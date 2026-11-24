import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { defineConfig, loadEnv, type PluginOption } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

function gitHash(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  }
  catch {
    return 'dev'
  }
}

function escapeHtmlAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

/** 开发时把 API_BASE 写进 meta，便于跨域调试纯静态主题。 */
function devApiBasePlugin(apiBase: string): PluginOption {
  if (!apiBase)
    return null
  return {
    name: 'cfsm-dev-api-base',
    apply: 'serve',
    transformIndexHtml(html) {
      const meta = `<meta name="apiBase" content="${escapeHtmlAttr(apiBase)}">`
      if (/<meta\b(?=[^>]*\bname=["']apiBase["'])[^>]*>/i.test(html))
        return html.replace(/<meta\b(?=[^>]*\bname=["']apiBase["'])[^>]*>/i, meta)
      return html.replace(/(<head[^>]*>)/i, `$1\n    ${meta}`)
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiBase = (env.API_BASE || env.VITE_API_BASE || '').trim()

  return {
    plugins: [vue(), tailwindcss(), devApiBasePlugin(apiBase)],
    define: {
      __BUILD_VERSION__: JSON.stringify(pkg.version),
      __BUILD_GIT_HASH__: JSON.stringify(gitHash()),
    },
    resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
    server: {
      host: '127.0.0.1',
      proxy: apiBase
        ? undefined
        : {
            // 本地 wrangler dev 默认 https 自签证书，secure:false 让代理接受
            '/api': { target: env.MONITOR_HUB ?? 'http://127.0.0.1:8787', changeOrigin: true, ws: true, secure: false },
          },
    },
    build: {
      target: ['es2022', 'chrome111', 'safari16.2', 'firefox113'],
      chunkSizeWarningLimit: 1800,
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            const normalized = id.replace(/\\/g, '/')
            if (!normalized.includes('/node_modules/'))
              return
            if (/\/node_modules\/(?:echarts|zrender|vue-echarts)\//.test(normalized))
              return 'charts'
            if (/\/node_modules\/(?:three|globe\.gl|cobe)\//.test(normalized))
              return 'globe'
            if (/\/node_modules\/(?:vue|vue-router|pinia|@vue)\//.test(normalized))
              return 'vue'
          },
        },
      },
    },
  }
})
