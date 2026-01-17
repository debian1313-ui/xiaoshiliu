<script setup>
import LoadingSpinner from '@/components/spinner/LoadingSpinner.vue';
import { ref, onMounted, onUnmounted } from 'vue'
import { useEventStore } from '@/stores/event'

const eventStore = useEventStore()
const isChannelLoading = ref(false)
let eventListenerKey = null

function handleFloatingBtnReload() {
  // 刷新按钮点击时也显示加载动画
  isChannelLoading.value = true
  eventStore.triggerFloatingBtnReload()
  setTimeout(() => {
    isChannelLoading.value = false
  }, 700)
}

onMounted(() => {
  // 监听刷新按钮事件
  eventListenerKey = eventStore.addEventListener('floating-btn-reload-request', handleFloatingBtnReload)
})

onUnmounted(() => {
  if (eventListenerKey) {
    eventStore.removeEventListener(eventListenerKey)
  }
})
</script>

<template>
  <div class="explore-container">
    <LoadingSpinner v-if="isChannelLoading" />
    <div class="explore-main" :class="{ 'with-loading': isChannelLoading }">
      <RouterView />
    </div>
  </div>
</template>

<style scoped>
.explore-container {
  padding-top: 72px;
  min-height: 100vh;
  background: var(--bg-color-primary);
  transition: background-color 0.2s ease;
}

.explore-main {
  padding: 0px 10px calc(48px + constant(safe-area-inset-bottom)) 10px;
  padding: 0px 10px calc(48px + env(safe-area-inset-bottom)) 10px;
  width: 100%;
  box-sizing: border-box;
  overflow-x: hidden;
  background: var(--bg-color-primary);
  transition: margin-top 0.3s ease, border-color 0.2s ease, background-color 0.2s ease;
}

.explore-main.with-loading {
  margin-top: 40px;
}
</style>