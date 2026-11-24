import type { CfDiskIo, CfGpuInfo, CfHistoryRow, CfServer, CfSiteConfig, CfWindowPoint } from '@/cfsm/types'
import type { Client, DiskIo, GpuInfo, LatencyWindowPoint, NodeStatus, NodeStatusPing, PingRecord, PingTaskInfo, ProbeValue, StatusRecord } from '@/types/model'

/** 探测线路定义：CT/CU/CM/BGP 加四条自定义节点线路。 */
export interface ProbeLine {
  key: string
  name: string
  /** 线路编号：1-4 对应三网，5-8 对应自定义节点 */
  id: number
}

const NAMED_CYCLES: Record<string, number> = {
  monthly: 30,
  month: 30,
  quarterly: 90,
  quarter: 90,
  semiannual: 180,
  halfyear: 180,
  half_year: 180,
  yearly: 365,
  annual: 365,
  year: 365,
  biennial: 730,
  biennium: 730,
  two_year: 730,
  triennial: 1095,
  three_year: 1095,
  once: -1,
  one_time: -1,
}

/** 付款周期 → 天数；`<n>m` 表示 n 个月。 */
export function cycleDays(cycle: string): number {
  const value = String(cycle || '').trim().toLowerCase()
  if (value in NAMED_CYCLES)
    return NAMED_CYCLES[value]!
  const months = Number(/^(\d+)m$/.exec(value)?.[1])
  if (Number.isFinite(months) && months > 0 && months <= 1200)
    return months % 12 === 0 ? months / 12 * 365 : months * 30
  return 0
}

export function numberOr(value: unknown, fallback = 0): number {
  if (typeof value === 'number')
    return Number.isFinite(value) ? value : fallback
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : fallback
  }
  return fallback
}

export function flagValue(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true'
}

const TRAFFIC_UNITS: Record<string, number> = {
  b: 1,
  k: 1024,
  kb: 1024,
  kib: 1024,
  m: 1024 ** 2,
  mb: 1024 ** 2,
  mib: 1024 ** 2,
  g: 1024 ** 3,
  gb: 1024 ** 3,
  gib: 1024 ** 3,
  t: 1024 ** 4,
  tb: 1024 ** 4,
  tib: 1024 ** 4,
  p: 1024 ** 5,
  pb: 1024 ** 5,
}

/** 流量额度文本（如 "1TB"）→ 字节；空字符串或无法识别时为 0。 */
export function parseTrafficLimit(value: unknown): number {
  if (typeof value === 'number')
    return Number.isFinite(value) && value > 0 ? value * 1024 ** 3 : 0
  const text = String(value ?? '').trim().toLowerCase().replace(/\s+/g, '')
  if (!text)
    return 0
  const match = /^([\d.]+)([a-z]*)$/.exec(text)
  if (!match)
    return 0
  const amount = Number.parseFloat(match[1] ?? '')
  if (!Number.isFinite(amount) || amount <= 0)
    return 0
  // CF-Server-Monitor 的 traffic_limit 以 GB 存储（默认主题按 *1024^3 展示）；
  // 兼容早期写成 "1TB" 一类带单位的文本。
  const unit = match[2]
  if (!unit)
    return amount * 1024 ** 3
  return amount * (TRAFFIC_UNITS[unit] ?? 1024 ** 3)
}

const TRAFFIC_CALC_TYPES: Record<string, string> = {
  total: 'sum',
  sum: 'sum',
  both: 'sum',
  up: 'up',
  ul: 'up',
  upload: 'up',
  tx: 'up',
  down: 'down',
  dl: 'down',
  download: 'down',
  rx: 'down',
  max: 'max',
  max_in_out: 'max',
}

export function trafficCalcType(value: unknown): string {
  return TRAFFIC_CALC_TYPES[String(value ?? '').trim().toLowerCase()] ?? 'sum'
}

const CURRENCY_BY_SYMBOL: Record<string, string> = {
  '¥': 'CNY',
  '￥': 'CNY',
  'CN¥': 'CNY',
  'RMB': 'CNY',
  '$': 'USD',
  'US$': 'USD',
  '€': 'EUR',
  '£': 'GBP',
  'HK$': 'HKD',
  'JP¥': 'JPY',
  '₽': 'RUB',
  '₹': 'INR',
  '₫': 'VND',
  '฿': 'THB',
  'C$': 'CAD',
  'CA$': 'CAD',
  'CHF': 'CHF',
}

export function normalizeCurrency(value: unknown): string {
  const text = String(value ?? '').trim()
  if (!text)
    return 'CNY'
  if (CURRENCY_BY_SYMBOL[text])
    return CURRENCY_BY_SYMBOL[text]!
  const upper = text.toUpperCase()
  if (/^[A-Z]{3}$/.test(upper))
    return upper
  return 'CNY'
}

