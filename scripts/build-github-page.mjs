#!/usr/bin/env node
/**
 * 纯静态（GitHub Pages / 主题商店）构建后的运行时配置注入。
 * 所有值都来自环境变量（CI 中由仓库 Secrets 注入），不写死 Worker 地址。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildCsp, injectApiBase, injectBackground, injectCsp, injectTitle, parseOrigins } from './csp.mjs'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distDir = path.join(rootDir, 'dist')

// 允许本地 .env 覆盖（不提交到仓库）
const envPath = path.join(rootDir, '.env')
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#'))
      continue
    const index = trimmed.indexOf('=')
    if (index === -1)
      continue
    const key = trimmed.slice(0, index).trim()
    let value = trimmed.slice(index + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\'')))
      value = value.slice(1, -1)
    if (!(key in process.env))
      process.env[key] = value
  }
}

if (!fs.existsSync(distDir))
  throw new Error('dist 不存在，请先运行 vite build')

const apiBases = parseOrigins(process.env.API_BASE || '')
if (!apiBases.length)
  console.warn('[build] 未设置 API_BASE：主题将使用当前页面同源地址作为后端')

const title = process.env.TITLE || ''
const backgroundImage = process.env.BACKGROUND_IMAGE || ''
const csp = buildCsp({
  apiBases,
  extraApi: [process.env.CSP_API || ''],
  extraStatic: [process.env.CSP_STATIC || ''],
})

const htmlFiles = fs.readdirSync(distDir).filter(file => file.endsWith('.html'))
for (const file of htmlFiles) {
  const filePath = path.join(distDir, file)
  let html = fs.readFileSync(filePath, 'utf8')
  html = injectApiBase(html, apiBases)
  html = injectTitle(html, title)
  html = injectCsp(html, csp)
  html = injectBackground(html, backgroundImage)
  fs.writeFileSync(filePath, html, 'utf8')
  console.log(`[build] 已注入运行时配置：${file}`)
}

// 产物只允许 index.html 与 assets/
const unexpected = fs.readdirSync(distDir).filter(name => name !== 'index.html' && name !== 'assets')
if (unexpected.length) {
  for (const name of unexpected)
    fs.rmSync(path.join(distDir, name), { recursive: true, force: true })
  console.warn(`[build] 已移除多余产物：${unexpected.join(', ')}`)
}

console.log('[build] 完成：index.html + assets/')
