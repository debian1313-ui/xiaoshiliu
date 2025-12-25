<template>
  <div v-if="visible" class="modal-overlay" v-click-outside.mousedown="handleClose" v-escape-key="handleClose">
    <div class="modal" @mousedown.stop>
      <div class="modal-header">
        <h4>余额中心</h4>
        <button @click="handleClose" class="close-btn">
          <SvgIcon name="close" width="20" height="20" />
        </button>
      </div>
      
      <div class="modal-body">
        <!-- 余额显示 -->
        <div class="balance-cards">
          <div class="balance-card external">
            <div class="balance-info">
              <div class="balance-label">余额</div>
              <div class="balance-value">
                <span v-if="balanceStore.isLoading" class="loading">加载中...</span>
                <span v-else class="amount">{{ balanceStore.externalBalance.toFixed(2) }}</span>
              </div>
            </div>
            <div v-if="balanceStore.vipLevel > 0" class="vip-badge">
              VIP {{ balanceStore.vipLevel }}
            </div>
          </div>
          
          <div class="balance-card local">
            <div class="balance-info">
              <div class="balance-label">石榴点</div>
              <div class="balance-value">
                <span v-if="balanceStore.isLoading" class="loading">加载中...</span>
                <span v-else class="amount">{{ balanceStore.localPoints.toFixed(2) }}</span>
              </div>
            </div>
            <div class="points-icon">🍒</div>
          </div>
        </div>

        <!-- 兑换比例说明 -->
        <div class="rate-info">
          <div class="rate-item">
            <span class="rate-label">兑入比例</span>
            <span class="rate-value">1 余额 = {{ balanceStore.exchangeRateIn }} 石榴点</span>
          </div>
          <div class="rate-item">
            <span class="rate-label">兑出比例</span>
            <span class="rate-value">1 石榴点 = {{ balanceStore.exchangeRateOut }} 余额</span>
          </div>
        </div>

        <!-- 兑换操作 -->
        <div class="exchange-section">
          <div class="tabs">
            <button 
              class="tab-btn" 
              :class="{ active: activeTab === 'in' }" 
              @click="activeTab = 'in'"
            >
              兑入
            </button>
            <button 
              class="tab-btn" 
              :class="{ active: activeTab === 'out' }" 
              @click="activeTab = 'out'"
            >
              兑出
            </button>
          </div>

          <div class="exchange-form">
            <div class="form-group">
              <label>{{ activeTab === 'in' ? '兑入金额' : '兑出石榴点' }}</label>
              <input 
                v-model="exchangeAmount" 
                type="number" 
                min="0" 
                step="0.01"
                :placeholder="activeTab === 'in' ? '请输入要转入的余额' : '请输入要转出的石榴点'"
              />
            </div>
            
            <div v-if="exchangeAmount > 0" class="exchange-preview">
              <span v-if="activeTab === 'in'">
                将获得 <strong>{{ (exchangeAmount * balanceStore.exchangeRateIn).toFixed(2) }}</strong> 石榴点
              </span>
              <span v-else>
                将获得 <strong>{{ (exchangeAmount * balanceStore.exchangeRateOut).toFixed(2) }}</strong> 余额
              </span>
            </div>

            <button 
              class="submit-btn" 
              :disabled="!exchangeAmount || exchangeAmount <= 0 || balanceStore.isLoading"
              @click="handleExchange"
            >
              {{ balanceStore.isLoading ? '处理中...' : (activeTab === 'in' ? '确认兑入' : '确认兑出') }}
            </button>
          </div>
        </div>

        <!-- 提示信息 -->
        <div v-if="message" class="message" :class="messageType">
          {{ message }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue'
import SvgIcon from '@/components/SvgIcon.vue'
import { useBalanceStore } from '@/stores/balance.js'
import { useScrollLock } from '@/composables/useScrollLock'

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:visible', 'close'])

const balanceStore = useBalanceStore()
const { lock, unlock } = useScrollLock()

const activeTab = ref('in')
const exchangeAmount = ref('')
const message = ref('')
const messageType = ref('info')

// 监听visible变化
watch(() => props.visible, (newValue) => {
  if (newValue) {
    lock()
    // 获取最新余额
    balanceStore.fetchUserBalance()
    // 重置表单
    exchangeAmount.value = ''
    message.value = ''
  } else {
    unlock()
  }
})

const handleClose = () => {
  emit('update:visible', false)
  emit('close')
}

const handleExchange = async () => {
  if (!exchangeAmount.value || exchangeAmount.value <= 0) {
    return
  }

  const amount = parseFloat(exchangeAmount.value)
  let result

  if (activeTab.value === 'in') {
    result = await balanceStore.exchangeIn(amount)
  } else {
    result = await balanceStore.exchangeOut(amount)
  }

  if (result.success) {
    message.value = result.message || '操作成功'
    messageType.value = 'success'
    exchangeAmount.value = ''
  } else {
    message.value = result.message || '操作失败'
    messageType.value = 'error'
  }

  // 3秒后清除消息
  setTimeout(() => {
    message.value = ''
  }, 3000)
}

onMounted(() => {
  balanceStore.fetchConfig()
})
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: var(--overlay-bg);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 2000;
}

