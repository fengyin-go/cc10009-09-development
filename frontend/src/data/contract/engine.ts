/**
 * 映射契约纯引擎：不依赖浏览器 / localStorage，可被本地服务与 Node 脚本直接复用。
 * 口径只有一份：必填标识与唯一性校验为准，类型转换失败与缺值都定位到具体源字段/目标字段。
 */
import type {
  ContractDataType,
  ContractViolation,
  FieldContract,
  FieldMappingResult,
  MappingVersion,
  NormalizationTrace,
  SourceRow,
  SubmitBatchInput,
  TraceResult,
  TraceStage,
  ValidationBatch,
  ValidationCheck,
  ValidationCheckDetail,
} from './types'

export interface EngineContext {
  now: () => Date
  id: (prefix: string) => string
}

export const defaultContext: EngineContext = {
  now: () => new Date(),
  id: (prefix) => `${prefix}-${Math.random().toString(36).slice(2, 10)}`,
}

function toText(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

export interface ConvertOutcome {
  ok: boolean
  value: string
  message: string
}

/** 按契约数据类型执行转换；失败信息带源列与目标列，交由调用方组装违例。 */
export function convertValue(raw: string, dataType: ContractDataType): ConvertOutcome {
  switch (dataType) {
    case '文本':
      // 手机号 13800001111 这类数字源值按文本口径保留完整字符，不做科学计数/裁剪
      return { ok: true, value: raw, message: '按文本口径原样保留' }
    case '整数': {
      if (!/^[+-]?\d+$/.test(raw)) {
        return { ok: false, value: '', message: `值「${raw}」无法转换为整数` }
      }
      return { ok: true, value: String(parseInt(raw, 10)), message: '已转换为整数' }
    }
    case '小数': {
      if (!/^[+-]?\d+(\.\d+)?$/.test(raw)) {
        return { ok: false, value: '', message: `值「${raw}」无法转换为小数` }
      }
      return { ok: true, value: String(Number(raw)), message: '已转换为小数' }
    }
    case '布尔': {
      if (['true', '1', '是', '真', 'Y'].includes(raw)) {
        return { ok: true, value: 'true', message: '已转换为布尔 true' }
      }
      if (['false', '0', '否', '假', 'N'].includes(raw)) {
        return { ok: true, value: 'false', message: '已转换为布尔 false' }
      }
      return { ok: false, value: '', message: `值「${raw}」无法转换为布尔` }
    }
    case '日期': {
      const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(raw)
      if (!match || Number.isNaN(new Date(raw).getTime())) {
        return { ok: false, value: '', message: `值「${raw}」无法转换为 YYYY-MM-DD 日期` }
      }
      const [, y, m, d] = match
      const value = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
      return { ok: true, value, message: '已规范化为 YYYY-MM-DD' }
    }
    default:
      return { ok: false, value: '', message: `未知数据类型「${String(dataType)}」` }
  }
}

function trace(
  ctx: EngineContext,
  base: Pick<NormalizationTrace, 'batchId' | 'versionId' | 'businessKey' | 'ruleCode' | 'sourceField' | 'targetField'>,
  stage: TraceStage,
  result: TraceResult,
  sourceValue: string,
  normalizedValue: string,
  message: string,
): NormalizationTrace {
  return {
    traceId: ctx.id('TRACE'),
    occurredAt: ctx.now().toISOString(),
    ...base,
    stage,
    result,
    sourceValue,
    normalizedValue,
    message,
  }
}

/**
 * 对一组源数据执行整组映射（需要映射版本快照）：
 * 1. 空值先按默认填充值补齐并留痕；
 * 2. 按数据类型转换，失败定位到源字段/目标字段；
 * 3. 必填标识作为关键字段口径，缺值即违例；
 * 4. 唯一性校验在整组范围内做，重复值定位到具体目标字段。
 * 只有全部关键字段契约满足（contractPassed）才允许进入结果校验。
 */
export function normalizeWithVersion(
  version: MappingVersion,
  input: SubmitBatchInput,
  ctx: EngineContext = defaultContext,
): FieldMappingResult {
  const traces: NormalizationTrace[] = []
  const violations: ContractViolation[] = []
  const normalizedRows: Record<string, string>[] = []
  /** 唯一性口径：目标字段 → 本批次已出现的「值 → 业务键」索引，跨行比对重复 */
  const uniqueSeen = new Map<string, Map<string, string>>()
  for (const contract of version.contracts.filter((item) => item.unique)) {
    uniqueSeen.set(contract.targetField, new Map())
  }

  input.rows.forEach((row: SourceRow, rowIndex) => {
    const businessKey = toText(row[input.businessKeyField]) || `第${rowIndex + 1}行`
    const normalized: Record<string, string> = {}
    let rowBlocked = false

    for (const contract of version.contracts) {
      const base = {
        batchId: input.batchId,
        versionId: input.versionId,
        businessKey,
        ruleCode: contract.ruleCode,
        sourceField: contract.sourceField,
        targetField: contract.targetField,
      }
      let raw = toText(row[contract.sourceField])

      // 1) 缺值 → 默认填充值（如邮编缺省 000000）
      if (raw === '') {
        if (contract.defaultValue !== '') {
          traces.push(
            trace(ctx, base, '默认填充', '成功', raw, contract.defaultValue,
              `源字段「${contract.sourceField}」缺值，按默认填充值写入目标字段「${contract.targetField}」`),
          )
          raw = contract.defaultValue
        } else if (contract.required) {
          // 2) 必填（关键字段）缺值，无默认值可兜底 → 阻断
          traces.push(
            trace(ctx, base, '必填校验', '缺值', '', '',
              `必填源字段「${contract.sourceField}」缺值，目标字段「${contract.targetField}」无默认值可填充`),
          )
          violations.push({
            businessKey,
            ruleCode: contract.ruleCode,
            sourceField: contract.sourceField,
            targetField: contract.targetField,
            kind: '缺值',
            message: `订单/记录「${businessKey}」源字段「${contract.sourceField}」→ 目标字段「${contract.targetField}」必填缺值`,
          })
          rowBlocked = true
          continue
        } else {
          traces.push(
            trace(ctx, base, '必填校验', '成功', '', '',
              `非必填源字段「${contract.sourceField}」缺值，目标字段「${contract.targetField}」保留空值`),
          )
          normalized[contract.targetField] = ''
          continue
        }
      }

      // 3) 数据类型转换
      const outcome = convertValue(raw, contract.dataType)
      if (!outcome.ok) {
        traces.push(
          trace(ctx, base, '类型转换', '转换失败', raw, '',
            `源字段「${contract.sourceField}」值「${raw}」转换为「${contract.dataType}」失败，目标字段「${contract.targetField}」未写入`),
        )
        violations.push({
          businessKey,
          ruleCode: contract.ruleCode,
          sourceField: contract.sourceField,
          targetField: contract.targetField,
          kind: '转换失败',
          message: `订单/记录「${businessKey}」源字段「${contract.sourceField}」→ 目标字段「${contract.targetField}」：${outcome.message}`,
        })
        rowBlocked = true
        continue
      }
      traces.push(
        trace(ctx, base, '类型转换', '成功', raw, outcome.value,
          `源字段「${contract.sourceField}」→ 目标字段「${contract.targetField}」：${outcome.message}`),
      )

      // 4) 唯一性校验：同批次同目标字段值不允许重复
      if (contract.unique) {
        const seen = uniqueSeen.get(contract.targetField)!
        const owner = seen.get(outcome.value)
        if (owner !== undefined) {
          traces.push(
            trace(ctx, base, '唯一性校验', '重复冲突', raw, outcome.value,
              `目标字段「${contract.targetField}」值「${outcome.value}」与记录「${owner}」重复，唯一性校验未通过`),
          )
          violations.push({
            businessKey,
            ruleCode: contract.ruleCode,
            sourceField: contract.sourceField,
            targetField: contract.targetField,
            kind: '重复冲突',
            message: `订单/记录「${businessKey}」源字段「${contract.sourceField}」→ 目标字段「${contract.targetField}」值「${outcome.value}」与「${owner}」重复，违反唯一性校验`,
          })
          rowBlocked = true
          continue
        }
        seen.set(outcome.value, businessKey)
        traces.push(
          trace(ctx, base, '唯一性校验', '成功', raw, outcome.value,
            `目标字段「${contract.targetField}」值「${outcome.value}」唯一性校验通过`),
        )
      }

      normalized[contract.targetField] = outcome.value
    }

    if (rowBlocked) {
      normalized.__blocked = businessKey
    } else {
      normalizedRows.push(normalized)
    }
  })

  const contractPassed = violations.length === 0
  return {
    batchId: input.batchId,
    versionId: version.versionId,
    templateCode: version.templateCode,
    businessFace: input.businessFace,
    businessKeyField: input.businessKeyField,
    status: contractPassed ? '已生成' : '契约阻断',
    contractPassed,
    totalRows: input.rows.length,
    passedRows: contractPassed ? input.rows.length : normalizedRows.length,
    violations,
    traces,
    normalizedRows,
    generatedAt: ctx.now().toISOString(),
  }
}

export interface PublishOutcome {
  ok: boolean
  version: MappingVersion
  message: string
}

/**
 * 发布新映射版本：规则变更只产生新版本，绝不覆盖历史版本。
 * 契约自身冲突（同目标字段口径不一致 / 缺少必填口径）时发布失败，
 * 调用方保持上一份已发布版本可用（事务回退）。
 */
export function publishMappingVersion(
  draft: Omit<MappingVersion, 'status' | 'publishedAt'>,
  ctx: EngineContext = defaultContext,
): PublishOutcome {
  if (draft.contracts.length === 0) {
    return { ok: false, version: { ...draft, status: '草稿', publishedAt: '' }, message: '映射契约为空，不能发布' }
  }
  const targetSeen = new Map<string, FieldContract>()
  for (const contract of draft.contracts) {
    if (!contract.sourceField || !contract.targetField) {
      return {
        ok: false,
        version: { ...draft, status: '草稿', publishedAt: '' },
        message: `规则 ${contract.ruleCode} 缺少源字段名称或目标字段名称`,
      }
    }
    const conflict = targetSeen.get(contract.targetField)
    if (conflict && (conflict.dataType !== contract.dataType || conflict.required !== contract.required)) {
      return {
        ok: false,
        version: { ...draft, status: '草稿', publishedAt: '' },
        message: `目标字段「${contract.targetField}」在规则 ${conflict.ruleCode} 与 ${contract.ruleCode} 间类型/必填口径冲突；类型冲突以必填字段与已发布规则为准`,
      }
    }
    targetSeen.set(contract.targetField, contract)
  }
  return {
    ok: true,
    version: { ...draft, status: '已发布', publishedAt: ctx.now().toISOString() },
    message: `映射版本 ${draft.versionId} 已发布，历史规则按原版本保留`,
  }
}

/**
 * 结果校验：字段映射结果按同一口径判定，超出期望值范围时说明具体目标字段。
 * 仅允许对 contractPassed 的映射结果执行，阻断批次不得进入。
 */
export function runValidationChecks(
  result: FieldMappingResult,
  checks: ValidationCheck[],
  ctx: EngineContext = defaultContext,
): ValidationBatch {
  if (!result.contractPassed) {
    throw new Error(
      `映射批次 ${result.batchId} 存在 ${result.violations.length} 条契约违例，关键字段未全部满足，不能交给结果校验`,
    )
  }
  const details: ValidationCheckDetail[] = []
  for (const check of checks) {
    for (const row of result.normalizedRows) {
      const actual = row[check.targetField] ?? ''
      let passed = true
      let message = '通过'
      switch (check.kind) {
        case '非空':
          passed = actual !== ''
          message = passed ? '通过' : `目标字段「${check.targetField}」为空，超出非空口径`
          break
        case '数值范围': {
          const num = Number(actual)
          passed = actual !== '' && !Number.isNaN(num)
            && (check.min === undefined || num >= check.min)
            && (check.max === undefined || num <= check.max)
          message = passed
            ? '通过'
            : `目标字段「${check.targetField}」实际值「${actual}」超出期望范围 ${check.expected}`
          break
        }
        case '枚举':
          passed = (check.options ?? []).includes(actual)
          message = passed
            ? '通过'
            : `目标字段「${check.targetField}」实际值「${actual}」不在枚举 ${check.expected} 内`
          break
      }
      details.push({
        ruleCode: check.ruleCode,
        targetField: check.targetField,
        expected: check.expected,
        actual,
        passed,
        message: passed ? message : `${message}（${result.businessKeyField} 对应行）`,
      })
    }
  }
  const rejected = details.some((item) => !item.passed)
  return {
    batchId: ctx.id('VBATCH'),
    businessFace: result.businessFace,
    mappingVersionId: result.versionId,
    mappingBatchId: result.batchId,
    status: rejected ? '已校验驳回' : '已校验通过',
    checks: details,
    createdAt: ctx.now().toISOString(),
    checkedAt: ctx.now().toISOString(),
  }
}
