import type { ExchangeRates } from '@/utils/financeHelper'

// 资产口径与溢价摊销参考 Monitor-SAO（MIT，Copyright (c) 2026 WAOR），按 Glassmorphism 的节点字段重写。

/** 资产管理里可选的汇总币种。汇率表以 CNY 为基准（1 CNY = rates[code]）。 */
export const ASSET_CURRENCIES = ['CNY', 'USD', 'EUR', 'HKD', 'JPY', 'GBP'] as const
export type AssetCurrency = (typeof ASSET_CURRENCIES)[number]

export const ASSET_CURRENCY_LABELS: Record<AssetCurrency, string> = {
  CNY: '人民币 CNY',
  USD: '美元 USD',
  EUR: '欧元 EUR',
  HKD: '港币 HKD',
  JPY: '日元 JPY',
  GBP: '英镑 GBP',
}

export const ASSET_CURRENCY_SYMBOLS: Record<AssetCurrency, string> = {
  CNY: '¥',
  USD: '$',
  EUR: '€',
  HKD: 'HK$',
  JPY: 'JP¥',
  GBP: '£',
}

export interface AssetRatePreset {
  id: string
  label: string
  url: string
}

/** 三个汇率接口预设，与 Monitor-SAO 的资产财务页保持一致。 */
export const ASSET_RATE_PRESETS: AssetRatePreset[] = [
  { id: 'frankfurter', label: 'Frankfurter (默认)', url: 'https://api.frankfurter.dev/v2/rates?base=USD' },
  { id: 'exchangerate-api-v6', label: 'ExchangeRate-API 新版', url: 'https://open.er-api.com/v6/latest/USD' },
  { id: 'exchangerate-api-v4', label: 'ExchangeRate-API 旧版', url: 'https://api.exchangerate-api.com/v4/latest/USD' },
]

export const DEFAULT_ASSET_RATE_URL = ASSET_RATE_PRESETS[0]!.url
export const DEFAULT_RENEWAL_WARNING_DAYS = 7
export const LONG_TERM_DAYS = 36_500
const DAY_MS = 86_400_000
const AMORT_MONTH_MS = 30 * DAY_MS
const AMORT_LONG_TERM_MS = 100 * 365 * DAY_MS

/** 结构化节点字段；NodeData 可直接传入，测试时也不必构造整个 store 节点。 */
export interface AssetNode {
  uuid: string
  name: string
  region?: string
  weight?: number
  price: number
  currency: string
  /** 账单周期天数；-1 表示一次性。 */
  billing_cycle: number
  expired_at?: string
  /** Hub 按自己的日历算出的剩余天数；null 表示没有到期日。 */
  expires_in?: number | null
  online?: boolean
}

export interface AssetPremiumEntry {
  /** 收购溢价，人民币；可为负数（折价买入）。 */
  amount: number
  /** 录入时的收购价，人民币；仅用于回显和重新计算。 */
  paidCny?: number
  /** 收购日期 YYYY-MM-DD，用于溢价摊销。 */
  acquiredAt?: string
  /**
   * 收购当天的节点到期日 YYYY-MM-DD。溢价按「收购日 → 收购日到期日期」摊销，
   * 避免月付/年付机器之后续费时把摊销期拉长；未填时回退到节点当前到期日。
   */
  acquiredExpiry?: string
}

export interface AssetSettings {
  showPage: boolean
  showForGuests: boolean
  currency: AssetCurrency
  rateUrl: string
  ignored: string[]
  premiums: Record<string, AssetPremiumEntry>
  renewalWarningDays: number
}

export interface AssetDetail {
  node: AssetNode
  uuid: string
  name: string
  region: string
  weight: number
  priceCny: number
  monthlyCny: number
  annualCny: number
  remainingCny: number
  premiumCny: number
  premiumMonthlyCny: number
  premiumRemainingCny: number
  amortMonths: number | null
  paidCny: number | null
  acquiredExpiry: string | null
  cycleDays: number
  cycleLabel: string
  expiresIn: number | null
  expiryLabel: string
  counted: boolean
  note: string
}

export interface AssetSummary {
  remainingCny: number
  monthlyCny: number
  annualCny: number
  originalCny: number
  premiumTotalCny: number
  premiumMonthlyTotalCny: number
  premiumRemainingTotalCny: number
  effectiveMonthlyCny: number
  actualRemainingCny: number
  dueSoonCount: number
  countedCount: number
  ignoredCount: number
  details: AssetDetail[]
}