export function parseLoadAverage(value: unknown): [number, number, number] {
  if (typeof value === 'number' && Number.isFinite(value))
    return [value, value, value]
  const parts = String(value ?? '').trim().split(/\s+/).map(Number).filter(Number.isFinite)
  return [parts[0] ?? 0, parts[1] ?? parts[0] ?? 0, parts[2] ?? parts[1] ?? parts[0] ?? 0]
}

export function normalizeGpu(value: unknown): GpuInfo[] {
  let list = value
  if (typeof value === 'string') {
    try {
      list = JSON.parse(value)
    }
    catch {
      return []
    }
  }
  if (!Array.isArray(list))
    return []
  return list.flatMap((item: CfGpuInfo) => {
    if (!item || typeof item !== 'object')
      return []
    const name = String(item.name ?? '').trim()
    if (!name)
      return []
    const info = numberOr(item.info, Number.NaN)
    return [{ id: String(item.id ?? ''), name, info: Number.isFinite(info) ? info : null }]
  })
}

export function normalizeDiskIo(value: unknown): DiskIo | null {
  if (!value || typeof value !== 'object')
    return null
  const raw = value as CfDiskIo
  const io: DiskIo = {
    read_bps: numberOr(raw.read_bps),
    write_bps: numberOr(raw.write_bps),
    read_iops: numberOr(raw.read_iops),
    write_iops: numberOr(raw.write_iops),
    await_ms: numberOr(raw.await_ms),
    util: numberOr(raw.util),
  }
  // 六个字段全为 0 时视为没有磁盘 IO 数据
  const hasValue = Object.values(io).some(v => v !== 0)
  return hasValue ? io : null
}

function windowValue(value: unknown): ProbeValue {
  if (value === false)
    return false
  if (value === null)
    return null
  if (typeof value === 'number' && Number.isFinite(value))
    return value
  return undefined
}

export function normalizeWindowPoints(value: unknown): LatencyWindowPoint[] {
  if (!Array.isArray(value))
    return []
  return value.flatMap((item) => {
    const point = item as CfWindowPoint
    const ts = numberOr(point?.ts, Number.NaN)
    if (!Number.isFinite(ts))
      return []
    const next: LatencyWindowPoint = { ts }
    for (const key of Object.keys(point)) {
      if (key === 'ts')
        continue
      const normalized = windowValue(point[key])
      if (normalized !== undefined)
        next[key] = normalized
    }
    return [next]
  })
}

export function probeValue(value: unknown): ProbeValue {
  return windowValue(value)
}

export function buildProbeLines(config: CfSiteConfig | undefined): ProbeLine[] {
  return [
    { key: 'ct', name: String(config?.custom_ct_name || '电信').trim() || '电信', id: 1 },
    { key: 'cu', name: String(config?.custom_cu_name || '联通').trim() || '联通', id: 2 },
    { key: 'cm', name: String(config?.custom_cm_name || '移动').trim() || '移动', id: 3 },
    { key: 'bd', name: String(config?.custom_bd_name || 'BGP').trim() || 'BGP', id: 4 },
    { key: 'node_1', name: String(config?.node_1_name || 'Node 1').trim() || 'Node 1', id: 5 },
    { key: 'node_2', name: String(config?.node_2_name || 'Node 2').trim() || 'Node 2', id: 6 },
    { key: 'node_3', name: String(config?.node_3_name || 'Node 3').trim() || 'Node 3', id: 7 },
    { key: 'node_4', name: String(config?.node_4_name || 'Node 4').trim() || 'Node 4', id: 8 },
  ]
}

/** 是否在线：CF 的统计口径为 5 分钟内有过上报。 */
export const ONLINE_THRESHOLD_MS = 5 * 60 * 1000
/** CF 的 ram / swap / disk 单位是 MB，展示层统一用字节。 */
const MB = 1024 * 1024

export function isServerOnline(server: CfServer, now = Date.now()): boolean {
  if (typeof server.is_online === 'boolean')
    return server.is_online
  const last = numberOr(server.last_updated, 0)
  return last > 0 && now - last < ONLINE_THRESHOLD_MS
}

