import { ref } from 'vue'
import type { CfHistoryRow, CfServer, CfSite, CfStats } from '@/cfsm/types'
import type { Client, PingRecord, PingTaskInfo, StatusRecord } from '@/types/model'
import { getHistory, getServer, getServers } from '@/cfsm/api'
import { buildProbeLines, historyToPingRecords, historyToStatusRecords, isServerOnline, mapServer, mergeServerPatch, serverToStatus } from '@/cfsm/adapter'
import { getSites, getSiteByIndex, getWsTimeoutMinutes } from '@/cfsm/session'
import { wsAuthToken, wsUrl } from '@/cfsm/apiBase'
import { useAppStore } from '@/stores/app'
import { useNodesStore } from '@/stores/nodes'
import { cached } from '@/monitor/transport'

type PageKind = 'none' | 'home' | 'detail'

interface PageState {
  kind: PageKind
  uuid?: string
  /** 详情页当前时间范围（重连后恢复请求用） */
  hours?: number
}

const page: PageState = { kind: 'none' }
const rawServers = new Map<string, CfServer>()
const pendingPatches = new Map<string, CfServer>()
const sockets = new Map<number, WebSocket>()
const reconnectAttempts = new Map<number, number>()
const reconnectTimers = new Map<number, number>()
const stopFlags = new Map<number, boolean>()

let sitesCount = 1
let homeLoaded = false
let generation = 0
let flushTimer: number | undefined
let lastFlush = 0
let onlineTicker: number | undefined
let visibilityBound = false
let suppressed = false
let controllers = new Set<AbortController>()

export const wsTimeoutPrompt = ref(false)

let wsTimeoutTimer: number | undefined

const MAX_RECONNECT_ATTEMPTS = 8
const FLUSH_INTERVAL_MS = 1000

function appStore() {
  return useAppStore()
}

function nodesStore() {
  return useNodesStore()
}

function siteOf(uuid: string): { site: CfSite, id: string } | null {
  const match = /^(\d+):(.+)$/.exec(uuid)
  const index = match ? Number(match[1]) : 0
  const id = match ? match[2]! : uuid
  const site = getSiteByIndex(index) ?? getSites()[0]
  return site ? { site, id } : null
}

function uuidOf(site: CfSite, id: string): string {
  return sitesCount > 1 ? `${site.index}:${id}` : id
}

function buildSnapshot(server: CfServer, site: CfSite): { client: Client, status: ReturnType<typeof serverToStatus> } {
  const client = mapServer(server, site.index, sitesCount)
  const status = serverToStatus(server, client, buildProbeLines(site.config))
  return { client, status }
}

function upsertNode(uuid: string, server: CfServer, site: CfSite): void {
  rawServers.set(uuid, server)
  const { client, status } = buildSnapshot(server, site)
  nodesStore().upsertNodes({ [uuid]: client }, { [uuid]: status })
}

function isOnlineNow(node: { last_updated: number, online: boolean }): boolean {
  return isServerOnline({ id: '', last_updated: node.last_updated }, Date.now())
}

/* ------------------------------------------------------------------ *
 * 列表数据（首页）
 * ------------------------------------------------------------------ */

export async function loadHomeServers(force = false): Promise<void> {
  if (homeLoaded && !force)
    return
  const current = generation
  const sites = getSites()
  sitesCount = Math.max(1, sites.length)
  if (sites.length === 0)
    return

  const responses = await Promise.all(sites.map(async (site) => {
    const data = await getServers(site.base, site.config.turnstile_enabled === true)
    return { site, data }
  }))
  if (current !== generation)
    return

  const clients: Record<string, Client> = {}
  const statuses: Record<string, ReturnType<typeof serverToStatus>> = {}
  const mergedStats: Required<CfStats> = {
    total: 0,
    online: 0,
    offline: 0,
    globalSpeedIn: 0,
    globalSpeedOut: 0,
    globalNetTx: 0,
    globalNetRx: 0,
  }

  for (const { site, data } of responses) {
    const serverList = Array.isArray(data.servers) ? data.servers : []
    site.ids = serverList.map(server => String(server.id ?? '')).filter(Boolean)
    for (const server of serverList) {
      const id = String(server.id ?? '')
      if (!id)
        continue
      const uuid = uuidOf(site, id)
      const { client, status } = buildSnapshot(server, site)
      rawServers.set(uuid, server)
      clients[uuid] = client
      statuses[uuid] = status
    }
    const stats = data.stats ?? {}
    mergedStats.total += Number(stats.total ?? serverList.length)
    mergedStats.online += Number(stats.online ?? serverList.filter(server => isServerOnline(server)).length)
    mergedStats.offline += Number(stats.offline ?? 0)
    mergedStats.globalSpeedIn += Number(stats.globalSpeedIn ?? 0)
    mergedStats.globalSpeedOut += Number(stats.globalSpeedOut ?? 0)
    mergedStats.globalNetTx += Number(stats.globalNetTx ?? 0)
    mergedStats.globalNetRx += Number(stats.globalNetRx ?? 0)
  }

  nodesStore().initNodes(clients, statuses)
  nodesStore().setStats(mergedStats)
  appStore().setSiteSysConfig(responses[0]?.data.sysConfig)
  homeLoaded = true
}

