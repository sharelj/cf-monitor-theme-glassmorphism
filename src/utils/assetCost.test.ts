import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  billingCycleLabel,
  calculateAssetSummary,
  expiryLabel,
  normalizePremiums,
  parseAssetSettings,
  remainingValueAt,
  remainingValueCny,
  type AssetNode,
} from './assetCost.ts'

const NOW = new Date('2026-11-23T12:00:00+08:00').getTime()
const DAY = 86_400_000
const RATES = { CNY: 1, USD: 0.2 } as never

function node(overrides: Partial<AssetNode> = {}): AssetNode {
  return {
    uuid: 'n1',
    name: 'HK-01',
    region: '🇭🇰',
    weight: 1,
    price: 10,
    currency: 'USD',
    billing_cycle: 30,
    expires_in: 15,
    expired_at: new Date(NOW + 15 * DAY).toISOString(),
    ...overrides,
  }
}

function settings(overrides: Record<string, unknown> = {}) {
  return parseAssetSettings({
    assetCurrency: 'CNY',
    assetPremiums: '{}',
    ...overrides,
  })
}

test('10 USD at 5 CNY/USD, monthly cycle, 15 days left', () => {
  const summary = calculateAssetSummary([node()], settings(), RATES, NOW)
  const detail = summary.details[0]!
  assert.equal(detail.priceCny, 50)
  assert.equal(detail.monthlyCny, 50)
  assert.equal(detail.remainingCny, 25)
  assert.equal(summary.annualCny, 600)
  assert.equal(summary.remainingCny, 25)
})

test('premium amortises over acquiredAt -> expiry and decays with time', () => {
  const acquiredAt = new Date(NOW - 300 * DAY).toISOString().slice(0, 10)
  const summary = calculateAssetSummary(
    [node({ expires_in: 60, expired_at: new Date(NOW + 60 * DAY).toISOString() })],
    settings({ assetPremiums: JSON.stringify({ n1: { amount: 120, acquiredAt } }) }),
    RATES,
    NOW,
  )
  const detail = summary.details[0]!
  assert.equal(detail.premiumCny, 120)
  assert.ok(Math.abs((detail.amortMonths ?? 0) - 12) < 0.1)
  assert.ok(Math.abs(detail.premiumMonthlyCny - 10) < 0.1)
  assert.ok(Math.abs(detail.premiumRemainingCny - 20) < 0.1)
  assert.ok(Math.abs(summary.actualRemainingCny - 120) < 0.1)
})

test('ignored nodes stay in the ledger but leave every total', () => {
  const summary = calculateAssetSummary(
    [node(), node({ uuid: 'n2', name: 'JP-01' })],
    settings({ assetIgnoredNodes: 'JP-01' }),
    RATES,
    NOW,
  )
  assert.equal(summary.countedCount, 1)
  assert.equal(summary.ignoredCount, 1)
  assert.equal(summary.remainingCny, 25)
  assert.equal(summary.details.find(item => item.uuid === 'n2')?.note, '已忽略')
})

test('free nodes are listed but not counted; a premium still records', () => {
  const summary = calculateAssetSummary(
    [node({ price: 0 })],
    settings({ assetPremiums: JSON.stringify({ n1: 30 }) }),
    RATES,
    NOW,
  )
  const detail = summary.details[0]!
  assert.equal(detail.counted, false)
  assert.equal(detail.note, '免费')
  assert.equal(summary.remainingCny, 0)
  assert.equal(summary.premiumTotalCny, 30)
})

test('one-time purchase has no monthly cost and keeps its price as value', () => {
  const summary = calculateAssetSummary(
    [node({ billing_cycle: -1, expires_in: null, expired_at: '' })],
    settings(),
    RATES,
    NOW,
  )
  const detail = summary.details[0]!
  assert.equal(detail.monthlyCny, 0)
  assert.equal(detail.remainingCny, 50)
})

test('missing rate marks the row and excludes it from totals', () => {
  const summary = calculateAssetSummary(
    [node({ currency: 'XYZ' })],
    settings(),
    RATES,
    NOW,
  )
  assert.equal(summary.details[0]!.note, '汇率缺失')
  assert.equal(summary.countedCount, 0)
  assert.equal(summary.remainingCny, 0)
})

