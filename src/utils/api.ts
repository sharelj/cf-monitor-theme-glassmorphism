import type { VersionInfo } from '@/types/model'
import { getServer, getServers, HISTORY_HOURS } from '@/cfsm/api'
import { mapServer } from '@/cfsm/adapter'
import type { CfServer } from '@/cfsm/types'
import type { Client } from '@/types/model'
import { getPrimarySite } from '@/cfsm/session'

export type { VersionInfo }

/** 用户信息（CF-Server-Monitor 只有登录状态） */
export interface MeInfo {
  'logged_in': boolean
  'username': string
}

/** 站点公开属性：由 /api/config 映射而来，保持主题既有字段名。 */
export interface PublicSettings {
  sitename: string
  description: string
  private_site: boolean
  record_enabled: boolean
  record_preserve_time: number
  ping_record_preserve_time: number
  theme_settings: Record<string, unknown>
  theme: string
  version: string
  is_public: boolean
  authorization: boolean
  visitor_audit_enabled?: boolean
}

export class ApiError extends Error {
  status: string
  code?: number

  constructor(message: string, status = 'error', code?: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

/** 历史窗口上限：CF 固定 168 小时，未登录 24 小时。 */
const MAX_HISTORY_HOURS = HISTORY_HOURS[HISTORY_HOURS.length - 1] ?? 168

export class CfThemeApi {
  async getPublicSettings(): Promise<PublicSettings> {
    const site = getPrimarySite()
    if (!site)
      throw new ApiError('站点配置尚未加载')
    const config = site.config
    const authed = config.authorization === true
    const maxHours = authed ? MAX_HISTORY_HOURS : 24
    return {
      sitename: String(config.site_title ?? '').trim() || 'CF Server Monitor',
      description: '',
      private_site: config.is_public !== true,
      record_enabled: true,
      record_preserve_time: maxHours,
      ping_record_preserve_time: maxHours,
      theme_settings: config.theme_options ?? {},
      theme: 'glassmorphism',
      version: String(config.version ?? ''),
      is_public: config.is_public === true,
      authorization: authed,
    }
  }

  async getMe(): Promise<MeInfo> {
    const site = getPrimarySite()
    return { logged_in: site?.config.authorization === true, username: '' }
  }

  async getVersion(): Promise<VersionInfo> {
    const site = getPrimarySite()
    return { version: String(site?.config.version ?? 'CF-Server-Monitor'), hash: '' }
  }

  /** 详情页初始数据。 */
  async getServer(uuid: string, signal?: AbortSignal): Promise<CfServer> {
    const site = getPrimarySite()
    if (!site)
      throw new ApiError('站点配置尚未加载')
    const { id } = parseUuid(uuid)
    return getServer(site.base, id, site.config.turnstile_enabled === true, signal)
  }

  async getServers(): Promise<{ servers: CfServer[], siteIndex: number, sitesCount: number }> {
    const site = getPrimarySite()
    if (!site)
      throw new ApiError('站点配置尚未加载')
    const data = await getServers(site.base, site.config.turnstile_enabled === true)
    return { servers: Array.isArray(data.servers) ? data.servers : [], siteIndex: site.index, sitesCount: 1 }
  }

  /** 详情页单台服务器 → 展示用 Client。 */
  async getClient(uuid: string, sitesCount = 1): Promise<Client> {
    const site = getPrimarySite()
    if (!site)
      throw new ApiError('站点配置尚未加载')
    const raw = await this.getServer(uuid)
    return mapServer(raw, site.index, sitesCount)
  }
}

export function parseUuid(uuid: string): { siteIndex: number, id: string } {
  const match = /^(\d+):(.+)$/.exec(uuid)
  if (match)
    return { siteIndex: Number(match[1]), id: match[2]! }
  return { siteIndex: 0, id: uuid }
}

let sharedApiInstance: CfThemeApi | null = null

export function getSharedApi(): CfThemeApi {
  sharedApiInstance ??= new CfThemeApi()
  return sharedApiInstance
}

export function resetSharedApi(): void {
  sharedApiInstance = null
}

export default CfThemeApi