/* ------------------------------------------------------------------ *
 * 详情数据
 * ------------------------------------------------------------------ */

export async function loadDetailServer(uuid: string): Promise<void> {
  const resolved = siteOf(uuid)
  if (!resolved)
    return
  const controller = new AbortController()
  controllers.add(controller)
  try {
    const raw = await getServer(resolved.site.base, resolved.id, resolved.site.config.turnstile_enabled === true, controller.signal)
    if (controller.signal.aborted)
      return
    appStore().setSiteSysConfig(raw.sysConfig)
    upsertNode(uuid, raw, resolved.site)
  }
  finally {
    controllers.delete(controller)
  }
}

/** 同一节点、同一时间范围的历史只请求一次，负载图与延迟图共用这一份。 */
function cachedRows(uuid: string, hours: number, signal?: AbortSignal): Promise<CfHistoryRow[]> {
  const resolved = siteOf(uuid)
  if (!resolved)
    return Promise.resolve([])
  return cached(`rows:${uuid}:${hours}`, () => getHistory(resolved.site.base, resolved.id, hours, resolved.site.config.turnstile_enabled === true, signal))
}

export async function loadDetailHistory(uuid: string, hours: number, signal?: AbortSignal): Promise<StatusRecord[]> {
  const resolved = siteOf(uuid)
  if (!resolved)
    return []
  const rows = await cachedRows(uuid, hours, signal)
  return historyToStatusRecords(rows, currentClient(uuid, resolved))
}

export async function loadDetailPing(uuid: string, hours: number): Promise<{ records: PingRecord[], tasks: PingTaskInfo[] }> {
  const resolved = siteOf(uuid)
  if (!resolved)
    return { records: [], tasks: [] }
  const rows = await cachedRows(uuid, hours)
  return historyToPingRecords(rows, currentClient(uuid, resolved), buildProbeLines(resolved.site.config))
}

function currentClient(uuid: string, resolved: { site: CfSite, id: string }): Client {
  const node = nodesStore().nodesByUuid.get(uuid)
  if (node)
    return node
  const raw = rawServers.get(uuid)
  if (raw)
    return mapServer(raw, resolved.site.index, sitesCount)
  return mapServer({ id: resolved.id, name: resolved.id }, resolved.site.index, sitesCount)
}

/* ------------------------------------------------------------------ *
 * WebSocket：每个后端一条连接，只订阅该后端自己的 ID
 * ------------------------------------------------------------------ */

function clearSocket(siteIndex: number): void {
  clearWsTimeoutTimer()
  const socket = sockets.get(siteIndex)
  if (socket) {
    stopFlags.set(siteIndex, true)
    socket.onopen = null
    socket.onmessage = null
    socket.onerror = null
    socket.onclose = null
    try {
      socket.close()
    }
    catch {
      // 忽略
    }
    sockets.delete(siteIndex)
  }
  const timer = reconnectTimers.get(siteIndex)
  if (timer) {
    window.clearTimeout(timer)
    reconnectTimers.delete(siteIndex)
  }
}

function closeAllSockets(): void {
  for (const index of [...sockets.keys()])
    clearSocket(index)
}

function scheduleReconnect(site: CfSite, subscribe: string): void {
  if (suppressed || stopFlags.get(site.index))
    return
  const attempts = (reconnectAttempts.get(site.index) ?? 0) + 1
  reconnectAttempts.set(site.index, attempts)
  if (attempts > MAX_RECONNECT_ATTEMPTS) {
    appStore().connectionError = true
    nodesStore().updateWsState('disconnected', attempts)
    return
  }
  nodesStore().updateWsState('reconnecting', attempts)
  const delay = Math.min(1000 * 2 ** (attempts - 1), 30000)
  const timer = window.setTimeout(() => {
    reconnectTimers.delete(site.index)
    connectSite(site, subscribe)
  }, delay)
  reconnectTimers.set(site.index, timer)
}

function wsSubscribeTarget(): string {
  return page.kind === 'detail' && page.uuid ? (siteOf(page.uuid)?.id ?? 'all') : 'all'
}

