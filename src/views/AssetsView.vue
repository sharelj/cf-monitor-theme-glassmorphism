<script setup lang="ts">
import type { AssetCurrency, AssetDetail } from '@/utils/assetCost'
import type { AssetRateSource } from '@/utils/assetRates'
import type { ExchangeRates } from '@/utils/financeHelper'
import { Icon } from '@iconify/vue'
import { useNow } from '@vueuse/core'
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch, watchEffect } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { Button } from '@/components/ui/button'
import { useAssetSettings } from '@/composables/useAssetSettings'
import { useAppStore } from '@/stores/app'
import { useNodesStore } from '@/stores/nodes'
import {
  billingCycleLabel,
  calculateAssetSummary,
  cnyToAssetCurrency,
  formatAssetMoney,
  formatOriginalMoney,
  formatSignedAssetMoney,
  splitAssetMoney,
} from '@/utils/assetCost'
import {
  hasRate,
  loadAssetRates,
  rateSourceLabel,
} from '@/utils/assetRates'
import { DEFAULT_EXCHANGE_RATES } from '@/utils/financeHelper'
import { getRegionCode, getRegionDisplayName } from '@/utils/regionHelper'
import { isHomeLoaded, loadHomeServers } from '@/cfsm/data'

const AssetManageDialog = defineAsyncComponent(() => import('@/components/AssetManageDialog.vue'))

type SortField = 'weight' | 'price' | 'remaining' | 'premium' | 'premiumMonthly' | 'expiry'
type SortDirection = 'asc' | 'desc'

const router = useRouter()
const route = useRoute()
const appStore = useAppStore()
const nodesStore = useNodesStore()
const { settings, pageVisible } = useAssetSettings()

const nodes = computed(() => nodesStore.visibleNodes)
const now = useNow({ interval: 60_000 })
const rates = ref<ExchangeRates>({ ...DEFAULT_EXCHANGE_RATES })
const rateSource = ref<AssetRateSource>('loading')
const ratesUpdatedAt = ref<number | null>(null)
const ratesError = ref('')
const loadingRates = ref(false)
const manageOpen = ref(false)
let rateRequest = 0

const targetCurrency = computed<AssetCurrency>(() => settings.value.currency)
const displayCurrency = computed<AssetCurrency>(() => hasRate(rates.value, targetCurrency.value) ? targetCurrency.value : 'CNY')
const currencyFallback = computed(() => displayCurrency.value !== targetCurrency.value)

const summary = computed(() => calculateAssetSummary(
  nodes.value,
  settings.value,
  rates.value,
  now.value.getTime(),
))

const mobileSortOptions: Array<{ field: SortField, label: string }> = [
  { field: 'weight', label: '默认' },
  { field: 'price', label: '价格' },
  { field: 'remaining', label: '剩余' },
  { field: 'expiry', label: '到期' },
]

const sortField = ref<SortField>('weight')
const sortDirection = ref<SortDirection>('asc')
const NATURAL_DIRECTION: Record<SortField, SortDirection> = {
  weight: 'asc',
  price: 'desc',
  remaining: 'desc',
  premium: 'desc',
  premiumMonthly: 'desc',
  expiry: 'asc',
}

const columns: Array<{ field: SortField, label: string, numeric?: boolean }> = [
  { field: 'weight', label: '节点' },
  { field: 'price', label: '价格', numeric: true },
  { field: 'remaining', label: '剩余价值', numeric: true },
  { field: 'premium', label: '溢价', numeric: true },
  { field: 'premiumMonthly', label: '溢价月摊', numeric: true },
  { field: 'expiry', label: '到期', numeric: true },
]

function sortValue(detail: AssetDetail, field: SortField): number {
  switch (field) {
    case 'price': return detail.priceCny
    case 'remaining': return detail.remainingCny
    case 'premium': return detail.premiumCny
    case 'premiumMonthly': return detail.premiumMonthlyCny
    case 'expiry': return detail.expiresIn ?? Number.POSITIVE_INFINITY
    default: return detail.weight
  }
}

