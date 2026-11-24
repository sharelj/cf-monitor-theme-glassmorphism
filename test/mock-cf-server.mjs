#!/usr/bin/env node
/**
 * 本地 CF-Server-Monitor API 模拟服务（仅用于开发自查，不进入构建产物）。
 * 模拟 /api/config、/api/servers、/api/server、/api/history/all、/api/ws 与默认皮肤静态资源。
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distDir = path.join(rootDir, 'dist')
const port = Number(process.env.PORT || 9911)
const PRIVATE = process.env.PRIVATE === '1'
const TURNSTILE = process.env.TURNSTILE === '1'
const SITE_TAG = process.env.SITE_TAG || ''
const MOCK_API_BASE = process.env.MOCK_API_BASE || ''
const G = 1024 ** 3
const M = 1024 ** 2
const now = () => Date.now()

const stats = { config: 0, servers: 0, server: 0, history: 0, themeOptions: 0, wsConnections: 0, wsOpen: 0, wsSubscribedIds: [] }
const stripTag = id => SITE_TAG && String(id).endsWith(SITE_TAG) ? String(id).slice(0, -SITE_TAG.length) : String(id)

const CONFIG = {
  version: '2.8.1',
  is_public: !PRIVATE,
  authorization: false,
  turnstile_enabled: TURNSTILE,
  turnstile_login_enabled: false,
  turnstile_site_key: '1x00000000000000000000AA',
  custom_ct_name: '电信',
  custom_cu_name: '联通',
  custom_cm_name: '移动',
  custom_bd_name: 'BGP',
  node_1_name: 'HKIX',
  node_2_name: 'CN2 GIA',
  node_3_name: 'IIJ',
  node_4_name: 'NTT',
  site_title: SITE_TAG ? `玻璃拟态 · CF 监控演示 ${SITE_TAG}` : '玻璃拟态 · CF 监控演示',
  preferred_theme: 'auto',
  default_language: 'zh',
  theme_options: {
    alertEnabled: true,
    alertTitle: '演示公告',
    alertContent: '这是 **Glassmorphism** 主题的演示数据，来自本地 mock API。',
    homepageMultiPingCount: 4,
  },
  verified: false,
  turnstile_verified: null,
  frontend_ws_timeout_minutes: Number(process.env.WS_TIMEOUT_MINUTES || 0),
  long_history_points: 120,
  latency_window: { points: 20, hours: 2 },
}

const SERVERS = [
  {
    id: 'hk-edge',
    name: 'Hong Kong · 香港边缘',
    server_group: '亚太',
    tags: 'CN2,prod',
    price: '88.00',
    billing_cycle: 'monthly',
    auto_renewal: '1',
    currency: 'HKD',
    expire_date: daysFromNow(24),
    traffic_limit: '1TB',
    traffic_calc_type: 'sum',
    reset_day: 1,
    is_hidden: '0',
    sort_order: 1,
    cpu: 23.4,
    load_avg: '0.42 0.38 0.33',
    net_in_speed: 3.2 * M,
    net_out_speed: 1.1 * M,
    net_rx: 640 * G,
    net_tx: 210 * G,
    net_rx_monthly: 120 * G,
    net_tx_monthly: 40 * G,
    processes: 214,
    tcp_conn: 88,
    udp_conn: 12,
    ram_total: 8192,
    ram_used: 3100,
    swap_total: 2048,
    swap_used: 64,
    disk_total: 102400,
    disk_used: 31000,
    disk: { read_bps: 4096, write_bps: 2048, read_iops: 12, write_iops: 8, await_ms: 1.5, util: 3.2 },
    cpu_cores: 4,
    cpu_info: 'AMD EPYC 7B13',
    gpu_info: [{ id: '0', name: 'NVIDIA RTX 3060', info: 12.5 }],
    arch: 'x86_64',
    os: 'Ubuntu 22.04',
    kernel_version: '6.8.0-36-generic',
    region: 'HK',
    ip_v4: '1',
    ip_v6: '1',
    boot_time: String(now() - (12 * 24 + 3) * 3600_000),
    agent_version: '1.3.3',
    last_updated: now(),
    timestamp: now(),
    online: true,
  },
  {
    id: 'jp-tokyo',
    name: 'Tokyo · 东京主节点',
    server_group: '亚太',
    tags: 'IIJ',
    price: '12.00',
    billing_cycle: 'quarterly',
    auto_renewal: '1',
    currency: 'USD',
    expire_date: daysFromNow(7),
    traffic_limit: '2TB',
    traffic_calc_type: 'max',
    reset_day: 5,
    is_hidden: '0',
    sort_order: 2,
    cpu: 61.7,
    load_avg: '1.9 1.6 1.4',
    net_in_speed: 12.5 * M,
    net_out_speed: 4.4 * M,
    net_rx: 2200 * G,
    net_tx: 900 * G,
    net_rx_monthly: 380 * G,
    net_tx_monthly: 180 * G,
    processes: 340,
    tcp_conn: 240,
    udp_conn: 40,
    ram_total: 16384,
    ram_used: 11200,
    swap_total: 4096,
    swap_used: 512,
    disk_total: 204800,
    disk_used: 128000,
    disk: { read_bps: 51200, write_bps: 12000, read_iops: 40, write_iops: 20, await_ms: 2.8, util: 12.4 },
    cpu_cores: 8,
    cpu_info: 'Intel Xeon Platinum 8375C',
    gpu_info: [],
    arch: 'x86_64',
    os: 'Debian 12',
    kernel_version: '6.1.0-26-amd64',
    region: 'JP',
    ip_v4: '1',
    ip_v6: '0',
    boot_time: String(now() - 36 * 3600_000),
    agent_version: '1.3.2',
    last_updated: now(),
    timestamp: now(),
    online: true,
  },
  {
    id: 'sg-relay',
    name: 'Singapore · 新加坡',
    server_group: '亚太',
    tags: '',
    price: '0',
    billing_cycle: 'yearly',
    auto_renewal: '0',
    currency: 'USD',
    expire_date: daysFromNow(120),
    traffic_limit: '500GB',
    traffic_calc_type: 'sum',
    reset_day: 10,
    is_hidden: '0',
    sort_order: 3,
    cpu: 8.2,
    load_avg: '0.08 0.10 0.12',
    net_in_speed: 512 * 1024,
    net_out_speed: 128 * 1024,
    net_rx: 300 * G,
    net_tx: 60 * G,
    net_rx_monthly: 20 * G,
    net_tx_monthly: 4 * G,
    processes: 96,
    tcp_conn: 20,
    udp_conn: 4,
    ram_total: 2048,
    ram_used: 480,
    swap_total: 0,
    swap_used: 0,
    disk_total: 51200,
    disk_used: 8000,
    disk: { read_bps: 0, write_bps: 0, read_iops: 0, write_iops: 0, await_ms: 0, util: 0 },
    cpu_cores: 2,
    cpu_info: 'AWS Graviton3',
    gpu_info: [],
    arch: 'aarch64',
    os: 'Alpine Linux',
    kernel_version: '6.6.0',
    region: 'SG',
    ip_v4: '1',
    ip_v6: '1',
    boot_time: String(now() - 90 * 24 * 3600_000),
    agent_version: '1.3.3',
    last_updated: now(),
    timestamp: now(),
    online: true,
  },
  {
    id: 'de-frankfurt',
    name: 'Frankfurt · 法兰克福',
    server_group: '欧洲',
    tags: '',
    price: '42.00',
    billing_cycle: 'yearly',
    auto_renewal: '1',
    currency: 'EUR',
    expire_date: daysFromNow(3),
    traffic_limit: '4TB',
    traffic_calc_type: 'sum',
    reset_day: 1,
    is_hidden: '0',
    sort_order: 4,
    cpu: 0,
    load_avg: '0 0 0',
    net_in_speed: 0,
    net_out_speed: 0,
    net_rx: 800 * G,
    net_tx: 300 * G,
    net_rx_monthly: 80 * G,
    net_tx_monthly: 30 * G,
    processes: 0,
    tcp_conn: 0,
    udp_conn: 0,
    ram_total: 4096,
    ram_used: 0,
    swap_total: 1024,
    swap_used: 0,
    disk_total: 102400,
    disk_used: 40000,
    cpu_cores: 4,
    cpu_info: 'Intel Xeon E5-2680 v4',
    gpu_info: [],
    arch: 'x86_64',
    os: 'Windows Server 2022',
    kernel_version: '10.0.20348',
    region: 'DE',
    ip_v4: '1',
    ip_v6: '0',
    boot_time: String(now() - 5 * 3600_000),
    agent_version: '1.3.0',
    last_updated: now() - 12 * 60_000,
    timestamp: now() - 12 * 60_000,
    online: false,
  },
  {
    id: 'us-la',
    name: 'Los Angeles · 洛杉矶',
    server_group: '其他',
    tags: 'best-effort',
    price: '',
    billing_cycle: 'monthly',
    auto_renewal: '0',
    currency: 'USD',
    expire_date: '',
    traffic_limit: '',
    traffic_calc_type: 'sum',
    reset_day: 1,
    is_hidden: '0',
    sort_order: 5,
    cpu: 44.1,
    load_avg: '1.2 1.0 0.9',
    net_in_speed: 2 * M,
    net_out_speed: 700 * 1024,
    net_rx: 500 * G,
    net_tx: 120 * G,
    net_rx_monthly: 60 * G,
    net_tx_monthly: 12 * G,
    processes: 150,
    tcp_conn: 60,
    udp_conn: 8,
    ram_total: 8192,
    ram_used: 5200,
    swap_total: 2048,
    swap_used: 0,
    disk_total: 153600,
    disk_used: 90000,
    cpu_cores: 4,
    cpu_info: 'AMD Ryzen 9 7950X',
    gpu_info: [{ id: '0', name: 'NVIDIA A4000', info: 44.8 }],
    arch: 'x86_64',
    os: 'Rocky Linux 9',
    kernel_version: '5.14.0-427',
    region: 'US',
    ip_v4: '1',
    ip_v6: '0',
    boot_time: String(now() - 8 * 3600_000),
    agent_version: '1.3.3',
    last_updated: now(),
    timestamp: now(),
    online: true,
  },
]

function daysFromNow(days) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
}

/** 探测线路：ct 正常，cu 偶发丢包，cm 有超时（null），bd 未配置（false）。 */
function probeValues(index, points) {
  const ts = []
  const start = now() - points * 6 * 60_000
  for (let i = 0; i < points; i++) {
    const t = start + i * 6 * 60_000
    const wave = Math.sin((i + index) / 3)
    ts.push({
      ts: t,
      ct: round(18 + index * 4 + wave * 6),
      cu: round(26 + index * 3 + wave * 4),
      cm: i === points - 2 ? null : round(35 + index * 5 + wave * 8),
      bd: index === 0 ? round(12 + wave * 3) : false,
    })
  }
  return ts
}

