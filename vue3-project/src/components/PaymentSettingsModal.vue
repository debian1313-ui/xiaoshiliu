<template>
  <div v-if="visible" class="modal-overlay" v-click-outside.mousedown="handleClose" v-escape-key="handleClose">
    <div class="modal" @mousedown.stop>
      <div class="modal-header">
        <h4>付费设置</h4>
        <button @click="handleClose" class="close-btn">
          <SvgIcon name="close" width="20" height="20" />
        </button>
      </div>
      
      <div class="modal-body">
        <!-- 付费开关 -->
        <div class="setting-item">
          <div class="setting-label">
            <span class="label-text">开启付费</span>
            <span class="label-hint">开启后，用户需要支付石榴点才能查看完整内容</span>
          </div>
          <div class="toggle-switch" :class="{ active: localSettings.enabled }" @click="toggleEnabled">
            <div class="toggle-slider"></div>
          </div>
        </div>

        <template v-if="localSettings.enabled">
          <!-- 付费类型选择 -->
          <div class="setting-item">
            <div class="setting-label">
              <span class="label-text">付费类型</span>
            </div>
            <div class="payment-type-options">
              <button 
                type="button"
                class="type-option" 
                :class="{ active: localSettings.paymentType === 'single' }"
                @click="localSettings.paymentType = 'single'"
              >
                <SvgIcon name="post" width="20" height="20" />
                <span>单篇付费</span>
              </button>
              <button 
                type="button"
                class="type-option" 
                :class="{ active: localSettings.paymentType === 'multi' }"
                @click="localSettings.paymentType = 'multi'"
              >
                <SvgIcon name="image" width="20" height="20" />
                <span>多篇付费</span>
              </button>
            </div>
          </div>

          <!-- 价格设置 -->
          <div class="setting-item">
            <div class="setting-label">
              <span class="label-text">价格（石榴点）</span>
              <span class="label-hint">用户需要支付的石榴点数量</span>
            </div>
            <div class="price-input-wrapper">
              <input 
                type="number" 
                v-model.number="localSettings.price" 
                min="1" 
                step="1"
                class="price-input"
                placeholder="请输入价格"
              />
              <span class="price-unit">🍒 石榴点</span>
            </div>
          </div>

          <!-- 免费预览设置 -->
          <div class="setting-item" v-if="mediaCount > 0">
            <div class="setting-label">
              <span class="label-text">免费预览</span>
              <span class="label-hint" v-if="mediaType === 'image'">
                点击上传区域的图片切换免费/付费状态，当前 {{ freeImagesCount }} 张免费，{{ paidImagesCount }} 张付费
              </span>
              <span class="label-hint" v-else>用户可以免费查看的视频数量</span>
            </div>
            <div class="free-preview-wrapper" v-if="mediaType !== 'image'">
              <input 
                type="number" 
                v-model.number="localSettings.freePreviewCount" 
                min="0" 
                :max="mediaCount"
                step="1"
                class="free-preview-input"
              />
              <span class="free-preview-hint">/ {{ mediaCount }} 个</span>
            </div>
            <div v-else class="free-preview-info">
              <span class="free-count">👁 {{ freeImagesCount }} 张免费</span>
              <span class="paid-count">🔒 {{ paidImagesCount }} 张付费</span>
            </div>
          </div>

          <!-- 付费说明 -->
          <div class="payment-note">
            <SvgIcon name="info" width="16" height="16" />
            <span>
              <template v-if="localSettings.paymentType === 'single'">
                用户支付 {{ localSettings.price || 0 }} 石榴点后可永久查看本篇内容
              </template>
              <template v-else>
                用户支付 {{ localSettings.price || 0 }} 石榴点后可查看您的所有付费内容
              </template>
            </span>
          </div>

          <!-- 验证错误提示 -->
          <div v-if="validationError" class="validation-error">
            <SvgIcon name="warning" width="16" height="16" />
            <span>{{ validationError }}</span>
          </div>
        </template>
      </div>

      <div class="modal-footer">
        <button class="cancel-btn" @click="handleClose">取消</button>
        <button class="confirm-btn" @click="handleConfirm">确认</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, watch, computed } from 'vue'
import SvgIcon from '@/components/SvgIcon.vue'
import { useScrollLock } from '@/composables/useScrollLock'

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  modelValue: {
    type: Object,
    default: () => ({
      enabled: false,
      paymentType: 'single',
      price: 0,
      freePreviewCount: 0
    })
  },
  mediaCount: {
    type: Number,
    default: 0
  },
  mediaType: {
    type: String,
    default: 'image' // 'image' or 'video'
  },
  freeImagesCount: {
    type: Number,
    default: 0
  },
  paidImagesCount: {
    type: Number,
    default: 0
  }
})

const emit = defineEmits(['update:visible', 'update:modelValue', 'close', 'confirm'])

const { lock, unlock } = useScrollLock()

// 本地设置副本
const localSettings = reactive({
  enabled: false,
  paymentType: 'single',
  price: 0,
  freePreviewCount: 0
})

// 监听visible变化
watch(() => props.visible, (newValue) => {
  if (newValue) {
    lock()
    // 复制props中的设置到本地
    Object.assign(localSettings, props.modelValue)
  } else {
    unlock()
  }
})

// 监听modelValue变化
watch(() => props.modelValue, (newValue) => {
  if (newValue && !props.visible) {
    Object.assign(localSettings, newValue)
  }
}, { deep: true })

