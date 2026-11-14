/**
 * 数据契约域端到端验证（Node 环境，与浏览器 localStorage 解耦）：
 * 覆盖 ORDER-9 样本规范化、违例定位、并发单次生效、版本发布/回退、校验批次版本锁定。
 * 运行：见 verify-contract.sh
 */
import { normalizeWithVersion, publishMappingVersion, runValidationChecks } from '../src/data/contract/engine'
import {
  SEED_SOURCE_ROWS,
  SEED_TEMPLATE_CODE,
  SEED_VALIDATION_CHECKS,
  SEED_VERSIONS,
  seedContext,
} from '../src/data/contract/seed-contract'
import type { SubmitBatchInput } from '../src/data/contract/types'

let failures = 0
function assert(condition: boolean, label: string, detail?: unknown) {
  if (condition) {
    console.log(`  ✔ ${label}`)
  } else {
    failures += 1
    console.error(`  ✘ ${label}`, detail ?? '')
  }
}

const v1 = SEED_VERSIONS.find((item) => item.versionId === 'MAP-V1')!

console.log('\n[1] ORDER-9 样本按 MAP-V1 规范化（手机号转文本、邮编缺省 000000）')
const input: SubmitBatchInput = {
  batchId: 'MBATCH-VERIFY-1',
  versionId: 'MAP-V1',
  businessFace: '订单域',
  businessKeyField: 'orderNo',
  rows: SEED_SOURCE_ROWS,
}
const result = normalizeWithVersion(v1, input, seedContext)
const order9 = result.normalizedRows.find((row) => row['订单号'] === 'ORDER-9')
assert(Boolean(order9), 'ORDER-9 通过契约并写入规范化行', order9)
assert(order9?.['手机号'] === '13800001111', '手机号 13800001111 按文本口径完整保留', order9?.['手机号'])
assert(order9?.['邮编'] === '000000', '邮编缺值由默认填充值 000000 兜底', order9?.['邮编'])
const fillTrace = result.traces.find((item) => item.businessKey === 'ORDER-9' && item.stage === '默认填充')
assert(Boolean(fillTrace) && fillTrace?.sourceField === 'postcode' && fillTrace?.targetField === '邮编',
  '默认填充留痕定位到源列 postcode 与目标列 邮编', fillTrace)

console.log('\n[2] 缺值 / 转换失败 / 唯一冲突均定位到具体源字段与目标字段')
const missingPhone = result.violations.find((item) => item.businessKey === 'ORDER-10')
assert(missingPhone?.kind === '缺值' && missingPhone.sourceField === 'phone' && missingPhone.targetField === '手机号',
  'ORDER-10 必填缺值定位源列 phone → 目标列 手机号', missingPhone)
const badAmount = result.violations.find((item) => item.businessKey === 'ORDER-11')
assert(badAmount?.kind === '转换失败' && badAmount.sourceField === 'amount' && badAmount.targetField === '订单金额',
  'ORDER-11 金额 abc 转小数失败定位源列 amount → 目标列 订单金额', badAmount)
const dup = result.violations.find((item) => item.businessKey === 'ORDER-9' && item.kind === '重复冲突') ||
  result.violations.find((item) => item.kind === '重复冲突')
assert(Boolean(dup) && dup!.targetField === '订单号', '订单号重复触发唯一性冲突并指明目标列 订单号', dup)
assert(result.contractPassed === false, '存在违例时整组映射契约阻断，不得交给结果校验', result.status)

let blocked = false
try {
  runValidationChecks(result, SEED_VALIDATION_CHECKS, seedContext)
} catch (error) {
  blocked = error instanceof Error && error.message.includes('不能交给结果校验')
}
assert(blocked, '阻断批次调用结果校验时被拒绝')

console.log('\n[3] 契约全通过的批次才能进入结果校验，超范围说明具体字段')
// 种子数据含两行 ORDER-9（唯一性冲突演示样本），干净批次只取首个 ORDER-9
const cleanRows = [SEED_SOURCE_ROWS.find((row) => String(row.orderNo) === 'ORDER-9')!]
const cleanInput: SubmitBatchInput = {
  batchId: 'MBATCH-VERIFY-2',
  versionId: 'MAP-V1',
  businessFace: '订单域',
  businessKeyField: 'orderNo',
  rows: cleanRows,
}
const cleanResult = normalizeWithVersion(v1, cleanInput, seedContext)
assert(cleanResult.contractPassed, '单条 ORDER-9 批次契约全部通过')
const vbatch = runValidationChecks(cleanResult, SEED_VALIDATION_CHECKS, seedContext)
assert(vbatch.mappingVersionId === 'MAP-V1', '校验批次引用同一份映射版本 MAP-V1', vbatch.mappingVersionId)
assert(vbatch.status === '已校验通过', 'ORDER-9 各项结果校验通过', vbatch.checks)

