<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Icon } from '@iconify/vue'
import { Button } from '@/components/ui/button'
import { loadTurnstileScript } from '@/cfsm/turnstile'
import { verifyTurnstile } from '@/cfsm/session'

const props = defineProps<{ siteKey: string }>()
const emit = defineEmits<{ verified: [] }>()

const container = ref<HTMLElement>()
const failed = ref(false)
const verifying = ref(false)
const errorText = ref('')
let widgetId = ''

async function mountWidget(): Promise<void> {
  if (!props.siteKey) {
    failed.value = true
    return
  }
  try {
    await loadTurnstileScript()
    await new Promise(resolve => window.setTimeout(resolve, 0))
    if (!window.turnstile || !container.value)
      throw new Error('Turnstile 不可用')
    widgetId = window.turnstile.render(container.value, {
      sitekey: props.siteKey,
      theme: 'auto',
      language: 'zh-CN',
      callback: (token: string) => { void submit(token) },
      'error-callback': () => { errorText.value = '人机验证加载失败，请检查网络后重试。' },
      'expired-callback': () => { errorText.value = '验证已过期，请重新完成验证。' },
    })
  }
  catch {
    failed.value = true
  }
}

async function submit(token: string): Promise<void> {
  if (verifying.value)
    return
  verifying.value = true
  errorText.value = ''
  try {
    await verifyTurnstile(token)
    emit('verified')
  }
  catch (error) {
    errorText.value = error instanceof Error ? error.message : '验证失败，请重试。'
    if (widgetId && window.turnstile)
      window.turnstile.reset(widgetId)
  }
  finally {
    verifying.value = false
  }
}

function retry(): void {
  failed.value = false
  errorText.value = ''
  void mountWidget()
}

onMounted(() => { void mountWidget() })
watch(() => props.siteKey, () => { failed.value = false; void mountWidget() })
onBeforeUnmount(() => {
  if (widgetId && window.turnstile) {
    try {
      window.turnstile.remove(widgetId)
    }
    catch {
      // 忽略
    }
  }
})
</script>

<template>
  <div class="turnstile-gate" role="dialog" aria-modal="true" aria-labelledby="turnstile-title">
    <div class="turnstile-card">
      <div class="turnstile-head">
        <Icon icon="tabler:shield-lock" width="22" height="22" />
        <h2 id="turnstile-title">安全验证</h2>
      </div>
      <p>本站启用了人机验证，完成一次验证后本浏览器将保留凭证一小时。</p>
      <div ref="container" class="turnstile-widget" />
      <p v-if="failed" class="turnstile-error" role="alert">
        验证组件加载失败，可能是网络或内容拦截器导致。
        <Button variant="outline" size="sm" @click="retry">重试</Button>
      </p>
      <p v-if="errorText" class="turnstile-error" role="alert">{{ errorText }}</p>
      <p v-if="verifying" class="turnstile-status" role="status">正在验证…</p>
    </div>
  </div>
</template>

<style scoped>
.turnstile-gate{position:fixed;inset:0;z-index:80;display:grid;place-items:center;padding:24px;background:color-mix(in srgb,var(--background,#0b1220) 55%,transparent);backdrop-filter:blur(12px)}
.turnstile-card{width:min(420px,100%);padding:26px;border-radius:18px;border:1px solid color-mix(in srgb,currentColor 12%,transparent);background:var(--background,#fff);color:var(--foreground,#111);box-shadow:0 24px 60px color-mix(in srgb,#000 28%,transparent)}
.turnstile-head{display:flex;align-items:center;gap:10px;margin-bottom:10px}
.turnstile-head h2{font-size:17px;font-weight:650}
.turnstile-card p{font-size:13px;line-height:1.7;opacity:.78}
.turnstile-widget{display:flex;justify-content:center;margin:18px 0}
.turnstile-error{display:flex;align-items:center;gap:8px;color:#dc2626;margin-top:10px}
.turnstile-status{opacity:.7}
</style>
