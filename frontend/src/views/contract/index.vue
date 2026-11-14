<template>
  <section class="page" data-module="contract">
    <header class="page-head">
      <div>
        <h2>数据契约 · 映射校验</h2>
        <p class="page-desc">
          沿着「模板字段 → 映射规则（数据契约）→ 校验批次」的调用链执行：类型转换、默认填充、必填与唯一性口径全部可执行，
          每次规范化处理均留痕，失败定位到具体源字段与目标字段。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="resetAll">重置契约数据</button>
      </div>
    </header>

    <!-- 调用链 -->
    <div class="chain-bar">
      <span class="chain-node">① 抽取模板 {{ templateCode }}（模板字段）</span>
      <span class="chain-arrow">→</span>
      <span class="chain-node">② 映射规则 EXTR-10xx（数据契约 / 映射版本）</span>
      <span class="chain-arrow">→</span>
      <span class="chain-node">③ 字段映射结果（规范化留痕）</span>
      <span class="chain-arrow">→</span>
      <span class="chain-node">④ 校验批次（引用同一份映射版本）</span>
    </div>

    <!-- 一、映射版本：不可变快照 -->
    <h3 class="section-title">一、映射版本与数据契约（规则变更只追加新版本，历史规则按原版本保留）</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>映射版本</th>
          <th>关联模板</th>
          <th>契约条数</th>
          <th>状态</th>
          <th>发布时间</th>
          <th>上一可用版本</th>
          <th>变更说明</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="version in versions" :key="version.versionId">
          <td>{{ version.versionId }}<br /><span class="muted">{{ version.label }}</span></td>
          <td>{{ version.templateCode }} / {{ version.templateVersion }}</td>
          <td>{{ version.contracts.length }}</td>
          <td>
            <span :class="['tag', version.status === '已发布' ? 'tag-green' : version.status === '草稿' ? 'tag-gray' : 'tag-amber']">
              {{ version.status }}
            </span>
          </td>
          <td>{{ version.publishedAt ? formatTime(version.publishedAt) : '—' }}</td>
          <td>{{ version.previousVersionId ?? '—' }}</td>
          <td>{{ version.changeNote }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="inspectVersion(version)">查看契约</button>
            <button
              v-if="version.status === '草稿'"
              class="link"
              type="button"
              @click="publishDraft(version)"
            >发布新版本</button>
            <button
              v-if="version.status === '已废弃'"
              class="link"
              type="button"
              @click="rollback(version)"
            >回退此版本</button>
          </td>
        </tr>
      </tbody>
    </table>

    <!-- 契约明细 -->
    <div v-if="activeVersion" class="detail-panel">
      <div class="panel-head">
        <strong>{{ activeVersion.versionId }} 契约明细（必填字段与唯一性校验为判定口径）</strong>
        <button class="btn ghost" type="button" @click="activeVersion = null">关闭</button>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>规则编号</th><th>源字段名称（源列）</th><th>目标字段名称（目标列）</th>
            <th>数据类型转换</th><th>默认填充值</th><th>必填标识</th><th>唯一性校验</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="contract in activeVersion.contracts" :key="contract.ruleCode">
            <td>{{ contract.ruleCode }}</td>
            <td>{{ contract.sourceField }}</td>
            <td>{{ contract.targetField }}</td>
            <td>{{ contract.dataType }}</td>
            <td>{{ contract.defaultValue || '—' }}</td>
            <td>
              <span :class="['tag', contract.required ? 'tag-green' : 'tag-gray']">
                {{ contract.required ? '必填（关键字段）' : '非必填' }}
              </span>
            </td>
            <td>
              <span :class="['tag', contract.unique ? 'tag-amber' : 'tag-gray']">
                {{ contract.unique ? '唯一' : '不校验' }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 二、提交映射批次 -->
    <h3 class="section-title">二、提交映射批次（同一映射版本并发只提交一次，后到请求读取已生成结果）</h3>
    <div class="submit-panel">
      <label class="filter-item">
        <span>映射版本</span>
        <select v-model="submitVersionId">
          <option v-for="version in publishedVersions" :key="version.versionId" :value="version.versionId">
            {{ version.versionId }}（{{ version.templateCode }}）
          </option>
        </select>
      </label>
      <label class="filter-item">
        <span>业务面</span>
        <input v-model="businessFace" placeholder="如：订单域" />
      </label>
      <label class="filter-item">
        <span>业务键列名（失败定位用）</span>
        <input v-model="businessKeyField" placeholder="如：orderNo" />
      </label>
      <div class="btn-cluster">
        <button class="btn primary" type="button" :disabled="submitting" @click="submitOnce">提交映射批次</button>
        <button class="btn" type="button" :disabled="submitting" @click="submitConcurrent">
          模拟并发提交 ×3（同版本）
        </button>
      </div>
    </div>
    <p class="muted small">内置样本（ORDER-9 等 5 行，覆盖正常 / 缺值 / 转换失败 / 唯一冲突 / 超范围）：</p>
    <pre class="json-box">{{ sampleJson }}</pre>

    <p v-if="actionMessage" :class="['action-msg', lastOk ? 'ok-text' : 'error-text']">{{ actionMessage }}</p>

    <!-- 三、字段映射结果 -->
    <h3 class="section-title">三、字段映射结果（关键字段全部满足契约后才能交给结果校验）</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>映射批次</th><th>业务面</th><th>引用映射版本</th><th>总行数</th>
          <th>通过行数</th><th>违例数</th><th>契约结论</th><th>生成时间</th><th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="result in results" :key="result.batchId">
          <td>{{ result.batchId }}</td>
          <td>{{ result.businessFace }}</td>
          <td>{{ result.versionId }}</td>
          <td>{{ result.totalRows }}</td>
          <td>{{ result.passedRows }}</td>
          <td>{{ result.violations.length }}</td>
          <td>
            <span :class="['tag', result.contractPassed ? 'tag-green' : 'tag-red']">
              {{ result.contractPassed ? '契约通过' : '契约阻断' }}
            </span>
          </td>
          <td>{{ formatTime(result.generatedAt) }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="inspectResult(result)">违例/数据</button>
            <button
              class="link"
              type="button"
              :disabled="!result.contractPassed"
              @click="createValidation(result)"
            >创建校验批次</button>
          </td>
        </tr>
      </tbody>
    </table>

    <!-- 违例 + 规范化行 -->
    <div v-if="activeResult" class="detail-panel">
      <div class="panel-head">
        <strong>{{ activeResult.batchId }} 违例清单与规范化数据</strong>
        <button class="btn ghost" type="button" @click="activeResult = null">关闭</button>
      </div>
      <p v-if="!activeResult.violations.length" class="ok-text small">关键字段（必填 + 唯一 + 类型）全部满足契约。</p>
      <table v-if="activeResult.violations.length" class="data-table">
        <thead>
          <tr><th>业务记录</th><th>规则编号</th><th>源字段（源列）</th><th>目标字段（目标列）</th><th>违例类型</th><th>定位说明</th></tr>
        </thead>
        <tbody>
          <tr v-for="(item, index) in activeResult.violations" :key="index">
            <td>{{ item.businessKey }}</td>
            <td>{{ item.ruleCode }}</td>
            <td class="error-text">{{ item.sourceField }}</td>
            <td class="error-text">{{ item.targetField }}</td>
            <td>{{ item.kind }}</td>
            <td>{{ item.message }}</td>
          </tr>
        </tbody>
      </table>
      <p class="small muted">通过契约的规范化行（{{ activeResult.normalizedRows.length }} 行）：</p>
      <pre class="json-box">{{ JSON.stringify(activeResult.normalizedRows, null, 2) }}</pre>
    </div>

    <!-- 四、规范化处理记录 -->
    <h3 class="section-title">四、规范化处理记录（每次处理都留痕，可按批次与处理阶段过滤）</h3>
    <form class="filter-bar" @submit.prevent>
      <label class="filter-item">
        <span>批次</span>
        <select v-model="traceBatchFilter">
          <option value="">全部批次</option>
          <option v-for="result in results" :key="result.batchId" :value="result.batchId">{{ result.batchId }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>处理阶段</span>
        <select v-model="traceStageFilter">
          <option value="">全部阶段</option>
          <option value="默认填充">默认填充</option>
          <option value="类型转换">类型转换</option>
          <option value="必填校验">必填校验</option>
          <option value="唯一性校验">唯一性校验</option>
        </select>
      </label>
    </form>
    <table class="data-table">
      <thead>
        <tr>
          <th>记录编号</th><th>批次</th><th>映射版本</th><th>业务记录</th><th>规则</th>
          <th>源字段 → 目标字段</th><th>阶段</th><th>结论</th><th>源值</th><th>规范化值</th><th>说明</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in filteredTraces" :key="item.traceId">
          <td>{{ item.traceId }}</td>
          <td>{{ item.batchId }}</td>
          <td>{{ item.versionId }}</td>
          <td>{{ item.businessKey }}</td>
          <td>{{ item.ruleCode }}</td>
          <td>{{ item.sourceField }} → {{ item.targetField }}</td>
          <td>{{ item.stage }}</td>
          <td>
            <span :class="['tag', item.result === '成功' ? 'tag-green' : item.result === '重复冲突' ? 'tag-amber' : 'tag-red']">
              {{ item.result }}
            </span>
          </td>
          <td>{{ item.sourceValue || '∅' }}</td>
          <td>{{ item.normalizedValue || '∅' }}</td>
          <td class="small">{{ item.message }}</td>
        </tr>
      </tbody>
    </table>

    <!-- 五、校验批次 -->
    <h3 class="section-title">五、业务面校验批次（引用同一份映射版本，按同一口径判定，超范围说明具体字段）</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>校验批次</th><th>业务面</th><th>映射版本</th><th>映射批次</th>
          <th>校验项</th><th>未通过项</th><th>结论</th><th>校验时间</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="batch in validationBatches" :key="batch.batchId">
          <td>{{ batch.batchId }}</td>
          <td>{{ batch.businessFace }}</td>
          <td>{{ batch.mappingVersionId }}</td>
          <td>{{ batch.mappingBatchId }}</td>
          <td>{{ batch.checks.length }}</td>
          <td>{{ batch.checks.filter((c) => !c.passed).length }}</td>
          <td>
            <span :class="['tag', batch.status === '已校验通过' ? 'tag-green' : 'tag-red']">{{ batch.status }}</span>
          </td>
          <td>{{ batch.checkedAt ? formatTime(batch.checkedAt) : '—' }}</td>
        </tr>
        <tr v-if="!validationBatches.length">
          <td colspan="8" class="empty-state">暂无校验批次：契约通过的映射批次才可创建</td>
        </tr>
      </tbody>
    </table>
    <div v-for="batch in validationBatches" :key="`${batch.batchId}-detail`" class="detail-panel">
      <div class="panel-head"><strong>{{ batch.batchId }} 校验明细（口径：{{ batch.mappingVersionId }}）</strong></div>
      <table class="data-table">
        <thead>
          <tr><th>校验规则</th><th>目标字段</th><th>期望口径</th><th>实际值</th><th>结论</th><th>说明</th></tr>
        </thead>
        <tbody>
          <tr v-for="(detail, index) in batch.checks" :key="index">
            <td>{{ detail.ruleCode }}</td>
            <td>{{ detail.targetField }}</td>
            <td>{{ detail.expected }}</td>
            <td>{{ detail.actual }}</td>
            <td>
              <span :class="['tag', detail.passed ? 'tag-green' : 'tag-red']">
                {{ detail.passed ? '通过' : '超范围' }}
              </span>
            </td>
            <td class="small">{{ detail.message }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  createValidationBatch,
  getVersion,
  listResults,
  listTraces,
  listValidationBatches,
  listVersions,
  publishNewVersion,
  resetContractDomain,
  rollbackToVersion,
  submitMappingBatch,
} from '@/data/contract/contract-store'
import { SEED_SOURCE_ROWS, SEED_TEMPLATE_CODE } from '@/data/contract/seed-contract'
import type { FieldMappingResult, MappingVersion, NormalizationTrace } from '@/data/contract/types'

const templateCode = SEED_TEMPLATE_CODE
const versions = ref<MappingVersion[]>([])
const results = ref<FieldMappingResult[]>([])
const traces = ref<NormalizationTrace[]>([])
const validationBatches = ref<ReturnType<typeof listValidationBatches>>([])
const activeVersion = ref<MappingVersion | null>(null)
const activeResult = ref<FieldMappingResult | null>(null)
const actionMessage = ref('')
const lastOk = ref(true)
const submitting = ref(false)
const submitVersionId = ref('MAP-V1')
const businessFace = ref('订单域')
const businessKeyField = ref('orderNo')
const traceBatchFilter = ref('')
const traceStageFilter = ref('')
const sampleJson = JSON.stringify(SEED_SOURCE_ROWS, null, 2)

const publishedVersions = computed(() => versions.value.filter((item) => item.status === '已发布'))

const filteredTraces = computed(() =>
  traces.value.filter(
    (item) =>
      (traceBatchFilter.value === '' || item.batchId === traceBatchFilter.value)
      && (traceStageFilter.value === '' || item.stage === traceStageFilter.value),
  ),
)

function formatTime(value: string): string {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—'
}

function notify(ok: boolean, message: string) {
  lastOk.value = ok
  actionMessage.value = message
}

function reload() {
  versions.value = listVersions()
  results.value = listResults()
  traces.value = listTraces()
  validationBatches.value = listValidationBatches()
  const published = versions.value.find((item) => item.status === '已发布')
  if (published && !versions.value.some((item) => item.versionId === submitVersionId.value && item.status === '已发布')) {
    submitVersionId.value = published.versionId
  }
}

function inspectVersion(version: MappingVersion) {
  activeVersion.value = version
  activeResult.value = null
}

function inspectResult(result: FieldMappingResult) {
  activeResult.value = result
  activeVersion.value = null
}

function publishDraft(version: MappingVersion) {
  const outcome = publishNewVersion({
    templateCode: version.templateCode,
    templateVersion: version.templateVersion,
    label: version.label.replace('草稿', '正式'),
    changeNote: version.changeNote,
    contracts: version.contracts,
  })
  notify(outcome.ok, outcome.message)
  reload()
}

function rollback(version: MappingVersion) {
  const outcome = rollbackToVersion(version.versionId)
  notify(outcome.ok, outcome.message)
  reload()
}

async function submitOnce() {
  if (submitting.value) return
  submitting.value = true
  try {
    const batchId = `MBATCH-${Date.now()}`
    const outcome = await submitMappingBatch({
      batchId,
      versionId: submitVersionId.value,
      businessFace: businessFace.value.trim() || '订单域',
      businessKeyField: businessKeyField.value.trim() || 'orderNo',
      rows: SEED_SOURCE_ROWS,
    })
    notify(outcome.ok, outcome.message)
    reload()
  } finally {
    submitting.value = false
  }
}

async function submitConcurrent() {
  if (submitting.value) return
  submitting.value = true
  try {
    const stamp = Date.now()
    const tasks = [0, 1, 2].map((index) =>
      submitMappingBatch({
        batchId: `MBATCH-CONC-${stamp}-${index}`,
        versionId: submitVersionId.value,
        businessFace: businessFace.value.trim() || '订单域',
        businessKeyField: businessKeyField.value.trim() || 'orderNo',
        rows: SEED_SOURCE_ROWS,
      }),
    )
    const outcomes = await Promise.all(tasks)
    const rejected = outcomes.filter((item) => !item.ok)
    notify(
      rejected.length === 0,
      rejected.length === 0
        ? `并发 3 次提交完成：同一映射版本只生效一次，后到请求均读取已生成结果（${outcomes.map((item) => item.data?.batchId).join(' / ')}）`
        : rejected.map((item) => item.message).join('；'),
    )
    reload()
  } finally {
    submitting.value = false
  }
}

function createValidation(result: FieldMappingResult) {
  const outcome = createValidationBatch(result.batchId)
  notify(outcome.ok, outcome.message)
  reload()
}

function resetAll() {
  resetContractDomain()
  reload()
  notify(true, '契约域数据已重置为种子状态（MAP-V1 已发布、ORDER-9 样本批次恢复）')
}

onMounted(() => {
  reload()
  const published = getVersion(submitVersionId.value)
  if (published) {
    notify(true, `样本订单 ORDER-9 已按 ${published.versionId} 预置：手机号 13800001111 按文本保留，邮编缺值由默认值 000000 兜底`)
  }
})
</script>
