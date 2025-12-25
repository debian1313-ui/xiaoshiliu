<template>
  <div class="reset-modal-overlay" :class="{ 'animating': isAnimating }" v-click-outside.mousedown="closeModal"
    v-escape-key="closeModal">
    <div class="reset-modal" @click.stop :class="{ 'scale-in': isAnimating }">
      <button class="close-btn" @click="closeModal">
        <SvgIcon name="close" />
      </button>

      <div class="reset-content">
        <div class="reset-header">
          <h2 class="reset-title">找回密码</h2>
          <p class="reset-subtitle">通过绑定的邮箱重置密码</p>
        </div>

        <form @submit.prevent="handleSubmit" class="reset-form" novalidate autocomplete="off">
          <!-- 步骤1：输入邮箱获取验证码 -->
          <template v-if="step === 1">
            <div class="form-group">
              <label for="email" class="form-label">邮箱地址</label>
              <input type="email" id="email" v-model="formData.email" class="form-input"
                :class="{ 'error': showErrors && errors.email }" placeholder="请输入绑定的邮箱地址" maxlength="100"
                autocomplete="off" @input="clearError('email')" />
              <span v-if="showErrors && errors.email" class="error-message">{{ errors.email }}</span>
            </div>

            <div class="form-group">
              <label for="emailCode" class="form-label">邮箱验证码</label>
              <div class="form-input-with-button">
                <input type="text" id="emailCode" v-model="formData.emailCode" class="form-input"
                  :class="{ 'error': showErrors && errors.emailCode }" placeholder="请输入邮箱验证码" maxlength="6"
                  autocomplete="off" @input="clearError('emailCode')" />
                <button type="button" class="email-code-btn"
                  :disabled="isSendingCode || codeCountdown > 0 || !isEmailValid" @click="sendResetCode">
                  {{ codeCountdown > 0 ? `${codeCountdown}秒后重发` : (isSendingCode ? '发送中...' : '获取验证码') }}
                </button>
              </div>
              <span v-if="showErrors && errors.emailCode" class="error-message">{{ errors.emailCode }}</span>
            </div>
          </template>

          <!-- 步骤2：设置新密码 -->
          <template v-if="step === 2">
            <div class="account-info">
              <span class="account-label">重置账号：</span>
              <span class="account-value">{{ foundUserId }}</span>
            </div>

            <div class="form-group">
              <label for="newPassword" class="form-label">新密码</label>
              <input type="password" id="newPassword" v-model="formData.newPassword" class="form-input"
                :class="{ 'error': showErrors && errors.newPassword }" placeholder="请设置新密码（6-20位）" maxlength="20"
                autocomplete="new-password" @input="clearError('newPassword')" />
              <span v-if="showErrors && errors.newPassword" class="error-message">{{ errors.newPassword }}</span>
            </div>

            <div class="form-group">
              <label for="confirmPassword" class="form-label">确认密码</label>
              <input type="password" id="confirmPassword" v-model="formData.confirmPassword" class="form-input"
                :class="{ 'error': showErrors && errors.confirmPassword }" placeholder="请再次输入新密码" maxlength="20"
                autocomplete="new-password" @input="clearError('confirmPassword')" />
              <span v-if="showErrors && errors.confirmPassword" class="error-message">{{ errors.confirmPassword }}
              </span>
            </div>
          </template>

          <div v-if="errorMessage" class="error-tip">
            <SvgIcon name="alert" width="16" height="16" />
            {{ errorMessage }}
          </div>

          <button type="submit" class="submit-btn" :disabled="isSubmitting" :class="{ 'loading': isSubmitting }">
            <span v-if="isSubmitting" class="loading-spinner"></span>
            {{ submitButtonText }}
          </button>
        </form>

        <div class="reset-switch">
          <button type="button" class="switch-btn" @click="goBackToLogin">
            返回登录
          </button>
        </div>
      </div>
    </div>

    <MessageToast v-if="showToast" :message="toastMessage" :type="toastType" @close="handleToastClose" />
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import SvgIcon from '@/components/SvgIcon.vue'
import MessageToast from '@/components/MessageToast.vue'
import { authApi } from '@/api/index.js'
import { useScrollLock } from '@/composables/useScrollLock'

const emit = defineEmits(['close', 'back-to-login'])

const { lock, unlock } = useScrollLock()

const isAnimating = ref(false)
const step = ref(1) // 1: 输入邮箱, 2: 设置新密码
const isSubmitting = ref(false)
const errorMessage = ref('')
const foundUserId = ref('')