const rows = computed(() => {
  const direction = sortDirection.value === 'asc' ? 1 : -1
  return [...summary.value.details].sort((a, b) => {
    if (a.counted !== b.counted) return a.counted ? -1 : 1
    return (sortValue(a, sortField.value) - sortValue(b, sortField.value)) * direction
      || a.name.localeCompare(b.name, 'zh-CN')
  })
})

const renewals = computed(() => summary.value.details
  .filter(detail => detail.expiresIn != null && detail.expiresIn <= settings.value.renewalWarningDays)
  .sort((a, b) => (a.expiresIn ?? 0) - (b.expiresIn ?? 0)))

const hasPremium = computed(() => summary.value.premiumTotalCny !== 0)
const hasPremiumMonthly = computed(() => summary.value.premiumMonthlyTotalCny !== 0)
const canManage = computed(() => appStore.privateFeaturesAllowed)

const hero = computed(() => {
  const value = toDisplay(summary.value.remainingCny)
  return splitAssetMoney(value, displayCurrency.value)
})

const rateRows = computed(() => ['USD', 'EUR', 'HKD', 'JPY', 'GBP']
  .map((code) => {
    const rate = Number(rates.value[code])
    return Number.isFinite(rate) && rate > 0 ? { code, cny: 1 / rate } : null
  })
  .filter((item): item is { code: string, cny: number } => Boolean(item)))

const ratesUpdatedText = computed(() => {
  if (!ratesUpdatedAt.value) return ''
  return new Date(ratesUpdatedAt.value).toLocaleString('zh-CN', { hour12: false })
})

function toDisplay(amountCny: number): number {
  return cnyToAssetCurrency(amountCny, displayCurrency.value, rates.value) ?? amountCny
}

function displayMoney(amountCny: number): string {
  return formatAssetMoney(toDisplay(amountCny), displayCurrency.value)
}

function displaySigned(amountCny: number): string {
  return formatSignedAssetMoney(toDisplay(amountCny), displayCurrency.value)
}

function sortBy(field: SortField): void {
  if (sortField.value === field) {
    sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc'
    return
  }
  sortField.value = field
  sortDirection.value = NATURAL_DIRECTION[field]
}

function ariaSort(field: SortField): 'ascending' | 'descending' | 'none' {
  if (sortField.value !== field) return 'none'
  return sortDirection.value === 'asc' ? 'ascending' : 'descending'
}

function expiryTone(detail: AssetDetail): 'critical' | 'warning' | 'normal' | 'muted' {
  if (detail.expiresIn == null) return 'muted'
  if (detail.expiresIn <= 3) return 'critical'
  if (detail.expiresIn <= settings.value.renewalWarningDays) return 'warning'
  return 'normal'
}

function premiumTone(amount: number): string {
  if (amount > 0) return 'is-cost'
  if (amount < 0) return 'is-save'
  return 'is-muted'
}

function flagSrc(region: string): string {
  return `/images/flags/${getRegionCode(region)}.svg`
}

function regionName(region: string): string {
  return getRegionDisplayName(region) || region
}

function nodePath(detail: AssetDetail): string {
  return `/server/${encodeURIComponent(detail.uuid)}`
}

async function refreshRates(force = false): Promise<void> {
  const seq = ++rateRequest
  loadingRates.value = true
  const result = await loadAssetRates(settings.value.rateUrl, force)
  if (seq !== rateRequest) return
  rates.value = result.rates
  rateSource.value = result.source
  ratesUpdatedAt.value = result.updatedAt
  ratesError.value = result.error ?? ''
  loadingRates.value = false
}

function openManage(): void {
  if (canManage.value) manageOpen.value = true
}

function goHome(): void {
  void router.push('/')
}

watch(
  [() => settings.value.rateUrl, () => appStore.loading, pageVisible],
  ([, loading, visible]) => {
    if (!loading && visible) void refreshRates(true)
  },
  { immediate: true },
)

