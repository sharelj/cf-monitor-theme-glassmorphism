import { useAppStore } from '@/stores/app'
import { applyThemeOptions } from '@/monitor/config'
import { safeStorage } from '@/monitor/storage'
import { getPrimarySite, loadSiteConfigs, sites, turnstileGate } from '@/cfsm/session'
import { gotoAdminLogin } from '@/cfsm/http'
import { destroyDataLayer } from '@/cfsm/data'
import { TURNSTILE_INVALID_EVENT } from '@/cfsm/turnstile'

let started = false
let turnstileListenerBound = false
const FAILURE_LIMIT = 3

function applySiteConfig(): void {
  const site = getPrimarySite()
  if (!site)
    return
  const config = site.config
  const settings = {
    sitename: String(config.site_title ?? '').trim() || 'CF Server Monitor',
    description: '',
    private_site: config.is_public !== true,
    record_enabled: true,
    record_preserve_time: config.authorization === true ? 168 : 24,
    ping_record_preserve_time: config.authorization === true ? 168 : 24,
    theme_settings: applyThemeOptions(config.theme_options),
    theme: 'glassmorphism',
    version: String(config.version ?? ''),
    is_public: config.is_public === true,
    authorization: config.authorization === true,
    visitor_audit_enabled: false,
  }
  const store = useAppStore()
  store.publicSettings = settings
  store.updateLoginState(settings.authorization)
  document.title = settings.sitename

  const language = String(config.default_language ?? 'auto')
  // 主题界面以中文为主，auto 时固定中文，避免英文浏览器出现中英混排；
  // 后台显式选择 en 时才使用英文格式化。
  store.lang = language === 'en' ? 'en-US' : 'zh-CN'

  // 访客没有手动选过深浅色时，跟随后台外观设置
  try {
    if (safeStorage.getItem('themeMode') === null) {
      const preferred = String(config.preferred_theme ?? 'auto')
      store.themeMode = preferred === 'light' ? 'light' : preferred === 'dark' ? 'dark' : 'auto'
    }
  }
  catch {
    // 忽略存储异常
  }
}

function bindTurnstileInvalid(): void {
  if (turnstileListenerBound)
    return
  turnstileListenerBound = true
  window.addEventListener(TURNSTILE_INVALID_EVENT, () => {
    // 403：清掉凭证后重新读配置，验证门会重新出现
    void loadSiteConfigs().catch(() => {})
  })
}

/**
 * 首次载入：每个后端各读一次 /api/config。
 * 不在这里请求服务器列表：首页与详情页各自按自己的流程取数。
 */
export async function initApp(): Promise<void> {
  started = true
  const store = useAppStore()
  store.loading = true
  store.connectionError = false
  bindTurnstileInvalid()

  try {
    for (let attempt = 1; ; attempt++) {
      try {
        const result = await loadSiteConfigs()
        if (result === 'turnstile') {
          store.loading = false
          return
        }
        if (result === 'private') {
          store.loading = false
          gotoAdminLogin(getPrimarySite()?.base ?? window.location.origin)
          return
        }
        applySiteConfig()
        store.loading = false
        store.connectionError = false
        return
      }
      catch (error) {
        if (attempt >= FAILURE_LIMIT) {
          store.connectionError = true
          store.loading = false
          throw error
        }
        await new Promise(resolve => setTimeout(resolve, attempt * 1000))
      }
    }
  }
  catch (error) {
    console.error('[boot] 初始化失败', error)
    store.loading = false
  }
}

export async function retryInitApp(): Promise<boolean> {
  await initApp()
  return !useAppStore().connectionError && turnstileGate.value === null
}

export function destroyInitManager(): void {
  if (!started)
    return
  started = false
  destroyDataLayer()
}

/** 验证门通过后再次应用站点配置。 */
export function refreshSiteConfig(): void {
  applySiteConfig()
}

export function hasLoadedSites(): boolean {
  return sites.value.length > 0
}
