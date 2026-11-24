import type { PingRecord, PingTaskInfo, StatusRecord } from '@/types/model'
import { loadDetailHistory, loadDetailPing } from '@/cfsm/data'

/**
 * 详情页历史：统一走 /api/history/all?id=&hours=xx。
 * 卡片小图、对比、导出都不再单独拉历史，避免 D1 额度消耗。
 */
export async function loadNodeLoadRecords(uuid: string, hours: number, _maxCount?: number): Promise<StatusRecord[]> {
  return loadDetailHistory(uuid, hours)
}

export async function loadPingRecordsWithTasks(hours: number, _maxCount?: number, uuid?: string): Promise<{ records: PingRecord[], tasks: PingTaskInfo[] }> {
  if (!uuid)
    return { records: [], tasks: [] }
  return loadDetailPing(uuid, hours)
}

export async function loadPingRecords(hours: number, maxCount?: number, uuid?: string): Promise<PingRecord[]> {
  const result = await loadPingRecordsWithTasks(hours, maxCount, uuid)
  return result.records
}

export function isHistoryError(error: unknown): boolean {
  return error instanceof Error
}