// 验证码倒计时
const isSendingCode = ref(false)
const codeCountdown = ref(0)
let countdownTimer = null

const formData = reactive({
  email: '',
  emailCode: '',
  newPassword: '',
  confirmPassword: ''
})

const errors = reactive({
  email: '',
  emailCode: '',
  newPassword: '',
  confirmPassword: ''
})

const showErrors = ref(false)

const showToast = ref(false)
const toastMessage = ref('')
const toastType = ref('success')

// 计算属性：邮箱格式是否有效
const isEmailValid = computed(() => {
  return formData.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)
})

const submitButtonText = computed(() => {
  if (isSubmitting.value) return '处理中...'
  return step.value === 1 ? '下一步' : '重置密码'
})

const validateEmail = () => {
  if (!formData.email.trim()) {
    errors.email = '请输入邮箱地址'
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
    errors.email = '请输入有效的邮箱地址'
  } else {
    errors.email = ''
  }
}

const validateEmailCode = () => {
  if (!formData.emailCode.trim()) {
    errors.emailCode = '请输入邮箱验证码'
  } else if (formData.emailCode.length !== 6) {
    errors.emailCode = '邮箱验证码长度为6位'
  } else {
    errors.emailCode = ''
  }
}

const validateNewPassword = () => {
  if (!formData.newPassword.trim()) {
    errors.newPassword = '请输入新密码'
  } else if (formData.newPassword.length < 6) {
    errors.newPassword = '密码至少需要6位'
  } else {
    errors.newPassword = ''
  }
}

const validateConfirmPassword = () => {
  if (!formData.confirmPassword.trim()) {
    errors.confirmPassword = '请确认密码'
  } else if (formData.newPassword !== formData.confirmPassword) {
    errors.confirmPassword = '两次输入的密码不一致'
  } else {
    errors.confirmPassword = ''
  }
}

const clearError = (field) => {
  errors[field] = ''
  errorMessage.value = ''
  showErrors.value = false
}

// 发送找回密码验证码
const sendResetCode = async () => {
  validateEmail()
  if (errors.email) {
    showErrors.value = true
    return
  }

  isSendingCode.value = true
  errorMessage.value = ''

  try {
    const response = await authApi.sendResetCode({ email: formData.email })
    if (response.success) {
      showToastMessage('验证码发送成功', 'success')
      // 保存找到的用户ID
      if (response.data?.user_id) {
        foundUserId.value = response.data.user_id
      }
      // 开始倒计时
      startCountdown()
    } else {
      errorMessage.value = response.message || '发送验证码失败'
    }
  } catch (error) {
    console.error('发送验证码失败:', error)
    errorMessage.value = '网络错误，请稍后重试'
  } finally {
    isSendingCode.value = false
  }
}

const startCountdown = () => {
  codeCountdown.value = 60
  countdownTimer = setInterval(() => {
    codeCountdown.value--
    if (codeCountdown.value <= 0) {
      clearInterval(countdownTimer)
      countdownTimer = null
    }
  }, 1000)
}

const handleSubmit = async () => {
  errorMessage.value = ''
  showErrors.value = true

  if (step.value === 1) {
    // 步骤1：验证邮箱和验证码
    validateEmail()
    validateEmailCode()

    if (errors.email || errors.emailCode) {
      return
    }

    // 调用后端验证验证码是否正确
    isSubmitting.value = true
    try {
      const response = await authApi.verifyResetCode({
        email: formData.email,
        emailCode: formData.emailCode
      })

      if (response.success) {
        // 验证码正确，进入步骤2
        step.value = 2
        showErrors.value = false
      } else {
        errorMessage.value = response.message || '验证码验证失败'
      }
    } catch (error) {
      console.error('验证验证码失败:', error)
      errorMessage.value = '网络错误，请稍后重试'
    } finally {
      isSubmitting.value = false
    }
  } else {
    // 步骤2：重置密码
    validateNewPassword()
    validateConfirmPassword()

    if (errors.newPassword || errors.confirmPassword) {
      return
    }

    isSubmitting.value = true

    try {
      const response = await authApi.resetPassword({
        email: formData.email,
        emailCode: formData.emailCode,
        newPassword: formData.newPassword
      })

      if (response.success) {
        showToastMessage('密码重置成功！', 'success')
        setTimeout(() => {
          goBackToLogin()
        }, 1500)
      } else {
        errorMessage.value = response.message || '重置密码失败'
        // 如果验证码错误，返回步骤1
        if (response.message?.includes('验证码')) {
          step.value = 1
          formData.emailCode = ''
        }
      }
    } catch (error) {
      console.error('重置密码失败:', error)
      errorMessage.value = '网络错误，请稍后重试'
    } finally {
      isSubmitting.value = false
    }
  }
}