function connectSite(site: CfSite, subscribe: string): void {
  if (suppressed)
    return
  clearSocket(site.index)
  stopFlags.set(site.index, false)

  const params: Record<string, string> = { subscribe }
  if (typeof DecompressionStream === 'function')
    params.gzip = '1'
  const token = wsAuthToken(site.base)
  if (token)
    params.token = token
  const url = wsUrl(site.base, params)

  let socket: WebSocket
  try {
    socket = new WebSocket(url)
  }
  catch {
    scheduleReconnect(site, subscribe)
    return
  }
  sockets.set(site.index, socket)
  let decodeChain: Promise<void> = Promise.resolve()
  const timeoutMinutes = getWsTimeoutMinutes()

  const handle = (text: string) => {
    try {
      handleMessage(site, JSON.parse(text))
    }
    catch {
      // 忽略无法解析的帧
    }
  }

  socket.onopen = () => {
    reconnectAttempts.set(site.index, 0)
    nodesStore().updateWsState('connected', 0)
    appStore().connectionError = false
    if (subscribe === 'all') {
      const ids = (site.ids.length ? site.ids : [...rawServers.keys()].filter(uuid => siteOf(uuid)?.site.index === site.index).map(uuid => siteOf(uuid)!.id)).slice(0, 500)
      socket.send(JSON.stringify({ type: 'subscribe', scope: 'all', ids }))
    }
    if (timeoutMinutes > 0) {
      wsTimeoutTimer = window.setTimeout(() => {
        wsTimeoutTimer = undefined
        suppressed = true
        wsTimeoutPrompt.value = true
        closeAllSockets()
        nodesStore().updateWsState('disconnected')
      }, timeoutMinutes * 60 * 1000)
    }
  }

  socket.onmessage = (event: MessageEvent) => {
    decodeChain = decodeChain.then(async () => {
      const data = event.data
      let text: string
      if (typeof data === 'string') {
        text = data
      }
      else if (data instanceof Blob) {
        const stream = data.stream().pipeThrough(new DecompressionStream('gzip'))
        text = await new Response(stream).text()
      }
      else {
        return
      }
      if (socket.readyState !== WebSocket.OPEN || stopFlags.get(site.index))
        return
      handle(text)
    }).catch((error) => {
      console.warn('[cfsm] 无法解压 WebSocket 帧', error)
    })
  }

  socket.onerror = () => {
    try {
      socket.close()
    }
    catch {
      // 忽略
    }
  }

  socket.onclose = () => {
    clearWsTimeoutTimer()
    if (stopFlags.get(site.index))
      return
    sockets.delete(site.index)
    nodesStore().updateWsState('disconnected')
    scheduleReconnect(site, subscribe)
  }
}

function clearWsTimeoutTimer(): void {
  if (wsTimeoutTimer) {
    window.clearTimeout(wsTimeoutTimer)
    wsTimeoutTimer = undefined
  }
}

function handleMessage(site: CfSite, message: { type?: string, updates?: Array<{ serverId: string, samples?: Array<{ data?: Partial<CfServer>, payload?: Partial<CfServer>, metrics?: Partial<CfServer> }> }> }): void {
  if (message.type !== 'batchUpdate' || !Array.isArray(message.updates))
    return
  for (const update of message.updates) {
    const id = String(update.serverId ?? '')
    if (!id)
      continue
    const uuid = uuidOf(site, id)
    let target = pendingPatches.get(uuid) ?? rawServers.get(uuid)
    if (!target)
      continue
    for (const sample of update.samples ?? []) {
      const patch = sample.data ?? sample.payload ?? sample.metrics
      if (patch && typeof patch === 'object')
        target = mergeServerPatch(target, patch)
    }
    pendingPatches.set(uuid, target)
  }
  scheduleFlush()
}

function scheduleFlush(): void {
  if (flushTimer)
    return
  const wait = Math.max(0, FLUSH_INTERVAL_MS - (Date.now() - lastFlush))
  flushTimer = window.setTimeout(flushPending, wait)
}

function flushPending(): void {
  flushTimer = undefined
  lastFlush = Date.now()
  if (pendingPatches.size === 0)
    return
  const entries = [...pendingPatches.entries()]
  pendingPatches.clear()
  const clients: Record<string, Client> = {}
  const statuses: Record<string, ReturnType<typeof serverToStatus>> = {}
  for (const [uuid, raw] of entries) {
    const resolved = siteOf(uuid)
    if (!resolved)
      continue
    rawServers.set(uuid, raw)
    const { client, status } = buildSnapshot(raw, resolved.site)
    clients[uuid] = client
    statuses[uuid] = status
  }
  nodesStore().upsertNodes(clients, statuses)
}

/* ------------------------------------------------------------------ *
 * 页面生命周期
 * ------------------------------------------------------------------ */

function bindVisibility(): void {
  if (visibilityBound)
    return
  visibilityBound = true
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('online', onOnline)
}