watchEffect(() => {
  if (!appStore.loading && !pageVisible.value)
    void router.replace({ name: 'home' })
})

watch(
  [() => route.query.manage, () => appStore.loading, canManage],
  ([manage, loading, manageAllowed]) => {
    if (manage === '1' && !loading && manageAllowed) manageOpen.value = true
  },
  { immediate: true },
)

onMounted(async () => {
  document.title = `${appStore.publicSettings?.sitename || 'CF Server Monitor'} · 资产管理`
  // 直接打开资产页时，节点列表还没加载：补一次 /api/servers（从首页进来则不会重复请求）
  if (!isHomeLoaded()) {
    try {
      await loadHomeServers()
    }
    catch (error) {
      console.error('[assets] 服务器列表加载失败', error)
      appStore.connectionError = true
    }
  }
})

onBeforeUnmount(() => {
  document.title = appStore.publicSettings?.sitename || 'Monitor'
})
</script>

<template>
  <div v-if="pageVisible" class="assets-view">
    <header class="assets-top">
      <Button variant="ghost" size="sm" class="assets-back" @click="goHome">
        <Icon icon="tabler:chevron-left" width="15" height="15" aria-hidden="true" />
        返回
      </Button>
      <div class="assets-title">
        <p class="assets-eyebrow">ASSETS · 资产</p>
        <h1>资产管理</h1>
        <p>按账单周期折算剩余价值，汇总年化与月均支出，并跟踪即将到期的机器。</p>
      </div>
      <div class="assets-actions">
        <Button
          variant="outline"
          size="sm"
          :disabled="loadingRates"
          :aria-busy="loadingRates"
          title="刷新汇率"
          @click="refreshRates(true)"
        >
          <Icon :icon="loadingRates ? 'tabler:loader-2' : 'tabler:refresh'" width="15" height="15" :class="loadingRates && 'assets-spin'" aria-hidden="true" />
          汇率
        </Button>
        <Button v-if="canManage" size="sm" @click="openManage">
          <Icon icon="tabler:adjustments-horizontal" width="15" height="15" aria-hidden="true" />
          管理
        </Button>
      </div>
    </header>

    <section class="assets-hero bg-card" aria-label="资产汇总">
      <span class="assets-hero-mark" aria-hidden="true">{{ hero.symbol }}</span>
      <div class="assets-hero-main">
        <span class="assets-eyebrow">剩余价值</span>
        <div class="assets-hero-value">
          <span class="assets-hero-currency">{{ hero.symbol }}</span>{{ hero.whole }}<span class="assets-hero-frac">.{{ hero.fraction }}</span>
        </div>
        <p class="assets-hero-note">
          {{ summary.countedCount }} 台计入
          <span v-if="summary.ignoredCount > 0"> · {{ summary.ignoredCount }} 台已忽略</span>
          <span v-if="currencyFallback"> · 汇率不可用，以 CNY 显示</span>
        </p>
      </div>
      <dl class="assets-ledger">
        <div class="assets-ledger-row">
          <dt title="各节点月成本 × 12，一次性付费不计入">
            年化支出
          </dt>
          <dd>{{ displayMoney(summary.annualCny) }}</dd>
        </div>
        <div class="assets-ledger-row">
          <dt title="各节点账单价格 ÷ 账单周期月数">
            月均支出
          </dt>
          <dd>{{ displayMoney(summary.monthlyCny) }}</dd>
        </div>
        <div v-if="hasPremium" class="assets-ledger-row">
          <dt title="所有节点收购溢价的加总；正数为溢价买入，负数为折价买入">
            溢价盈亏
          </dt>
          <dd :class="premiumTone(summary.premiumTotalCny)">{{ displaySigned(summary.premiumTotalCny) }}</dd>
        </div>
        <div v-if="hasPremiumMonthly" class="assets-ledger-row">
          <dt title="月均支出 + 溢价按收购日到到期日的月摊，仅作参考">
            真实月均
          </dt>
          <dd>{{ displayMoney(summary.effectiveMonthlyCny) }}</dd>
        </div>
        <div v-if="hasPremium" class="assets-ledger-row">
          <dt title="剩余价值 + 尚未摊销的溢价">
            实际剩余价值
          </dt>
          <dd>{{ displayMoney(summary.actualRemainingCny) }}</dd>
        </div>
      </dl>
    </section>

    <div class="assets-section-head">
      <h2>明细</h2>
      <span class="assets-count">{{ rows.length }} 台</span>
      <span v-if="renewals.length > 0" class="assets-renewal-inline">
        <Icon icon="tabler:calendar-exclamation" width="12" height="12" aria-hidden="true" />
        {{ renewals.length }} 台临期
      </span>
      <div class="assets-mobile-sort">
        <button
          v-for="item in mobileSortOptions"
          :key="item.field"
          type="button"
          :data-active="sortField === item.field"
          @click="sortBy(item.field)"
        >
          {{ item.label }}
        </button>
        <button type="button" :aria-label="sortDirection === 'asc' ? '切换为倒序' : '切换为正序'" @click="sortDirection = sortDirection === 'asc' ? 'desc' : 'asc'">
          <Icon :icon="sortDirection === 'asc' ? 'tabler:chevron-up' : 'tabler:chevron-down'" width="14" height="14" />
        </button>
      </div>
    </div>

    <div v-if="rows.length === 0" class="assets-empty bg-card">
      <Icon icon="tabler:server-off" width="24" height="24" aria-hidden="true" />
      <p>暂无节点数据</p>
      <span>等待后端推送或前往管理后台添加节点。</span>
    </div>

    <template v-else>
      <div class="assets-table-wrap bg-card">
        <table class="assets-table">
          <thead>
            <tr>
              <th v-for="(column, index) in columns" :key="`${column.field}-${index}`" :data-numeric="column.numeric || undefined" :aria-sort="ariaSort(column.field)">
                <button type="button" :data-active="sortField === column.field" @click="sortBy(column.field)">
                  {{ column.label }}
                  <Icon v-if="sortField === column.field" :icon="sortDirection === 'asc' ? 'tabler:chevron-up' : 'tabler:chevron-down'" width="11" height="11" aria-hidden="true" />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="detail in rows" :key="detail.uuid" :data-counted="detail.counted" :data-tone="expiryTone(detail)">
              <td>
                <RouterLink :to="nodePath(detail)" class="assets-node-link" :title="detail.name">
                  <img v-if="detail.region" :src="flagSrc(detail.region)" alt="" width="14" height="10" loading="lazy">
                  <span>{{ detail.name }}</span>
                  <small v-if="detail.region">{{ regionName(detail.region) }}</small>
                </RouterLink>
              </td>
              <td data-numeric>
                <template v-if="detail.counted">
                  <span :title="`${formatOriginalMoney(detail.node.price, detail.node.currency)} / ${detail.cycleLabel}`">
                    {{ displayMoney(detail.priceCny) }}<span class="assets-cycle">/{{ detail.cycleLabel }}</span>
                  </span>
                </template>
                <span v-else class="assets-note-chip">{{ detail.note }}</span>
              </td>
              <td data-numeric data-strong>
                {{ detail.counted ? displayMoney(detail.remainingCny) : '—' }}
              </td>
              <td data-numeric>
                <span v-if="detail.premiumCny !== 0" :class="premiumTone(detail.premiumCny)">{{ displaySigned(detail.premiumCny) }}</span>
                <span v-else class="is-muted">—</span>
              </td>
              <td data-numeric>
                <span v-if="detail.premiumCny !== 0 && detail.amortMonths != null" :title="`摊销 ${detail.amortMonths!.toFixed(1)} 个月（收购日 → 收购日到期日期）`">
                  {{ displaySigned(detail.premiumMonthlyCny) }}<span class="assets-cycle">/月</span>
                </span>
                <span v-else class="is-muted">—</span>
              </td>
              <td data-numeric>
                <span class="assets-expiry" :data-tone="expiryTone(detail)">
                  {{ detail.expiryLabel }}
                  <small v-if="detail.expiresIn != null && detail.expiresIn <= settings.renewalWarningDays">{{ detail.expiresIn < 0 ? '已过期' : '即将到期' }}</small>
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="assets-cards">
        <article v-for="detail in rows" :key="detail.uuid" class="assets-card bg-card" :data-counted="detail.counted" :data-tone="expiryTone(detail)">
          <div class="assets-card-head">
            <RouterLink :to="nodePath(detail)" class="assets-node-link">
              <img v-if="detail.region" :src="flagSrc(detail.region)" alt="" width="14" height="10" loading="lazy">
              <span>{{ detail.name }}</span>
            </RouterLink>
            <strong>{{ detail.counted ? displayMoney(detail.remainingCny) : '—' }}</strong>
          </div>
          <div class="assets-card-meta">
            <span v-if="detail.counted" class="assets-price-chip">{{ displayMoney(detail.priceCny) }}/{{ detail.cycleLabel }}</span>
            <span v-else class="assets-note-chip">{{ detail.note }}</span>
            <span v-if="detail.premiumCny !== 0" class="assets-premium-chip" :class="premiumTone(detail.premiumCny)">
              {{ displaySigned(detail.premiumCny) }} 溢价
            </span>
            <span class="assets-expiry" :data-tone="expiryTone(detail)">
              {{ detail.expiryLabel }}
            </span>
          </div>
        </article>
      </div>
    </template>

    <details class="assets-rates bg-card">
      <summary>
        <span>汇率</span>
        <strong>
          {{ rateSourceLabel(rateSource) }}<template v-if="ratesUpdatedText"> · {{ ratesUpdatedText }}</template>
          <template v-if="rateRows.length > 0"> · {{ rateRows.slice(0, 3).map(item => `1 ${item.code} = ¥${item.cny.toFixed(2)}`).join(' · ') }}</template>
        </strong>
      </summary>
      <div class="assets-rate-body">
        <p v-if="ratesError" class="assets-rate-error">
          <Icon icon="tabler:alert-circle" width="13" height="13" aria-hidden="true" />
          汇率请求失败（{{ ratesError }}），当前使用{{ rateSourceLabel(rateSource) }}。
        </p>
        <div v-if="rateRows.length > 0" class="assets-rate-grid">
          <div v-for="item in rateRows" :key="item.code" class="assets-rate-item">
            <span>1 {{ item.code }}</span>
            <strong>¥ {{ item.cny.toFixed(2) }}</strong>
          </div>
        </div>
        <p v-else class="assets-rate-error">暂无可用汇率。</p>
        <p class="assets-rate-footnote">
          节点价格按各自账单币种录入，汇总时统一折算为 {{ displayCurrency }}。汇率接口可在「管理」中更换。
        </p>
      </div>
    </details>

    <AssetManageDialog
      v-if="canManage"
      v-model:open="manageOpen"
      :nodes="nodes"
      :settings="settings"
      :rates="rates"
    />
  </div>