const CURRENCY_ALIASES: Record<string, string> = {
  '¥': 'CNY',
  '￥': 'CNY',
  'RMB': 'CNY',
  'CN¥': 'CNY',
  '$': 'USD',
  'US$': 'USD',
  'USD$': 'USD',
  'HK$': 'HKD',
  'HKD$': 'HKD',
  '€': 'EUR',
  '£': 'GBP',
  'JP¥': 'JPY',
  '円': 'JPY',
}

/** 三个大写字母以外的值（旧 Hub 可能存过符号）按别名归一，认不出时返回空串。 */
export function normalizeCurrencyCode(value: unknown): string {
  const raw = String(value ?? '').trim()
  if (!raw) return 'CNY'
  const upper = raw.toUpperCase().replace(/\s+/g, '')
  const alias = CURRENCY_ALIASES[raw] ?? CURRENCY_ALIASES[upper]
  if (alias) return alias
  return /^[A-Z]{3}$/.test(upper) ? upper : ''
}

export function normalizeAssetCurrency(value: unknown): AssetCurrency {
  const code = normalizeCurrencyCode(value)
  return (ASSET_CURRENCIES as readonly string[]).includes(code) ? code as AssetCurrency : 'CNY'
}

/** 1 CNY = rates[code]；换算成 CNY 时除以汇率。 */
export function currencyToCny(amount: number, currency: string, rates: ExchangeRates): number | null {
  if (!Number.isFinite(amount)) return null
  const code = normalizeCurrencyCode(currency)
  if (!code) return null
  if (code === 'CNY') return amount
  const rate = Number(rates[code])
  if (!Number.isFinite(rate) || rate <= 0) return null
  return amount / rate
}

/** CNY 金额换算成目标币种；汇率缺失时返回 null，由调用方决定如何显示。 */
export function cnyToAssetCurrency(amountCny: number, currency: AssetCurrency, rates: ExchangeRates): number | null {
  if (!Number.isFinite(amountCny)) return null
  if (currency === 'CNY') return amountCny
  const rate = Number(rates[currency])
  if (!Number.isFinite(rate) || rate <= 0) return null
  return amountCny * rate
}

export function formatAssetMoney(amount: number, currency: AssetCurrency): string {
  if (!Number.isFinite(amount)) return '—'
  const symbol = ASSET_CURRENCY_SYMBOLS[currency]
  const value = new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
  return `${symbol} ${value}`
}

export function splitAssetMoney(amount: number, currency: AssetCurrency): { symbol: string, whole: string, fraction: string } {
  const text = formatAssetMoney(amount, currency)
  const symbol = ASSET_CURRENCY_SYMBOLS[currency]
  const [whole = '0', fraction = '00'] = text.replace(symbol, '').trim().split('.')
  return { symbol, whole, fraction }
}

export function formatSignedAssetMoney(amount: number, currency: AssetCurrency): string {
  const sign = amount < 0 ? '-' : '+'
  return `${sign}${formatAssetMoney(Math.abs(amount), currency)}`
}

/** 原始账单币种的显示，用于资产页的“价格”列。 */
export function formatOriginalMoney(amount: number, currency: string): string {
  if (!Number.isFinite(amount)) return '—'
  const code = normalizeCurrencyCode(currency)
  if (!code) return `${currency || '—'} ${amount.toFixed(2)}`
  try {
    return new Intl.NumberFormat('zh-CN', {
      style: 'currency',
      currency: code,
      maximumFractionDigits: 2,
    }).format(amount)
  }
  catch {
    return `${code} ${amount.toFixed(2)}`
  }
}

/** 账单周期天数 → 中文标签。Hub 1.3.1 的任意月数在映射层已折算成天。 */
export function billingCycleLabel(days: number): string {
  if (!Number.isFinite(days) || days <= 0) return days === -1 ? '一次性' : '周期未知'
  if (days === 30) return '月'
  if (days === 90) return '季'
  if (days === 180 || days === 182) return '半年'
  if (days === 365) return '年'
  if (days % 365 === 0) return `${days / 365} 年`
  if (days % 30 === 0) return `${days / 30} 个月`
  return `${days} 天`
}

