/** CF-Server-Monitor 主题内部使用的展示模型类型。 */

/** 节点客户端信息（由 CF-Server-Monitor 的 Server 归一化而来） */
export interface Client {
  uuid: string
  /** 后端原始服务器 ID（不含站点前缀） */
  server_id: string
  /** 多 apiBase 时的站点序号，单站为 0 */
  site_index: number
  name: string
  cpu_name: string
  virtualization: string
  arch: string
  cpu_cores: number
  cpu_physical_cores?: number
  os: string
  kernel_version: string
  region: string
  /** CF 公开接口只返回可达性；保留字段供既有展示代码兼容 */
  ipv4?: string
  ipv6?: string
  expires_in?: number | null
  tags?: string
  remark?: string
  mem_total: number
  swap_total: number
  disk_total: number
  version?: string
  weight: number
  price: number
  billing_cycle: number
  auto_renewal: boolean
  currency: string
  expired_at: string
  group: string
  groups?: string[]
  hidden: boolean
  traffic_limit: number
  traffic_limit_type: string
  traffic_reset_day?: number
  created_at: string
  updated_at: string
  /** 计费周期原始值（CF 的 billing_cycle 字符串） */
  billing_cycle_raw: string
  /** 价格是否有值；CF 用空字符串表示未设置 */
  price_set: boolean
  /** IPv4 / IPv6 可达性（CF 不向公开接口返回具体地址） */
  ipv4_reachable: boolean
  ipv6_reachable: boolean
  /** 是否在线（按 last_updated 5 分钟口径） */
  online: boolean
  last_updated: number
  /** 三网窗口延迟采样，仅列表接口提供 */
  /** 本次快照是否来自列表接口（只有列表带三网窗口数组） */
  windows_available: boolean
  ping_window: LatencyWindowPoint[]
  loss_window: LatencyWindowPoint[]
  gpu: GpuInfo[]
  disk_io: DiskIo | null
}

/** 单条探测线路的最新值；false/undefined 表示未配置，null 表示本轮超时 */
export type ProbeValue = number | null | false | undefined

export interface LatencyWindowPoint {
  ts: number
  ct?: ProbeValue
  cu?: ProbeValue
  cm?: ProbeValue
  bd?: ProbeValue
  [line: string]: ProbeValue | undefined
}

export interface GpuInfo {
  id: string
  name: string
  info: number | null
}

export interface DiskIo {
  read_bps: number
  write_bps: number
  read_iops: number
  write_iops: number
  await_ms: number
  util: number
}

export interface NodeStatus {
  client: string
  time: string
  cpu: number
  ram: number
  ram_total: number
  swap: number
  swap_total: number
  load: number
  load5: number
  load15: number
  disk: number
  disk_total: number
  net_in: number
  net_out: number
  net_total_up: number
  net_total_down: number
  traffic_up?: number
  traffic_down?: number
  traffic_used?: number
  process: number
  connections: number
  connections_udp: number
  uptime: number
  online: boolean
  message?: string
  updated_at?: string
  /** 各探测线路最新值，键为线路 id（ct/cu/cm/bd/node_1..4） */
  ping?: Record<string, NodeStatusPing>
}

export interface NodeStatusPing {
  name: string
  /** 最新延迟；<0 表示超时 */
  latest: number
  avg?: number
  p99?: number
  min?: number
  max?: number
  /** 丢包率（%）；NaN 表示无可用的窗口丢包数据 */
  loss: number
  /** false 表示该线路未配置 */
  configured?: boolean
  /** true 表示最新一轮明确超时 */
  timed_out?: boolean
}

/** 历史指标行（归一化后） */
export interface StatusRecord {
  client: string
  time: string
  cpu: number
  ram: number
  ram_total: number
  swap: number
  swap_total: number
  load: number
  load5: number
  load15: number
  disk: number
  disk_total: number
  net_in: number
  net_out: number
  cpu_peak?: number
  net_in_peak?: number
  net_out_peak?: number
  net_total_up: number
  net_total_down: number
  traffic_up?: number
  traffic_down?: number
  process: number
  connections: number
  connections_udp: number
  step?: number
  disk_read?: number
  disk_write?: number
}

/** Ping 记录 */
export interface PingRecord {
  monitor_window_loss?: number
  monitor_bucket_loss?: number
  client: string
  task_id: number
  time: string
  value: number
}

/** Ping 任务摘要 */
export interface PingTaskInfo {
  id: number
  name: string
  interval: number
  loss: number
  key?: string
  clients?: string[]
  configured?: boolean
  latest?: number
  avg?: number
  min?: number
  max?: number
  total?: number
  valid?: number
  timed_out?: boolean
  p50?: number
  p99?: number
  p99_p50_ratio?: number
  stddev?: number
  loss_approximate?: boolean
  type?: string
}

export interface VersionInfo {
  version: string
  hash: string
}