</template>

<style scoped>
.assets-view {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  padding: 0.5rem 1rem 3rem;
}

.assets-top {
  display: flex;
  align-items: flex-start;
  gap: 0.9rem;
  border: 1px solid color-mix(in oklch, var(--border) 72%, transparent);
  border-radius: 0.85rem;
  background: color-mix(in srgb, var(--card) 74%, transparent);
  padding: 0.8rem 1rem;
  backdrop-filter: blur(14px) saturate(145%);
  -webkit-backdrop-filter: blur(14px) saturate(145%);
}

.assets-back {
  margin-top: 0.15rem;
  flex: 0 0 auto;
}

.assets-title {
  min-width: 0;
  flex: 1;
}

.assets-eyebrow {
  margin: 0;
  color: var(--muted-foreground);
  font-size: 0.66rem;
  font-weight: 650;
  letter-spacing: 0.16em;
}

.assets-title h1 {
  margin: 0.12rem 0 0;
  font-size: clamp(1.5rem, 3.2vw, 2rem);
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.1;
}

.assets-title > p:last-child {
  margin: 0.35rem 0 0;
  color: var(--muted-foreground);
  font-size: 0.76rem;
  line-height: 1.6;
}

.assets-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 0.45rem;
  margin-top: 0.2rem;
}

