import { HISTORY_HOURS } from '@/cfsm/api'

/**
 * 时间范围按钮：只允许 CF-Server-Monitor 支持的档位。
 * maxHours 由登录状态决定（未登录 24、登录 168），写死的档位会被后端静默收窄。
 */
export function historyWindows(presets: number[], maxHours: number): number[] {
  const usable = presets.filter(h => h > 0 && h <= maxHours)
  return [...new Set(usable)].sort((a, b) => a - b)
}

export function windowLabel(hours: number): string {
  if (hours < 1)
    return `${Math.round(hours * 60)} 分钟`
  if (hours % 24 === 0)
    return `${hours / 24} 天`
  return `${hours} 小时`
}

/** 详情图表的预设档位（0.167 小时是 10 分钟）。 */
export const PRESET_HOURS = [...HISTORY_HOURS]

export const DEFAULT_WINDOW_HOURS = 0.167

/** 历史返回结果缓存：同一节点、同一范围 15 秒内不重复请求。 */
const historyCache = new Map<string, { time: number, promise: Promise<unknown> }>()

export function cached<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const hit = historyCache.get(key)
  if (hit && Date.now() - hit.time < 15000)
    return hit.promise as Promise<T>
  const promise = loader().catch((error) => {
    historyCache.delete(key)
    throw error
  })
  if (historyCache.size > 200)
    historyCache.clear()
  historyCache.set(key, { time: Date.now(), promise })
  return promise
}

export function clearHistoryCache(): void {
  historyCache.clear()
}
