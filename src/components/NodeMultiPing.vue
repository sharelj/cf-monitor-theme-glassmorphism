<script setup lang="ts">
import { computed } from 'vue'
import { DataTooltip } from '@/components/ui/data-tooltip'
import { PingSparkline } from '@/components/ui/sparkline'
import { buildLinePoints, lineId, useNodePingLines } from '@/composables/useNodePingDisplay'
import { pingColor } from '@/monitor/pingRows'
import { useAppStore } from '@/stores/app'

const props = defineProps<{ uuid: string, name: string, enabled: boolean }>()
const emit = defineEmits<{ open: [] }>()
const store = useAppStore()

const { lines } = useNodePingLines(() => props.uuid)

const sparkline = computed(() => store.publicSettings?.theme_settings?.nodeCardPingStyle === 'sparkline')
const maxRows = computed(() => {
  const value = Number(store.publicSettings?.theme_settings?.homepageMultiPingCount ?? 3)
  return Math.max(1, Math.min(8, Number.isFinite(value) ? value : 3))
})

interface Bar { time: string, latency: number | null, loss: number | null }

function toBars(points: { time: string, latency: number | null, loss: number | null }[]): Bar[] {
  const bars: Bar[] = Array.from({ length: 20 }, () => ({ time: '', latency: null, loss: null }))
  if (!points.length)
    return bars
  const start = Date.parse(points[0]!.time)
  const end = Date.parse(points.at(-1)!.time)
  const gaps = points.slice(1).map((point, i) => Date.parse(point.time) - Date.parse(points[i]!.time)).filter(gap => gap > 0).sort((a, b) => a - b)
  const cadence = gaps[Math.floor((gaps.length - 1) / 2)] ?? 1
  const slotMs = Math.max(cadence, (end - start) / 19)
  for (const point of points) {
    const slot = Math.max(0, Math.min(19, 19 - Math.round((end - Date.parse(point.time)) / slotMs)))
    bars[slot] = { time: point.time, latency: point.latency, loss: point.loss }
  }
  return bars
}

const rows = computed(() => {
  if (!props.enabled)
    return []
  return lines.value.slice(0, maxRows.value).map((line) => {
    const points = line.points.length ? line.points : buildLinePoints(undefined, line.key)
    return {
      id: lineId(line.key),
      key: line.key,
      name: line.name,
      bars: toBars(points),
      hasData: line.hasData,
      latency: line.latency,
      timedOut: line.timedOut && line.latency === null,
      loss: line.loss,
    }
  })
})

type Row = (typeof rows.value)[number]
// 折线只画有效延迟；超时点为 null，折线在此断开，由提示说明。
const linesById = computed(() => new Map(rows.value.map(row => [row.id, { values: row.bars.map(bar => bar.latency), tips: row.bars.map(periodTip) }])))
const lineColor = (row: Row) => row.timedOut ? 'var(--signal-5)' : pingColor(row.latency, 'latency')
const periodTip = (bar: Bar | undefined) => !bar?.time ? '无采样' : `${new Date(bar.time).toLocaleTimeString()}\n${bar.latency === null ? '超时 / 无有效延迟' : `${bar.latency.toFixed(0)} ms`} · ${bar.loss === null ? '无丢包数据' : `丢包 ${bar.loss.toFixed(1)}%`}`
const tooltip = (bar: Bar, metric: 'latency' | 'loss') => !bar.time ? '无采样' : `${new Date(bar.time).toLocaleTimeString()} · ${metric === 'latency' ? bar.latency === null ? '超时 / 无有效延迟' : `${bar.latency.toFixed(0)} ms` : bar.loss === null ? '无丢包数据' : `${bar.loss.toFixed(1)}% 丢包`}`
</script>
<template>
  <div
    class="multi-ping"
    :class="{'multi-ping--sparkline':sparkline}"
    data-multi-ping
    role="button"
    tabindex="0"
    :aria-label="`${name} 延迟与丢包详情`"
    @click.stop="emit('open')"
    @keydown.stop
    @keydown.enter.prevent="emit('open')"
    @keydown.space.prevent="emit('open')"
  >
    <template v-if="!sparkline"><div v-for="row in rows" :key="row.key" class="multi-ping-row">
      <div class="multi-ping-half">
        <div class="multi-ping-label"><span :title="row.name">{{ row.name }}</span><strong :style="{'--ping-value-color':pingColor(row.latency,'latency')}">{{ row.latency !== null ? Math.round(row.latency) : row.timedOut ? '超时' : '—' }}<small v-if="row.latency !== null"> ms</small></strong></div>
        <div v-if="row.bars.some((bar) => bar.time)" class="multi-ping-bars" aria-hidden="true"><DataTooltip v-for="(bar,index) in row.bars" :key="index" :content="tooltip(bar,'latency')"><span :style="{background:bar.time && bar.latency === null ? 'var(--signal-5)' : pingColor(bar.latency,'latency'),opacity:bar.time?1:.2}" /></DataTooltip></div>
      </div>
      <div class="multi-ping-half">
        <div class="multi-ping-label multi-ping-loss" :title="`${row.name} 最近 1 小时窗口丢包率`"><span class="sr-only">窗口丢包率</span><strong :style="{'--ping-value-color':pingColor(row.loss,'loss')}">{{ row.loss === null ? '—' : row.loss.toFixed(1) }}<small v-if="row.loss !== null"> %</small></strong></div>
        <div v-if="row.bars.some((bar) => bar.time)" class="multi-ping-bars" aria-hidden="true"><DataTooltip v-for="(bar,index) in row.bars" :key="index" :content="tooltip(bar,'loss')"><span :style="{background:pingColor(bar.loss,'loss'),opacity:bar.loss===null?.2:1}" /></DataTooltip></div>
      </div>
    </div></template>
    <template v-else>
      <div v-for="row in rows" :key="row.key" class="spark-row">
        <span class="spark-dot" :style="{background:row.hasData ? lineColor(row) : 'var(--muted-foreground)',opacity:row.hasData?1:.4}" />
        <span class="spark-name" :title="row.name">{{ row.name }}</span>
        <strong class="spark-value" :style="{'--ping-value-color':lineColor(row)}">{{ row.latency !== null ? Math.round(row.latency) : row.timedOut ? '超时' : '—' }}<small v-if="row.latency !== null"> ms</small></strong>
        <PingSparkline :values="linesById.get(row.id)?.values ?? []" :tips="linesById.get(row.id)?.tips ?? []" :color="lineColor(row)" />
        <strong class="spark-value spark-loss" :title="`${row.name} 最近 1 小时窗口丢包率`" :style="{'--ping-value-color':pingColor(row.loss,'loss')}"><small v-if="row.loss !== null">丢包 </small>{{ row.loss === null ? '—' : `${row.loss.toFixed(1)}%` }}</strong>
      </div>
    </template>
    <p v-if="!rows.length" class="multi-ping-note">暂无探测线路或采样</p>
  </div>