.assets-hero {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(15rem, 0.85fr);
  gap: 1rem 2.5rem;
  overflow: hidden;
  border-radius: 1rem;
  padding: 1.4rem 1.6rem;
}

.assets-hero::before {
  position: absolute;
  inset: 0;
  background: linear-gradient(125deg, color-mix(in oklch, var(--selection) 10%, transparent), transparent 48%);
  content: '';
  pointer-events: none;
}

.assets-hero-mark {
  position: absolute;
  right: -0.35rem;
  bottom: -2.8rem;
  color: color-mix(in oklch, var(--foreground) 5%, transparent);
  font-size: 10rem;
  font-weight: 800;
  line-height: 1;
  pointer-events: none;
  user-select: none;
  transform: rotate(-6deg);
}

.assets-hero-main,
.assets-ledger {
  position: relative;
  z-index: 1;
}

.assets-hero-main {
  display: flex;
  min-width: 0;
  flex-direction: column;
  justify-content: center;
  gap: 0.45rem;
}

.assets-hero-value {
  display: flex;
  align-items: baseline;
  color: var(--foreground);
  font-size: clamp(2.4rem, 6vw, 3.5rem);
  font-weight: 800;
  letter-spacing: -0.03em;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.assets-hero-currency {
  margin-right: 0.18em;
  color: var(--muted-foreground);
  font-size: 0.4em;
  font-weight: 700;
  letter-spacing: 0;
}

.assets-hero-frac {
  color: var(--muted-foreground);
  font-size: 0.48em;
  font-weight: 700;
}

.assets-hero-note {
  margin: 0;
  color: var(--muted-foreground);
  font-size: 0.72rem;
}

.assets-ledger {
  display: flex;
  min-width: 0;
  flex-direction: column;
  justify-content: center;
  margin: 0;
}

.assets-ledger-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  border-top: 1px solid color-mix(in oklch, var(--border) 85%, transparent);
  padding: 0.5rem 0;
}

