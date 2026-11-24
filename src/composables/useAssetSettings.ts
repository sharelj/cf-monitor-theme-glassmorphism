import { computed } from 'vue'
import { useAppStore } from '@/stores/app'
import { parseAssetSettings } from '@/utils/assetCost'

/**
 * 资产管理的站点级设置与可见性。
 * 页面入口对管理员始终可见；对访客要站点明确开放（showAssetForGuests）。
 */
export function useAssetSettings() {
  const appStore = useAppStore()
  const settings = computed(() => parseAssetSettings(appStore.publicSettings?.theme_settings ?? null))
  const visible = computed(() => appStore.privateFeaturesAllowed || settings.value.showForGuests)
  const pageVisible = computed(() => settings.value.showPage && visible.value)
  return { appStore, settings, visible, pageVisible }
}
