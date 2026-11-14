/**
 * 数据契约域本地持久化：
 * - 映射版本只追加不覆盖，规则变更产生新版本，历史批次永久引用原版本；
 * - 同一映射版本并发提交只生效一次（single-flight），后到请求直接读取已生成结果；
 * - 发布事务失败时回退到上一份可用映射版本；
 * - 业务面校验批次锁定映射版本，同一业务面不允许按不同版本重复判定；
 * - 每次规范化处理记录（NormalizationTrace）随结果持久化。
 */
import { defaultContext, normalizeWithVersion, publishMappingVersion, runValidationChecks } from './engine'
import {
  SEED_MAPPING_RESULT,
  SEED_SOURCE_ROWS,
  SEED_VALIDATION_BATCHES,
  SEED_VALIDATION_CHECKS,
  SEED_VERSIONS,
} from './seed-contract'
import type {
  FieldContract,
  FieldMappingResult,
  MappingVersion,
  NormalizationTrace,
  SubmitBatchInput,
  ValidationBatch,
  ValidationCheck,
} from './types'

const VERSION_KEY = 'scraper-config-studio:contract-versions'
const RESULT_KEY = 'scraper-config-studio:contract-results'
const TRACE_KEY = 'scraper-config-studio:contract-traces'
const VBATCH_KEY = 'scraper-config-studio:contract-vbatches'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function read<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined' || !window.localStorage) return clone(fallback)
  const raw = window.localStorage.getItem(key)
  if (!raw) {
    window.localStorage.setItem(key, JSON.stringify(fallback))
    return clone(fallback)
  }
  try {
    return JSON.parse(raw) as T
  } catch {
    window.localStorage.setItem(key, JSON.stringify(fallback))
    return clone(fallback)
  }
}

function write<T>(key: string, value: T): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(key, JSON.stringify(value))
  }
}

// ---- 映射版本（不可变快照，追加式） ----

export function listVersions(): MappingVersion[] {
  return read<MappingVersion[]>(VERSION_KEY, SEED_VERSIONS)
}

export function getVersion(versionId: string): MappingVersion | undefined {
  return listVersions().find((item) => item.versionId === versionId)
}

function latestPublishedVersion(): MappingVersion | undefined {
  return [...listVersions()]
    .reverse()
    .find((item) => item.status === '已发布')
}

export interface PublishDraftInput {
  templateCode: string
  templateVersion: string
  label: string
  changeNote: string
  contracts: FieldContract[]
}

export interface StoreOutcome<T> {
  ok: boolean
  message: string
  data?: T
}

/**
 * 发布新映射版本（事务语义）：
 * 先在草稿快照上做契约校验，失败则不动任何已发布版本（回退到上一份可用映射）；
 * 成功后把当前已发布版本标记为已废弃，新版本成为唯一已发布口径，旧版本数据原样保留。
 */
export function publishNewVersion(input: PublishDraftInput): StoreOutcome<MappingVersion> {
  const versions = listVersions()
  const current = latestPublishedVersion()
  const nextId = `MAP-V${versions.filter((item) => item.versionId.startsWith('MAP-V')).length + 1}`
  const draft: Omit<MappingVersion, 'status' | 'publishedAt'> = {
    versionId: nextId,
    templateCode: input.templateCode,
    templateVersion: input.templateVersion,
    label: input.label,
    contracts: input.contracts,
    previousVersionId: current?.versionId ?? null,
    changeNote: input.changeNote,
  }
  const outcome = publishMappingVersion(draft, defaultContext)
  if (!outcome.ok) {
    // 事务失败：不写入新版本，已发布版本指针保持指向上一份可用映射
    return { ok: false, message: `发布已回退，沿用上一份可用映射 ${current?.versionId ?? '无'}：${outcome.message}` }
  }
  const nextVersions = versions.map((item) =>
    item.status === '已发布' ? { ...item, status: '已废弃' as const } : item,
  )
  nextVersions.push(outcome.version)
  write(VERSION_KEY, nextVersions)
  return { ok: true, message: outcome.message, data: outcome.version }
}

/** 手工回退：把指定版本恢复为已发布，当前已发布版本废弃；用于事务失败后的人工兜底。 */
export function rollbackToVersion(versionId: string): StoreOutcome<MappingVersion> {
  const versions = listVersions()
  const target = versions.find((item) => item.versionId === versionId)
  if (!target) return { ok: false, message: `映射版本 ${versionId} 不存在` }
  const nextVersions = versions.map((item) => ({
    ...item,
    status: item.versionId === versionId ? ('已发布' as const) : item.status === '已发布' ? ('已废弃' as const) : item.status,
  }))
  write(VERSION_KEY, nextVersions)
  return { ok: true, message: `已回退到上一份可用映射版本 ${versionId}`, data: nextVersions.find((item) => item.versionId === versionId) }
}

// ---- 字段映射结果 + 规范化记录 ----

export function listResults(): FieldMappingResult[] {
  return read<FieldMappingResult[]>(RESULT_KEY, [SEED_MAPPING_RESULT])
}

export function listTraces(): NormalizationTrace[] {
  const seeded = listResults().flatMap((item) => item.traces)
  const stored = read<NormalizationTrace[]>(TRACE_KEY, [])
  // 种子批次的规范化记录直接从结果派生，用户批次的增量记录从独立存储读取
  const storedIds = new Set(stored.map((item) => item.traceId))
  return [...seeded.filter((item) => !storedIds.has(item.traceId)), ...stored]
}

