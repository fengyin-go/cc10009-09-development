/**
 * 契约 store 端到端验证：用内存版 localStorage 垫片，验证
 * single-flight 并发提交、后到请求复用、校验批次版本锁定、事务失败回退。
 */
// 必须在导入 store 之前装好垫片（模块顶层只读一次 localStorage）
const memory = new Map<string, string>()
const localStorageShim = {
  getItem: (key: string) => (memory.has(key) ? memory.get(key)! : null),
  setItem: (key: string, value: string) => void memory.set(key, value),
  removeItem: (key: string) => void memory.delete(key),
  clear: () => memory.clear(),
}
Object.assign(globalThis, { window: { localStorage: localStorageShim }, localStorage: localStorageShim })

import {
  createValidationBatch,
  listResults,
  listValidationBatches,
  listVersions,
  publishNewVersion,
  resetContractDomain,
  rollbackToVersion,
  submitMappingBatch,
} from '../src/data/contract/contract-store'
import { SEED_SOURCE_ROWS } from '../src/data/contract/seed-contract'

let failures = 0
function assert(condition: boolean, label: string, detail?: unknown) {
  if (condition) console.log(`  ✔ ${label}`)
  else {
    failures += 1
    console.error(`  ✘ ${label}`, detail ?? '')
  }
}

resetContractDomain()

console.log('\n[A] 同一映射版本并发提交只生效一次，后到请求读取已生成结果')
const stamp = Date.now()
const concurrent = await Promise.all(
  [0, 1, 2].map((index) =>
    submitMappingBatch({
      batchId: `MBATCH-CONC-${stamp}-${index}`,
      versionId: 'MAP-V1',
      businessFace: '订单域',
      businessKeyField: 'orderNo',
      rows: SEED_SOURCE_ROWS,
    }),
  ),
)
assert(concurrent.every((item) => item.ok), '三个并发请求均成功返回', concurrent.map((i) => i.message))
const resultIds = new Set(concurrent.map((item) => item.data?.batchId))
assert(resultIds.size === 1, '三个请求拿到同一个映射批次（仅一次生效）', [...resultIds])
const storedCount = listResults().filter((item) => item.businessFace === '订单域' && item.versionId === 'MAP-V1').length
assert(storedCount === 1, '存储层只落了一份映射结果', storedCount)
const after = await submitMappingBatch({
  batchId: 'MBATCH-LATE',
  versionId: 'MAP-V1',
  businessFace: '订单域',
  businessKeyField: 'orderNo',
  rows: SEED_SOURCE_ROWS,
})
assert(after.message.includes('已生成过结果'), '后到请求直接读取已生成结果而不重新判定', after.message)

console.log('\n[B] 阻断批次不能创建校验批次；通过批次锁定映射版本')
const blockedBatch = listResults().find((item) => !item.contractPassed)!
const blockedValidation = createValidationBatch(blockedBatch.batchId)
assert(!blockedValidation.ok && blockedValidation.message.includes('不能交给结果校验'),
  '契约阻断批次创建校验批次被拒绝', blockedValidation.message)

// 用干净的单行数据生成一份契约通过的批次
const clean = await submitMappingBatch({
  batchId: 'MBATCH-CLEAN-1',
  versionId: 'MAP-V1',
  businessFace: '履约域',
  businessKeyField: 'orderNo',
  rows: [SEED_SOURCE_ROWS.find((row) => String(row.orderNo) === 'ORDER-9')!],
})
assert(Boolean(clean.data?.contractPassed), '干净批次契约通过')
const validation = createValidationBatch(clean.data!.batchId)
assert(validation.ok && validation.data?.mappingVersionId === 'MAP-V1', '校验批次引用同一份映射版本 MAP-V1', validation.message)

console.log('\n[C] 同一业务面不允许按不同映射版本重复判定')
const v2Published = publishNewVersion({
  templateCode: 'TEMP-0009',
  templateVersion: 'v2.0',
  label: '订单字段映射契约 V2（正式）',
  changeNote: '新增邮箱必填',
  contracts: listVersions().find((item) => item.versionId === 'MAP-V2')!.contracts,
})
assert(v2Published.ok, 'V2 发布成功，V1 转为已废弃但数据保留', v2Published.message)
const v2Clean = await submitMappingBatch({
  batchId: 'MBATCH-CLEAN-V2',
  versionId: v2Published.data!.versionId,
  businessFace: '履约域',
  businessKeyField: 'orderNo',
  rows: [{ orderNo: 'ORDER-99', phone: '13500009999', postcode: '', amount: '66.00', status: '已支付', email: 'a@b.cn' }],
})
const reJudge = createValidationBatch(v2Clean.data!.batchId)
assert(!reJudge.ok && reJudge.message.includes('不能再按'), '同业务面换版本重复判定被拒绝', reJudge.message)
assert(listValidationBatches().length === 1, '业务面仍只保留原版本口径的一份校验批次', listValidationBatches().length)

console.log('\n[D] 事务失败回退到上一份可用映射版本')
const before = listVersions().find((item) => item.status === '已发布')
const bad = publishNewVersion({
  templateCode: 'TEMP-0009',
  templateVersion: 'v3.0',
  label: '冲突版本',
  changeNote: '同目标字段口径冲突',
  contracts: [
    ...listVersions().find((item) => item.versionId === 'MAP-V2')!.contracts,
    { ruleCode: 'EXTR-9009', sourceField: 'phoneX', targetField: '手机号', dataType: '整数', defaultValue: '', required: false, unique: false },
  ],
})
assert(!bad.ok && bad.message.includes('发布已回退'), '冲突版本发布失败并回退', bad.message)
const afterPublished = listVersions().find((item) => item.status === '已发布')
assert(afterPublished?.versionId === before?.versionId, '已发布版本指针保持在上一份可用映射', afterPublished?.versionId)
const manual = rollbackToVersion('MAP-V1')
assert(manual.ok && listVersions().find((item) => item.versionId === 'MAP-V1')?.status === '已发布',
  '人工回退 MAP-V1 恢复为已发布', manual.message)

console.log(`\n${failures === 0 ? 'store 层全部验证通过 ✅' : `存在 ${failures} 项失败 ❌`}`)
if (failures > 0) process.exit(1)
