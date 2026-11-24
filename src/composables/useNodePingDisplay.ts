import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { useAppStore } from '@/stores/app'
import { useNodesStore } from '@/stores/nodes'
import { formatDateTime } from '@/utils/helper'
import type { NodeData } from '@/stores/nodes'
import type { LatencyWindowPoint } from '@/types/model'

export type NodePingMetric = 'latency' | 'loss'

export interface NodePingBar {
  key: string
  className: string
  tooltip: string
}

export interface PingPoint {
  time: string
  latency: number | null
  loss: number | null
}

interface UseNodePingDisplayOptions {
  enabled?: MaybeRefOrGetter<boolean>
  loadingDisplayText?: string
  emptyDisplayText?: string
  loadingPanelTooltipText?: Partial<Record<NodePingMetric, string>>
  emptyPanelTooltipText?: Partial<Record<NodePingMetric, string>>
}

const EMPTY_PING_BAR_COUNT = 20

export interface ProbeLineDisplay {
  key: string
  name: string
  points: PingPoint[]
  latency: number | null
  loss: number | null
  timedOut: boolean
  hasData: boolean
}

/** 线路 key 与显示名的固定顺序：CT/CU/CM/BGP 与四条自定义线路。 */
const LINE_ORDER = ['ct', 'cu', 'cm', 'bd', 'node_1', 'node_2', 'node_3', 'node_4'] as const
const LINE_IDS: Record<string, number> = { ct: 1, cu: 2, cm: 3, bd: 4, node_1: 5, node_2: 6, node_3: 7, node_4: 8 }
const DEFAULT_LINE_NAMES: Record<string, string> = { ct: '电信', cu: '联通', cm: '移动', bd: 'BGP', node_1: 'Node 1', node_2: 'Node 2', node_3: 'Node 3', node_4: 'Node 4' }

export function lineDisplayName(key: string, names: Record<string, string>): string {
  return names[key] || DEFAULT_LINE_NAMES[key] || key
}

export function lineId(key: string): number {
  return LINE_IDS[key] ?? 0
}

/** 首选项里的线路名称/编号 → 线路 key 列表。 */
export function resolveSelectedLines(selection: string, names: Record<string, string>): string[] {
  const tokens = selection.trim().split(/[,，;；\n]+/).map(token => token.trim()).filter(Boolean)
  if (!tokens.length)
    return []
  const keys: string[] = []
  for (const token of tokens) {
    const numeric = /^\d+$/.test(token) ? Number(token) : Number.NaN
    const byId = Object.entries(LINE_IDS).find(([, id]) => id === numeric)?.[0]
    const key = byId ?? LINE_ORDER.find(k => lineDisplayName(k, names) === token || k === token)
    if (key && !keys.includes(key))
      keys.push(key)
  }
  return keys
}

function pointValue(value: unknown): number | null | undefined {
  if (value === false)
    return undefined
  if (value === null)
    return null
  if (typeof value === 'number' && Number.isFinite(value))
    return value
  return undefined
}

/** 把窗口数组按时间合并成一条线路的点位序列。 */
export function buildLinePoints(node: NodeData | undefined, key: string): PingPoint[] {
  if (!node)
    return []
  const latencyByTs = new Map<number, number | null>()
  const lossByTs = new Map<number, number | null>()
  for (const point of node.ping_window ?? []) {
    const value = pointValue((point as LatencyWindowPoint)[key])
    if (value !== undefined)
      latencyByTs.set(point.ts, value)
  }
  for (const point of node.loss_window ?? []) {
    const value = pointValue((point as LatencyWindowPoint)[key])
    if (value !== undefined)
      lossByTs.set(point.ts, value)
  }
  const timestamps = [...new Set([...latencyByTs.keys(), ...lossByTs.keys()])].sort((a, b) => a - b)
  return timestamps.map(ts => ({
    time: new Date(ts).toISOString(),
    latency: latencyByTs.get(ts) ?? null,
    loss: lossByTs.get(ts) ?? null,
  }))
}

export function useNodePingLines(uuid: MaybeRefOrGetter<string>) {
  const nodesStore = useNodesStore()
  const appStore = useAppStore()

  const node = computed(() => nodesStore.nodesByUuid.get(toValue(uuid)))
  const names = computed(() => appStore.probeLineNames)

  const lines = computed<ProbeLineDisplay[]>(() => {
    const current = node.value
    if (!current)
      return []
    const selection = appStore.homepageMultiPingTaskIds
    const selectedKeys = resolveSelectedLines(selection, names.value)
    const keys = selectedKeys.length ? selectedKeys : [...LINE_ORDER]
    return keys.flatMap((key) => {
      const points = buildLinePoints(current, key)
      const ping = current.pingLines[key]
      if (!points.length && !ping)
        return []
      // null = 本轮明确超时：显示「超时」，不拿历史值冒充最新值
      const timedOut = Boolean(ping?.timedOut)
      const fallbackLatency = points.filter(point => point.latency !== null).at(-1)?.latency ?? null
      const latency = timedOut ? null : ping && !ping.timedOut ? ping.latest : fallbackLatency
      const loss = ping?.loss ?? (points.filter(point => point.loss !== null).at(-1)?.loss ?? null)
      return [{
        key,
        name: names.value[key] || DEFAULT_LINE_NAMES[key] || key,
        points,
        latency,
        loss,
        timedOut,
        hasData: points.length > 0 || Boolean(ping),
      }]
    })
  })

  const selected = computed(() => lines.value.find(line => line.hasData) ?? null)

  return { lines, selected }
}

