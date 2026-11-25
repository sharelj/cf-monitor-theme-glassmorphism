#!/usr/bin/env node
/** 浏览器冒烟测试：验证首页/详情页数据流、WebSocket 推送与请求次数。 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const shots = path.join(rootDir, 'test', 'screenshots')
fs.mkdirSync(shots, { recursive: true })

const PORT = Number(process.env.PORT || 9911)
const BASE = `http://127.0.0.1:${PORT}`
const executablePath = process.env.CHROMIUM_PATH || `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

async function stats() {
  const response = await fetch(`${BASE}/__stats`)
  return response.json()
}

async function resetStats() {
  await fetch(`${BASE}/__reset`)
}

const serverProcess = spawn(process.execPath, [path.join(rootDir, 'test', 'mock-cf-server.mjs')], {
  env: { ...process.env, PORT: String(PORT), PRIVATE: process.env.PRIVATE || '0' },
  stdio: ['ignore', 'pipe', 'inherit'],
})
await new Promise((resolve) => {
  serverProcess.stdout.on('data', (chunk) => {
    if (String(chunk).includes('[mock]'))
      resolve()
  })
  setTimeout(resolve, 1500)
})

const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
const page = await context.newPage()
const consoleErrors = []
const pageErrors = []
const failedRequests = []
page.on('console', (message) => {
  if (message.type() === 'error')
    consoleErrors.push(message.text())
})
page.on('pageerror', error => pageErrors.push(String(error)))
page.on('requestfailed', request => failedRequests.push(`${request.url()} ${request.failure()?.errorText}`))

try {
  await resetStats()
  await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.node-card', { timeout: 15000 })
  const cardCount = await page.locator('.node-card').count()
  check('首页渲染节点卡片', cardCount === 5, `cards=${cardCount}`)

  const footerText = await page.locator('footer').innerText()
  check('页脚展示 Powered by CF Server Monitor', /Powered by[\s\S]*CF Server Monitor/.test(footerText), footerText.replace(/\n/g, ' | '))

  let counts = await stats()
  check('首次进入 /api/config 只请求一次', counts.config === 1, JSON.stringify(counts))
  check('首次进入 /api/servers 只请求一次', counts.servers === 1, JSON.stringify(counts))

  // 等 WebSocket 推送，确认数值在变化且没有额外的 REST 请求
  const guestPageText = await page.locator('.node-info').innerText()
  check('访客模式隐藏价格与剩余价值', !/HK\$|US\$|€|¥/.test(guestPageText), guestPageText.split('\n').filter(line => /HK\$|US\$|€|¥/.test(line)).join(' | '))

  const firstCardText = await page.locator('.node-card').first().innerText()
  check('流量上限按 GB→字节换算（不是 KB）', /\/\s*\d+(?:\.\d+)?\s*TB/.test(firstCardText) && !/\/\s*\d+(?:\.\d+)?\s*KB/.test(firstCardText), firstCardText.split('\n').filter(line => /TB|KB|MB/.test(line)).join(' | '))
  check('中文界面不出现英文日期片段', /在线\s+\d+\s+天/.test(firstCardText) && !/days online|left \d+ days|\/ Year/.test(firstCardText), 'zh labels')

  const cpuBefore = await page.locator('.node-card').first().innerText()
  await page.waitForTimeout(2600)
  const cpuAfter = await page.locator('.node-card').first().innerText()
  counts = await stats()
  check('实时更新来自 WebSocket（无额外 REST）', counts.servers === 1 && counts.history === 0, JSON.stringify(counts))
  check('卡片数值随推送变化', cpuBefore !== cpuAfter, 'text changed')

  const barsBefore = await page.locator('.node-card').first().locator('.multi-ping-bars span').count()
  await page.screenshot({ path: path.join(shots, 'home.png'), fullPage: true })

  // 详情页
  await page.locator('.node-card').first().click()
  await page.waitForURL(/#\/server\//, { timeout: 10000 })
  await page.waitForTimeout(2500)
  const detailTitle = await page.locator('main').innerText()
  check('详情页展示节点名称', detailTitle.includes('Hong Kong'), detailTitle.slice(0, 40).replace(/\n/g, ' | '))
  check('访客模式详情页价格被打码', detailTitle.includes('***') && !/HK\$88/.test(detailTitle), detailTitle.split('\n').filter(line => /\*\*\*|HK\$/.test(line)).slice(0, 3).join(' | '))
  counts = await stats()
  check('详情页使用 /api/server 单节点接口', counts.server === 1, JSON.stringify(counts))
  check('详情页负载与延迟共用一次历史请求', counts.history === 1, JSON.stringify(counts))
  const charts = await page.locator('canvas').count()
  check('详情页图表已渲染', charts >= 2, `canvas=${charts}`)
  await page.screenshot({ path: path.join(shots, 'detail.png'), fullPage: true })

  // 切换时间范围：只有用户主动切换时才请求
  const dayTab = page.locator('[data-load-chart-range] button, [data-load-chart-range] [role="tab"]').filter({ hasText: '1 天' }).first()
  if (await dayTab.count()) {
    await dayTab.click()
    await page.waitForTimeout(1200)
    counts = await stats()
    check('切换 1 天才新增历史请求', counts.history === 2, JSON.stringify(counts))
  }
  else {
    check('存在 1 天时间范围按钮', false, 'not found')
  }

  // 返回首页：KeepAlive 保留列表，不重复请求 /api/servers
  await page.goBack()
  await page.waitForSelector('.node-card', { timeout: 10000 })
  await page.waitForTimeout(1200)
  counts = await stats()
  check('返回首页不重复请求 /api/servers', counts.servers === 1, JSON.stringify(counts))
  const barsAfter = await page.locator('.node-card').first().locator('.multi-ping-bars span').count()
  check('详情页返回后卡片三网小图仍在', barsAfter === barsBefore && barsAfter > 0, `before=${barsBefore} after=${barsAfter}`)

  // 页面隐藏再恢复：关闭 WS，恢复时补一次 REST
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.waitForTimeout(500)
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.waitForTimeout(1500)
  counts = await stats()
  check('可见性恢复时补一次 /api/servers', counts.servers === 2, JSON.stringify(counts))

  // 直接打开详情页：不请求 /api/servers
  await resetStats()
  const deepContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' })
  const deepPage = await deepContext.newPage()
  const deepErrors = []
  deepPage.on('pageerror', error => deepErrors.push(String(error)))
  await deepPage.goto(`${BASE}/#/server/jp-tokyo`, { waitUntil: 'networkidle' })
  await deepPage.waitForTimeout(2500)
  const deepText = await deepPage.locator('main').innerText()
  check('直接打开详情页渲染节点', deepText.includes('Tokyo'), deepText.slice(0, 30).replace(/\n/g, ' | '))
  const deepCounts = await stats()
  check('直接打开详情页不请求 /api/servers', deepCounts.servers === 0, JSON.stringify(deepCounts))
  check('直接打开详情页只请求一次 /api/server', deepCounts.server === 1, JSON.stringify(deepCounts))
  check('直接打开详情页历史只请求一次', deepCounts.history === 1, JSON.stringify(deepCounts))
  check('直接打开详情页无异常', deepErrors.length === 0, deepErrors.slice(0, 2).join(' | '))
  await deepContext.close()

  // 英文浏览器 + default_language=auto：主题仍应保持中文
  const enContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US' })
  const enPage = await enContext.newPage()
  await enPage.goto(`${BASE}/#/`, { waitUntil: 'networkidle' })
  await enPage.waitForSelector('.node-card', { timeout: 15000 })
  const enCardText = await enPage.locator('.node-card').first().innerText()
  check('auto 语言下英文浏览器不混入英文片段', /在线\s+\d+\s+天/.test(enCardText) && !/days online|left \d+ days|\/ Year/.test(enCardText), enCardText.split('\n').slice(0, 4).join(' | '))
  await enContext.close()

  // 移动端截图
  await context.close()
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN', isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
  const mobilePage = await mobile.newPage()
  await mobilePage.goto(`${BASE}/#/`, { waitUntil: 'networkidle' })
  await mobilePage.waitForSelector('.node-card', { timeout: 15000 })
  await mobilePage.waitForTimeout(2000)
  await mobilePage.screenshot({ path: path.join(shots, 'home-mobile.png'), fullPage: true })
  const mobileCards = await mobilePage.locator('.node-card').count()
  check('移动端首页渲染', mobileCards === 5, `cards=${mobileCards}`)
  await mobile.close()

  check('无 JS 运行时异常', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))
  check('无控制台 error', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
  check('无失败请求', failedRequests.length === 0, failedRequests.slice(0, 3).join(' | '))
}
catch (error) {
  check('测试执行', false, String(error))
}
finally {
  await browser.close()
  serverProcess.kill()
}

const failed = results.filter(item => !item.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length)
  process.exit(1)
