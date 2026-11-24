<script setup lang="ts">
import { computed } from 'vue'
import { DataTooltip } from '@/components/ui/data-tooltip'
import { getPrimarySite } from '@/cfsm/session'

const buildVersion = __BUILD_VERSION__
const buildGitHash = __BUILD_GIT_HASH__

const serverVersion = computed(() => String(getPrimarySite()?.config.version ?? ''))

const versionTitle = computed(() => serverVersion.value ? `CF-Server-Monitor v${serverVersion.value.replace(/^v/, '')}` : 'CF-Server-Monitor')
</script>

<template>
  <footer data-app-footer class="app-footer w-full max-w-[1280px] mx-auto p-4">
    <div class="flex w-full flex-row justify-between gap-4 text-xs text-muted-foreground">
      <div class="flex gap-1 items-center">
        Powered by
        <DataTooltip as="span" placement="top" :content="versionTitle">
          <a
            href="https://github.com/huilang-me/CF-Server-Monitor/" target="_blank" rel="noopener noreferrer" :title="versionTitle"
            class="transition-opacity hover:opacity-80"
          >
            <span class="font-medium text-foreground">CF Server Monitor</span>
          </a>
        </DataTooltip>
      </div>
      <div class="flex flex-wrap gap-1 items-center justify-end text-right">
        Theme by
        <DataTooltip
          as="span"
          placement="top"
          :content="`v${buildVersion}\n${buildGitHash}`"
        >
          <a
            href="https://github.com/Gongsc/Theme-Glassmorphism" target="_blank" rel="noopener noreferrer"
            class="transition-opacity hover:opacity-80"
          >
            <span class="font-medium text-foreground">Glassmorphism</span>
          </a>
        </DataTooltip>
      </div>
    </div>
  </footer>
</template>

<style scoped>
.app-footer {
  padding-right: max(1rem, env(safe-area-inset-right, 0px));
  padding-right: max(1rem, var(--komari-safe-area-right, env(safe-area-inset-right, 0px)));
  padding-bottom: calc(1rem + env(safe-area-inset-bottom, 0px));
  padding-bottom: calc(1rem + var(--komari-safe-area-bottom, env(safe-area-inset-bottom, 0px)));
  padding-left: max(1rem, env(safe-area-inset-left, 0px));
  padding-left: max(1rem, var(--komari-safe-area-left, env(safe-area-inset-left, 0px)));
}
</style>
