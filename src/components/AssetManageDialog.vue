<script setup lang="ts">
import type { AssetPremiumEntry, AssetSettings } from '@/utils/assetCost'
import type { ExchangeRates } from '@/utils/financeHelper'
import type { NodeData } from '@/stores/nodes'
import { Icon } from '@iconify/vue'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { AppDialog } from '@/components/ui/app-dialog'
import { Button } from '@/components/ui/button'
import { getSiteConfig, saveConfig } from '@/monitor/config'
import { useAppStore } from '@/stores/app'
import {
  ASSET_CURRENCIES,
  ASSET_CURRENCY_LABELS,
  ASSET_RATE_PRESETS,
  billingCycleLabel,
  calculateAssetSummary,
  cnyToAssetCurrency,
  formatAssetMoney,
  formatOriginalMoney,
  isValidDateKey,
  normalizePremiums,
  remainingValueAt,
  serializePremiums,
  todayDateKey,
} from '@/utils/assetCost'
import { message } from '@/utils/message'

const props = defineProps<{
  open: boolean
  nodes: NodeData[]
  settings: AssetSettings
  rates: ExchangeRates
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
}>()

const appStore = useAppStore()
const errorText = ref('')
const saveState = ref<'idle' | 'pending' | 'saving' | 'saved' | 'error'>('idle')
const savedAt = ref<number | null>(null)
const draft = ref<AssetSettings>(cloneSettings(props.settings))
const today = todayDateKey()
const AUTO_SAVE_DELAY = 700

let hydrating = false
let alive = true
let saveTimer: ReturnType<typeof setTimeout> | undefined
let savePromise: Promise<void> | null = null
let revision = 0
let savedRevision = 0

function cloneSettings(settings: AssetSettings): AssetSettings {
  return {
    ...settings,
    ignored: [...settings.ignored],
    premiums: Object.fromEntries(
      Object.entries(settings.premiums).map(([uuid, entry]) => [uuid, { ...entry }]),
    ),
  }
}

function clearSaveTimer(): void {
  if (saveTimer !== undefined) clearTimeout(saveTimer)
  saveTimer = undefined
}

function scheduleSave(): void {
  if (hydrating || !alive || !props.open) return
  clearSaveTimer()
  saveState.value = 'pending'
  saveTimer = setTimeout(() => {
    saveTimer = undefined
    void flushSave()
  }, AUTO_SAVE_DELAY)
}

/** 自动保存当前资产设置；同一时间只允许一个 PUT，期间的新修改会在完成后补一次。 */
async function flushSave(): Promise<void> {
  clearSaveTimer()
  if (!alive || !props.open || hydrating) return
  if (rateUrlInvalid.value) {
    saveState.value = 'error'
    errorText.value = '汇率接口必须是 http(s) 地址，修正后会自动保存。'
    return
  }
  if (savePromise) {
    await savePromise
    return
  }
  if (revision === savedRevision && saveState.value !== 'error') return

  const savingRevision = revision
  saveState.value = 'saving'
  errorText.value = ''
  savePromise = (async () => {
    try {
      const current = getSiteConfig()
      const next = {
        ...current,
        assetCurrency: draft.value.currency,
        assetIgnoredNodes: draft.value.ignored.join(', '),
        assetPremiums: serializePremiums(draft.value.premiums),
        assetRateApiUrl: draft.value.rateUrl.trim(),
        assetRenewalWarningDays: draft.value.renewalWarningDays,
      }
      const saved = await saveConfig(next)
      if (!alive) return
      savedRevision = savingRevision
      savedAt.value = Date.now()
      if (appStore.publicSettings) {
        appStore.publicSettings = { ...appStore.publicSettings, theme_settings: saved }
      }
      if (revision === savingRevision) {
        saveState.value = 'saved'
      }
      else {
        saveState.value = 'pending'
        scheduleSave()
      }
    }
    catch (error) {
      saveState.value = 'error'
      errorText.value = error instanceof Error ? error.message : '自动保存失败，请稍后重试。'
    }
    finally {
      savePromise = null
    }
  })()
  await savePromise
  if (alive && revision !== savedRevision) scheduleSave()
}