function lossValues(index, points) {
  const start = now() - points * 6 * 60_000
  const list = []
  for (let i = 0; i < points; i++) {
    list.push({
      ts: start + i * 6 * 60_000,
      ct: i % 7 === 0 ? 0 : 0.2,
      cu: i % 5 === 0 ? 1.2 : 0.4,
      cm: i === points - 2 ? null : 0.8,
      bd: index === 0 ? 0 : false,
    })
  }
  return list
}

function round(value) {
  return Math.round(value * 10) / 10
}

function pingFields(index) {
  const base = index + 1
  return {
    ping_ct: 18 + base * 4,
    ping_cu: 26 + base * 3,
    ping_cm: index === 4 ? null : 35 + base * 5,
    ping_bd: index === 0 ? 12 + base : false,
    loss_ct: 0,
    loss_cu: 0.4,
    loss_cm: index === 4 ? null : 0.8,
    loss_bd: index === 0 ? 0 : false,
    ping_node_1: 21 + base,
    ping_node_2: 33 + base,
    ping_node_3: index === 2 ? null : 45 + base,
    ping_node_4: index === 3 ? false : 52 + base,
    loss_node_1: 0,
    loss_node_2: 0.1,
    loss_node_3: index === 2 ? null : 0.3,
    loss_node_4: index === 3 ? false : 0.5,
  }
}

