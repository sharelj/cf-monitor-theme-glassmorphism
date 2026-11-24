import type { CfHistoryRow, CfServer, CfServersResponse, CfSiteConfig } from '@/cfsm/types'
import { cfRequest, CfApiError } from '@/cfsm/http'

/** CF-Server-Monitor 允许的历史时间范围（小时），默认 10 分钟。 */
export const HISTORY_HOURS = [0.167, 0.5, 1, 6, 12, 24, 48, 96, 168] as const
export type HistoryHours = typeof HISTORY_HOURS[number]
export const DEFAULT_HISTORY_HOURS: HistoryHours = 0.167
/** 未登录时后端只允许查询 24 小时以内。 */
export const ANONYMOUS_MAX_HISTORY_HOURS: HistoryHours = 24

export function normalizeHistoryHours(hours: number, authed: boolean): HistoryHours {
  const max = authed ? 168 : 24
  const allowed = HISTORY_HOURS.filter(h => h <= max)
  if (!Number.isFinite(hours) || hours <= 0)
    return DEFAULT_HISTORY_HOURS
  let nearest = allowed[0] ?? DEFAULT_HISTORY_HOURS
  for (const candidate of allowed) {
    if (candidate <= hours)
      nearest = candidate
  }
  return nearest
}

export function historyRangeLabel(hours: number): string {
  if (hours < 1)
    return `${Math.round(hours * 60)} 分钟`
  if (hours % 24 === 0)
    return `${hours / 24} 天`
  return `${hours} 小时`
}

/** 可用的时间范围按钮：当前登录状态允许的档位。 */
export function historyWindows(authed: boolean): HistoryHours[] {
  const max = authed ? 168 : 24
  return HISTORY_HOURS.filter(h => h <= max)
}

export function getSiteConfig(base: string, options: { turnstileToken?: string, turnstile?: boolean } = {}): Promise<CfSiteConfig> {
  return cfRequest<CfSiteConfig>(base, '/api/config', {
    auth: true,
    turnstile: options.turnstile,
    turnstileToken: options.turnstileToken,
  })
}

export function getServers(base: string, turnstile = false): Promise<CfServersResponse> {
  return cfRequest<CfServersResponse>(base, '/api/servers', { turnstile })
}

export function getServer(base: string, id: string, turnstile = false, signal?: AbortSignal): Promise<CfServer> {
  const query = new URLSearchParams({ id })
  return cfRequest<CfServer>(base, `/api/server?${query.toString()}`, { turnstile, signal })
}

export function getHistory(base: string, id: string, hours: number, turnstile = false, signal?: AbortSignal): Promise<CfHistoryRow[]> {
  const query = new URLSearchParams({ id, hours: String(hours) })
  return cfRequest<CfHistoryRow[]>(base, `/api/history/all?${query.toString()}`, { turnstile, signal })
}

export async function saveThemeOptions(base: string, themeOptions: Record<string, unknown>, turnstile = false): Promise<Record<string, unknown>> {
  const result = await cfRequest<{ theme_options?: Record<string, unknown> }>(base, '/api/theme_options', {
    method: 'POST',
    body: { theme_options: themeOptions },
    turnstile,
  })
  return result.theme_options ?? themeOptions
}

export { CfApiError }