watch(() => props.open, (open) => {
  clearSaveTimer()
  if (!open) return
  hydrating = true
  revision = 0
  savedRevision = 0
  draft.value = cloneSettings(props.settings)
  errorText.value = ''
  saveState.value = 'idle'
  savedAt.value = null
  void nextTick(() => { hydrating = false })
})

watch(draft, () => {
  if (hydrating || !props.open) return
  revision++
  scheduleSave()
}, { deep: true })

const sortedNodes = computed(() =>
  [...props.nodes].sort((a, b) => (a.weight || 0) - (b.weight || 0) || a.name.localeCompare(b.name, 'zh-CN')),
)

const ignoredSet = computed(() => new Set(draft.value.ignored.map(item => item.trim()).filter(Boolean)))
const rateUrlInvalid = computed(() => {
  const raw = draft.value.rateUrl.trim()
  if (!raw) return false
  try {
    const { protocol } = new URL(raw)
    return protocol !== 'http:' && protocol !== 'https:'
  }
  catch {
    return true
  }
})

async function close(): Promise<void> {
  clearSaveTimer()
  for (let attempt = 0; attempt < 3 && revision !== savedRevision && saveState.value !== 'error'; attempt++) {
    await flushSave()
  }
  emit('update:open', false)
}

function retrySave(): void {
  errorText.value = ''
  saveState.value = 'pending'
  void flushSave()
}

function entryFor(uuid: string): AssetPremiumEntry {
  const current = draft.value.premiums[uuid]
  if (current) return current
  const entry: AssetPremiumEntry = { amount: 0 }
  draft.value.premiums[uuid] = entry
  return entry
}

function formatMonths(months: number | null): string {
  if (months == null) return ''
  return months < 10 ? months.toFixed(1) : String(Math.round(months))
}

function displayMoney(amountCny: number): string {
  const converted = cnyToAssetCurrency(amountCny, draft.value.currency, props.rates)
  return converted == null ? formatAssetMoney(amountCny, 'CNY') : formatAssetMoney(converted, draft.value.currency)
}

function hasEntry(uuid: string): boolean {
  const entry = draft.value.premiums[uuid]
  return Boolean(entry && (entry.amount !== 0 || entry.paidCny != null || entry.acquiredAt || entry.acquiredExpiry))
}

function setAmount(uuid: string, raw: string): void {
  const value = Number(raw)
  entryFor(uuid).amount = Number.isFinite(value) ? value : 0
}

function autoCalculatePremium(node: NodeData): void {
  const entry = draft.value.premiums[node.uuid]
  if (!entry || entry.paidCny == null || !entry.acquiredAt) return
  const basis = remainingValueAt(node, entry.acquiredAt, props.rates, Date.now(), entry.acquiredExpiry)
  if (basis == null) return
  const amount = Math.round((entry.paidCny - basis) * 100) / 100
  if (entry.amount !== amount) entry.amount = amount
}

function setPaid(node: NodeData, raw: string): void {
  const entry = entryFor(node.uuid)
  if (raw.trim() === '') {
    delete entry.paidCny
    return
  }
  const value = Number(raw)
  if (Number.isFinite(value) && value >= 0) {
    entry.paidCny = value
    autoCalculatePremium(node)
  }
}

function setDate(node: NodeData, raw: string): void {
  const entry = entryFor(node.uuid)
  if (!raw) {
    delete entry.acquiredAt
    return
  }
  if (raw <= today) {
    entry.acquiredAt = raw
    // 收购日往后改时，早于它的“收购日到期日期”不再可信。
    if (entry.acquiredExpiry && entry.acquiredExpiry < raw) delete entry.acquiredExpiry
    autoCalculatePremium(node)
  }
}

function setAcquiredExpiry(node: NodeData, raw: string): void {
  const entry = entryFor(node.uuid)
  if (!raw) {
    delete entry.acquiredExpiry
    autoCalculatePremium(node)
    return
  }
  if (!isValidDateKey(raw)) return
  if (entry.acquiredAt && raw < entry.acquiredAt) {
    message.warning('收购日到期日期不能早于收购日期。')
    return
  }
  entry.acquiredExpiry = raw
  autoCalculatePremium(node)
}

function clearEntry(node: NodeData): void {
  delete draft.value.premiums[node.uuid]
}