// 验证错误信息
const validationError = ref('')

const toggleEnabled = () => {
  localSettings.enabled = !localSettings.enabled
  validationError.value = ''
  if (localSettings.enabled && localSettings.price === 0) {
    localSettings.price = 10 // 默认价格
  }
}

const handleClose = () => {
  validationError.value = ''
  emit('update:visible', false)
  emit('close')
}

const handleConfirm = () => {
  // 验证价格
  if (localSettings.enabled && (!localSettings.price || localSettings.price <= 0)) {
    validationError.value = '请设置有效的价格（必须大于0）'
    return
  }
  
  // 确保免费预览数不超过总数
  if (localSettings.freePreviewCount > props.mediaCount) {
    localSettings.freePreviewCount = props.mediaCount
  }
  
  validationError.value = ''
  emit('update:modelValue', { ...localSettings })
  emit('confirm', { ...localSettings })
  handleClose()
}
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
  max-width: 420px;
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

.setting-item {
  margin-bottom: 20px;
}

.setting-label {
  display: flex;
  flex-direction: column;
  margin-bottom: 8px;
}

.label-text {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-color-primary);
}

.label-hint {
  font-size: 12px;
  color: var(--text-color-tertiary);
  margin-top: 4px;
}

/* Toggle Switch */
.toggle-switch {
  width: 48px;
  height: 26px;
  background: var(--bg-color-tertiary);
  border-radius: 13px;
  cursor: pointer;
  transition: background 0.2s ease;
  position: relative;
}

.toggle-switch.active {
  background: var(--primary-color);
}

.toggle-slider {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 20px;
  height: 20px;
  background: white;
  border-radius: 50%;
  transition: transform 0.2s ease;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.toggle-switch.active .toggle-slider {
  transform: translateX(22px);
}

/* Payment Type Options */
.payment-type-options {
  display: flex;
  gap: 12px;
}

.type-option {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 16px;
  border: 2px solid var(--border-color-primary);
  border-radius: 12px;
  background: var(--bg-color-primary);
  cursor: pointer;
  transition: all 0.2s ease;
  color: var(--text-color-secondary);
}

.type-option:hover {
  border-color: var(--primary-color);
  color: var(--primary-color);
}

.type-option.active {
  border-color: var(--primary-color);
  background: rgba(var(--primary-color-rgb), 0.05);
  color: var(--primary-color);
}

.type-option span {
  font-size: 14px;
  font-weight: 500;
}

/* Price Input */
.price-input-wrapper {
  display: flex;
  align-items: center;
  gap: 8px;
}

.price-input {
  width: 120px;
  padding: 10px 12px;
  border: 1px solid var(--border-color-primary);
  border-radius: 8px;
  font-size: 14px;
  background: var(--bg-color-primary);
  color: var(--text-color-primary);
  transition: border-color 0.2s ease;
}

.price-input:focus {
  outline: none;
  border-color: var(--primary-color);
}

.price-unit {
  font-size: 14px;
  color: var(--text-color-secondary);
}

/* Free Preview */
.free-preview-wrapper {
  display: flex;
  align-items: center;
  gap: 8px;
}

.free-preview-input {
  width: 80px;
  padding: 10px 12px;
  border: 1px solid var(--border-color-primary);
  border-radius: 8px;
  font-size: 14px;
  background: var(--bg-color-primary);
  color: var(--text-color-primary);
  transition: border-color 0.2s ease;
}

.free-preview-input:focus {
  outline: none;
  border-color: var(--primary-color);
}

.free-preview-hint {
  font-size: 14px;
  color: var(--text-color-tertiary);
}

/* Free Preview Info (for images) */
.free-preview-info {
  display: flex;
  align-items: center;
  gap: 16px;
}

.free-count {
  font-size: 14px;
  color: #2ecc71;
  font-weight: 500;
}

.paid-count {
  font-size: 14px;
  color: #ff4757;
  font-weight: 500;
}

/* Payment Note */
.payment-note {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 12px;
  background: var(--bg-color-secondary);
  border-radius: 8px;
  color: var(--text-color-secondary);
  font-size: 13px;
  line-height: 1.5;
}

.payment-note svg {
  flex-shrink: 0;
  margin-top: 2px;
}

/* Validation Error */
.validation-error {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  background: rgba(255, 59, 48, 0.1);
  border-radius: 8px;
  color: #ff3b30;
  font-size: 13px;
  margin-top: 12px;
}

.validation-error svg {
  flex-shrink: 0;
}

/* Modal Footer */
.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid var(--border-color-primary);
}

.cancel-btn {
  padding: 10px 20px;
  border: 1px solid var(--border-color-primary);
  border-radius: 8px;
  background: var(--bg-color-primary);
  color: var(--text-color-secondary);
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.cancel-btn:hover {
  background: var(--bg-color-secondary);
  color: var(--text-color-primary);
}

.confirm-btn {
  padding: 10px 20px;
  border: none;
  border-radius: 8px;
  background: var(--primary-color);
  color: white;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.confirm-btn:hover {
  background: var(--primary-color-dark);
}

/* Responsive */
@media (max-width: 480px) {
  .modal {
    width: 95%;
    max-height: 85vh;
  }
  
  .payment-type-options {
    flex-direction: column;
  }
  
  .type-option {
    flex-direction: row;
    justify-content: flex-start;
    gap: 12px;
    padding: 12px 16px;
  }
}
</style>