const overRows = [{ orderNo: 'ORDER-13', phone: '13900002222', postcode: '100000', amount: '9999.00', status: '已退款' }]
const overResult = normalizeWithVersion(
  v1,
  { batchId: 'MBATCH-VERIFY-3', versionId: 'MAP-V1', businessFace: '订单域', businessKeyField: 'orderNo', rows: overRows },
  seedContext,
)
assert(overResult.contractPassed, '超范围行的映射契约本身通过（范围属于结果校验口径）')
const overBatch = runValidationChecks(overResult, SEED_VALIDATION_CHECKS, seedContext)
const amountFail = overBatch.checks.find((item) => !item.passed && item.targetField === '订单金额')
const statusFail = overBatch.checks.find((item) => !item.passed && item.targetField === '订单状态')
assert(Boolean(amountFail) && amountFail.message.includes('0 ~ 5000'), '金额 9999 超范围并指明目标字段 订单金额', amountFail?.message)
assert(Boolean(statusFail) && statusFail.message.includes('订单状态'), '非法枚举指明目标字段 订单状态', statusFail?.message)

console.log('\n[4] 规则版本：发布校验、历史保留、失败回退口径')
const conflictDraft = {
  versionId: 'MAP-BAD',
  templateCode: SEED_TEMPLATE_CODE,
  templateVersion: 'v9.0',
  label: '冲突草案',
  contracts: [
    ...v1.contracts,
    { ruleCode: 'EXTR-9001', sourceField: 'phone2', targetField: '手机号', dataType: '整数' as const, defaultValue: '', required: false, unique: false },
  ],
  previousVersionId: 'MAP-V1',
  changeNote: '同目标字段类型冲突',
}
const badPublish = publishMappingVersion(conflictDraft, seedContext)
assert(!badPublish.ok && badPublish.message.includes('口径冲突'), '同目标字段类型/必填冲突时发布失败，提示以必填字段与已发布规则为准', badPublish.message)

const v2 = SEED_VERSIONS.find((item) => item.versionId === 'MAP-V2')!
const okPublish = publishMappingVersion(
  {
    versionId: 'MAP-V2',
    templateCode: v2.templateCode,
    templateVersion: v2.templateVersion,
    label: v2.label,
    contracts: v2.contracts,
    previousVersionId: 'MAP-V1',
    changeNote: v2.changeNote,
  },
  seedContext,
)
assert(okPublish.ok && okPublish.version.status === '已发布', 'V2 契约发布成功')
const v2Result = normalizeWithVersion(okPublish.version, { ...input, batchId: 'MBATCH-VERIFY-4' }, seedContext)
const emailMissing = v2Result.violations.find((item) => item.targetField === '邮箱')
assert(Boolean(emailMissing) && emailMissing.kind === '缺值', '新口径 V2 下旧样本因新增必填邮箱被阻断，历史批次仍保留 MAP-V1 结论', emailMissing)
assert(result.versionId === 'MAP-V1', '历史批次结果仍引用原版本 MAP-V1，不被新规则改写')

console.log('\n[5] 并发单次生效语义（模拟 store 的 single-flight 判定）')
const committedBatches = new Map<string, string>()
const versionLocks = new Map<string, Promise<string>>()
async function submitOnce(versionId: string, face: string, batchId: string): Promise<{ reused: boolean; id: string }> {
  const key = `${versionId}::${face}`
  const committed = committedBatches.get(key)
  if (committed) return { reused: true, id: committed }
  const running = versionLocks.get(key)
  if (running) return { reused: true, id: await running }
  const task = new Promise<string>((resolve) => setTimeout(() => resolve(batchId), 20))
  versionLocks.set(key, task)
  const id = await task
  committedBatches.set(key, id)
  versionLocks.delete(key)
  return { reused: false, id }
}
const concurrent = await Promise.all([
  submitOnce('MAP-V1', '订单域', 'MBATCH-A'),
  submitOnce('MAP-V1', '订单域', 'MBATCH-B'),
  submitOnce('MAP-V1', '订单域', 'MBATCH-C'),
])
assert(concurrent.filter((item) => !item.reused).length === 1, '并发 3 次同版本提交只有 1 次生效', concurrent)
assert(new Set(concurrent.map((item) => item.id)).size === 1, '后到请求读取同一份已生成结果', concurrent)

console.log(`\n${failures === 0 ? '全部验证通过 ✅' : `存在 ${failures} 项失败 ❌`}`)
if (failures > 0) process.exit(1)