function toggleIgnored(node: NodeData): void {
  const next = new Set(ignoredSet.value)
  const name = node.name.trim()
  if (next.has(name)) next.delete(name)
  else {
    // 同名节点极少见；优先写名称，命中 UUID 的历史值也一并清掉。
    next.delete(node.uuid)
    next.add(name)
  }
  draft.value.ignored = [...next]
}

function isIgnored(node: NodeData): boolean {
  return ignoredSet.value.has(node.name.trim()) || ignoredSet.value.has(node.uuid)
}

const previewSummary = computed(() => calculateAssetSummary(
  sortedNodes.value,
  { ...draft.value, ignored: [] },
  props.rates,
  Date.now(),
))

const previewByUuid = computed(() => new Map(previewSummary.value.details.map(detail => [detail.uuid, detail])))

function previewFor(node: NodeData) {
  if (!hasEntry(node.uuid)) return null
  return previewByUuid.value.get(node.uuid) ?? null
}

const configuredCount = computed(() =>
  Object.keys(normalizePremiums(draft.value.premiums)).length,
)

const savedTime = computed(() =>
  savedAt.value ? new Date(savedAt.value).toLocaleTimeString('zh-CN', { hour12: false }) : '',
)

onBeforeUnmount(() => {
  alive = false
  clearSaveTimer()
})
</script>

