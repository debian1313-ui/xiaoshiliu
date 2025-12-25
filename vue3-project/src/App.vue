<script setup>
import { RouterView } from 'vue-router'
import { onMounted, ref } from 'vue'
import { useUserStore } from '@/stores/user'
import { useAuthStore } from '@/stores/auth'
import { useAboutStore } from '@/stores/about'
import { useChangePasswordStore } from '@/stores/changePassword'
import { useKeyboardShortcutsStore } from '@/stores/keyboardShortcuts'
import { useAccountSecurityStore } from '@/stores/accountSecurity'
import { useVerifiedStore } from '@/stores/verified'
import { useBalanceStore } from '@/stores/balance'
import AuthModal from '@/components/modals/AuthModal.vue'
import ResetPasswordModal from '@/components/modals/ResetPasswordModal.vue'
import AboutModal from '@/components/modals/AboutModal.vue'
import ChangePasswordModal from '@/components/modals/ChangePasswordModal.vue'
import KeyboardShortcutsModal from '@/components/modals/KeyboardShortcutsModal.vue'
import AccountSecurityModal from '@/components/modals/AccountSecurityModal.vue'
import VerifiedModal from '@/components/modals/VerifiedModal.vue'
import BalanceModal from '@/components/modals/BalanceModal.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { useConfirm } from '@/views/admin/composables/useConfirm'

const userStore = useUserStore()
const authStore = useAuthStore()
const aboutStore = useAboutStore()
const changePasswordStore = useChangePasswordStore()
const keyboardShortcutsStore = useKeyboardShortcutsStore()
const accountSecurityStore = useAccountSecurityStore()
const verifiedStore = useVerifiedStore()
const balanceStore = useBalanceStore()
const { confirmState, handleConfirm, handleCancel } = useConfirm()

// 找回密码模态框状态
const showResetPasswordModal = ref(false)

const openResetPassword = () => {
  authStore.closeAuthModal()
  showResetPasswordModal.value = true
}

const closeResetPassword = () => {
  showResetPasswordModal.value = false
}

const backToLoginFromReset = () => {
  showResetPasswordModal.value = false
  authStore.openLoginModal()
}

// 处理OAuth2回调参数
const handleOAuth2Callback = () => {
  const urlParams = new URLSearchParams(window.location.search)
  const oauth2Login = urlParams.get('oauth2_login')
  const accessToken = urlParams.get('access_token')
  const refreshToken = urlParams.get('refresh_token')
  const isNewUser = urlParams.get('is_new_user')
  const error = urlParams.get('error')
  const errorMessage = urlParams.get('message')

  // 如果没有OAuth2相关参数，直接返回
  if (!oauth2Login && !error) {
    return
  }

  // 立即清除URL参数（安全性：减少敏感信息在URL中的暴露时间）
  window.history.replaceState({}, document.title, window.location.pathname)

  // 处理OAuth2登录错误
  if (error) {
    console.error('OAuth2登录错误:', error, errorMessage)
    // 显示错误提示给用户
    const errorMessages = {
      'oauth2_disabled': 'OAuth2登录未启用',
      'oauth2_auth_error': '授权失败：' + (errorMessage || '未知错误'),
      'missing_code': '缺少授权码',
      'invalid_state': '无效的安全令牌，请重试',
      'token_error': '获取令牌失败：' + (errorMessage || '未知错误'),
      'missing_access_token': '授权响应无效',
      'userinfo_error': '获取用户信息失败',
      'account_disabled': '账户已被禁用',
      'callback_error': '登录回调处理失败：' + (errorMessage || '请稍后重试')
    }
    const displayMessage = errorMessages[error] || `登录失败：${error}`
    alert(displayMessage)
    return
  }

  // 处理OAuth2登录成功
  if (oauth2Login === 'success' && accessToken) {
    // 保存token
    localStorage.setItem('token', accessToken)
    if (refreshToken) {
      localStorage.setItem('refreshToken', refreshToken)
    }
    
    // 获取用户信息并保存
    userStore.getCurrentUser().then(() => {
      console.log('OAuth2登录成功', isNewUser === 'true' ? '（新用户）' : '')
      
      // 刷新页面以应用登录状态
      window.location.reload()
    }).catch((err) => {
      console.error('获取用户信息失败:', err)
    })
  }
}

