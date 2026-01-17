<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="visible && currentNotification" class="system-notification-overlay" @click.self="handleConfirm">
        <Transition name="scale">
          <div v-if="visible" class="system-notification-modal">
            <!-- 关闭按钮 -->
            <button class="close-btn" @click="handleConfirm" aria-label="关闭">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
            
            <!-- 通知类型标签 -->
            <div class="notification-type-badge" :class="currentNotification.type">
              {{ currentNotification.type === 'system' ? '系统消息' : '活动消息' }}
            </div>
            
            <!-- 图片区域 -->
            <div v-if="currentNotification.image_url" class="notification-image">
              <img :src="currentNotification.image_url" :alt="currentNotification.title" @error="handleImageError" />
            </div>
            
            <!-- 标题 -->
            <h2 class="notification-title">{{ currentNotification.title }}</h2>
            
            <!-- 内容 -->
            <div class="notification-content">{{ currentNotification.content }}</div>
            
            <!-- 链接按钮 -->
            <div class="notification-actions">
              <a 
                v-if="currentNotification.link_url" 
                :href="currentNotification.link_url" 
                target="_blank"
                class="action-btn link-btn"
                @click="handleLinkClick"
              >
                查看详情
              </a>
              <button class="action-btn confirm-btn" @click="handleConfirm">
                {{ hasMoreNotifications ? '下一条' : '我知道了' }}
              </button>
            </div>
            
            <!-- 进度指示器 -->
            <div v-if="totalNotifications > 1" class="notification-progress">
              <span>{{ currentIndex + 1 }} / {{ totalNotifications }}</span>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { systemNotificationApi } from '@/api/index.js'
import { useUserStore } from '@/stores/user'

const userStore = useUserStore()

// 初始化延迟时间（毫秒）
// 延迟获取通知是为了避免与用户登录后的其他初始化操作冲突
// 确保用户信息和token已完全加载后再获取系统通知
const INIT_FETCH_DELAY_MS = 500

const visible = ref(false)
const notifications = ref([])
const currentIndex = ref(0)
const isLoading = ref(false)

// 计算属性
const currentNotification = computed(() => {
  return notifications.value[currentIndex.value] || null
})

const totalNotifications = computed(() => notifications.value.length)

const hasMoreNotifications = computed(() => {
  return currentIndex.value < notifications.value.length - 1
})

// 获取未确认的系统通知
const fetchPendingNotifications = async () => {
  if (!userStore.isLoggedIn || isLoading.value) return
  
  isLoading.value = true
  try {
    const response = await systemNotificationApi.getPendingNotifications()
    if (response.code === 200 && response.data?.notifications?.length > 0) {
      notifications.value = response.data.notifications
      currentIndex.value = 0
      visible.value = true
    }
  } catch (error) {
    console.error('获取系统通知失败:', error)
  } finally {
    isLoading.value = false
  }
}

// 确认当前通知
const handleConfirm = async () => {
  if (!currentNotification.value) return
  
  // 移动到下一条通知或关闭弹窗的通用处理函数
  const moveToNextOrClose = () => {
    if (hasMoreNotifications.value) {
      currentIndex.value++
    } else {
      visible.value = false
      notifications.value = []
      currentIndex.value = 0
    }
  }
  
  try {
    // 调用确认API
    await systemNotificationApi.confirmNotification(currentNotification.value.id)
    moveToNextOrClose()
  } catch (error) {
    console.error('确认通知失败:', error)
    // 即使API失败也继续，确保用户体验不受影响
    moveToNextOrClose()
  }
}

// 点击链接时的处理
const handleLinkClick = () => {
  // 不关闭弹窗，让用户可以继续查看
}

// 图片加载错误处理
const handleImageError = (event) => {
  event.target.style.display = 'none'
}

// 监听登录状态变化
watch(() => userStore.isLoggedIn, (newValue, oldValue) => {
  // 只在从未登录变为已登录时获取通知
  if (newValue && !oldValue) {
    setTimeout(() => {
      fetchPendingNotifications()
    }, INIT_FETCH_DELAY_MS)
  } else if (!newValue) {
    visible.value = false
    notifications.value = []
  }
})

// 组件挂载时获取通知
onMounted(() => {
  if (userStore.isLoggedIn) {
    setTimeout(() => {
      fetchPendingNotifications()
    }, INIT_FETCH_DELAY_MS)
  }
})

// 暴露方法供外部调用
defineExpose({
  fetchPendingNotifications
})
</script>

<style scoped>
.system-notification-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  padding: 20px;
}

.system-notification-modal {
  position: relative;
  background: var(--bg-color-primary);
  border-radius: 16px;
  max-width: 480px;
  width: 100%;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  padding: 24px;
}

.close-btn {
  position: absolute;
  top: 16px;
  right: 16px;
  background: var(--bg-color-secondary);
  border: none;
  border-radius: 50%;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--text-color-secondary);
  transition: all 0.2s ease;
  z-index: 1;
}

.close-btn:hover {
  background: var(--bg-color-tertiary);
  color: var(--text-color-primary);
}

.notification-type-badge {
  display: inline-block;
  padding: 4px 12px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 16px;
}

.notification-type-badge.system {
  background: #e3f2fd;
  color: #1976d2;
}

.notification-type-badge.activity {
  background: #fff3e0;
  color: #f57c00;
}

[data-theme="dark"] .notification-type-badge.system {
  background: rgba(33, 150, 243, 0.2);
  color: #64b5f6;
}

[data-theme="dark"] .notification-type-badge.activity {
  background: rgba(255, 152, 0, 0.2);
  color: #ffb74d;
}

.notification-image {
  width: 100%;
  border-radius: 12px;
  overflow: hidden;
  margin-bottom: 16px;
}

.notification-image img {
  width: 100%;
  height: auto;
  display: block;
  object-fit: cover;
  max-height: 300px;
}

.notification-title {
  font-size: 20px;
  font-weight: 600;
  color: var(--text-color-primary);
  margin: 0 0 12px 0;
  line-height: 1.4;
}

.notification-content {
  font-size: 15px;
  color: var(--text-color-secondary);
  line-height: 1.6;
  margin-bottom: 24px;
  white-space: pre-wrap;
  word-break: break-word;
}

.notification-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
}

.action-btn {
  padding: 10px 24px;
  border-radius: 24px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.link-btn {
  background: var(--bg-color-secondary);
  color: var(--text-color-primary);
  border: 1px solid var(--border-color-primary);
}

.link-btn:hover {
  background: var(--bg-color-tertiary);
}

.confirm-btn {
  background: var(--primary-color);
  color: white;
  border: none;
}

.confirm-btn:hover {
  opacity: 0.9;
}

.notification-progress {
  text-align: center;
  margin-top: 16px;
  font-size: 12px;
  color: var(--text-color-tertiary);
}

/* 动画 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.scale-enter-active,
.scale-leave-active {
  transition: all 0.3s ease;
}

.scale-enter-from,
.scale-leave-to {
  opacity: 0;
  transform: scale(0.9);
}

/* 响应式 */
@media (max-width: 600px) {
  .system-notification-overlay {
    padding: 16px;
  }
  
  .system-notification-modal {
    padding: 20px;
    border-radius: 12px;
  }
  
  .notification-title {
    font-size: 18px;
  }
  
  .notification-content {
    font-size: 14px;
  }
  
  .notification-actions {
    flex-direction: column;
  }
  
  .action-btn {
    width: 100%;
  }
}
</style>
