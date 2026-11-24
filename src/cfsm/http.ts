import { apiUrl, isSameOrigin, readJwt } from '@/cfsm/apiBase'
import { getTurnstileToken, getTurnstileVerified, invalidateTurnstile } from '@/cfsm/turnstile'

export class CfApiError extends Error {
  status: number
  code?: string

  constructor(message: string, status = 0, code?: string) {
    super(message)
    this.name = 'CfApiError'
    this.status = status
    this.code = code
  }
}

export interface CfRequestOptions {
  method?: 'GET' | 'POST' | 'PUT'
  body?: unknown
  signal?: AbortSignal
  /** 是否携带 JWT；默认携带（公开站没有 token 时不加头） */
  auth?: boolean
  /** 该站点是否启用了 Turnstile；启用时带上验证头 */
  turnstile?: boolean
  /** 强制带一次性 token（验证阶段） */
  turnstileToken?: string
  timeoutMs?: number
}

let turnstileEnabled = false
let privateLockBase = ''

export function setPrivateLockBase(base: string): void {
  privateLockBase = base
}

export function setTurnstileEnabled(enabled: boolean): void {
  turnstileEnabled = enabled
}

export function isTurnstileEnabled(): boolean {
  return turnstileEnabled
}

function buildHeaders(options: CfRequestOptions): Headers {
  const headers = new Headers()
  if (options.body !== undefined)
    headers.set('Content-Type', 'application/json')
  if (options.auth !== false) {
    const token = readJwt()
    if (token)
      headers.set('Authorization', `Bearer ${token}`)
  }
  const turnstile = options.turnstile ?? turnstileEnabled
  if (turnstile) {
    if (options.turnstileToken)
      headers.set('X-Turnstile-Token', options.turnstileToken)
    else {
      const verified = getTurnstileVerified()
      const token = getTurnstileToken()
      if (verified)
        headers.set('X-Turnstile-Verified', verified)
      else if (token)
        headers.set('X-Turnstile-Token', token)
    }
  }
  return headers
}

function errorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    const message = record.error ?? record.message
    if (typeof message === 'string' && message.trim())
      return message
  }
  return fallback
}

export async function cfRequest<T>(base: string, path: string, options: CfRequestOptions = {}): Promise<T> {
  const controller = new AbortController()
  const timeoutMs = options.timeoutMs ?? 15000
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  const abort = () => controller.abort()
  options.signal?.addEventListener('abort', abort, { once: true })

  try {
    const response = await fetch(apiUrl(base, path), {
      method: options.method ?? 'GET',
      headers: buildHeaders(options),
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: 'same-origin',
      signal: controller.signal,
    })

    const text = await response.text()
    let payload: unknown = null
    if (text) {
      try {
        payload = JSON.parse(text)
      }
      catch {
        payload = text
      }
    }

    if (!response.ok) {
      if (response.status === 403 && (options.turnstile ?? turnstileEnabled))
        invalidateTurnstile()
      if (response.status === 401) {
        // JWT 失效：清掉本地凭证；私有站点跳后台登录（不在主题内实现登录页）
        try {
          localStorage.removeItem('jwt_token')
        }
        catch {
          // 忽略
        }
        if (privateLockBase)
          gotoAdminLogin(privateLockBase)
      }
      throw new CfApiError(
        errorMessage(payload, `请求失败（${response.status}）`),
        response.status,
        typeof payload === 'object' && payload ? String((payload as Record<string, unknown>).error ?? '') : undefined,
      )
    }

    return payload as T
  }
  catch (error) {
    if (error instanceof CfApiError)
      throw error
    if (error instanceof DOMException && error.name === 'AbortError')
      throw new CfApiError('请求超时', 0, 'timeout')
    throw new CfApiError(error instanceof Error ? error.message : '网络请求失败', 0, 'network')
  }
  finally {
    window.clearTimeout(timer)
    options.signal?.removeEventListener('abort', abort)
  }
}

/** 私有站点未登录时跳转后台登录，不实现主题内登录页。 */
export function gotoAdminLogin(base: string): void {
  if (window.location.pathname.startsWith('/admin'))
    return
  const target = isSameOrigin(base) ? `${window.location.origin}/admin#/admin` : `${base}/admin#/admin`
  window.location.assign(target)
}