/** 溢价摊销月数：优先按收购日 → 到期日，缺少一端时按已持有时间，至少 1 个月。 */
export function premiumAmortMonths(acquiredAt: string | undefined, expiresAtMs: number | null, now: number): number | null {
  if (!acquiredAt) return null
  const acquiredMs = parseDateKey(acquiredAt)
  if (acquiredMs == null || acquiredMs > now) return null
  const span = expiresAtMs != null && expiresAtMs > acquiredMs && expiresAtMs - acquiredMs < AMORT_LONG_TERM_MS
    ? expiresAtMs - acquiredMs
    : now - acquiredMs
  // 按实际天数折算；不足一天时按一天，避免除零，也不再把半个月硬抬成一整月。
  return Math.max(1 / 30, span / AMORT_MONTH_MS)
}

/** 尚未摊销的溢价；无到期或长期资产保留全部，固定期限资产随到期临近衰减。 */
export function premiumRemainingValue(
  amount: number,
  acquiredAt: string | undefined,
  expiresAtMs: number | null,
  now: number,
): number {
  if (!amount) return 0
  if (expiresAtMs == null || expiresAtMs - now >= AMORT_LONG_TERM_MS) return amount
  if (expiresAtMs <= now) return 0
  const acquiredMs = acquiredAt ? parseDateKey(acquiredAt) : null
  if (acquiredMs == null || acquiredMs >= expiresAtMs || acquiredMs > now) return amount
  const ratio = Math.min(1, Math.max(0, (expiresAtMs - now) / (expiresAtMs - acquiredMs)))
  return amount * ratio
}

/** 到期时间戳：优先绝对到期日，旧 Hub 只有 expires_in 时按当前时间推算。 */
export function expiryTimestamp(node: AssetNode, now: number): number | null {
  if (node.expired_at) {
    const parsed = Date.parse(node.expired_at)
    if (Number.isFinite(parsed)) return parsed
  }
  if (node.expires_in !== undefined && node.expires_in !== null && Number.isFinite(node.expires_in)) {
    return now + node.expires_in * DAY_MS
  }
  return null
}

/** 剩余天数；优先使用 Hub 日历的 expires_in，null 表示没有到期日。 */
export function expiryDays(node: AssetNode, now: number): number | null {
  if (node.expires_in !== undefined) {
    return typeof node.expires_in === 'number' && Number.isFinite(node.expires_in) ? node.expires_in : null
  }
  const expires = expiryTimestamp(node, now)
  if (expires == null) return null
  const diff = expires - now
  return diff <= 0 ? Math.floor(diff / DAY_MS) : Math.ceil(diff / DAY_MS)
}

export function expiryLabel(days: number | null): string {
  if (days == null) return '到期未知'
  if (days > LONG_TERM_DAYS) return '长期'
  if (days < 0) return `已过期 ${Math.abs(days)} 天`
  if (days === 0) return '今日到期'
  return `${days} 天后到期`
}

function cycleMonths(days: number): number {
  if (!Number.isFinite(days) || days <= 0) return 0
  if (days === 30) return 1
  if (days > 0 && days % 365 === 0) return (days / 365) * 12
  return days / 30
}

/**
 * 剩余预付价值：一个账单周期的价格 × 到期前剩余周期数。
 * 无到期日/长期/一次性购买按一个周期计价；已过期归零。
 */
export function remainingValueCny(
  node: AssetNode,
  rates: ExchangeRates,
  now: number,
): number | null {
  const priceCny = currencyToCny(node.price, node.currency, rates)
  if (priceCny == null) return null
  if (priceCny <= 0) return 0
  const days = expiryDays(node, now)
  if (days == null) return priceCny
  if (days <= 0) return 0
  if (days > LONG_TERM_DAYS) return priceCny
  const cycleDays = Number(node.billing_cycle)
  if (!Number.isFinite(cycleDays) || cycleDays <= 0) return priceCny
  return priceCny * days / cycleDays
}

/**
 * 收购日当天的剩余价值，用于把“收购价”换算成溢价。
 * `expiryOverride` 是收购日到期日期；给了它就用它，避免用续费后的当前到期日。
 */
export function remainingValueAt(
  node: AssetNode,
  acquiredAt: string,
  rates: ExchangeRates,
  now: number,
  expiryOverride?: string | null,
): number | null {
  const acquiredMs = parseDateKey(acquiredAt)
  if (acquiredMs == null || acquiredMs > now) return null
  const priceCny = currencyToCny(node.price, node.currency, rates)
  if (priceCny == null) return null
  const overrideMs = expiryOverride ? parseDateKey(expiryOverride) : null
  const expires = overrideMs ?? expiryTimestamp(node, now)
  if (expires == null) return priceCny
  const diff = expires - acquiredMs
  if (diff <= 0) return 0
  if (diff / DAY_MS > LONG_TERM_DAYS) return priceCny
  const cycleDays = Number(node.billing_cycle)
  if (!Number.isFinite(cycleDays) || cycleDays <= 0) return priceCny
  return priceCny * (diff / DAY_MS) / cycleDays
}