/** 进程内 single-flight 锁：同一映射版本并发提交期间只允许一次规范化生效。 */
const inflight = new Map<string, Promise<FieldMappingResult>>()

/**
 * 提交映射批次：
 * 1. 同一映射版本已有生成结果时直接复用（后到请求读取已生成结果，不重复判定）；
 * 2. 并发请求共享同一个 in-flight Promise，只提交一次；
 * 3. 抛错时清除锁并回退已发布版本指针，保证下一次仍沿用上一份可用映射。
 */
export async function submitMappingBatch(input: SubmitBatchInput): Promise<StoreOutcome<FieldMappingResult>> {
  const results = listResults()
  const existing = results.find((item) => item.versionId === input.versionId && item.businessFace === input.businessFace)
  if (existing) {
    return {
      ok: true,
      message: `映射版本 ${input.versionId} 已生成过结果，后到请求直接读取已生成批次 ${existing.batchId}`,
      data: existing,
    }
  }
  const lockKey = `${input.versionId}::${input.businessFace}`
  const running = inflight.get(lockKey)
  if (running) {
    const shared = await running
    return { ok: true, message: `并发提交命中单次生效锁，复用进行中批次 ${shared.batchId}`, data: shared }
  }

  const version = getVersion(input.versionId)
  if (!version) {
    return { ok: false, message: `映射版本 ${input.versionId} 不存在，无法提交` }
  }
  if (version.status !== '已发布') {
    return { ok: false, message: `映射版本 ${input.versionId} 状态为「${version.status}」，只有已发布版本才能提交批次` }
  }

  const task = (async (): Promise<FieldMappingResult> => {
    // 模拟异步事务窗口，便于并发请求命中同一把锁
    await new Promise((resolve) => setTimeout(resolve, 120))
    const result = normalizeWithVersion(version, input, defaultContext)
    const nextResults = [...listResults(), result]
    write(RESULT_KEY, nextResults)
    const storedTraces = read<NormalizationTrace[]>(TRACE_KEY, [])
    write(TRACE_KEY, [...storedTraces, ...result.traces])
    return result
  })()

  inflight.set(lockKey, task)
  try {
    const result = await task
    return {
      ok: true,
      message: result.contractPassed
        ? `批次 ${result.batchId} 关键字段全部满足契约，可交给结果校验`
        : `批次 ${result.batchId} 契约阻断：${result.violations.length} 条违例，定位信息见违例清单，不得进入结果校验`,
      data: result,
    }
  } catch (error) {
    // 事务失败：回退到上一份可用映射版本
    const current = latestPublishedVersion()
    if (current?.previousVersionId) {
      rollbackToVersion(current.previousVersionId)
    }
    return {
      ok: false,
      message: `映射事务失败，已退回上一份可用映射：${error instanceof Error ? error.message : String(error)}`,
    }
  } finally {
    inflight.delete(lockKey)
  }
}

// ---- 业务面校验批次（锁定同一份映射版本） ----

export function listValidationBatches(): ValidationBatch[] {
  return read<ValidationBatch[]>(VBATCH_KEY, SEED_VALIDATION_BATCHES)
}

export function getValidationChecks(): ValidationCheck[] {
  return clone(SEED_VALIDATION_CHECKS)
}

/**
 * 创建校验批次：
 * 同一业务面只能存在一个映射版本口径；已按旧版本判定过的业务面，
 * 不允许再拿别的映射版本重复判定。校验对象必须是契约通过的字段映射结果。
 */
export function createValidationBatch(mappingBatchId: string): StoreOutcome<ValidationBatch> {
  const result = listResults().find((item) => item.batchId === mappingBatchId)
  if (!result) return { ok: false, message: `字段映射批次 ${mappingBatchId} 不存在` }
  if (!result.contractPassed) {
    return {
      ok: false,
      message: `映射批次 ${mappingBatchId} 关键字段未全部满足契约（${result.violations.length} 条违例），整组映射不能交给结果校验`,
    }
  }
  const batches = listValidationBatches()
  const sameFace = batches.find((item) => item.businessFace === result.businessFace)
  if (sameFace && sameFace.mappingVersionId !== result.versionId) {
    return {
      ok: false,
      message: `业务面「${result.businessFace}」已按映射版本 ${sameFace.mappingVersionId} 判定，不能再按 ${result.versionId} 重复判定；历史规则按原版本保留`,
    }
  }
  const batch = runValidationChecks(result, getValidationChecks(), defaultContext)
  write(VBATCH_KEY, [...batches, batch])
  return {
    ok: true,
    message:
      batch.status === '已校验通过'
        ? `校验批次 ${batch.batchId} 已通过，引用映射版本 ${batch.mappingVersionId}`
        : `校验批次 ${batch.batchId} 已驳回，${batch.checks.filter((item) => !item.passed).length} 项超出口径，具体字段见明细`,
    data: batch,
  }
}

export function resetContractDomain(): void {
  for (const key of [VERSION_KEY, RESULT_KEY, TRACE_KEY, VBATCH_KEY]) {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(key)
    }
  }
}

export { SEED_SOURCE_ROWS }