</template>
<style scoped>
.multi-ping{display:flex;flex-direction:column;gap:10px;padding:8px 2px 4px;border-top:1px solid color-mix(in srgb,currentColor 10%,transparent);cursor:pointer;border-radius:6px;-webkit-tap-highlight-color:transparent;transition:background-color .15s ease}
.multi-ping:hover{background:color-mix(in srgb,currentColor 3%,transparent)}
.multi-ping:focus-visible{outline:2px solid var(--ring);outline-offset:2px}
.multi-ping-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px;text-align:left;width:100%;border-radius:4px;transition:background-color .15s ease}
.multi-ping-row:hover{background:color-mix(in srgb,currentColor 6%,transparent)}.multi-ping-half{min-width:0}.multi-ping-label{display:flex;justify-content:space-between;align-items:baseline;gap:6px;font-size:11px;margin-bottom:5px;line-height:1.3}.multi-ping-label>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted-foreground)}.multi-ping-label strong{color:color-mix(in srgb,var(--ping-value-color) 65%,var(--foreground));font-size:12px;font-variant-numeric:tabular-nums;flex-shrink:0}.multi-ping-label small{font-size:10px;font-weight:400;color:var(--muted-foreground)}.multi-ping-loss{justify-content:flex-end}.multi-ping-bars{display:grid;grid-template-columns:repeat(20,minmax(0,1fr));gap:2px;height:9px}.multi-ping-bars span{display:block;height:9px;width:100%;border-radius:2px}.multi-ping-note{font-size:11px;color:var(--muted-foreground);padding:4px 0}
.multi-ping--sparkline{display:grid;grid-template-columns:auto minmax(0,max-content) max-content minmax(3.5rem,1fr) max-content;column-gap:6px;row-gap:6px}
.multi-ping--sparkline .multi-ping-note{grid-column:1/-1}
.spark-row{display:grid;grid-column:1/-1;grid-template-columns:auto minmax(0,max-content) max-content minmax(3.5rem,1fr) max-content;grid-template-columns:subgrid;align-items:center;min-height:20px;text-align:left;width:100%;border-radius:4px;font-size:11px;line-height:1.3;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;transition:background-color .15s ease}
.spark-row:hover{background:color-mix(in srgb,currentColor 6%,transparent)}
.spark-dot{width:6px;height:6px;border-radius:999px}.spark-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted-foreground)}
.spark-value{color:color-mix(in srgb,var(--ping-value-color) 65%,var(--foreground));font-size:12px;font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}.spark-value small{font-size:10px;font-weight:400;color:var(--muted-foreground)}.spark-loss{justify-self:end}
</style>