function localDateKey(date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function parseDateKey(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const parsed = new Date(year, month - 1, day)
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) return null
  return parsed.getTime()
}

export function isValidDateKey(value: unknown): value is string {
  return typeof value === 'string' && parseDateKey(value) != null
}

export function isValidAcquiredAt(value: unknown, now = Date.now()): value is string {
  if (!isValidDateKey(value)) return false
  const ms = parseDateKey(value)
  return ms != null && ms <= now
}

export function todayDateKey(): string {
  return localDateKey()
}

/**
 * 规范化站点设置里的溢价表。旧版纯数字自动升格；非法日期丢字段不丢条目；
 * 金额为 0 且没有收购价/收购日的空记录整条丢弃。
 */
export function normalizePremiums(value: unknown): Record<string, AssetPremiumEntry> {
  let raw = value
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw)
    }
    catch {
      return {}
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}

  const result: Record<string, AssetPremiumEntry> = {}
  for (const [key, item] of Object.entries(raw as Record<string, unknown>)) {
    const uuid = key.trim()
    if (!uuid) continue
    let amount = 0
    let paidCny: number | undefined
    let acquiredAt: string | undefined
    let acquiredExpiry: string | undefined

    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const entry = item as Record<string, unknown>
      const numericAmount = Number(entry.amount)
      if (Number.isFinite(numericAmount)) amount = numericAmount
      const paid = Number(entry.paidCny)
      if (entry.paidCny != null && Number.isFinite(paid) && paid >= 0) paidCny = paid
      if (isValidAcquiredAt(entry.acquiredAt)) acquiredAt = entry.acquiredAt.trim()
      if (isValidDateKey(entry.acquiredExpiry)) acquiredExpiry = entry.acquiredExpiry.trim()
    }
    else {
      const numericAmount = Number(item)
      if (Number.isFinite(numericAmount)) amount = numericAmount
    }

    // 收购日到期早于收购日的记录不可信，丢字段但保留溢价本身。
    if (acquiredAt && acquiredExpiry && parseDateKey(acquiredExpiry)! < parseDateKey(acquiredAt)!) {
      acquiredExpiry = undefined
    }

    if (amount === 0 && paidCny == null && !acquiredAt && !acquiredExpiry) continue
    result[uuid] = {
      amount,
      ...(paidCny != null ? { paidCny } : {}),
      ...(acquiredAt ? { acquiredAt } : {}),
      ...(acquiredExpiry ? { acquiredExpiry } : {}),
    }
  }
  return result
}

export function serializePremiums(value: Record<string, AssetPremiumEntry>): string {
  const normalized = normalizePremiums(value)
  return JSON.stringify(normalized)
}

export function parseAssetSettings(raw: Record<string, unknown> | null | undefined): AssetSettings {
  const settings = raw ?? {}
  const renewalDays = Number(settings.assetRenewalWarningDays)
  const ignoredRaw = typeof settings.assetIgnoredNodes === 'string' ? settings.assetIgnoredNodes : ''
  return {
    showPage: settings.showAssetPage !== false,
    showForGuests: settings.showAssetForGuests === true,
    currency: normalizeAssetCurrency(settings.assetCurrency),
    rateUrl: typeof settings.assetRateApiUrl === 'string' && settings.assetRateApiUrl.trim()
      ? settings.assetRateApiUrl.trim()
      : DEFAULT_ASSET_RATE_URL,
    ignored: [...new Set(ignoredRaw.split(/[,，;；\n]/).map(item => item.trim()).filter(Boolean))],
    premiums: normalizePremiums(settings.assetPremiums),
    renewalWarningDays: Number.isFinite(renewalDays) ? Math.min(365, Math.max(1, Math.round(renewalDays))) : DEFAULT_RENEWAL_WARNING_DAYS,
  }
}

function isIgnored(node: AssetNode, ignored: Set<string>): boolean {
  const uuid = node.uuid.trim().toLowerCase()
  const name = node.name.trim().toLowerCase()
  return ignored.has(uuid) || ignored.has(name)
}