function onVisibility(): void {
  if (page.kind === 'none')
    return
  if (document.hidden) {
    generation++
    clearWsTimeoutTimer()
    closeAllSockets()
    for (const controller of controllers)
      controller.abort()
    controllers = new Set()
    nodesStore().updateWsState('disconnected')
    // 保留最后一次数据静态展示
  }
  else {
    suppressed = false
    void resumePage()
  }
}

function onOnline(): void {
  if (!document.hidden && page.kind !== 'none' && sockets.size === 0 && !suppressed) {
    suppressed = false
    void resumePage()
  }
}

async function resumePage(): Promise<void> {
  if (page.kind === 'home') {
    // 规则：重新可见时按当前页面类型补一次 REST，再重连
    try {
      await loadHomeServers(true)
    }
    catch {
      // 恢复失败时保留旧数据，连接层照常重试
    }
    startHomeRealtime()
  }
  else if (page.kind === 'detail' && page.uuid) {
    try {
      await loadDetailServer(page.uuid)
    }
    catch {
      // 保留旧数据
    }
    startDetailRealtime(page.uuid)
  }
}

export function startHomePage(): void {
  page.kind = 'home'
  page.uuid = undefined
  bindVisibility()
  suppressed = false
  startOnlineTicker()
}

export function startHomeRealtime(): void {
  if (page.kind !== 'home' || suppressed)
    return
  for (const site of getSites())
    connectSite(site, 'all')
}

export async function enterHome(): Promise<void> {
  const current = ++generation
  startHomePage()
  await loadHomeServers()
  if (current !== generation)
    return
  startHomeRealtime()
}

export function leaveHome(): void {
  if (page.kind !== 'home')
    return
  generation++
  closeAllSockets()
  page.kind = 'none'
}

export function startDetailPage(uuid: string, hours: number): void {
  page.kind = 'detail'
  page.uuid = uuid
  page.hours = hours
  bindVisibility()
  suppressed = false
  startOnlineTicker()
}

export function startDetailRealtime(uuid: string): void {
  if (page.kind !== 'detail' || suppressed)
    return
  const resolved = siteOf(uuid)
  if (resolved)
    connectSite(resolved.site, resolved.id)
}

export async function enterDetail(uuid: string): Promise<void> {
  const current = ++generation
  startDetailPage(uuid, 0.167)
  await loadDetailServer(uuid)
  if (current !== generation)
    return
  startDetailRealtime(uuid)
}

export function leaveDetail(): void {
  if (page.kind !== 'detail')
    return
  generation++
  closeAllSockets()
  page.kind = 'none'
  page.uuid = undefined
}

/** 手动重试：清除抑制状态并重新拉取当前页面数据。 */
export async function retryConnection(): Promise<boolean> {
  suppressed = false
  reconnectAttempts.clear()
  appStore().connectionError = false
  if (page.kind === 'none')
    return true
  await resumePage()
  return nodesStore().wsConnectionState === 'connected' || nodesStore().wsConnectionState === 'reconnecting'
}

/** WS 超时后用户选择继续。 */
export function continueRealtime(): void {
  wsTimeoutPrompt.value = false
  suppressed = false
  reconnectAttempts.clear()
  if (page.kind === 'home')
    startHomeRealtime()
  else if (page.kind === 'detail' && page.uuid)
    startDetailRealtime(page.uuid)
}

/** WS 超时后用户选择停止：不静默重连。 */
export function stopRealtimeByUser(): void {
  wsTimeoutPrompt.value = false
  suppressed = true
  closeAllSockets()
  nodesStore().updateWsState('disconnected')
}

function startOnlineTicker(): void {
  if (onlineTicker)
    return
  // 只是本地重算在线状态（5 分钟内有过上报），不发起任何请求；
  // 用递归 setTimeout 而非 setInterval，页面销毁时立即停止。
  const tick = () => {
    for (const node of nodesStore().nodes) {
      const online = isOnlineNow(node)
      if (node.online !== online)
        node.online = online
    }
    onlineTicker = window.setTimeout(tick, 30000)
  }
  onlineTicker = window.setTimeout(tick, 30000)
}

export function destroyDataLayer(): void {
  generation++
  closeAllSockets()
  clearWsTimeoutTimer()
  if (onlineTicker) {
    window.clearTimeout(onlineTicker)
    onlineTicker = undefined
  }
  document.removeEventListener('visibilitychange', onVisibility)
  window.removeEventListener('online', onOnline)
  visibilityBound = false
}

export function isHomeLoaded(): boolean {
  return homeLoaded
}

export function resetHomeLoaded(): void {
  homeLoaded = false
}

export function getRawServer(uuid: string): CfServer | undefined {
  return rawServers.get(uuid)
}

export { page as currentPage }
