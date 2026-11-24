#!/usr/bin/env node
/** 鉴权、主题设置保存、私有站跳转、Turnstile 验证门与 WS 超时提示的浏览器测试。 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const shots = path.join(rootDir, 'test', 'screenshots')
fs.mkdirSync(shots, { recursive: true })

const executablePath = process.env.CHROMIUM_PATH || `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`
const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

async function startServer(port, env = {}) {
  const child = spawn(process.execPath, [path.join(rootDir, 'test', 'mock-cf-server.mjs')], {
    env: { ...process.env, PORT: String(port), ...env },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise((resolve) => {
    child.stdout.on('data', (chunk) => {
      if (String(chunk).includes('[mock]'))
        resolve()
    })
    setTimeout(resolve, 1500)
  })
  return child
}

async function getJson(url) {
  const response = await fetch(url)
  return response.json()
}

const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] })

try {
  /* ---------------- A. 管理员登录后可保存主题设置 ---------------- */
  const portA = 9921
  const serverA = await startServer(portA)
  const contextA = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' })
  await contextA.addInitScript(() => localStorage.setItem('jwt_token', 'demo-token'))
  const pageA = await contextA.newPage()
  const errorsA = []
  pageA.on('pageerror', error => errorsA.push(String(error)))
  pageA.on('console', message => { if (message.type() === 'error') errorsA.push(message.text()) })
  pageA.on('response', (response) => { if (response.status() >= 400) errorsA.push(`HTTP ${response.status()} ${response.url()}`) })
  await pageA.goto(`http://127.0.0.1:${portA}/#/`, { waitUntil: 'networkidle' })
  await pageA.waitForSelector('.node-card', { timeout: 15000 })
  const settingsButton = pageA.locator('button[aria-label="主题设置"]')
  check('登录后显示主题设置入口', await settingsButton.count() === 1)
  await settingsButton.click()
  await pageA.waitForSelector('dialog[open]', { timeout: 5000 })
  const fieldCount = await pageA.locator('.settings-fields .settings-field').count()
  check('设置面板按 theme.json 渲染字段', fieldCount > 20, `fields=${fieldCount}`)
  const titleInput = pageA.locator('.settings-field', { hasText: '公告标题' }).locator('input[type="text"]').first()
  await titleInput.fill('测试公告标题')
  await pageA.locator('button', { hasText: '保存到站点' }).click()
  await pageA.waitForFunction(() => document.querySelector('.monitor-settings footer')?.textContent?.includes('已保存到站点'), null, { timeout: 8000 })
  const savedConfig = await getJson(`http://127.0.0.1:${portA}/__config`)
  check('主题设置保存到 /api/theme_options', savedConfig.theme_options?.alertTitle === '测试公告标题', JSON.stringify(savedConfig.theme_options).slice(0, 120))
  const statsA = await getJson(`http://127.0.0.1:${portA}/__stats`)
  check('保存主题设置只发一次 POST', statsA.themeOptions === 1, JSON.stringify(statsA))
  check('登录态无运行时错误', errorsA.length === 0, errorsA.slice(0, 2).join(' | '))
  await pageA.locator('button', { hasText: '关闭' }).first().click().catch(() => {})
  await contextA.close()
  serverA.kill()

  /* ---------------- B. 私有站未登录跳转后台 ---------------- */
  const portB = 9922
  const serverB = await startServer(portB, { PRIVATE: '1' })
  const contextB = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const pageB = await contextB.newPage()
  await pageB.goto(`http://127.0.0.1:${portB}/#/`, { waitUntil: 'domcontentloaded' })
  await pageB.waitForTimeout(1200)
  check('私有站未登录跳转 /admin#/admin', pageB.url().includes('/admin#/admin'), pageB.url())
  await contextB.close()
  serverB.kill()

  /* ---------------- C. Turnstile 验证门 ---------------- */
  const portC = 9923
  const serverC = await startServer(portC, { TURNSTILE: '1' })
  const contextC = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const pageC = await contextC.newPage()
  const errorsC = []
  pageC.on('pageerror', error => errorsC.push(String(error)))
  await pageC.route('https://challenges.cloudflare.com/**', route => route.fulfill({
    status: 200,
    contentType: 'text/javascript',
    body: `window.turnstile = {
      render(el, opts) { setTimeout(() => opts.callback && opts.callback('mock-turnstile-token'), 1200); return 'widget-1' },
      remove() {}, reset() {}
    }`,
  }))
  await pageC.goto(`http://127.0.0.1:${portC}/#/`, { waitUntil: 'networkidle' })
  const gateText = await pageC.locator('.turnstile-gate').innerText().catch(() => '')
  check('Turnstile 开启时显示验证门', gateText.includes('安全验证'), gateText.replace(/\n/g, ' | '))
  await pageC.waitForSelector('.node-card', { timeout: 15000 })
  check('验证完成后渲染首页', (await pageC.locator('.node-card').count()) === 5, 'cards=5')
  const storedVerified = await pageC.evaluate(() => localStorage.getItem('turnstile_verified'))
  check('验证凭证缓存复用', storedVerified === 'mock-verified', String(storedVerified))
  const statsC = await getJson(`http://127.0.0.1:${portC}/__stats`)
  check('Turnstile 流程无控制台异常', errorsC.length === 0, errorsC.slice(0, 2).join(' | '))
  check('验证后 /api/servers 正常请求', statsC.servers === 1, JSON.stringify(statsC))
  await contextC.close()
  serverC.kill()

  /* ---------------- D. WS 超时提示 ---------------- */
  const portD = 9924
  const serverD = await startServer(portD, { WS_TIMEOUT_MINUTES: '0.05' })
  const contextD = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const pageD = await contextD.newPage()
  await pageD.goto(`http://127.0.0.1:${portD}/#/`, { waitUntil: 'networkidle' })
  await pageD.waitForSelector('.node-card', { timeout: 15000 })
  await pageD.waitForSelector('.ws-timeout', { timeout: 12000 })
  check('达到 frontend_ws_timeout_minutes 后提示用户', await pageD.locator('.ws-timeout').count() === 1)
  await pageD.locator('button', { hasText: '继续实时更新' }).click()
  await pageD.waitForTimeout(800)
  const statsD1 = await getJson(`http://127.0.0.1:${portD}/__stats`)
  check('用户选择继续后重新建立 WS', statsD1.wsConnections >= 2 && statsD1.wsOpen === 1, JSON.stringify(statsD1))
  await pageD.waitForSelector('.ws-timeout', { timeout: 12000 })
  await pageD.locator('button', { hasText: '停止更新' }).click()
  await pageD.waitForTimeout(1500)
  const statsD2 = await getJson(`http://127.0.0.1:${portD}/__stats`)
  check('用户选择停止后不静默重连', statsD2.wsOpen === 0, JSON.stringify(statsD2))
  await contextD.close()
  serverD.kill()
}
catch (error) {
  check('测试执行', false, String(error))
}
finally {
  await browser.close()
}

const failed = results.filter(item => !item.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length)
  process.exit(1)
