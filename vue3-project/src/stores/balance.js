import { ref } from 'vue'
import { defineStore } from 'pinia'
import { balanceApi } from '@/api/index.js'

export const useBalanceStore = defineStore('balance', () => {
  // 状态
  const enabled = ref(false)
  const exchangeRateIn = ref(1.0)
  const exchangeRateOut = ref(1.0)
  const externalBalance = ref(0)
  const localPoints = ref(0)
  const vipLevel = ref(0)
  const externalUsername = ref('')
  const isLoading = ref(false)
  const showBalanceModal = ref(false)

  // 获取余额中心配置
  const fetchConfig = async () => {
    try {
      const response = await balanceApi.getConfig()
      if (response.success) {
        enabled.value = response.data.enabled
        exchangeRateIn.value = response.data.exchangeRateIn
        exchangeRateOut.value = response.data.exchangeRateOut
      }
    } catch (error) {
      console.error('获取余额中心配置失败:', error)
    }
  }

  // 获取用户外部余额和本地石榴点
  const fetchUserBalance = async () => {
    if (!enabled.value) return null
    
    isLoading.value = true
    try {
      const response = await balanceApi.getUserBalance()
      if (response.success) {
        externalBalance.value = response.data.balance
        localPoints.value = response.data.localPoints || 0
        vipLevel.value = response.data.vip_level
        externalUsername.value = response.data.username
        return response.data
      }
      return null
    } catch (error) {
      console.error('获取用户余额失败:', error)
      return null
    } finally {
      isLoading.value = false
    }
  }

  // 兑入石榴点
  const exchangeIn = async (amount) => {
    if (!enabled.value) {
      return { success: false, message: '余额中心未启用' }
    }
    
    isLoading.value = true
    try {
      const response = await balanceApi.exchangeIn(amount)
      if (response.success) {
        externalBalance.value = response.data.newBalance
        localPoints.value = response.data.newLocalPoints
        return { 
          success: true, 
          data: response.data,
          message: response.message 
        }
      }
      return { success: false, message: response.message || '兑入失败' }
    } catch (error) {
      console.error('兑入石榴点失败:', error)
      return { success: false, message: error.message || '网络错误' }
    } finally {
      isLoading.value = false
    }
  }

  // 兑出石榴点
  const exchangeOut = async (amount) => {
    if (!enabled.value) {
      return { success: false, message: '余额中心未启用' }
    }
    
    isLoading.value = true
    try {
      const response = await balanceApi.exchangeOut(amount)
      if (response.success) {
        externalBalance.value = response.data.newBalance
        localPoints.value = response.data.newLocalPoints
        return { 
          success: true, 
          data: response.data,
          message: response.message 
        }
      }
      return { success: false, message: response.message || '兑出失败' }
    } catch (error) {
      console.error('兑出石榴点失败:', error)
      return { success: false, message: error.message || '网络错误' }
    } finally {
      isLoading.value = false
    }
  }

  // 打开余额中心模态框
  const openBalanceModal = () => {
    showBalanceModal.value = true
  }

  // 关闭余额中心模态框
  const closeBalanceModal = () => {
    showBalanceModal.value = false
  }

  return {
    // 状态
    enabled,
    exchangeRateIn,
    exchangeRateOut,
    externalBalance,
    localPoints,
    vipLevel,
    externalUsername,
    isLoading,
    showBalanceModal,
    
    // 方法
    fetchConfig,
    fetchUserBalance,
    exchangeIn,
    exchangeOut,
    openBalanceModal,
    closeBalanceModal
  }
})