test('premium normalisation upgrades legacy numbers and drops junk', () => {
  const normalized = normalizePremiums({
    a: 20,
    b: { amount: 0, paidCny: 130 },
    c: { amount: 5, acquiredAt: 'not-a-date' },
    d: { amount: 0 },
    e: { amount: 7, acquiredAt: '2026-01-01', acquiredExpiry: '2026-12-01' },
    f: { amount: 8, acquiredAt: '2026-06-01', acquiredExpiry: '2026-05-01' },
    '': 3,
  })
  assert.deepEqual(normalized.a, { amount: 20 })
  assert.deepEqual(normalized.b, { amount: 0, paidCny: 130 })
  assert.deepEqual(normalized.c, { amount: 5 })
  assert.deepEqual(normalized.e, { amount: 7, acquiredAt: '2026-01-01', acquiredExpiry: '2026-12-01' })
  assert.deepEqual(normalized.f, { amount: 8, acquiredAt: '2026-06-01' })
  assert.equal(normalized.d, undefined)
  assert.equal(Object.keys(normalized).length, 5)
})

test('acquired expiry pins the premium term before later renewals', () => {
  const acquiredAt = '2026-06-01'
  const acquiredExpiry = '2026-06-20'
  const current = node({ expires_in: 60, expired_at: new Date(NOW + 60 * DAY).toISOString() })
  const pinned = calculateAssetSummary(
    [current],
    settings({ assetPremiums: JSON.stringify({ n1: { amount: 100, acquiredAt, acquiredExpiry } }) }),
    RATES,
    NOW,
  ).details[0]!
  // 现在早已超过收购日到期日，即使节点后来续费到 60 天后，溢价也应全部摊完。
  assert.equal(pinned.premiumRemainingCny, 0)
  assert.ok(Math.abs((pinned.amortMonths ?? 0) - 19 / 30) < 0.001)
  assert.ok(Math.abs(pinned.premiumMonthlyCny - 100 / (19 / 30)) < 0.01)

  const fallback = calculateAssetSummary(
    [current],
    settings({ assetPremiums: JSON.stringify({ n1: { amount: 100, acquiredAt } }) }),
    RATES,
    NOW,
  ).details[0]!
  assert.ok((fallback.premiumRemainingCny ?? 0) > 0)
})

test('premium basis can use the acquisition-time expiry', () => {
  const basis = remainingValueAt(node(), '2026-06-01', RATES, NOW, '2026-06-20')
  // 50 CNY 的月付价，收购时只剩 19 天：50 × 19 / 30。
  assert.ok(Math.abs((basis ?? 0) - 31.6666667) < 0.0001)
})

test('settings defaults and renewal clamp', () => {
  const defaults = parseAssetSettings({})
  assert.equal(defaults.showPage, true)
  assert.equal(defaults.showForGuests, false)
  assert.equal(defaults.currency, 'CNY')
  assert.equal(defaults.renewalWarningDays, 7)
  const clamped = parseAssetSettings({ assetRenewalWarningDays: 999, assetCurrency: 'HKD' })
  assert.equal(clamped.renewalWarningDays, 365)
  assert.equal(clamped.currency, 'HKD')
})

test('labels and remaining-value basis', () => {
  assert.equal(billingCycleLabel(30), '月')
  assert.equal(billingCycleLabel(-1), '一次性')
  assert.equal(billingCycleLabel(730), '2 年')
  assert.equal(expiryLabel(null), '到期未知')
  assert.equal(expiryLabel(0), '今日到期')
  assert.equal(expiryLabel(-2), '已过期 2 天')
  assert.equal(expiryLabel(36_501), '长期')
  const acquiredAt = new Date(NOW - 10 * DAY).toISOString().slice(0, 10)
  const basis = remainingValueAt(node(), acquiredAt, RATES, NOW)
  assert.ok(Math.abs((basis ?? 0) - 42.5) < 0.0001)
  assert.ok(Math.abs((remainingValueCny(node(), RATES, NOW) ?? 0) - 25) < 0.0001)
})