.assets-ledger-row:first-child {
  border-top: 0;
}

.assets-ledger-row dt {
  color: var(--muted-foreground);
  font-size: 0.72rem;
  white-space: nowrap;
}

.assets-ledger-row dd {
  min-width: 0;
  overflow: hidden;
  margin: 0;
  color: var(--foreground);
  font-size: 0.92rem;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.assets-section-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.55rem;
  border-radius: 0.55rem;
  background: color-mix(in srgb, var(--card) 70%, transparent);
  padding: 0.45rem 0.6rem;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}

.assets-section-head h2 {
  margin: 0;
  font-size: 0.86rem;
  font-weight: 650;
}

.assets-count {
  color: var(--muted-foreground);
  font-size: 0.68rem;
  font-variant-numeric: tabular-nums;
}

.assets-renewal-inline {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  border-radius: 0.35rem;
  background: color-mix(in oklch, var(--warning) 13%, transparent);
  color: color-mix(in oklch, var(--warning) 78%, var(--foreground));
  padding: 0.18rem 0.4rem;
  font-size: 0.64rem;
  font-weight: 650;
  white-space: nowrap;
}

.assets-mobile-sort {
  display: none;
  align-items: center;
  gap: 0.2rem;
  margin-left: auto;
  border: 1px solid color-mix(in oklch, var(--border) 75%, transparent);
  border-radius: 0.45rem;
  background: color-mix(in srgb, var(--background) 82%, transparent);
  padding: 0.15rem;
}