function getLatencyToneClass(latency: number): string {
  if (latency <= 60)
    return 'bg-signal-1'
  if (latency <= 100)
    return 'bg-signal-2'
  if (latency <= 160)
    return 'bg-signal-3 ping-signal-pattern-2'
  if (latency <= 200)
    return 'bg-signal-4 ping-signal-pattern-3'
  return 'bg-signal-5 ping-signal-pattern-4'
}

function getLossToneClass(loss: number): string {
  if (loss <= 1)
    return 'bg-signal-1'
  if (loss <= 3)
    return 'bg-signal-2'
  if (loss <= 6)
    return 'bg-signal-3 ping-signal-pattern-2'
  if (loss <= 9)
    return 'bg-signal-4 ping-signal-pattern-3'
  return 'bg-signal-5 ping-signal-pattern-4'
}

export function useNodePingDisplay(
  uuid: MaybeRefOrGetter<string>,
  options: UseNodePingDisplayOptions = {},
) {
  const { lines, selected } = useNodePingLines(uuid)

  const pingStatsEnabled = computed(() => toValue(options.enabled) !== false)

  const history = computed<PingPoint[]>(() => selected.value?.points ?? [])

  const hasData = computed(() => Boolean(selected.value?.hasData))

  const avgLatency = computed(() => selected.value?.latency ?? 0)

  const avgLoss = computed(() => selected.value?.loss ?? 0)

  const avgVolatility = computed(() => {
    const values = history.value.map(point => point.latency).filter((value): value is number => value !== null)
    if (values.length < 2)
      return 0
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
    return Math.sqrt(variance)
  })

  function buildPingBars(metric: NodePingMetric): NodePingBar[] {
    return history.value.map((point, index) => {
      const value = point[metric]
      return {
        key: `${point.time}-${index}`,
        className: value === null
          ? 'bg-muted-foreground/15'
          : metric === 'latency'
            ? getLatencyToneClass(value)
            : getLossToneClass(value),
        tooltip: value === null
          ? `${formatDateTime(point.time, 'HH:mm:ss')}\n无采样数据`
          : metric === 'latency'
            ? `${formatDateTime(point.time, 'HH:mm:ss')}\n${Math.round(value)} ms`
            : `${formatDateTime(point.time, 'HH:mm:ss')}\n${value.toFixed(1)}%`,
      }
    })
  }

  function buildEmptyPingBars(metric: NodePingMetric): NodePingBar[] {
    const tooltip = metricsAvailable.value ? '无采样数据' : '未配置探测线路'
    void metric
    return Array.from({ length: EMPTY_PING_BAR_COUNT }, (_, index) => ({
      key: `${metric}-empty-${index}`,
      className: 'bg-muted-foreground/10',
      tooltip,
    }))
  }

  const metricsAvailable = computed(() => lines.value.length > 0)
  const latencyBars = computed(() => buildPingBars('latency'))
  const lossBars = computed(() => buildPingBars('loss'))
  const latencyRenderBars = computed(() => latencyBars.value.length ? latencyBars.value : buildEmptyPingBars('latency'))
  const lossRenderBars = computed(() => lossBars.value.length ? lossBars.value : buildEmptyPingBars('loss'))

  const latencyPoints = computed(() => history.value.map(point => point.latency))

  const periodTips = computed(() => history.value.map(point =>
    `${formatDateTime(point.time, 'HH:mm:ss')}\n${point.latency === null ? '无采样数据' : `${Math.round(point.latency)} ms`} · ${point.loss === null ? '无丢包数据' : `丢包 ${point.loss.toFixed(1)}%`}`,
  ))

  const latencyDisplay = computed(() => {
    if (hasData.value && selected.value?.timedOut)
      return '超时'
    if (hasData.value && selected.value?.latency !== null)
      return `${Math.round(avgLatency.value)} ms`
    return options.emptyDisplayText ?? '-'
  })

  const lossDisplay = computed(() => {
    if (hasData.value && selected.value?.loss !== null)
      return `${avgLoss.value.toFixed(1)}%`
    return options.emptyDisplayText ?? '-'
  })

  const latencyPanelTooltip = computed(() => {
    if (!hasData.value)
      return options.emptyPanelTooltipText?.latency ?? ''
    if (selected.value?.timedOut)
      return '本轮探测超时（Timeout），显示上一轮有效值或无数据'
    return `最新延迟 ${Math.round(avgLatency.value)} ms`
  })

  const lossPanelTooltip = computed(() => {
    if (!hasData.value)
      return options.emptyPanelTooltipText?.loss ?? ''
    const volatility = avgVolatility.value > 0 ? `，平均波动 ${avgVolatility.value.toFixed(2)}` : ''
    return `窗口丢包 ${avgLoss.value.toFixed(1)}%${volatility}`
  })

  const pingStats = {
    history,
    hasData,
    avgLatency,
    avgLoss,
    avgVolatility,
    loading: computed(() => false),
    error: computed(() => null as string | null),
  }

  return {
    pingStats,
    pingStatsEnabled,
    latencyRenderBars,
    lossRenderBars,
    latencyPoints,
    periodTips,
    latencyDisplay,
    lossDisplay,
    latencyPanelTooltip,
    lossPanelTooltip,
    lines,
  }
}