function withWindow(server, index) {
  const points = 20
  return {
    ...server,
    id: `${server.id}${SITE_TAG}`,
    ...pingFields(index),
    ping: probeValues(index, points),
    loss: lossValues(index, points),
  }
}

function historyRows(id, hours) {
  const server = SERVERS.find(item => item.id === stripTag(id))
  if (!server)
    return []
  const index = SERVERS.indexOf(server)
  const allowed = [0.167, 0.5, 1, 6, 12, 24, 48, 96, 168]
  const window = allowed.includes(Number(hours)) ? Number(hours) : 24
  const maxPoints = CONFIG.long_history_points
  const points = Math.max(6, Math.min(maxPoints, Math.round(window * 60 / Math.max(1, window >= 24 ? 12 : 1))))
  const stepMs = (window * 3600_000) / points
  return Array.from({ length: points }, (_, i) => {
    const ts = now() - (points - 1 - i) * stepMs
    const wave = Math.sin(i / 4)
    return {
      timestamp: Math.round(ts),
      cpu: round(Math.max(0, Math.min(100, server.cpu + wave * 8))),
      load_avg: `${(Math.max(0, 0.4 + wave * 0.2)).toFixed(2)} 0.38 0.33`,
      ram_used: Math.round(server.ram_used + wave * 120),
      ram_total: server.ram_total,
      swap_used: server.swap_used,
      swap_total: server.swap_total,
      disk_used: server.disk_used,
      disk_total: server.disk_total,
      net_in_speed: Math.max(0, Math.round(server.net_in_speed + wave * 200_000)),
      net_out_speed: Math.max(0, Math.round(server.net_out_speed + wave * 80_000)),
      net_rx: server.net_rx,
      net_tx: server.net_tx,
      net_rx_monthly: server.net_rx_monthly,
      net_tx_monthly: server.net_tx_monthly,
      processes: server.processes,
      tcp_conn: server.tcp_conn,
      udp_conn: server.udp_conn,
      ...(server.disk && Object.values(server.disk).some(v => v) ? { disk: server.disk } : {}),
      gpu_info: JSON.stringify(server.gpu_info),
      os: server.os,
      kernel_version: server.kernel_version,
      ...pingFields(index),
    }
  })
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(body)
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization,content-type,x-turnstile-token,x-turnstile-verified',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`)
  const pathname = decodeURIComponent(url.pathname)
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS)
    res.end()
    return
  }
  if (pathname.startsWith('/api/')) {
    for (const [key, value] of Object.entries(CORS_HEADERS))
      res.setHeader(key, value)
  }
  if (pathname === '/') {
    let html = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8')
    if (MOCK_API_BASE)
      html = html.replace(/<meta name="apiBase" content="[^"]*"\s*\/?>/, `<meta name="apiBase" content="${MOCK_API_BASE}">`)
    res.writeHead(200, { 'Content-Type': MIME['.html'] })
    res.end(html)
    return
  }

  if (pathname === '/api/config') {
    stats.config++
    const authed = req.headers.authorization === 'Bearer demo-token'
    return sendJson(res, 200, {
      ...CONFIG,
      authorization: authed,
      verified: TURNSTILE ? Boolean(req.headers['x-turnstile-verified'] || req.headers['x-turnstile-token']) : false,
      turnstile_verified: TURNSTILE ? 'mock-verified' : null,
    })
  }

  if (pathname === '/api/servers') {
    stats.servers++
    if (PRIVATE && req.headers.authorization !== 'Bearer demo-token')
      return sendJson(res, 401, { error: 'Unauthorized' })
    return sendJson(res, 200, {
      servers: SERVERS.map(withWindow),
      stats: {
        total: SERVERS.length,
        online: SERVERS.filter(item => item.online).length,
        offline: SERVERS.filter(item => !item.online).length,
        globalSpeedIn: SERVERS.reduce((sum, item) => sum + item.net_in_speed, 0),
        globalSpeedOut: SERVERS.reduce((sum, item) => sum + item.net_out_speed, 0),
        globalNetTx: SERVERS.reduce((sum, item) => sum + item.net_tx, 0),
        globalNetRx: SERVERS.reduce((sum, item) => sum + item.net_rx, 0),
      },
      regionStats: { HK: 1, JP: 1, SG: 1, DE: 1, US: 1 },
      sysConfig: { show_price: process.env.HIDE_PRICE !== '1', show_expire: process.env.HIDE_EXPIRE !== '1', show_tf: process.env.HIDE_TF !== '1', show_three_net_details: true },
    })
  }

  if (pathname === '/api/server') {
    stats.server++
    if (PRIVATE && req.headers.authorization !== 'Bearer demo-token')
      return sendJson(res, 401, { error: 'Unauthorized' })
    const id = stripTag(url.searchParams.get('id'))
    const index = SERVERS.findIndex(item => item.id === id)
    if (index === -1)
      return sendJson(res, 404, { error: 'Server not found' })
    return sendJson(res, 200, withWindow(SERVERS[index], index))
  }

  if (pathname === '/api/history/all') {
    stats.history++
    if (PRIVATE && req.headers.authorization !== 'Bearer demo-token')
      return sendJson(res, 401, { error: 'Unauthorized' })
    const hours = Number(url.searchParams.get('hours') || 24)
    if (hours > 24 && req.headers.authorization !== 'Bearer demo-token')
      return sendJson(res, 401, { error: 'Unauthorized' })
    return sendJson(res, 200, historyRows(url.searchParams.get('id'), hours))
  }

  if (pathname === '/api/theme_options') {
    stats.themeOptions++
    if (req.headers.authorization !== 'Bearer demo-token')
      return sendJson(res, 401, { error: 'Unauthorized' })
    let raw = ''
    req.on('data', chunk => raw += chunk)
    req.on('end', () => {
      try {
        const body = JSON.parse(raw || '{}')
        if (!body.theme_options || typeof body.theme_options !== 'object' || Array.isArray(body.theme_options))
          return sendJson(res, 400, { error: 'invalidThemeOptionsFormat' })
        CONFIG.theme_options = body.theme_options
        return sendJson(res, 200, { success: true, theme_options: CONFIG.theme_options, message: 'updateSuccess' })
      }
      catch {
        return sendJson(res, 400, { error: 'invalidJson' })
      }
    })
    return
  }

  if (pathname === '/__config') {
    return sendJson(res, 200, CONFIG)
  }

  if (pathname === '/__stats') {
    return sendJson(res, 200, stats)
  }
  if (pathname === '/__reset') {
    for (const key of Object.keys(stats)) {
      if (key === 'wsSubscribedIds')
        stats[key] = []
      else
        stats[key] = 0
    }
    return sendJson(res, 200, stats)
  }

  if (pathname.startsWith('/flags/') || pathname.startsWith('/os-icons/')) {
    res.writeHead(200, { 'Content-Type': 'image/svg+xml' })
    return res.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 16"><rect width="24" height="16" fill="#9bb4c9"/></svg>')
  }

  const filePath = pathname === '/' || pathname === '' ? path.join(distDir, 'index.html') : path.join(distDir, pathname)
  if (!filePath.startsWith(distDir) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404).end('Not found')
    return
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' })
  fs.createReadStream(filePath).pipe(res)
})

