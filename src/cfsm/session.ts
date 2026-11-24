import { computed, ref, shallowRef } from 'vue'
import type { CfSite, CfSiteConfig } from '@/cfsm/types'
import { getApiBases } from '@/cfsm/apiBase'
import { getSiteConfig, saveThemeOptions } from '@/cfsm/api'
import { setPrivateLockBase, setTurnstileEnabled } from '@/cfsm/http'
import { getTurnstileVerified, storeTurnstileVerified } from '@/cfsm/turnstile'

/** 已加载的后端站点（多 apiBase 时有多份配置）。 */
export const sites = shallowRef<CfSite[]>([])
export const themeOptionsRaw = ref<Record<string, unknown>>({})
export const turnstileGate = ref<{ base: string, siteKey: string } | null>(null)
export const configLoaded = ref(false)
export const configError = ref('')

export const primarySite = computed(() => sites.value[0])

export function getSites(): CfSite[] {
  return sites.value
}

export function getPrimarySite(): CfSite | undefined {
  return sites.value[0]
}

export function getSiteByIndex(index: number): CfSite | undefined {
  return sites.value[index]
}

export function isAuthed(): boolean {
  return sites.value.some(site => site.config.authorization === true)
}

export function getWsTimeoutMinutes(): number {
  const value = Number(primarySite.value?.config.frontend_ws_timeout_minutes ?? 0)
  return Number.isFinite(value) && value > 0 ? value : 0
}

export function getLongHistoryPoints(): number {
  const value = Number(primarySite.value?.config.long_history_points ?? 120)
  return Number.isFinite(value) && value > 0 ? value : 120
}

/** 所有站点都启用了 Turnstile 时才需要对每个后端复用同一份凭证。 */
export function anyTurnstileEnabled(): boolean {
  return sites.value.some(site => site.config.turnstile_enabled === true)
}

export function siteNeedsVerification(site: CfSite): boolean {
  return site.config.turnstile_enabled === true && site.config.verified !== true && !getTurnstileVerified()
}

async function fetchConfigs(): Promise<CfSite[]> {
  const bases = getApiBases()
  const loaded = await Promise.all(bases.map(async (base, index) => {
    const config = await getSiteConfig(base, { turnstile: false })
    return { index, base, config, ids: [] } satisfies CfSite
  }))
  sites.value = loaded
  setTurnstileEnabled(loaded.some(site => site.config.turnstile_enabled === true))
  return loaded
}

/**
 * 首次加载：每个后端各请求一次 /api/config。
 * 返回 'ready' 表示可以继续；'turnstile' 表示需要人工验证；'private' 表示需要登录。
 */
export async function loadSiteConfigs(): Promise<'ready' | 'turnstile' | 'private'> {
  configError.value = ''
  const loaded = await fetchConfigs()

  // 先过人机验证：/api/config 本身不需要登录，验证后再判断是否要跳转后台登录。
  const needsTurnstile = loaded.find(site => siteNeedsVerification(site))
  if (needsTurnstile) {
    turnstileGate.value = {
      base: needsTurnstile.base,
      siteKey: String(needsTurnstile.config.turnstile_site_key ?? ''),
    }
    return 'turnstile'
  }

  const locked = loaded.filter(site => site.config.is_public !== true && site.config.authorization !== true)
  setPrivateLockBase(loaded.filter(site => site.config.is_public !== true)[0]?.base ?? '')
  if (locked.length > 0)
    return 'private'

  turnstileGate.value = null
  themeOptionsRaw.value = { ...(loaded[0]?.config.theme_options ?? {}) }
  configLoaded.value = true
  return 'ready'
}

/** 完成人机验证：换取加密凭证并重新读取配置。 */
export async function verifyTurnstile(token: string): Promise<void> {
  const gate = turnstileGate.value
  if (!gate)
    return
  const config = await getSiteConfig(gate.base, { turnstile: true, turnstileToken: token })
  if (config.turnstile_verified)
    storeTurnstileVerified(config.turnstile_verified)
  turnstileGate.value = null
  await loadSiteConfigs()
}

export function resetTurnstileGate(): void {
  turnstileGate.value = null
}

/** 保存主题设置（仅主站，需管理员登录）。 */
export async function saveThemeOptionsRemote(values: Record<string, unknown>): Promise<Record<string, unknown>> {
  const site = getPrimarySite()
  if (!site)
    throw new Error('站点配置尚未加载')
  const saved = await saveThemeOptions(site.base, values, site.config.turnstile_enabled === true)
  site.config.theme_options = saved
  themeOptionsRaw.value = { ...saved }
  return saved
}

export function defaultSiteConfig(): CfSiteConfig {
  return { is_public: true, authorization: false, turnstile_enabled: false, theme_options: {} }
}
