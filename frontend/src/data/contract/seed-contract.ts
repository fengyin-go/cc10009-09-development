/**
 * 数据契约域种子数据：
 * 调用链 = 抽取模板 TEMP-0009 → 映射规则 EXTR-10xx（契约版本 MAP-V1/MAP-V2）→ 校验批次 VALI-10xx。
 * 样本订单 ORDER-9：手机号 13800001111 按文本口径保留，邮编缺值由默认值 000000 兜底。
 */
import { normalizeWithVersion, runValidationChecks, type EngineContext } from './engine'
import type {
  FieldMappingResult,
  MappingVersion,
  SourceRow,
  ValidationBatch,
  ValidationCheck,
} from './types'

/** 固定时钟与序列，保证种子数据在每次重置后一致。 */
export const seedContext: EngineContext = {
  now: () => new Date('2026-11-14T09:00:00.000Z'),
  id: (() => {
    const counters = new Map<string, number>()
    return (prefix: string) => {
      const next = (counters.get(prefix) ?? 0) + 1
      counters.set(prefix, next)
      return `${prefix}-SEED-${String(next).padStart(3, '0')}`
    }
  })(),
}

export const SEED_TEMPLATE_CODE = 'TEMP-0009'

export const SEED_VERSIONS: MappingVersion[] = [
  {
    versionId: 'MAP-V1',
    templateCode: SEED_TEMPLATE_CODE,
    templateVersion: 'v1.0',
    label: '订单字段映射契约 V1（已发布口径）',
    status: '已发布',
    publishedAt: '2026-11-01T08:30:00.000Z',
    previousVersionId: null,
    changeNote: '首版发布：订单号必填唯一、手机号按文本保留、邮编缺省 000000',
    contracts: [
      {
        ruleCode: 'EXTR-1001',
        sourceField: 'orderNo',
        targetField: '订单号',
        dataType: '文本',
        defaultValue: '',
        required: true,
        unique: true,
      },
      {
        ruleCode: 'EXTR-1002',
        sourceField: 'phone',
        targetField: '手机号',
        dataType: '文本',
        defaultValue: '',
        required: true,
        unique: true,
      },
      {
        ruleCode: 'EXTR-1003',
        sourceField: 'postcode',
        targetField: '邮编',
        dataType: '文本',
        defaultValue: '000000',
        required: false,
        unique: false,
      },
      {
        ruleCode: 'EXTR-1004',
        sourceField: 'amount',
        targetField: '订单金额',
        dataType: '小数',
        defaultValue: '',
        required: true,
        unique: false,
      },
      {
        ruleCode: 'EXTR-1005',
        sourceField: 'status',
        targetField: '订单状态',
        dataType: '文本',
        defaultValue: '',
        required: true,
        unique: false,
      },
    ],
  },
  {
    versionId: 'MAP-V2',
    templateCode: SEED_TEMPLATE_CODE,
    templateVersion: 'v2.0',
    label: '订单字段映射契约 V2（草稿，新增邮箱必填口径）',
    status: '草稿',
    publishedAt: '',
    previousVersionId: 'MAP-V1',
    changeNote: '规则变更草案：新增邮箱必填字段；旧批次仍按 MAP-V1 判定，发布后新批次按 V2 口径',
    contracts: [
      {
        ruleCode: 'EXTR-1001',
        sourceField: 'orderNo',
        targetField: '订单号',
        dataType: '文本',
        defaultValue: '',
        required: true,
        unique: true,
      },
      {
        ruleCode: 'EXTR-1002',
        sourceField: 'phone',
        targetField: '手机号',
        dataType: '文本',
        defaultValue: '',
        required: true,
        unique: true,
      },
      {
        ruleCode: 'EXTR-1003',
        sourceField: 'postcode',
        targetField: '邮编',
        dataType: '文本',
        defaultValue: '000000',
        required: false,
        unique: false,
      },
      {
        ruleCode: 'EXTR-1004',
        sourceField: 'amount',
        targetField: '订单金额',
        dataType: '小数',
        defaultValue: '',
        required: true,
        unique: false,
      },
      {
        ruleCode: 'EXTR-1005',
        sourceField: 'status',
        targetField: '订单状态',
        dataType: '文本',
        defaultValue: '',
        required: true,
        unique: false,
      },
      {
        ruleCode: 'EXTR-1006',
        sourceField: 'email',
        targetField: '邮箱',
        dataType: '文本',
        defaultValue: '',
        required: true,
        unique: false,
      },
    ],
  },
]

/** 结果校验口径：业务面校验批次与映射批次引用同一份映射版本，按同一口径判定。 */
export const SEED_VALIDATION_CHECKS: ValidationCheck[] = [
  { ruleCode: 'VALI-1001', targetField: '订单号', kind: '非空', expected: '非空' },
  { ruleCode: 'VALI-1002', targetField: '订单金额', kind: '数值范围', expected: '0 ~ 5000', min: 0, max: 5000 },
  { ruleCode: 'VALI-1003', targetField: '订单状态', kind: '枚举', expected: '待支付/已支付/已发货/已完成', options: ['待支付', '已支付', '已发货', '已完成'] },
]

/** 演示源数据：覆盖正常、缺值、类型转换失败、唯一性冲突与超出结果校验范围五类场景。 */
export const SEED_SOURCE_ROWS: SourceRow[] = [
  // ORDER-9：题目样本——手机号 13800001111 转文本，邮编缺省 000000
  { orderNo: 'ORDER-9', phone: '13800001111', postcode: '', amount: '299.50', status: '已支付' },
  // 手机号缺值且无默认值 → 必填缺值，报告源列 phone 与目标列 手机号
  { orderNo: 'ORDER-10', phone: '', postcode: '310000', amount: '88.00', status: '待支付' },
  // 金额 abc 无法转小数 → 转换失败，报告源列 amount 与目标列 订单金额
  { orderNo: 'ORDER-11', phone: '13700003333', postcode: '200000', amount: 'abc', status: '已发货' },
  // 订单号与 ORDER-9 重复 → 唯一性冲突，报告目标列 订单号
  { orderNo: 'ORDER-9', phone: '13600004444', postcode: '', amount: '120.00', status: '已完成' },
  // 契约全部通过，但金额 9999 超出结果校验 0~5000 范围 → 结果校验驳回并指明字段
  { orderNo: 'ORDER-13', phone: '13900002222', postcode: '100000', amount: '9999.00', status: '已退款' },
]

/** 首屏预置一份已生成的映射结果（MAP-V1 口径），规范化记录随结果一并落盘。 */
function buildSeedResult(): FieldMappingResult {
  const v1 = SEED_VERSIONS.find((item) => item.versionId === 'MAP-V1')!
  return normalizeWithVersion(
    v1,
    {
      batchId: 'MBATCH-SEED-001',
      versionId: 'MAP-V1',
      businessFace: '订单域',
      businessKeyField: 'orderNo',
      rows: SEED_SOURCE_ROWS,
    },
    seedContext,
  )
}

export const SEED_MAPPING_RESULT: FieldMappingResult = buildSeedResult()

/** 预置批次只做展示，尚未创建业务面校验批次（阻断状态也不允许进入结果校验）。 */
export const SEED_VALIDATION_BATCHES: ValidationBatch[] = []