.modal {
  background: var(--bg-color-primary);
  border-radius: 12px;
  width: 90%;
  max-width: 400px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color-primary);
}

.modal-header h4 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--text-color-primary);
}

.close-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px;
  color: var(--text-color-secondary);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.close-btn:hover {
  background: var(--bg-color-secondary);
  color: var(--text-color-primary);
}

.modal-body {
  padding: 20px;
  overflow-y: auto;
}

/* 余额卡片容器 */
.balance-cards {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
}

/* 余额卡片 */
.balance-card {
  flex: 1;
  border-radius: 12px;
  padding: 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.balance-card.external {
  background: linear-gradient(135deg, var(--primary-color) 0%, var(--primary-color-dark) 100%);
}

.balance-card.local {
  background: linear-gradient(135deg, #ff6b6b 0%, #ee5a5a 100%);
}

.balance-info {
  color: white;
}

.balance-label {
  font-size: 12px;
  opacity: 0.9;
  margin-bottom: 4px;
}

.balance-value {
  font-size: 22px;
  font-weight: 700;
}

.balance-value .loading {
  font-size: 14px;
  opacity: 0.8;
}

.points-icon {
  font-size: 24px;
}

.vip-badge {
  background: rgba(255, 255, 255, 0.2);
  color: white;
  padding: 4px 12px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 600;
}

/* 比例信息 */
.rate-info {
  background: var(--bg-color-secondary);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 16px;
}

.rate-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
}

.rate-item:not(:last-child) {
  border-bottom: 1px solid var(--border-color-primary);
  padding-bottom: 8px;
  margin-bottom: 8px;
}

.rate-label {
  font-size: 13px;
  color: var(--text-color-secondary);
}

.rate-value {
  font-size: 13px;
  color: var(--text-color-primary);
}

/* 兑换区域 */
.exchange-section {
  margin-bottom: 16px;
}

.tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}

.tab-btn {
  flex: 1;
  padding: 10px 16px;
  border: 1px solid var(--border-color-primary);
  border-radius: 8px;
  background: var(--bg-color-primary);
  color: var(--text-color-secondary);
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.tab-btn:hover {
  border-color: var(--primary-color);
  color: var(--primary-color);
}

.tab-btn.active {
  background: var(--primary-color);
  border-color: var(--primary-color);
  color: white;
}

.exchange-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.form-group label {
  display: block;
  font-size: 14px;
  color: var(--text-color-primary);
  margin-bottom: 6px;
}

.form-group input {
  width: 100%;
  padding: 12px;
  border: 1px solid var(--border-color-primary);
  border-radius: 8px;
  font-size: 14px;
  background: var(--bg-color-primary);
  color: var(--text-color-primary);
  box-sizing: border-box;
  transition: border-color 0.2s ease;
}

.form-group input:focus {
  outline: none;
  border-color: var(--primary-color);
}

.exchange-preview {
  font-size: 13px;
  color: var(--text-color-secondary);
  padding: 8px;
  background: var(--bg-color-secondary);
  border-radius: 6px;
}

.exchange-preview strong {
  color: var(--primary-color);
}

.submit-btn {
  padding: 12px 20px;
  background: var(--primary-color);
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.submit-btn:hover:not(:disabled) {
  background: var(--primary-color-dark);
}

.submit-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 消息提示 */
.message {
  padding: 12px;
  border-radius: 8px;
  font-size: 14px;
  text-align: center;
}

.message.success {
  background: rgba(52, 199, 89, 0.1);
  color: #34c759;
}

.message.error {
  background: rgba(255, 59, 48, 0.1);
  color: #ff3b30;
}

.message.info {
  background: var(--bg-color-secondary);
  color: var(--text-color-secondary);
}
</style>
