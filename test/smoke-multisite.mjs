#!/usr/bin/env node
/** 多 apiBase 测试：每个后端各建一条 WS，只订阅自己返回的服务器 ID。 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const executablePath = process.env.CHROMIUM_PATH || `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`
const A = 9931
const B = 9932

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

function startServer(port, env) {
  const child = spawn(process.execPath, [path.join(rootDir, 'test', 'mock-cf-server.mjs')], {
    env: { ...process.env, PORT: String(port), ...env },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  return child
}
const serverA = startServer(A, { MOCK_API_BASE: `http://127.0.0.1:${A},http://127.0.0.1:${B}` })
const serverB = startServer(B, { SITE_TAG: '-b' })
await new Promise(resolve => setTimeout(resolve, 1800))

const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] })
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(String(error)))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto(`http://127.0.0.1:${A}/#/`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.node-card', { timeout: 20000 })
  await page.waitForTimeout(2000)
  const cards = await page.locator('.node-card').count()
  check('多站聚合显示 10 台服务器', cards === 10, `cards=${cards}`)
  const titles = await page.locator('.node-card [aria-label^="查看节点"]').count().catch(() => 0)
  void titles
  const statsA = await (await fetch(`http://127.0.0.1:${A}/__stats`)).json()
  const statsB = await (await fetch(`http://127.0.0.1:${B}/__stats`)).json()
  check('每个后端各请求一次 /api/config', statsA.config === 1 && statsB.config === 1, JSON.stringify({ a: statsA.config, b: statsB.config }))
  check('每个后端各请求一次 /api/servers', statsA.servers === 1 && statsB.servers === 1, JSON.stringify({ a: statsA.servers, b: statsB.servers }))
  check('每个后端各建立一条 WebSocket', statsA.wsConnections === 1 && statsB.wsConnections === 1, JSON.stringify({ a: statsA.wsConnections, b: statsB.wsConnections }))
  const subsA = statsA.wsSubscribedIds.flat()
  const subsB = statsB.wsSubscribedIds.flat()
  check('A 站订阅只含自己的 ID', subsA.length === 5 && subsA.every(id => !id.endsWith('-b')), JSON.stringify(subsA))
  check('B 站订阅只含自己的 ID', subsB.length === 5 && subsB.every(id => id.endsWith('-b')), JSON.stringify(subsB))

  // 跨站详情页：id 带站点前缀，只请求对应后端
  const firstB = page.locator('.node-card', { hasText: 'BK' }).first()
  void firstB
  const bCard = page.locator('.node-card').filter({ hasText: '玻璃拟态' }).count()
  void bCard
  await page.locator('.node-card').last().click()
  await page.waitForURL(/#\/server\/\d:/, { timeout: 8000 })
  await page.waitForTimeout(2500)
  check('详情页路由带站点前缀', /#\/server\/\d:/.test(page.url()), page.url())
  const statsA2 = await (await fetch(`http://127.0.0.1:${A}/__stats`)).json()
  const statsB2 = await (await fetch(`http://127.0.0.1:${B}/__stats`)).json()
  check('详情页只向所属后端请求 /api/server', statsA2.server === 0 && statsB2.server === 1, JSON.stringify({ a: statsA2.server, b: statsB2.server }))
  check('多站模式无错误', errors.length === 0, errors.slice(0, 2).join(' | '))
  await context.close()
}
catch (error) {
  check('测试执行', false, String(error))
}
finally {
  await browser.close()
  serverA.kill()
  serverB.kill()
}

const failed = results.filter(item => !item.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length)
  process.exit(1)