/** 站点 + 原始服务器 → 展示用 Client。 */
export function mapServer(server: CfServer, siteIndex: number, sitesCount: number): Client {
  const [load1] = parseLoadAverage(server.load_avg)
  const priceRaw = String(server.price ?? '').trim()
  const price = priceRaw === '0' || priceRaw === '-1' ? -1 : numberOr(priceRaw, 0)
  const group = String(server.server_group ?? '').trim()
  const bootTime = numberOr(server.boot_time, 0)
  const uptime = bootTime > 0 ? Math.max(0, Math.floor((Date.now() - bootTime) / 1000)) : 0
  const id = String(server.id ?? '')
  const uuid = sitesCount > 1 ? `${siteIndex}:${id}` : id

  return {
    uuid,
    server_id: id,
    site_index: siteIndex,
    name: String(server.name ?? '').trim() || id,
    cpu_name: String(server.cpu_info ?? '').trim(),
    virtualization: String(server.virtualization ?? '').trim(),
    arch: String(server.arch ?? '').trim(),
    cpu_cores: numberOr(server.cpu_cores),
    os: String(server.os ?? '').trim(),
    kernel_version: String(server.kernel_version ?? '').trim(),
    region: String(server.region ?? '').trim(),
    tags: String(server.tags ?? '').trim(),
    remark: String(server.tags ?? '').trim(),
    mem_total: numberOr(server.ram_total) * MB,
    swap_total: numberOr(server.swap_total) * MB,
    disk_total: numberOr(server.disk_total) * MB,
    version: String(server.agent_version ?? '').trim(),
    weight: numberOr(server.sort_order),
    price,
    price_set: priceRaw !== '',
    billing_cycle: cycleDays(String(server.billing_cycle ?? '')),
    billing_cycle_raw: String(server.billing_cycle ?? ''),
    auto_renewal: flagValue(server.auto_renewal),
    currency: normalizeCurrency(server.currency),
    expired_at: String(server.expire_date ?? '').trim(),
    group,
    groups: group ? [group] : [],
    hidden: flagValue(server.is_hidden),
    traffic_limit: parseTrafficLimit(server.traffic_limit),
    traffic_limit_type: trafficCalcType(server.traffic_calc_type),
    traffic_reset_day: numberOr(server.reset_day),
    created_at: '',
    updated_at: '',
    ipv4_reachable: flagValue(server.ip_v4),
    ipv6_reachable: flagValue(server.ip_v6),
    online: isServerOnline(server),
    last_updated: numberOr(server.last_updated, 0) || numberOr(server.timestamp, 0),
    windows_available: server.ping !== undefined || server.loss !== undefined,
    ping_window: normalizeWindowPoints(server.ping),
    loss_window: normalizeWindowPoints(server.loss),
    gpu: normalizeGpu(server.gpu_info),
    disk_io: normalizeDiskIo(server.disk),
  } as Client
}

function isoTime(ms: number): string {
  return new Date(ms).toISOString()
}

/** 把 CF 服务器快照映射成状态记录。 */
export function serverToStatus(server: CfServer, client: Client, lines: ProbeLine[] = []): NodeStatus {
  const [load1, load5, load15] = parseLoadAverage(server.load_avg)
  const bootTime = numberOr(server.boot_time, 0)
  const ping: Record<string, NodeStatusPing> = {}
  for (const line of lines) {
    const raw = probeValue(server[`ping_${line.key}`])
    const rawLoss = probeValue(server[`loss_${line.key}`])
    // 三态：false / 缺失 = 未配置，不显示；null = 本轮超时；0 是有效值
    if (raw === false || raw === undefined)
      continue
    ping[line.key] = {
      name: line.name,
      latest: raw === null ? -1 : raw,
      loss: typeof rawLoss === 'number' ? rawLoss : Number.NaN,
      configured: true,
      timed_out: raw === null,
    }
  }
  return {
    client: client.uuid,
    time: isoTime(numberOr(server.last_updated, Date.now())),
    cpu: numberOr(server.cpu),
    ram: numberOr(server.ram_used) * MB,
    ram_total: numberOr(server.ram_total) * MB || client.mem_total,
    swap: numberOr(server.swap_used) * MB,
    swap_total: numberOr(server.swap_total) * MB || client.swap_total,
    load: load1,
    load5,
    load15,
    disk: numberOr(server.disk_used) * MB,
    disk_total: numberOr(server.disk_total) * MB || client.disk_total,
    net_in: numberOr(server.net_in_speed),
    net_out: numberOr(server.net_out_speed),
    net_total_up: numberOr(server.net_tx),
    net_total_down: numberOr(server.net_rx),
    traffic_up: numberOr(server.net_tx_monthly),
    traffic_down: numberOr(server.net_rx_monthly),
    process: numberOr(server.processes),
    connections: numberOr(server.tcp_conn),
    connections_udp: numberOr(server.udp_conn),
    uptime: bootTime > 0 ? Math.max(0, Math.floor((Date.now() - bootTime) / 1000)) : 0,
    online: client.online,
    ping,
    updated_at: isoTime(numberOr(server.last_updated, Date.now())),
  }
}