/**
 * 一台节点的资产口径：价格、月摊、剩余价值、溢价与摊销。
 * 已忽略/免费/汇率缺失的节点仍列在明细里，但不计入汇总。
 */
export function calculateAssetSummary(
  nodes: AssetNode[],
  settings: AssetSettings,
  rates: ExchangeRates,
  now = Date.now(),
): AssetSummary {
  const ignored = new Set(settings.ignored.map(item => item.trim().toLowerCase()).filter(Boolean))
  let remainingCny = 0
  let monthlyCny = 0
  let originalCny = 0
  let premiumTotalCny = 0
  let premiumMonthlyTotalCny = 0
  let premiumRemainingTotalCny = 0
  let dueSoonCount = 0
  let countedCount = 0
  let ignoredCount = 0

  const details: AssetDetail[] = nodes.map((node) => {
    const cycleDays = Number(node.billing_cycle)
    const days = expiryDays(node, now)
    const expiresAt = expiryTimestamp(node, now)
    const entry = settings.premiums[node.uuid]
    const premiumCny = entry?.amount ?? 0
    // 有收购日到期日期时，摊销期固定在收购时的账期；续费不会把它拉长。
    const acquiredExpiryMs = entry?.acquiredExpiry ? parseDateKey(entry.acquiredExpiry) : null
    const amortizationEnd = acquiredExpiryMs ?? expiresAt
    const amortMonths = premiumCny !== 0 ? premiumAmortMonths(entry?.acquiredAt, amortizationEnd, now) : null
    const premiumMonthlyCny = amortMonths != null ? premiumCny / amortMonths : 0
    const premiumRemainingCny = premiumRemainingValue(premiumCny, entry?.acquiredAt, amortizationEnd, now)
    const priceCny = currencyToCny(node.price, node.currency, rates) ?? 0
    const monthly = cycleMonths(cycleDays) > 0 ? priceCny / cycleMonths(cycleDays) : 0
    const remaining = remainingValueCny(node, rates, now) ?? 0
    const ignoredNode = isIgnored(node, ignored)
    const free = node.price <= 0
    const rateMissing = node.price > 0 && currencyToCny(node.price, node.currency, rates) == null

    let counted = true
    let note = ''
    if (ignoredNode) {
      counted = false
      note = '已忽略'
      ignoredCount++
    }
    else if (free) {
      counted = false
      note = '免费'
    }
    else if (rateMissing) {
      counted = false
      note = '汇率缺失'
    }

    if (counted) {
      remainingCny += remaining
      monthlyCny += monthly
      originalCny += priceCny
      countedCount++
      if (days != null && days <= settings.renewalWarningDays) dueSoonCount++
    }

    if (!ignoredNode) {
      premiumTotalCny += premiumCny
      premiumMonthlyTotalCny += premiumMonthlyCny
      premiumRemainingTotalCny += premiumRemainingCny
    }

    return {
      node,
      uuid: node.uuid,
      name: node.name || node.uuid,
      region: node.region || '',
      weight: Number(node.weight) || 0,
      priceCny,
      monthlyCny: counted ? monthly : 0,
      annualCny: counted ? monthly * 12 : 0,
      remainingCny: counted ? remaining : 0,
      premiumCny: ignoredNode ? 0 : premiumCny,
      premiumMonthlyCny: ignoredNode ? 0 : premiumMonthlyCny,
      premiumRemainingCny: ignoredNode ? 0 : premiumRemainingCny,
      amortMonths: ignoredNode ? null : amortMonths,
      paidCny: entry?.paidCny ?? null,
      acquiredExpiry: entry?.acquiredExpiry ?? null,
      cycleDays,
      cycleLabel: billingCycleLabel(cycleDays),
      expiresIn: days,
      expiryLabel: expiryLabel(days),
      counted,
      note,
    }
  })

  details.sort((a, b) => a.weight - b.weight || a.name.localeCompare(b.name, 'zh-CN'))

  return {
    remainingCny,
    monthlyCny,
    annualCny: monthlyCny * 12,
    originalCny,
    premiumTotalCny,
    premiumMonthlyTotalCny,
    premiumRemainingTotalCny,
    effectiveMonthlyCny: monthlyCny + premiumMonthlyTotalCny,
    actualRemainingCny: remainingCny + premiumRemainingTotalCny,
    dueSoonCount,
    countedCount,
    ignoredCount,
    details,
  }
}
