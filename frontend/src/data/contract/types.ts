/**
 * 数据契约域类型：在「源字段名称 → 目标字段名称」之上补齐可执行口径
 * （数据类型转换、默认填充值、必填标识、唯一性校验），并把映射版本、
 * 规范化记录、字段映射结果、校验批次串成同一条调用链。
 */

/** 契约支持的目标数据类型 */
export type ContractDataType = '文本' | '整数' | '小数' | '布尔' | '日期'

/** 单条字段映射契约：一条映射规则（extractor 规则编号）对应一份可执行口径 */
export interface FieldContract {
  /** 对应字段映射模块的规则编号，如 EXTR-1001 */
  ruleCode: string
  /** 源字段名称（源数据列名，失败时按此定位具体列） */
  sourceField: string
  /** 目标字段名称（落库列名，失败时一并报告） */
  targetField: string
  /** 数据类型转换口径 */
  dataType: ContractDataType
  /** 默认填充值，空字符串表示不填充 */
  defaultValue: string
  /** 必填标识：必填字段即关键字段，整组映射的关键字段全部满足后才能交给结果校验 */
  required: boolean
  /** 唯一性校验：同批次内目标值不允许重复 */
  unique: boolean
}

export type MappingVersionStatus = '草稿' | '已发布' | '已废弃'

/**
 * 映射版本：一组契约的不可变快照。
 * 规则变更不覆盖旧版本，而是发布新版本；历史批次永久引用其生成时的版本。
 */
export interface MappingVersion {
  versionId: string
  /** 关联的抽取模板编号（调用链起点：模板字段） */
  templateCode: string
  /** 模板版本号 */
  templateVersion: string
  label: string
  contracts: FieldContract[]
  status: MappingVersionStatus
  publishedAt: string
  /** 上一份可用映射版本，事务失败时回退到它 */
  previousVersionId: string | null
  changeNote: string
}

export type TraceStage = '类型转换' | '默认填充' | '必填校验' | '唯一性校验'
export type TraceResult = '成功' | '缺值' | '转换失败' | '重复冲突' | '阻断'

/** 规范化处理记录：每个源字段的每一次处理都留痕，定位到源列与目标列 */
export interface NormalizationTrace {
  traceId: string
  batchId: string
  versionId: string
  businessKey: string
  ruleCode: string
  sourceField: string
  targetField: string
  stage: TraceStage
  result: TraceResult
  sourceValue: string
  normalizedValue: string
  message: string
  occurredAt: string
}

export type ViolationKind = '缺值' | '转换失败' | '重复冲突'

/** 契约违例：必须定位到具体源字段与目标字段 */
export interface ContractViolation {
  businessKey: string
  ruleCode: string
  sourceField: string
  targetField: string
  kind: ViolationKind
  message: string
}

export type MappingBatchStatus = '已生成' | '契约阻断'

/** 字段映射结果：一个批次按某一份映射版本规范化后的产物 */
export interface FieldMappingResult {
  batchId: string
  versionId: string
  templateCode: string
  businessFace: string
  businessKeyField: string
  status: MappingBatchStatus
  /** 关键字段（必填 + 唯一 + 类型）全部满足契约才为 true，否则不得交给结果校验 */
  contractPassed: boolean
  totalRows: number
  passedRows: number
  violations: ContractViolation[]
  traces: NormalizationTrace[]
  /** 通过契约的规范化行（目标字段 → 文本值） */
  normalizedRows: Record<string, string>[]
  generatedAt: string
}

export type ValidationBatchStatus = '待结果校验' | '已校验通过' | '已校验驳回'

export interface ValidationCheck {
  ruleCode: string
  targetField: string
  kind: '非空' | '数值范围' | '枚举'
  expected: string
  min?: number
  max?: number
  options?: string[]
}

export interface ValidationCheckDetail {
  ruleCode: string
  targetField: string
  expected: string
  actual: string
  passed: boolean
  message: string
}

/**
 * 校验批次：业务面的结果校验批次，必须引用同一份映射版本，
 * 同一业务面不允许按不同映射版本重复判定。
 */
export interface ValidationBatch {
  batchId: string
  businessFace: string
  /** 引用的映射版本，与字段映射结果锁定的版本保持一致 */
  mappingVersionId: string
  mappingBatchId: string
  status: ValidationBatchStatus
  checks: ValidationCheckDetail[]
  createdAt: string
  checkedAt: string | null
}

/** 提交映射批次的入参 */
export interface SubmitBatchInput {
  batchId: string
  versionId: string
  businessFace: string
  businessKeyField: string
  rows: Record<string, unknown>[]
}

export type SourceRow = Record<string, unknown>