<template>
  <AppDialog
    :open="open"
    title="资产管理设置"
    description="币种、临期阈值、忽略节点与收购溢价 · 修改自动保存"
    content-class="max-w-7xl"
    @update:open="close"
  >
    <div class="asset-manage">
      <div class="asset-manage-notice">
        <Icon icon="tabler:info-circle" width="15" height="15" aria-hidden="true" />
        <span>这些设置保存在站点主题配置中，所有访客均可读取。请勿填写 token、密码等敏感信息。</span>
      </div>

      <section class="asset-manage-section">
        <h3>统计口径</h3>
        <div class="asset-manage-grid">
          <label class="asset-field">
            <span>汇总币种</span>
            <select v-model="draft.currency">
              <option v-for="item in ASSET_CURRENCIES" :key="item" :value="item">
                {{ ASSET_CURRENCY_LABELS[item] }}
              </option>
            </select>
          </label>
          <label class="asset-field">
            <span>临期提醒天数</span>
            <input v-model.number="draft.renewalWarningDays" type="number" min="1" max="365" step="1">
          </label>
          <div class="asset-field asset-field--wide">
            <span class="asset-field-head"><span>汇率接口</span><small>留空使用默认</small></span>
            <div class="asset-rate-presets" role="group" aria-label="汇率接口预设">
              <button
                v-for="preset in ASSET_RATE_PRESETS"
                :key="preset.id"
                type="button"
                :data-active="draft.rateUrl === preset.url"
                :aria-pressed="draft.rateUrl === preset.url"
                :title="preset.url"
                @click="draft.rateUrl = preset.url"
              >
                {{ preset.label }}
              </button>
            </div>
            <input v-model="draft.rateUrl" type="url" aria-label="汇率接口" placeholder="https://api.frankfurter.dev/v2/rates?base=USD" :aria-invalid="rateUrlInvalid">
            <small>点击上方预设一键切换，也可直接输入自定义链接；支持 CNY / USD 基准和 Frankfurter 数组格式。</small>
          </div>
        </div>
      </section>

      <section class="asset-manage-section">
        <div class="asset-manage-heading">
          <h3>忽略节点</h3>
          <span>{{ ignoredSet.size }} 台不计入汇总</span>
        </div>
        <div class="asset-node-picker">
          <label v-for="node in sortedNodes" :key="node.uuid" class="asset-node-check">
            <input type="checkbox" :checked="isIgnored(node)" @change="toggleIgnored(node)">
            <span class="asset-node-check-name">{{ node.name }}</span>
            <span class="asset-node-check-meta">{{ formatOriginalMoney(node.price, node.currency) }}</span>
          </label>
          <p v-if="sortedNodes.length === 0" class="asset-manage-empty">暂无节点。</p>
        </div>
      </section>

      <section class="asset-manage-section">
        <div class="asset-manage-heading">
          <h3>收购溢价</h3>
          <span>{{ configuredCount }} 台已记录</span>
        </div>
        <p class="asset-manage-hint">
          溢价 = 收购价 − 收购日剩余价值，单位为人民币；负数表示折价买入。填写收购日期后，溢价按「收购日 → 收购日到期日期」摊销；该日期留空时才回退到节点当前到期日，避免续费后摊销期被拉长。
        </p>

        <div class="asset-premium-table-wrap">
          <table class="asset-premium-table">
            <thead>
              <tr>
                <th>节点</th>
                <th>账单价格</th>
                <th>当前剩余</th>
                <th>溢价 ¥</th>
                <th>收购价 ¥</th>
                <th>收购日期</th>
                <th>收购日到期日期</th>
                <th>摊销预览</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="node in sortedNodes" :key="node.uuid" :data-ignored="isIgnored(node)">
                <td>
                  <span class="asset-premium-name">{{ node.name }}</span>
                  <small v-if="isIgnored(node)" class="asset-premium-ignored">已忽略</small>
                </td>
                <td class="tabular-nums">
                  {{ formatOriginalMoney(node.price, node.currency) }}<span class="asset-premium-cycle">/{{ billingCycleLabel(node.billing_cycle) }}</span>
                </td>
                <td class="tabular-nums">
                  {{ displayMoney(previewByUuid.get(node.uuid)?.remainingCny ?? 0) }}
                </td>
                <td>
                  <input
                    class="asset-premium-input"
                    type="number"
                    step="0.01"
                    :aria-label="`${node.name} 收购溢价（人民币）`"
                    :value="hasEntry(node.uuid) ? draft.premiums[node.uuid]?.amount ?? 0 : ''"
                    placeholder="0"
                    @input="setAmount(node.uuid, ($event.target as HTMLInputElement).value)"
                  >
                </td>
                <td>
                  <input
                    class="asset-premium-input"
                    type="number"
                    min="0"
                    step="0.01"
                    :aria-label="`${node.name} 收购价（人民币）`"
                    :value="draft.premiums[node.uuid]?.paidCny ?? ''"
                    placeholder="选填"
                    @input="setPaid(node, ($event.target as HTMLInputElement).value)"
                  >
                </td>
                <td>
                  <input
                    class="asset-premium-input asset-premium-date"
                    type="date"
                    :max="today"
                    :aria-label="`${node.name} 收购日期`"
                    :value="draft.premiums[node.uuid]?.acquiredAt ?? ''"
                    @input="setDate(node, ($event.target as HTMLInputElement).value)"
                  >
                </td>
                <td>
                  <input
                    class="asset-premium-input asset-premium-date"
                    type="date"
                    :min="draft.premiums[node.uuid]?.acquiredAt || undefined"
                    :aria-label="`${node.name} 收购日到期日期`"
                    :value="draft.premiums[node.uuid]?.acquiredExpiry ?? ''"
                    @input="setAcquiredExpiry(node, ($event.target as HTMLInputElement).value)"
                  >
                </td>
                <td>
                  <div class="asset-premium-preview">
                    <template v-if="previewFor(node)">
                      <span>{{ displayMoney(previewFor(node)!.premiumCny) }}</span>
                      <small v-if="previewFor(node)!.amortMonths != null">
                        月摊 {{ displayMoney(previewFor(node)!.premiumMonthlyCny) }} · {{ formatMonths(previewFor(node)!.amortMonths) }} 月
                      </small>
                      <small v-else>未填收购日期，不摊销</small>
                    </template>
                    <span v-else class="asset-premium-muted">—</span>
                  </div>
                </td>
                <td>
                  <div class="asset-premium-actions">
                    <button v-if="hasEntry(node.uuid)" type="button" :title="`清除 ${node.name} 的溢价记录`" :aria-label="`清除 ${node.name} 的溢价记录`" @click="clearEntry(node)">
                      <Icon icon="tabler:trash" width="14" height="14" />
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <footer class="asset-manage-footer">
        <div class="asset-save-status" :class="saveState === 'error' && 'is-error'" role="status" aria-live="polite">
          <template v-if="saveState === 'saving'">
            <Icon icon="tabler:loader-2" width="14" height="14" class="asset-spin" aria-hidden="true" />
            正在自动保存…
          </template>
          <template v-else-if="saveState === 'pending'">
            <Icon icon="tabler:clock" width="14" height="14" aria-hidden="true" />
            修改后自动保存…
          </template>
          <template v-else-if="saveState === 'saved'">
            <Icon icon="tabler:cloud-check" width="14" height="14" aria-hidden="true" />
            已自动保存到站点<template v-if="savedTime"> · {{ savedTime }}</template>
          </template>
          <template v-else-if="saveState === 'error'">
            <Icon icon="tabler:alert-circle" width="14" height="14" aria-hidden="true" />
            <span>{{ errorText || '自动保存失败' }}</span>
            <Button size="sm" variant="outline" class="h-7" @click="retrySave">重试</Button>
          </template>
          <template v-else>
            <Icon icon="tabler:cloud" width="14" height="14" aria-hidden="true" />
            修改后自动保存到站点
          </template>
        </div>
        <div class="asset-save-actions">
          <Button variant="outline" @click="close">关闭</Button>
        </div>
      </footer>
    </div>
  </AppDialog>
