import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getUnreadNotificationCount, getUnreadNotificationCountByType } from '@/api/notification.js'
import { systemNotificationApi } from '@/api/index.js'

export const useNotificationStore = defineStore('notification', () => {
  // 未读通知数量
  const unreadCount = ref(0)

  // 按类型的未读通知数量
  const unreadCountByType = ref({
    system: 0,
    comments: 0,
    likes: 0,
    collections: 0,
    follows: 0
  })

  // 获取未读通知数量（同时获取系统消息未读数量）
  async function fetchUnreadCount() {
    try {
      // 同时获取普通通知数量和系统消息数量
      const [response, systemResponse] = await Promise.all([
        getUnreadNotificationCount(),
        systemNotificationApi.getPendingCount().catch(() => ({ code: 200, data: { count: 0 } }))
      ])
      
      unreadCount.value = response.count || 0
      
      // 更新系统消息未读数量
      if (systemResponse.code === 200) {
        unreadCountByType.value.system = systemResponse.data?.count || 0
      }
      
      return unreadCount.value
    } catch (error) {
      console.error('获取未读通知数量失败:', error)
      unreadCount.value = 0
      return 0
    }
  }

  // 获取系统消息未读数量
  async function fetchSystemUnreadCount() {
    try {
      const response = await systemNotificationApi.getPendingCount()
      if (response.code === 200) {
        unreadCountByType.value.system = response.data?.count || 0
      }
      return unreadCountByType.value.system
    } catch (error) {
      console.error('获取系统消息未读数量失败:', error)
      unreadCountByType.value.system = 0
      return 0
    }
  }

  // 获取按类型的未读通知数量
  async function fetchUnreadCountByType() {
    try {
      const response = await getUnreadNotificationCountByType()
      unreadCountByType.value = {
        system: unreadCountByType.value.system, // 保持系统消息数量
        comments: response.comments || 0,
        likes: response.likes || 0,
        collections: response.collections || 0,
        follows: response.follows || 0
      }
      // 同时更新总数
      unreadCount.value = response.total || 0
      return unreadCountByType.value
    } catch (error) {
      console.error('获取按类型的未读通知数量失败:', error)
      unreadCountByType.value = {
        system: unreadCountByType.value.system, // 保持系统消息数量
        comments: 0,
        likes: 0,
        collections: 0,
        follows: 0
      }
      return unreadCountByType.value
    }
  }

  // 获取所有类型的未读数量（包括系统消息）
  async function fetchAllUnreadCounts() {
    await Promise.all([
      fetchUnreadCountByType(),
      fetchSystemUnreadCount()
    ])
    return unreadCountByType.value
  }

  // 减少未读数量（当标记单个通知为已读时）
  function decrementUnreadCount() {
    if (unreadCount.value > 0) {
      unreadCount.value--
    }
  }

  // 减少特定类型的未读数量
  function decrementUnreadCountByType(type) {
    if (unreadCountByType.value[type] > 0) {
      unreadCountByType.value[type]--
    }
    // 同时减少总数（系统消息不计入总数）
    if (type !== 'system' && unreadCount.value > 0) {
      unreadCount.value--
    }
  }

  // 清空未读数量（当标记所有通知为已读时）
  function clearUnreadCount() {
    unreadCount.value = 0
    unreadCountByType.value = {
      system: unreadCountByType.value.system, // 保持系统消息数量
      comments: 0,
      likes: 0,
      collections: 0,
      follows: 0
    }
  }

  // 重置未读数量（用户登出时）
  function resetUnreadCount() {
    unreadCount.value = 0
    unreadCountByType.value = {
      system: 0,
      comments: 0,
      likes: 0,
      collections: 0,
      follows: 0
    }
  }

  return {
    unreadCount,
    unreadCountByType,
    fetchUnreadCount,
    fetchSystemUnreadCount,
    fetchUnreadCountByType,
    fetchAllUnreadCounts,
    decrementUnreadCount,
    decrementUnreadCountByType,
    clearUnreadCount,
    resetUnreadCount
  }
})