const wss = new WebSocketServer({ noServer: true })

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`)
  if (url.pathname !== '/api/ws') {
    socket.destroy()
    return
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req, url)
  })
})

wss.on('connection', (ws, _req, url) => {
  stats.wsConnections++
  stats.wsOpen++
  const subscribe = url.searchParams.get('subscribe') || 'all'
  let ids = []
  const send = payload => ws.readyState === ws.OPEN && ws.send(JSON.stringify(payload))
  send({ type: 'hello', ts: now(), subscribed: subscribe })
  if (subscribe !== 'all')
    stats.wsSubscribedIds.push([subscribe])
  if (subscribe !== 'all') {
    ids = [subscribe]
    send({ type: 'subscribed', ts: now(), subscribed: subscribe, count: 1 })
  }
  let tick = 0
  const timer = setInterval(() => {
    tick++
    const targets = subscribe === 'all' ? ids : [subscribe]
    if (!targets.length)
      return
    const updates = targets.flatMap((id) => {
      const serverItem = SERVERS.find(item => item.id === stripTag(id))
      if (!serverItem || !serverItem.online)
        return []
      const jitter = Math.random()
      const sample = {
        ts: now(),
        data: {
          cpu: round(Math.min(99, Math.max(1, serverItem.cpu + Math.sin((tick + id.length) / 3) * 6 + jitter * 2))),
          ram_used: Math.round(serverItem.ram_used + jitter * 60),
          net_in_speed: Math.round(serverItem.net_in_speed * (0.7 + jitter * 0.6)),
          net_out_speed: Math.round(serverItem.net_out_speed * (0.7 + jitter * 0.6)),
          last_updated: now(),
          ...(tick % 5 === 0
            ? {
                disk_used: serverItem.disk_used,
                processes: serverItem.processes,
                tcp_conn: serverItem.tcp_conn,
                udp_conn: serverItem.udp_conn,
                ...pingFields(SERVERS.indexOf(serverItem)),
                gpu_info: serverItem.gpu_info,
                ...(serverItem.disk && Object.values(serverItem.disk).some(v => v) ? { disk: serverItem.disk } : {}),
              }
            : {}),
        },
      }
      return [{ serverId: id, samples: [sample] }]
    })
    if (updates.length)
      send({ type: 'batchUpdate', ts: now(), updates })
  }, 1000)

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(String(raw))
      if (msg.type === 'subscribe' && Array.isArray(msg.ids)) {
        ids = msg.ids.map(String)
        stats.wsSubscribedIds.push([...ids])
        send({ type: 'subscribed', ts: now(), subscribed: msg.scope || 'all', count: ids.length })
      }
      if (msg.type === 'ping')
        send({ type: 'pong', ts: msg.ts ?? now() })
    }
    catch {
      // ignore
    }
  })
  ws.on('close', () => {
    stats.wsOpen = Math.max(0, stats.wsOpen - 1)
    clearInterval(timer)
  })
})

server.listen(port, '127.0.0.1', () => {
  console.log(`[mock] CF-Server-Monitor API on http://127.0.0.1:${port} (private=${PRIVATE}, turnstile=${TURNSTILE})`)
})
