/** Turnstile 一次性 token / 已验证凭证的本地缓存与脚本加载。 */

export const TURNSTILE_TOKEN_KEY = 'turnstile_token'
export const TURNSTILE_VERIFIED_KEY = 'turnstile_verified'
export const TURNSTILE_INVALID_EVENT = 'cfsm-turnstile-invalid'

const TURNSTILE_SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js'

interface TurnstileRenderOptions {
  sitekey: string
  theme?: 'light' | 'dark' | 'auto'
  language?: string
  callback?: (token: string) => void
  'error-callback'?: (error?: unknown) => void
  'expired-callback'?: () => void
  [key: string]: unknown
}

interface TurnstileGlobal {
  render: (container: HTMLElement | string, options: TurnstileRenderOptions) => string
  remove: (widgetId: string) => void
  reset: (widgetId?: string | HTMLElement) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileGlobal
  }
}

function readStorage(key: string): string {
  try {
    return localStorage.getItem(key) ?? ''
  }
  catch {
    return ''
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  }
  catch {
    // 存储不可用时验证不会持久化，不影响本次访问
  }
}

function removeStorage(key: string): void {
  try {
    localStorage.removeItem(key)
  }
  catch {
    // 忽略
  }
}

export function getTurnstileToken(): string {
  return readStorage(TURNSTILE_TOKEN_KEY)
}

export function setTurnstileToken(token: string): void {
  if (token)
    writeStorage(TURNSTILE_TOKEN_KEY, token)
}

export function clearTurnstileToken(): void {
  removeStorage(TURNSTILE_TOKEN_KEY)
}

export function getTurnstileVerified(): string {
  return readStorage(TURNSTILE_VERIFIED_KEY)
}

export function storeTurnstileVerified(encrypted: string): void {
  if (!encrypted)
    return
  writeStorage(TURNSTILE_VERIFIED_KEY, encrypted)
  removeStorage(TURNSTILE_TOKEN_KEY)
}

export function clearTurnstileVerified(): void {
  removeStorage(TURNSTILE_VERIFIED_KEY)
  removeStorage(TURNSTILE_TOKEN_KEY)
}

/** 403 时清掉凭证并广播，让页面重新出现验证门。 */
export function invalidateTurnstile(): void {
  clearTurnstileVerified()
  window.dispatchEvent(new CustomEvent(TURNSTILE_INVALID_EVENT))
}

let turnstileScriptPromise: Promise<void> | null = null

export function loadTurnstileScript(): Promise<void> {
  if (window.turnstile)
    return Promise.resolve()

  turnstileScriptPromise ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = TURNSTILE_SCRIPT_SRC
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => {
      turnstileScriptPromise = null
      reject(new Error('Turnstile script failed to load'))
    }
    document.head.appendChild(script)
  })

  return turnstileScriptPromise
}