// 恢复保存的主题色
const restoreThemeColor = () => {
  const savedColor = localStorage.getItem('theme-color')
  if (savedColor) {
    const root = document.documentElement

    // 将hex颜色转换为RGB
    const hexToRgb = (hex) => {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
      return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
      } : null
    }

    // 调整颜色亮度
    const adjustBrightness = (hex, percent) => {
      const rgb = hexToRgb(hex)
      if (!rgb) return hex

      const adjust = (color) => {
        const adjusted = Math.round(color * (1 + percent / 100))
        return Math.max(0, Math.min(255, adjusted))
      }

      const r = adjust(rgb.r)
      const g = adjust(rgb.g)
      const b = adjust(rgb.b)

      return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`
    }

    // 设置主色
    root.style.setProperty('--primary-color', savedColor)

    // 设置深一些的主色（降低亮度10%）
    const darkColor = adjustBrightness(savedColor, -10)
    root.style.setProperty('--primary-color-dark', darkColor)

    // 设置半透明深一些的主色
    const rgb = hexToRgb(darkColor)
    if (rgb) {
      const shadowColor = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.3)`
      root.style.setProperty('--primary-color-shadow', shadowColor)
    }
  }
  else{
  // 设置默认主题色
    const root = document.documentElement
    root.style.setProperty('--primary-color', '#ff2442')
    root.style.setProperty('--primary-color-dark', '#b31f35')
    root.style.setProperty('--primary-color-shadow', 'rgba(254, 40, 67, 0.3)')
  }
}

// 应用启动时初始化用户信息和主题色
onMounted(() => {
  // 先处理OAuth2回调
  handleOAuth2Callback()
  
  userStore.initUserInfo()
  restoreThemeColor()
})
</script>

<template>
  <div class="app-container">
    <RouterView />
    <AuthModal v-if="authStore.showAuthModal" :initial-mode="authStore.initialMode" @close="authStore.closeAuthModal"
      @success="authStore.closeAuthModal" @open-reset-password="openResetPassword" />
    <ResetPasswordModal v-if="showResetPasswordModal" @close="closeResetPassword"
      @back-to-login="backToLoginFromReset" />
    <AboutModal v-if="aboutStore.showAboutModal" @close="aboutStore.closeAboutModal" />
    <ChangePasswordModal v-if="changePasswordStore.showChangePasswordModal" :userInfo="userStore.userInfo"
      @close="changePasswordStore.closeChangePasswordModal" />
    <KeyboardShortcutsModal v-if="keyboardShortcutsStore.showKeyboardShortcutsModal"
      @close="keyboardShortcutsStore.closeKeyboardShortcutsModal" />
    <AccountSecurityModal v-model:visible="accountSecurityStore.showAccountSecurityModal"
      @close="accountSecurityStore.closeAccountSecurityModal" />
    <VerifiedModal v-if="verifiedStore.showVerifiedModal" @close="verifiedStore.closeVerifiedModal" />
    <BalanceModal v-model:visible="balanceStore.showBalanceModal" @close="balanceStore.closeBalanceModal" />
    <ConfirmDialog v-model:visible="confirmState.visible" :title="confirmState.title" :message="confirmState.message"
      :type="confirmState.type" :confirm-text="confirmState.confirmText" :cancel-text="confirmState.cancelText"
      :show-cancel="confirmState.showCancel" @confirm="handleConfirm" @cancel="handleCancel" />
  </div>
</template>

<style>
.app-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  width: 100vw;
  min-width: 100%;
  background-color: var(--bg-color-primary);
  box-sizing: border-box;
  position: relative;
  overflow-x: hidden;
  transition: background 0.2s ease;
}

body {
  margin: 0;
  padding: 0;
}
</style>