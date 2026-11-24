import type { ExchangeRates } from '@/utils/financeHelper'
import { safeStorage } from '@/monitor/storage'
import { DEFAULT_EXCHANGE_RATES, normalizeCurrency } from '@/utils/financeHelper'
import { DEFAULT_ASSET_RATE_URL } from '@/utils/assetCost'

export type AssetRateSource = 'loading' | 'cache' | 'network' | 'stale-cache' | 'default'

export interface AssetRateResult {
  rates: ExchangeRates
  source: AssetRateSource
  updatedAt: number | null
  error?: string
}

const CACHE_PREFIX = 'glassmorphism_asset_rates_v1:'
const CACHE_TTL_MS = 60 * 60 * 1000
const TIMEOUT_MS = 10_000

interface CachedRates {
  rates: ExchangeRates
  time: number
}

function cacheKey(url: string): string {
  return `${CACHE_PREFIX}${url}`
}

function readCache(url: string, allowExpired = false): CachedRates | null {
  try {
    const raw = safeStorage.getItem(cacheKey(url))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<CachedRates>
    if (!parsed || typeof parsed !== 'object' || !parsed.rates || typeof parsed.time !== 'number') return null
    const age = Date.now() - parsed.time
    if (!Number.isFinite(age) || age < 0 || (!allowExpired && age >= CACHE_TTL_MS)) return null
    return { rates: parsed.rates, time: parsed.time }
  }
  catch {
    return null
  }
}

function writeCache(url: string, rates: ExchangeRates): number {
  const time = Date.now()
  try {
    safeStorage.setItem(cacheKey(url), JSON.stringify({ rates, time }))
  }
  catch {
    // 当前会话内仍使用内存中的结果。
  }
  return time
}

export function isValidRateUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:'
  }
  catch {
    return false
  }
}

export function normalizeRateUrl(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  return raw && isValidRateUrl(raw) ? raw : DEFAULT_ASSET_RATE_URL
}

/**
 * 把汇率接口的返回统一成“1 CNY = rates[code]”。
 * 兼容 open.er-api（base=CNY）、frankfurter（base=USD）和数组形态
 * `[{ quote, rate }]`；缺 CNY 时以 CNY 报价为锚归一。
 */
export function parseRatePayload(payload: unknown): ExchangeRates | null {
  let base = 'CNY'
  const raw: Record<string, number> = {}

  if (Array.isArray(payload)) {
    // Frankfurter v2 的数组形态默认以 USD 为基准；CNY 的 rate 就是 1 USD 兑 CNY。
    base = 'USD'
    for (const item of payload) {
      if (!item || typeof item !== 'object') continue
      const record = item as Record<string, unknown>
      const quote = typeof record.quote === 'string' ? record.quote.toUpperCase() : ''
      const rate = Number(record.rate)
      if (quote && Number.isFinite(rate) && rate > 0) raw[quote] = rate
    }
  }
  else if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    if (typeof record.base_code === 'string') base = record.base_code.toUpperCase()
    else if (typeof record.base === 'string') base = record.base.toUpperCase()
    const table = record.rates
    if (table && typeof table === 'object' && !Array.isArray(table)) {
      for (const [code, value] of Object.entries(table as Record<string, unknown>)) {
        const rate = Number(value)
        if (code && Number.isFinite(rate) && rate > 0) raw[code.toUpperCase()] = rate
      }
    }
  }

  if (Object.keys(raw).length === 0) return null
  // 非 CNY 基准又没有 CNY 报价时无法换算成“1 CNY 对应多少”，宁可回退也不要静默算错。
  if (base !== 'CNY' && !(raw.CNY && raw.CNY > 0)) return null

  const cnyPerBase = raw.CNY && raw.CNY > 0 ? raw.CNY : 1
  const rates: Record<string, number> = Object.fromEntries(
    Object.entries(DEFAULT_EXCHANGE_RATES).filter((entry): entry is [string, number] => typeof entry[1] === 'number'),
  )
  for (const [code, value] of Object.entries(raw)) {
    // 1 base = value code；1 CNY = value / cnyPerBase code。
    rates[code] = base === 'CNY' ? value : value / cnyPerBase
  }
  rates.CNY = 1
  return rates as ExchangeRates
}

/**
 * 读取资产页汇率。网络失败时退回过期缓存，再退回内置参考汇率；
 * 永不抛错，页面始终能画出金额。
 */
export async function loadAssetRates(urlInput: unknown, force = false): Promise<AssetRateResult> {
  const url = normalizeRateUrl(urlInput)
  if (!force) {
    const cached = readCache(url)
    if (cached) return { rates: cached.rates, source: 'cache', updatedAt: cached.time }
  }

  try {
    const response = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const payload = await response.json()
    const rates = parseRatePayload(payload)
    if (!rates) throw new Error('汇率数据格式无法识别')
    const updatedAt = writeCache(url, rates)
    return { rates, source: 'network', updatedAt }
  }
  catch (error) {
    const stale = readCache(url, true)
    if (stale) {
      return {
        rates: stale.rates,
        source: 'stale-cache',
        updatedAt: stale.time,
        error: error instanceof Error ? error.message : '汇率获取失败',
      }
    }
    return {
      rates: DEFAULT_EXCHANGE_RATES,
      source: 'default',
      updatedAt: null,
      error: error instanceof Error ? error.message : '汇率获取失败',
    }
  }
}

/** 汇率来源文案。 */
export function rateSourceLabel(source: AssetRateSource): string {
  switch (source) {
    case 'loading': return '汇率加载中'
    case 'network': return '今日网络汇率'
    case 'cache': return '今日缓存汇率'
    case 'stale-cache': return '历史缓存汇率'
    default: return '内置参考汇率'
  }
}

/** 目标币种是否真的有可用汇率（CNY 恒为 1）。 */
export function hasRate(rates: ExchangeRates, currency: string): boolean {
  if (currency === 'CNY') return true
  const code = normalizeCurrency(currency)
  const rate = Number(rates[code])
  return Number.isFinite(rate) && rate > 0
}
