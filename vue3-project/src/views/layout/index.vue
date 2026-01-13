<template>
  <div class="layout-container">
    <Sidebar v-if="showSidebar" />
    <div class="main-content" :class="{ 'with-sidebar': showSidebar }">
      <LayoutHeader />
      <div class="content-wrapper" :class="{ 'no-footer-padding': isPostDetailPage }">
        <router-view />
      </div>
      <LayoutFooter v-if="!showSidebar && !isPostDetailPage" />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import Sidebar from './components/Sidebar.vue'
import LayoutHeader from './components/LayoutHeader.vue'
import LayoutFooter from './components/LayoutFooter.vue'

const route = useRoute()

// Check if current route is post detail page
const isPostDetailPage = computed(() => route.name === 'post_detail')

const showSidebar = ref(window.innerWidth > 960)
const handleResize = () => {
  showSidebar.value = window.innerWidth > 960
}
onMounted(() => {
  window.addEventListener('resize', handleResize)
})
onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
})
</script>

<style scoped>
.layout-container {
  display: flex;
  min-height: 100vh;
  background-color: var(--bg-color-primary);
  min-width: 320px;
  margin: 0;
  width: 100%;
  overflow-x: hidden;
  position: relative;
  box-sizing: border-box;
  transition: background-color 0.2s ease;

}

.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 100vh;
  transition: margin-left 0.3s;
  width: 100%;
  overflow-x: hidden;
}

/* 大屏模式下主内容区域留出侧边栏空间 */
.main-content.with-sidebar {
  margin-left: 228px;
  width: calc(100% - 228px);
}

.content-wrapper {
  flex: 1;
  margin: 0 auto;
  width: 100%;
  max-width: 1200px;
  padding: 0;
  box-sizing: border-box;
  padding-bottom: 48px;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  background-color: var(--bg-color-primary);
  transition: background-color 0.2s ease;
}

@media (max-width: 960px) {
  .main-content {
    margin-left: 0;
  }

  .content-wrapper {
    padding-bottom: 48px;
  }
}

@media (max-width: 768px) {
  .content-wrapper {
    padding-bottom: 48px;
  }
}

@media (max-width: 480px) {
  .content-wrapper {
    padding-bottom: 48px;
  }
}

@media (min-width: 961px) {
  .content-wrapper {
    padding-bottom: 0;
  }
}

/* Remove padding when footer is hidden (e.g., on post detail page) */
.content-wrapper.no-footer-padding {
  padding-bottom: 0;
}
</style>