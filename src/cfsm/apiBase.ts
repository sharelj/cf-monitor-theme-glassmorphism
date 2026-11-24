/** 读取 HTML meta 里的 apiBase，或退回当前页面同源地址。 */

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

export function getConfiguredApiBases(): string[] {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="apiBase"]')?.content
  return meta
    ?.split(',')
    .map(item => stripTrailingSlash(item.trim()))
    .filter(Boolean) ?? []
}

/** 每个 apiBase 是一个独立后端；没有配置时为当前同源地址。 */
export function getApiBases(): string[] {
  const bases = getConfiguredApiBases()
  return bases.length > 0 ? bases : [stripTrailingSlash(window.location.origin)]
}

export function isSameOrigin(base: string): boolean {
  try {
    return new URL(base).origin === window.location.origin
  }
  catch {
    return false
  }
}

export function apiUrl(base: string, path: string): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`
  return `${stripTrailingSlash(base)}${cleanPath}`
}

export function wsUrl(base: string, params: Record<string, string>): string {
  const url = new URL(apiUrl(base, '/api/ws'))
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  for (const [key, value] of Object.entries(params)) {
    if (value)
      url.searchParams.set(key, value)
  }
  return url.toString()
}

export function readJwt(): string {
  try {
    return localStorage.getItem('jwt_token') ?? ''
  }
  catch {
    return ''
  }
}

export function clearJwt(): void {
  try {
    localStorage.removeItem('jwt_token')
  }
  catch {
    // 忽略隐私模式下的存储异常
  }
}

/**
 * 主题静态资源：旗帜与 OS 图标来自默认皮肤，不打包进主题。
 * 优先使用相对路径（hub 反代主题时即为 /flags/…），静态托管时可回退到后端地址。
 */
export function publicAssetCandidates(path: string): string[] {
  const clean = path.replace(/^\/+/, '')
  const candidates = [`./${clean}`]
  for (const base of getConfiguredApiBases()) {
    const url = `${stripTrailingSlash(base)}/${clean}`
    if (!candidates.includes(url))
      candidates.push(url)
  }
  return candidates
}

export function publicAssetUrl(path: string): string {
  const clean = path.replace(/^\/+/, '')
  // 纯静态托管（GitHub Pages）时，默认皮肤的 /flags、/os-icons 在后端源站上；
  // hub 反代主题时同源，直接用相对路径。
  const configured = getConfiguredApiBases()
  if (configured.length > 0 && configured[0] && !isSameOrigin(configured[0]))
    return `${stripTrailingSlash(configured[0])}/${clean}`
  return `./${clean}`
}

/** 跨域部署时 WebSocket 不能带 Header，需要在 URL 上追加 token。 */
export function wsAuthToken(base: string): string {
  return isSameOrigin(base) ? '' : readJwt()
}
