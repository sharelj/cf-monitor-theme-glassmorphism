<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/sonner'
import TurnstileGate from '@/components/TurnstileGate.vue'
import { useSafeAreaZoom } from '@/composables/useSafeAreaZoom'
import { useSiteIcon } from '@/composables/useSiteIcon'
import { useAppStore } from '@/stores/app'
import { destroyInitManager, initApp, refreshSiteConfig, retryInitApp } from '@/utils/init'
import { continueRealtime, retryConnection, stopRealtimeByUser, wsTimeoutPrompt } from '@/cfsm/data'
import { configLoaded, turnstileGate } from '@/cfsm/session'
import Background from './components/Background.vue'
import Footer from './components/Footer.vue'
import Header from './components/Header.vue'
import LoadingCover from './components/LoadingCover.vue'
import Provider from './components/Provider.vue'

const appStore = useAppStore()
useSafeAreaZoom()
useSiteIcon()

const isReady = ref(false)
const isRetryingConnection = ref(false)
const readyToRender = computed(() => isReady.value && configLoaded.value)

async function retryConnectionAction(): Promise<void> {
  if (isRetryingConnection.value)
    return

  isRetryingConnection.value = true
  try {
    const recovered = await retryInitApp()
    if (recovered)
      window.$message?.success('连接已恢复。')
    else
      window.$message?.error('仍无法连接服务器，请稍后再试。')
  }
  catch (error) {
    console.error('[App] Connection retry failed:', error)
    window.$message?.error('重试失败，请稍后再试。')
  }
  finally {
    isRetryingConnection.value = false
  }
}

async function retryData(): Promise<void> {
  if (isRetryingConnection.value)
    return
  isRetryingConnection.value = true
  try {
    const ok = await retryConnection()
    if (!ok)
      window.$message?.error('仍未连上实时通道，请稍后再试。')
  }
  finally {
    isRetryingConnection.value = false
  }
}

watch(configLoaded, (loaded) => {
  if (loaded) {
    refreshSiteConfig()
    isReady.value = true
  }
})

function onTurnstileVerified(): void {
  refreshSiteConfig()
  isReady.value = true
}

onMounted(async () => {
  try {
    await initApp()
    if (configLoaded.value)
      isReady.value = true
  }
  catch (error) {
    console.error('[App] Initialization failed:', error)
    isReady.value = true
  }
})

onUnmounted(() => {
  destroyInitManager()
})
</script>

<template>
  <Provider>
    <Background />
    <TurnstileGate v-if="turnstileGate" :site-key="turnstileGate.siteKey" @verified="onTurnstileVerified" />
    <Transition
      :css="!appStore.disablePageAnimation"
      enter-active-class="transition-opacity duration-200 ease-out" enter-from-class="opacity-0"
      enter-to-class="opacity-100" leave-active-class="transition-opacity duration-300 ease-in"
      leave-from-class="opacity-100" leave-to-class="opacity-0"
    >
      <LoadingCover v-if="appStore.loading" />
    </Transition>
    <Header />
    <Transition
      :css="!appStore.disablePageAnimation"
      enter-active-class="transition-all duration-300 ease-out"
      enter-from-class="opacity-0 translate-y-2"
      enter-to-class="opacity-100 translate-y-0"
    >
      <div v-if="!appStore.loading && readyToRender" class="app-shell">
        <main class="app-main overflow-hidden">
          <div v-if="appStore.connectionError" class="relative z-10 mx-auto max-w-[1280px] px-4 pt-4">
            <Alert variant="destructive" class="!pr-28 border-none bg-destructive/10 backdrop-blur-xs rounded-md">
              <Icon icon="tabler:plug-connected-x" />
              <AlertTitle>实时连接中断</AlertTitle>
              <AlertDescription>无法连接服务器，数据可能不是最新。</AlertDescription>
              <AlertAction class="top-1/2 -translate-y-1/2">
                <Button size="sm" variant="outline" :disabled="isRetryingConnection" @click="retryData">
                  <Icon :icon="isRetryingConnection ? 'tabler:loader-2' : 'tabler:refresh'" :class="isRetryingConnection && 'animate-spin'" />
                  {{ isRetryingConnection ? '重试中' : '重试' }}
                </Button>
              </AlertAction>
            </Alert>
          </div>
          <div class="max-w-[1280px] mx-auto">
            <RouterView v-slot="{ Component }">
              <Transition
                :css="!appStore.disablePageAnimation"
                enter-active-class="transition-all duration-300 ease-out"
                enter-from-class="opacity-0 translate-y-2" enter-to-class="opacity-100 translate-y-0"
                leave-active-class="transition-opacity duration-150 ease-in" leave-from-class="opacity-100"
                leave-to-class="opacity-0"
                :mode="appStore.disablePageAnimation ? 'default' : 'out-in'"
              >
                <KeepAlive :include="['HomeView']">
                  <component :is="Component" />
                </KeepAlive>
              </Transition>
            </RouterView>
          </div>
        </main>
        <Footer />
      </div>
    </Transition>
    <div v-if="!appStore.loading && !configLoaded && !turnstileGate && appStore.connectionError" class="relative z-10 mx-auto max-w-[1280px] px-4 pt-6">
      <Alert variant="destructive" class="border-none bg-destructive/10 backdrop-blur-xs rounded-md">
        <Icon icon="tabler:plug-connected-x" />
        <AlertTitle>无法加载站点配置</AlertTitle>
        <AlertDescription>请检查网络或 API 地址（apiBase）配置后重试。</AlertDescription>
        <AlertAction class="top-1/2 -translate-y-1/2">
          <Button size="sm" variant="outline" :disabled="isRetryingConnection" @click="retryConnectionAction">重试</Button>
        </AlertAction>
      </Alert>
    </div>

    <!-- 实时连接达到 frontend_ws_timeout_minutes：主动断开并由用户决定是否继续 -->
    <div v-if="wsTimeoutPrompt" class="ws-timeout" role="dialog" aria-modal="true" aria-labelledby="ws-timeout-title">
      <div class="ws-timeout-card">
        <h2 id="ws-timeout-title">实时连接已达到时间上限</h2>
        <p>为避免长时间占用连接，本次实时推送已暂停。是否继续接收实时更新？</p>
        <div class="ws-timeout-actions">
          <Button @click="continueRealtime">继续实时更新</Button>
          <Button variant="outline" @click="stopRealtimeByUser">停止更新</Button>
        </div>
      </div>
    </div>

    <Toaster rich-colors close-button position="top-center" />
  </Provider>
</template>

<style scoped>
.ws-timeout{position:fixed;inset:0;z-index:70;display:grid;place-items:center;padding:24px;background:color-mix(in srgb,var(--background) 45%,transparent);backdrop-filter:blur(10px)}
.ws-timeout-card{width:min(420px,100%);padding:24px;border-radius:16px;border:1px solid color-mix(in srgb,currentColor 12%,transparent);background:var(--background);color:var(--foreground);box-shadow:0 20px 50px color-mix(in srgb,#000 25%,transparent)}
.ws-timeout-card h2{font-size:16px;font-weight:650;margin-bottom:8px}
.ws-timeout-card p{font-size:13px;line-height:1.7;opacity:.78}
.ws-timeout-actions{display:flex;gap:8px;margin-top:16px}
</style>