const showToastMessage = (message, type = 'success') => {
  toastMessage.value = message
  toastType.value = type
  showToast.value = true
}

const handleToastClose = () => {
  showToast.value = false
}

const closeModal = () => {
  isAnimating.value = false
  unlock()
  if (countdownTimer) {
    clearInterval(countdownTimer)
  }
  setTimeout(() => {
    emit('close')
  }, 200)
}

const goBackToLogin = () => {
  isAnimating.value = false
  unlock()
  if (countdownTimer) {
    clearInterval(countdownTimer)
  }
  setTimeout(() => {
    emit('back-to-login')
  }, 200)
}

onMounted(() => {
  lock()
  isAnimating.value = true
})

onUnmounted(() => {
  if (countdownTimer) {
    clearInterval(countdownTimer)
  }
})
</script>

<style scoped>
.reset-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--overlay-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
  opacity: 0;
  transition: opacity 0.2s ease;
  width: 100vw;
  height: 100%;
}

.reset-modal-overlay.animating {
  opacity: 1;
}

.reset-modal {
  background: var(--bg-color-primary);
  border-radius: 16px;
  width: 90%;
  max-width: 400px;
  max-height: 90vh;
  overflow-y: auto;
  position: relative;
  transform: scale(0.9);
  transition: transform 0.2s ease;
  box-shadow: 0 20px 40px var(--shadow-color);
}

.reset-modal.scale-in {
  transform: scale(1);
}

.close-btn {
  position: absolute;
  top: 16px;
  right: 16px;
  width: 30px;
  height: 30px;
  background: var(--bg-color-secondary);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1;
  border: none;
  cursor: pointer;
  padding: 5px;
  color: var(--text-color-primary);
  transition: all 0.2s ease;
}

.close-btn:hover {
  color: var(--text-color-secondary);
  transform: scale(1.1);
}

.reset-content {
  padding: 32px;
}

.reset-header {
  text-align: center;
  margin-bottom: 32px;
}

.reset-title {
  font-size: 24px;
  font-weight: 700;
  color: var(--text-color-primary);
  margin: 0 0 8px 0;
}

.reset-subtitle {
  font-size: 14px;
  color: var(--text-color-secondary);
  margin: 0;
}

.reset-form {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-color-primary);
}

.form-input {
  padding: 12px 16px;
  border: 1px solid transparent;
  border-radius: 8px;
  font-size: 16px;
  background: var(--bg-color-secondary);
  color: var(--text-color-primary);
  caret-color: var(--primary-color);
  transition: border-color 0.2s ease;
}

.form-input:focus {
  outline: none;
  border-color: var(--primary-color);
}

.form-input.error {
  border-color: var(--primary-color);
}

.error-message {
  font-size: 12px;
  color: var(--primary-color);
  margin-top: -4px;
}

.error-tip {
  display: flex;
  flex-direction: row;
  align-items: center;
  color: var(--primary-color);
  font-size: 14px;
  text-align: center;
  justify-content: center;
  gap: 8px;
}

.account-info {
  padding: 12px 16px;
  background: var(--bg-color-secondary);
  border-radius: 8px;
  font-size: 14px;
}

.account-label {
  color: var(--text-color-secondary);
}

.account-value {
  color: var(--text-color-primary);
  font-weight: 600;
  font-size:16px;
}

.submit-btn {
  padding: 14px 24px;
  background: var(--primary-color);
  color: white;
  border: none;
  border-radius: 999px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 48px;
}

.submit-btn:hover {
  background-color: var(--primary-color-dark);
}

.submit-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.loading-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top: 2px solid white;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.reset-switch {
  text-align: center;
  padding-top: 24px;
}

.switch-btn {
  background: none;
  border: none;
  color: var(--primary-color);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  text-decoration: underline;
  transition: color 0.2s ease;
}

.switch-btn:hover {
  opacity: 0.8;
}

.form-input-with-button {
  display: flex;
  gap: 8px;
}

.form-input-with-button .form-input {
  flex: 1;
}

.email-code-btn {
  padding: 12px 16px;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  background: var(--primary-color);
  color: white;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
}

.email-code-btn:hover:not(:disabled) {
  background-color: var(--primary-color-dark);
}

.email-code-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

@media (max-width: 480px) {
  .reset-content {
    padding: 24px;
  }

  .reset-title {
    font-size: 20px;
  }
}
</style>