.assets-mobile-sort button {
  border-radius: 0.3rem;
  padding: 0.22rem 0.42rem;
  color: var(--muted-foreground);
  font-size: 0.66rem;
}

.assets-mobile-sort button[data-active="true"] {
  background: var(--accent);
  color: var(--foreground);
}

.assets-table-wrap {
  overflow-x: auto;
  border-radius: 0.8rem;
}

.assets-table {
  width: 100%;
  border-collapse: collapse;
  color: var(--foreground);
  font-size: 0.76rem;
}

.assets-table th {
  border-bottom: 1px solid color-mix(in oklch, var(--border) 90%, transparent);
  padding: 0;
  text-align: left;
  white-space: nowrap;
}

.assets-table th button {
  display: inline-flex;
  width: 100%;
  align-items: center;
  gap: 0.2rem;
  padding: 0.7rem 0.85rem;
  color: var(--muted-foreground);
  font-size: 0.65rem;
  font-weight: 650;
  letter-spacing: 0.04em;
  white-space: nowrap;
}

.assets-table th[data-numeric] button {
  justify-content: flex-end;
}

.assets-table th button:hover,
.assets-table th button[data-active="true"] {
  color: var(--foreground);
}

.assets-table td {
  border-bottom: 1px solid color-mix(in oklch, var(--border) 55%, transparent);
  padding: 0.62rem 0.85rem;
  text-align: left;
  white-space: nowrap;
}

.assets-table tr:last-child td {
  border-bottom: 0;
}

