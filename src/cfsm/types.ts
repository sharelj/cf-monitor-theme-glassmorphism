/** CF-Server-Monitor 公开接口的原始数据类型（宽松，服务端字段可能缺省）。 */

export interface CfSiteConfig {
  version?: string
  last_workers_version?: string | null
  last_agent_version?: string | null
  is_public?: boolean
  authorization?: boolean
  turnstile_enabled?: boolean
  turnstile_login_enabled?: boolean
  turnstile_site_key?: string
  custom_ct_name?: string
  custom_cu_name?: string
  custom_cm_name?: string
  custom_bd_name?: string
  node_1_name?: string
  node_2_name?: string
  node_3_name?: string
  node_4_name?: string
  site_title?: string
  preferred_theme?: string
  default_language?: string
  theme_options?: Record<string, unknown>
  verified?: boolean
  turnstile_verified?: string | null
  frontend_ws_timeout_minutes?: number
  long_history_points?: number
  latency_window?: { points?: number, hours?: number }
}

export interface CfProbeValue { ct?: number | null | false, cu?: number | null | false, cm?: number | null | false, bd?: number | null | false }

export interface CfWindowPoint extends CfProbeValue {
  ts: number
  [key: string]: number | null | false | undefined
}

export interface CfDiskIo {
  read_bps?: number
  write_bps?: number
  read_iops?: number
  write_iops?: number
  await_ms?: number
  util?: number
}

export interface CfGpuInfo {
  id?: string | number
  name?: string
  info?: number | null
}

export interface CfServer {
  id: string
  name?: string
  server_group?: string
  tags?: string
  price?: string | number
  billing_cycle?: string
  auto_renewal?: string | boolean
  currency?: string
  expire_date?: string
  traffic_limit?: string | number
  traffic_calc_type?: string
  reset_day?: number
  report_interval?: number
  wss_report_interval?: number
  is_hidden?: string | boolean
  sort_order?: number
  cpu?: number
  load_avg?: string
  net_in_speed?: number
  net_out_speed?: number
  net_rx?: number
  net_tx?: number
  net_rx_monthly?: number
  net_tx_monthly?: number
  processes?: number
  tcp_conn?: number
  udp_conn?: number
  ping_ct?: number | null | false
  ping_cu?: number | null | false
  ping_cm?: number | null | false
  ping_bd?: number | null | false
  ping_node_1?: number | null | false
  ping_node_2?: number | null | false
  ping_node_3?: number | null | false
  ping_node_4?: number | null | false
  loss_ct?: number | null | false
  loss_cu?: number | null | false
  loss_cm?: number | null | false
  loss_bd?: number | null | false
  loss_node_1?: number | null | false
  loss_node_2?: number | null | false
  loss_node_3?: number | null | false
  loss_node_4?: number | null | false
  ping?: CfWindowPoint[]
  loss?: CfWindowPoint[]
  ram_total?: number
  ram_used?: number
  swap_total?: number
  swap_used?: number
  disk_total?: number
  disk_used?: number
  disk?: CfDiskIo | null
  cpu_cores?: number
  cpu_info?: string
  gpu_info?: CfGpuInfo[] | string
  arch?: string
  os?: string
  kernel_version?: string
  region?: string
  ip_v4?: string | boolean
  ip_v6?: string | boolean
  boot_time?: string | number
  agent_version?: string
  last_updated?: number
  timestamp?: number
  is_online?: boolean
  sysConfig?: CfSysConfig
  [key: string]: unknown
}

export interface CfSysConfig {
  show_price?: boolean
  show_expire?: boolean
  show_tf?: boolean
  show_three_net_details?: boolean
  long_history_points?: number
}

export interface CfStats {
  total?: number
  online?: number
  offline?: number
  globalSpeedIn?: number
  globalSpeedOut?: number
  globalNetTx?: number
  globalNetRx?: number
}

export interface CfServersResponse {
  servers?: CfServer[]
  stats?: CfStats
  regionStats?: Record<string, number>
  sysConfig?: CfSysConfig
}

export type CfHistoryRow = Partial<CfServer> & { timestamp: number }

export interface CfWsSample {
  ts?: number
  data?: Partial<CfServer>
  payload?: Partial<CfServer>
  metrics?: Partial<CfServer>
}

export interface CfWsMessage {
  type: string
  ts?: number
  subscribed?: string
  scope?: string
  ids?: string[]
  count?: number
  serverId?: string
  updates?: Array<{ serverId: string, samples?: CfWsSample[] }>
}

/** 一个后端站点（多 apiBase 时有多份）。 */
export interface CfSite {
  index: number
  base: string
  config: CfSiteConfig
  ids: string[]
}
