import manifest from '../../theme.json' with { type: 'json' }
import { isSameOrigin } from '@/cfsm/apiBase'
import { getPrimarySite, saveThemeOptionsRemote, themeOptionsRaw } from '@/cfsm/session'
import { isValidSiteIconSetting } from './siteIcon.ts'

export interface ConfigField {
  key?: string
  type: string
  label: string
  help?: string
  default?: unknown
  options?: { value: string, label: string }[]
  min?: number
  max?: number
}

// 主题设置声明：唯一存放处是后端 theme_options，默认值在此补齐，未配置过的站点跟随主题升级。
export const configFields: ConfigField[] = manifest.config as ConfigField[]
const valueFields = configFields.filter((f): f is ConfigField & { key: string } => f.type !== 'title' && Boolean(f.key))
export const defaultConfig: Record<string, unknown> = Object.fromEntries(valueFields.map(f => [f.key, f.default]))
let cachedConfig: Record<string, unknown> = { ...defaultConfig }
let lastSent: Record<string, unknown> = {}

function configObject(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('配置必须为对象')
  return input as Record<string, unknown>
}

const contentChecks: Record<string, (value: unknown) => boolean> = {
  siteIconUrl: isValidSiteIconSetting,
}

export function fitsConfigField(field: ConfigField, value: unknown): boolean {
  return fitsFieldType(field, value) && (!field.key || !contentChecks[field.key] || contentChecks[field.key]!(value))
}

function fitsFieldType(field: ConfigField, value: unknown): boolean {
  switch (field.type) {
    case 'boolean': return typeof value === 'boolean'
    case 'number': return typeof value === 'number' && Number.isFinite(value)
      && value >= (field.min ?? -Infinity) && value <= (field.max ?? Infinity)
    case 'select': return Boolean(field.options?.some(option => option.value === value))
    case 'string':
    case 'text': return typeof value === 'string'
    default: return false
  }
}

export function sanitizeConfig(input: unknown): Record<string, unknown> {
  const values = configObject(input)
  return Object.fromEntries(valueFields.filter(f => Object.hasOwn(values, f.key) && fitsConfigField(f, values[f.key])).map(f => [f.key, values[f.key]]))
}

export function mergeConfig(input: unknown): Record<string, unknown> {
  return { ...defaultConfig, ...sanitizeConfig(input) }
}

export class ConfigRequestError extends Error {
  status: number
  constructor(status: number) {
    const messages: Record<number, string> = {
      400: '主题设置格式不正确（theme_options 必须是非数组对象）。',
      401: '登录已失效，请重新登录管理员账号。',
      403: '人机验证已过期，请刷新页面后重新验证。',
      404: '此版本不支持主题设置接口，请升级 CF-Server-Monitor。',
      413: '主题设置超过后端限制，请缩短公告或图片。',
    }
    super(messages[status] ?? `主题设置请求失败（${status}）`)
    this.status = status
  }
}

/** 从 /api/config 的 theme_options 读取（首次载入时已缓存，不额外请求）。 */
export function getSiteConfig(): Record<string, unknown> {
  return { ...cachedConfig }
}

/** 原始保存值（未补默认值），用于导出与增量保存。 */
export function readSavedConfig(): Record<string, unknown> {
  return { ...(themeOptionsRaw.value ?? {}) }
}

/** 站点配置加载完成后调用：把 theme_options 合并出默认值。 */
export function applyThemeOptions(raw: unknown): Record<string, unknown> {
  lastSent = { ...(raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}) }
  cachedConfig = mergeConfig(raw)
  return getSiteConfig()
}

export async function saveConfig(values: Record<string, unknown>): Promise<Record<string, unknown>> {
  for (const field of valueFields) {
    if (!fitsConfigField(field, values[field.key]))
      throw new Error(`${field.label}的值不符合要求`)
  }
  const site = getPrimarySite()
  if (!site)
    throw new Error('站点配置尚未加载')

  // 只提交声明过的项；其他键（其他主题版本留下的）原样保留。
  const next: Record<string, unknown> = { ...lastSent }
  for (const field of valueFields) {
    const value = values[field.key]
    if (value === field.default)
      delete next[field.key]
    else
      next[field.key] = value
  }

  try {
    cachedConfig = mergeConfig(values)
    lastSent = await saveThemeOptionsRemote(next)
    return getSiteConfig()
  }
  catch (error) {
    const status = (error as { status?: number }).status
    if (typeof status === 'number' && status > 0)
      throw new ConfigRequestError(status)
    throw error
  }
}

export function importConfig(input: unknown): Record<string, unknown> {
  const object = configObject(input)
  const values = configObject(Object.hasOwn(object, 'themeOptions') ? object.themeOptions : object)
  for (const field of valueFields) {
    if (Object.hasOwn(values, field.key) && !fitsConfigField(field, values[field.key]))
      throw new Error(`${field.label}的值不符合要求`)
  }
  return mergeConfig(values)
}

/** 主题设置保存只在同源后台或已配置 apiBase 的主站可用。 */
export function canSaveThemeOptions(): boolean {
  const site = getPrimarySite()
  return Boolean(site) && isSameOrigin(site!.base)
}