.assets-table td[data-numeric] {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.assets-table td[data-strong] {
  font-weight: 700;
}

.assets-table tr[data-counted="false"] {
  opacity: 0.62;
}

.assets-table tr[data-tone="critical"] {
  background: color-mix(in oklch, var(--destructive) 4%, transparent);
}

.assets-table tr[data-tone="warning"] {
  background: color-mix(in oklch, var(--warning) 4%, transparent);
}

.assets-node-link {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 0.4rem;
  color: var(--foreground);
  font-weight: 600;
}

.assets-node-link img {
  flex: 0 0 auto;
  border-radius: 1px;
  object-fit: cover;
}

.assets-node-link span {
  max-width: 13rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.assets-node-link small {
  color: var(--muted-foreground);
  font-size: 0.64rem;
  font-weight: 400;
}

.assets-node-link:hover span {
  text-decoration: underline;
  text-underline-offset: 2px;
}

.assets-cycle {
  color: var(--muted-foreground);
  font-size: 0.66rem;
}

.assets-note-chip {
  display: inline-block;
  border-radius: 0.3rem;
  background: color-mix(in oklch, var(--muted-foreground) 14%, transparent);
  padding: 0.1rem 0.35rem;
  color: var(--muted-foreground);
  font-size: 0.66rem;
}

.assets-price-chip {
  border-radius: 0.3rem;
  background: color-mix(in oklch, var(--info) 12%, transparent);
  padding: 0.12rem 0.35rem;
  color: color-mix(in oklch, var(--info) 80%, var(--foreground));
  font-size: 0.66rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.assets-premium-chip {
  border-radius: 0.3rem;
  padding: 0.12rem 0.35rem;
  font-size: 0.66rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.assets-expiry {
  color: var(--muted-foreground);
  font-size: 0.7rem;
  font-variant-numeric: tabular-nums;
}

.assets-expiry[data-tone="critical"] {
  color: color-mix(in oklch, var(--destructive) 85%, var(--foreground));
  font-weight: 650;
}

.assets-expiry[data-tone="warning"] {
  color: color-mix(in oklch, var(--warning) 78%, var(--foreground));
  font-weight: 600;
}

.assets-expiry small {
  margin-left: 0.25rem;
  font-size: 0.6rem;
}

.is-cost {
  color: color-mix(in oklch, var(--warning) 82%, var(--foreground));
}

.is-save {
  color: color-mix(in oklch, var(--success) 82%, var(--foreground));
}

.is-muted {
  color: var(--muted-foreground);
}

.assets-cards {
  display: none;
  flex-direction: column;
  gap: 0.5rem;
}

.assets-card {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  border-radius: 0.7rem;
  padding: 0.7rem 0.8rem;
}

.assets-card-head {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.assets-card-head strong {
  flex: 0 0 auto;
  color: color-mix(in oklch, var(--success) 80%, var(--foreground));
  font-size: 0.9rem;
  font-variant-numeric: tabular-nums;
}

.assets-card[data-counted="false"] {
  opacity: 0.64;
}

.assets-card[data-tone="critical"] {
  border-color: color-mix(in oklch, var(--destructive) 32%, var(--border));
}

.assets-card[data-tone="warning"] {
  border-color: color-mix(in oklch, var(--warning) 28%, var(--border));
}

.assets-card-meta {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
}

.assets-empty {
  display: flex;
  min-height: 12rem;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  border-radius: 0.8rem;
  color: var(--muted-foreground);
}

.assets-empty p {
  margin: 0;
  color: var(--foreground);
  font-size: 0.88rem;
  font-weight: 600;
}

.assets-empty span {
  font-size: 0.72rem;
}

.assets-rates {
  border-radius: 0.7rem;
}

.assets-rates summary {
  display: flex;
  min-width: 0;
  cursor: pointer;
  list-style: none;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.62rem 0.8rem;
}

.assets-rates summary::-webkit-details-marker {
  display: none;
}

.assets-rates summary span {
  flex: 0 0 auto;
  color: var(--muted-foreground);
  font-size: 0.72rem;
  font-weight: 650;
}

.assets-rates summary strong {
  min-width: 0;
  overflow: hidden;
  color: var(--muted-foreground);
  font-size: 0.66rem;
  font-weight: 500;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.assets-rate-body {
  border-top: 1px solid color-mix(in oklch, var(--border) 80%, transparent);
  padding: 0.65rem 0.8rem 0.75rem;
}

.assets-rate-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(7rem, 1fr));
  gap: 0.4rem 0.9rem;
}

.assets-rate-item {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
  color: var(--muted-foreground);
  font-size: 0.7rem;
}

.assets-rate-item strong {
  color: color-mix(in oklch, var(--success) 78%, var(--foreground));
  font-variant-numeric: tabular-nums;
}

.assets-rate-error {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  margin: 0 0 0.45rem;
  color: color-mix(in oklch, var(--warning) 80%, var(--foreground));
  font-size: 0.7rem;
}

.assets-rate-footnote {
  margin: 0.55rem 0 0;
  color: var(--muted-foreground);
  font-size: 0.66rem;
  line-height: 1.6;
}

.assets-spin {
  animation: assets-spin 900ms linear infinite;
}

@keyframes assets-spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 900px) {
  .assets-hero {
    grid-template-columns: 1fr;
    gap: 0.7rem;
  }

  .assets-ledger {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    column-gap: 1.5rem;
  }
}

@media (max-width: 720px) {
  .assets-view {
    padding: 0.35rem 0.75rem 4.5rem;
  }

  .assets-top {
    flex-wrap: wrap;
  }

  .assets-title {
    flex-basis: calc(100% - 5rem);
  }

  .assets-actions {
    margin-left: auto;
  }

  .assets-hero {
    padding: 1.05rem 1rem;
  }

  .assets-table-wrap {
    display: none;
  }

  .assets-cards {
    display: flex;
  }

  .assets-mobile-sort {
    display: flex;
  }

  .assets-ledger {
    grid-template-columns: 1fr;
  }

  .assets-rates summary strong {
    display: none;
  }
}

@media (max-width: 480px) {
  .assets-mobile-sort {
    width: 100%;
    margin-left: 0;
    justify-content: space-between;
  }

  .assets-mobile-sort button:not(:last-child) {
    flex: 1;
  }

  .assets-renewal-inline {
    padding: 0.15rem 0.3rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .assets-spin {
    animation: none;
  }
}
</style>