</template>

<style scoped>
.asset-manage { display: flex; flex-direction: column; gap: 1.1rem; }
.asset-manage-notice { display: flex; align-items: flex-start; gap: 0.45rem; border: 1px solid color-mix(in oklch, var(--warning) 30%, var(--border)); border-radius: 0.55rem; background: color-mix(in oklch, var(--warning) 7%, transparent); padding: 0.6rem 0.7rem; color: var(--muted-foreground); font-size: 0.72rem; line-height: 1.6; }
.asset-manage-section { border: 1px solid color-mix(in oklch, var(--border) 80%, transparent); border-radius: 0.75rem; background: color-mix(in oklch, var(--card) 50%, transparent); padding: 0.9rem; }
.asset-manage-section h3 { margin: 0; font-size: 0.86rem; font-weight: 650; }
.asset-manage-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 0.75rem; margin-bottom: 0.55rem; }
.asset-manage-heading > span { color: var(--muted-foreground); font-size: 0.7rem; }
.asset-manage-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.75rem; margin-top: 0.7rem; }
.asset-field { display: flex; min-width: 0; flex-direction: column; gap: 0.3rem; color: var(--muted-foreground); font-size: 0.72rem; }
.asset-field--wide { grid-column: 1 / -1; }
.asset-field-head { display: flex; align-items: baseline; justify-content: space-between; gap: 0.75rem; }
.asset-field-head small { color: var(--muted-foreground); font-size: 0.65rem; }
.asset-rate-presets { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.35rem; }
.asset-rate-presets button { min-height: 2rem; border: 1px solid color-mix(in oklch, var(--border) 85%, transparent); border-radius: 0.45rem; background: color-mix(in srgb, var(--background) 82%, transparent); padding: 0 0.45rem; color: var(--muted-foreground); font-size: 0.68rem; font-weight: 620; line-height: 1.2; transition: background 140ms ease, border-color 140ms ease, color 140ms ease; }
.asset-rate-presets button:hover { border-color: color-mix(in oklch, var(--ring) 45%, var(--border)); color: var(--foreground); }
.asset-rate-presets button[data-active="true"] { border-color: color-mix(in oklch, var(--selection) 55%, var(--border)); background: color-mix(in oklch, var(--selection) 12%, transparent); color: var(--foreground); box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--selection) 18%, transparent); }
.asset-field select, .asset-field input { width: 100%; min-height: 2.1rem; border: 1px solid var(--input); border-radius: 0.45rem; background: var(--background); padding: 0 0.55rem; color: var(--foreground); font: inherit; outline: none; }
.asset-field select:focus-visible, .asset-field input:focus-visible, .asset-premium-input:focus-visible { border-color: var(--ring); box-shadow: 0 0 0 3px color-mix(in oklch, var(--ring) 22%, transparent); }
.asset-field small, .asset-manage-hint { color: var(--muted-foreground); font-size: 0.68rem; line-height: 1.65; }
.asset-node-picker { display: grid; grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr)); gap: 0.3rem 0.8rem; max-height: 12rem; overflow: auto; padding-right: 0.2rem; }
.asset-node-check { display: flex; min-width: 0; align-items: center; gap: 0.45rem; border-radius: 0.35rem; padding: 0.28rem 0.3rem; font-size: 0.75rem; cursor: pointer; }
.asset-node-check:hover { background: color-mix(in oklch, var(--accent) 60%, transparent); }
.asset-node-check input { accent-color: var(--selection); }
.asset-node-check-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.asset-node-check-meta { margin-left: auto; color: var(--muted-foreground); font-size: 0.68rem; font-variant-numeric: tabular-nums; }
.asset-premium-table-wrap { margin-top: 0.65rem; overflow-x: auto; border: 1px solid color-mix(in oklch, var(--border) 72%, transparent); border-radius: 0.55rem; }
.asset-premium-table { width: 100%; min-width: 68rem; border-collapse: collapse; font-size: 0.72rem; }
.asset-premium-table th { border-bottom: 1px solid var(--border); padding: 0.45rem 0.5rem; color: var(--muted-foreground); font-size: 0.64rem; font-weight: 650; letter-spacing: 0.04em; text-align: left; white-space: nowrap; }
.asset-premium-table td { border-bottom: 1px solid color-mix(in oklch, var(--border) 55%, transparent); padding: 0.35rem 0.5rem; vertical-align: middle; white-space: nowrap; }
.asset-premium-table tr:last-child td { border-bottom: 0; }
.asset-premium-table tr[data-ignored="true"] { opacity: 0.62; }
.asset-premium-name { display: block; max-width: 10rem; overflow: hidden; text-overflow: ellipsis; font-weight: 600; }
.asset-premium-ignored { display: inline-block; border-radius: 0.25rem; background: color-mix(in oklch, var(--muted-foreground) 15%, transparent); padding: 0 0.25rem; color: var(--muted-foreground); font-size: 0.6rem; }
.asset-premium-cycle { color: var(--muted-foreground); font-size: 0.62rem; }
.asset-premium-input { width: 6.4rem; height: 1.85rem; border: 1px solid var(--input); border-radius: 0.35rem; background: var(--background); padding: 0 0.4rem; color: var(--foreground); font: inherit; font-variant-numeric: tabular-nums; outline: none; }
.asset-premium-date { width: 8.2rem; }
.asset-premium-preview { display: flex; flex-direction: column; gap: 0.1rem; font-variant-numeric: tabular-nums; }
.asset-premium-preview small { color: var(--muted-foreground); font-size: 0.62rem; }
.asset-premium-muted { color: var(--muted-foreground); }
.asset-premium-actions { display: flex; align-items: center; gap: 0.2rem; }
.asset-premium-actions button { display: inline-grid; width: 1.65rem; height: 1.65rem; place-items: center; border: 1px solid transparent; border-radius: 0.35rem; color: var(--muted-foreground); transition: background 140ms ease, color 140ms ease; }
.asset-premium-actions button:hover:not(:disabled) { background: var(--accent); color: var(--foreground); }
.asset-premium-actions button:disabled { cursor: not-allowed; opacity: 0.35; }
.asset-manage-empty { color: var(--muted-foreground); font-size: 0.72rem; }
.asset-manage-footer { position: sticky; bottom: 0; z-index: 2; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.75rem; border-top: 1px solid var(--border); background: color-mix(in srgb, var(--card) 93%, transparent); padding: 0.85rem 0 0.2rem; backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); }
.asset-save-status { display: flex; min-width: 0; flex-wrap: wrap; align-items: center; gap: 0.35rem; color: var(--muted-foreground); font-size: 0.7rem; line-height: 1.5; }
.asset-save-status.is-error { color: color-mix(in oklch, var(--destructive) 85%, var(--foreground)); }
.asset-save-actions { display: flex; gap: 0.5rem; margin-left: auto; }
.asset-spin { animation: asset-spin 900ms linear infinite; }
@keyframes asset-spin { to { transform: rotate(360deg); } }
@media (max-width: 640px) {
  .asset-manage-grid { grid-template-columns: 1fr; }
  .asset-manage-footer { align-items: stretch; flex-direction: column; }
  .asset-save-actions { width: 100%; margin-left: 0; }
  .asset-save-actions :deep(button) { flex: 1; }
  .asset-rate-presets { grid-template-columns: 1fr; }
}
</style>