/** 历史行 → 负载记录。 */
export function historyToStatusRecords(rows: CfHistoryRow[], client: Client): StatusRecord[] {
  return (Array.isArray(rows) ? rows : []).flatMap((row) => {
    const ts = numberOr(row.timestamp, Number.NaN)
    if (!Number.isFinite(ts))
      return []
    const [load1, load5, load15] = parseLoadAverage(row.load_avg)
    const disk = normalizeDiskIo(row.disk)
    return [{
      client: client.uuid,
      time: isoTime(ts),
      cpu: numberOr(row.cpu),
      ram: numberOr(row.ram_used) * MB,
      ram_total: numberOr(row.ram_total) * MB || client.mem_total,
      swap: numberOr(row.swap_used) * MB,
      swap_total: numberOr(row.swap_total) * MB || client.swap_total,
      load: load1,
      load5,
      load15,
      disk: numberOr(row.disk_used) * MB,
      disk_total: numberOr(row.disk_total) * MB || client.disk_total,
      net_in: numberOr(row.net_in_speed),
      net_out: numberOr(row.net_out_speed),
      net_total_up: numberOr(row.net_tx),
      net_total_down: numberOr(row.net_rx),
      traffic_up: numberOr(row.net_tx_monthly),
      traffic_down: numberOr(row.net_rx_monthly),
      process: numberOr(row.processes),
      connections: numberOr(row.tcp_conn),
      connections_udp: numberOr(row.udp_conn),
      ...(disk ? { disk_read: disk.read_bps, disk_write: disk.write_bps } : {}),
    }]
  }).sort((a, b) => Date.parse(a.time) - Date.parse(b.time))
}

/**
 * 历史行 → 延迟 / 丢包记录。
 * 三态：false/缺失 = 未配置（不产生记录）；null = 超时（value = -1）；0 是有效值。
 */
export function historyToPingRecords(rows: CfHistoryRow[], client: Client, lines: ProbeLine[]): { records: PingRecord[], tasks: PingTaskInfo[] } {
  const records: PingRecord[] = []
  const usable = (Array.isArray(rows) ? rows : []).filter(row => Number.isFinite(numberOr(row.timestamp, Number.NaN)))
  const sorted = [...usable].sort((a, b) => numberOr(a.timestamp, 0) - numberOr(b.timestamp, 0))

  const tasks = lines.flatMap((line): PingTaskInfo[] => {
    const values: number[] = []
    let sawValue = false
    let latest: number | undefined
    let lossLatest: number | undefined
    let timedOut = false

    for (const row of sorted) {
      const record = row as Record<string, unknown>
      const rawPing = windowValue(record[`ping_${line.key}`])
      const rawLoss = windowValue(record[`loss_${line.key}`])
      // false = 该线路未配置 / 未取样，不产生记录
      if (rawPing === false && rawLoss === false)
        continue
      if (rawPing !== undefined || rawLoss !== undefined)
        sawValue = true
      if (rawPing === null) {
        timedOut = true
        latest = -1
      }
      else if (typeof rawPing === 'number') {
        timedOut = false
        latest = rawPing
        values.push(rawPing)
      }
      if (typeof rawLoss === 'number')
        lossLatest = rawLoss
      // 延迟缺测时不补点：只有明确超时（null）才画成超时
      if (rawPing === undefined)
        continue
      records.push({
        client: client.uuid,
        task_id: line.id,
        time: isoTime(numberOr(row.timestamp, 0)),
        value: typeof rawPing === 'number' ? rawPing : -1,
        ...(typeof rawLoss === 'number' ? { monitor_bucket_loss: rawLoss, monitor_window_loss: rawLoss } : {}),
      })
    }

    if (!sawValue)
      return []
    const avg = values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : undefined
    return [{
      id: line.id,
      key: line.key,
      name: line.name,
      interval: 60,
      loss: lossLatest ?? Number.NaN,
      clients: [client.uuid],
      configured: true,
      latest: latest ?? (timedOut ? -1 : undefined),
      avg,
      min: values.length ? Math.min(...values) : undefined,
      max: values.length ? Math.max(...values) : undefined,
      total: values.length + (timedOut ? 1 : 0),
      valid: values.length,
      timed_out: timedOut,
    }]
  })

  return { records, tasks }
}

/** 合并 WebSocket 增量字段：缺失字段保留旧值，null / false 是有意义的值。 */
export function mergeServerPatch(target: CfServer, patch: Partial<CfServer>): CfServer {
  const next: CfServer = { ...target }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined)
      continue
    next[key] = value
  }
  return next
}
