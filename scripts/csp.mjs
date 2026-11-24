const TURNSTILE_DOMAIN = 'https://challenges.cloudflare.com'
const INSIGHTS_DOMAIN = 'https://static.cloudflareinsights.com'
const FONTS_API_DOMAIN = 'https://fonts.googleapis.com'
const FONTS_STATIC_DOMAIN = 'https://fonts.gstatic.com'

// 主题运行时需要访问的第三方域名（图标 CDN、Bing 背景、汇率接口）
const DEFAULT_CONNECT_DOMAINS = [
  'https://api.iconify.design',
  'https://api.simplesvg.com',
  'https://api.unisvg.com',
  'https://bing.biturl.top',
  'https://api.frankfurter.dev',
  'https://api.frankfurter.app',
  'https://open.er-api.com',
]

const CSP_META_RE = /<meta\b(?=[^>]*http-equiv=["']Content-Security-Policy["'])[^>]*>\s*/gi
const API_BASE_META_RE = /<meta\b(?=[^>]*\bname=["']apiBase["'])[^>]*>/i

export function normalizeOrigin(value) {
  const raw = String(value || '').trim()
  if (!raw || /[\s;"']/.test(raw))
    return ''
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' && url.protocol !== 'http:')
      return ''
    return url.origin
  }
  catch {
    return ''
  }
}

export function parseOrigins(value) {
  return [...new Set(String(value || '')
    .split(',')
    .map(normalizeOrigin)
    .filter(Boolean))]
}

export function buildCsp({ apiBases = [], extraApi = [], extraStatic = [] } = {}) {
  const apiOrigins = [...new Set([...apiBases, ...parseOrigins(extraApi.join(','))])]
  const wsOrigins = apiOrigins.flatMap(origin => origin.startsWith('https://') ? [origin.replace('https://', 'wss://')] : origin.startsWith('http://') ? [origin.replace('http://', 'ws://')] : [])
  const staticOrigins = parseOrigins(extraStatic.join(','))

  const directive = (name, values) => `${name} ${[...new Set(values.filter(Boolean))].join(' ')}`
  return [
    directive('default-src', ["'self'"]),
    directive('script-src', ["'self'", "'unsafe-inline'", TURNSTILE_DOMAIN, INSIGHTS_DOMAIN, ...staticOrigins]),
    directive('style-src', ["'self'", "'unsafe-inline'", FONTS_API_DOMAIN, ...staticOrigins]),
    directive('img-src', ["'self'", 'data:', 'blob:', 'https:', TURNSTILE_DOMAIN]),
    directive('font-src', ["'self'", 'data:', FONTS_STATIC_DOMAIN]),
    directive('media-src', ["'self'", 'https:', 'blob:']),
    directive('connect-src', ["'self'", TURNSTILE_DOMAIN, INSIGHTS_DOMAIN, ...DEFAULT_CONNECT_DOMAINS, ...apiOrigins, ...wsOrigins, ...staticOrigins]),
    directive('frame-src', [TURNSTILE_DOMAIN]),
    directive('object-src', ["'none'"]),
    directive('base-uri', ["'self'"]),
    directive('form-action', ["'self'"]),
  ].join('; ')
}

export function injectCsp(html, csp) {
  const cleaned = html.replace(CSP_META_RE, '')
  const meta = `<meta http-equiv="Content-Security-Policy" content="${csp.replace(/"/g, '&quot;')}">`
  return cleaned.replace(/<\/head>/i, `    ${meta}\n  </head>`)
}

export function injectApiBase(html, bases) {
  if (!bases.length)
    return html
  const content = bases.join(',').replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  const meta = `<meta name="apiBase" content="${content}">`
  if (API_BASE_META_RE.test(html))
    return html.replace(API_BASE_META_RE, meta)
  return html.replace(/<head[^>]*>/i, match => `${match}\n    ${meta}`)
}

export function injectTitle(html, title) {
  if (!title)
    return html
  const safe = title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  let next = html.replace(/<title>.*?<\/title>/is, `<title>${safe}</title>`)
  next = next.replace(/(<meta name="apple-mobile-web-app-title" content=")[^"]*(")/, `$1${safe}$2`)
  return next
}

export function injectBackground(html, url) {
  const value = String(url || '').trim()
  if (!value)
    return html
  const safe = value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  const style = `<style>body::before{content:"";position:fixed;inset:0;z-index:-2;pointer-events:none;background-image:url('${safe}');background-size:cover;background-position:center;background-repeat:no-repeat}</style>`
  return html.replace(/<\/head>/i, `${style}\n  </head>`)
}
