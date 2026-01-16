<script setup>
import WaterfallFlow from '@/components/WaterfallFlow.vue'
import FloatingBtn from './FloatingBtn.vue'
import SvgIcon from '@/components/SvgIcon.vue'
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useUserStore } from '@/stores/user'
import { useAuthStore } from '@/stores/auth'

const userStore = useUserStore()
const authStore = useAuthStore()

// 从环境变量获取是否允许未登录用户查看首页内容
const ALLOW_GUEST_VIEW = import.meta.env.VITE_ALLOW_GUEST_VIEW === 'true'

// 计算用户是否已登录
const isLoggedIn = computed(() => userStore.isLoggedIn)

// 计算是否可以查看内容（已登录或允许游客查看）
const canViewContent = computed(() => isLoggedIn.value || ALLOW_GUEST_VIEW)

const props = defineProps({
    category: {
        type: [String, Number],
        default: 'general'
    },
    forceType: {
        type: Number,
        default: null
    }
})

const refreshKey = ref(0)
const isImgOnly = ref(false)

// 计算实际的type值：forceType优先，否则根据isImgOnly决定
const effectiveType = computed(() => {
    if (props.forceType !== null) {
        return props.forceType
    }
    return isImgOnly.value ? 1 : null
})

function handleReload() {
    // 通知父组件显示加载动画
    window.dispatchEvent(new CustomEvent('floating-btn-reload-request'))
}

function handleToggleImgOnly(imgOnlyState) {
    isImgOnly.value = imgOnlyState
    // 切换状态时刷新内容
    refreshKey.value++
}

function handleFloatingBtnReload() {
    // 刷新按钮触发时更新内容
    refreshKey.value++
    
    // 触发强制重新检查图片加载事件
    setTimeout(() => {
        document.dispatchEvent(new CustomEvent('force-recheck'))
    }, 100)
}

onMounted(() => {
    // 只监听刷新按钮事件
    window.addEventListener('floating-btn-reload', handleFloatingBtnReload)
})

onUnmounted(() => {
    window.removeEventListener('floating-btn-reload', handleFloatingBtnReload)
})
</script>

<template>
    <div class="explore-page">
        <!-- 未登录且不允许游客查看时显示登录提示 -->
        <div v-if="!canViewContent" class="login-prompt">
            <div class="login-prompt-content">
                <SvgIcon name="user" width="48" height="48" class="login-icon" />
                <h3 class="login-title">请先登录</h3>
                <p class="login-text">登录后即可查看所有信息</p>
                <button class="login-btn" @click="authStore.openLoginModal()">立即登录</button>
            </div>
        </div>

        <!-- 已登录或允许游客查看时显示内容 -->
        <template v-else>
            <WaterfallFlow :refresh-key="refreshKey" :category="category" :type="effectiveType" />
            <FloatingBtn @reload="handleReload" @toggle-img-only="handleToggleImgOnly" :hideImgOnlyButton="forceType !== null" />
        </template>
    </div>
</template>

<style scoped>
.explore-page {
    position: relative;
    width: 100%;
    height: 100%;
}

/* 登录提示样式 */
.login-prompt {
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 400px;
    padding: 40px 20px;
}

.login-prompt-content {
    text-align: center;
    max-width: 300px;
}

.login-icon {
    color: var(--text-color-tertiary);
    margin-bottom: 16px;
}

.login-title {
    color: var(--text-color-primary);
    font-size: 18px;
    font-weight: 600;
    margin: 0 0 8px 0;
}

.login-text {
    color: var(--text-color-secondary);
    font-size: 14px;
    margin: 0 0 24px 0;
    line-height: 1.5;
}

.login-btn {
    background: var(--primary-color);
    color: white;
    border: none;
    padding: 12px 32px;
    border-radius: 20px;
    font-size: 14px;
    cursor: pointer;
    transition: background-color 0.2s ease;
}

.login-btn:hover {
    background: var(--primary-color-dark);
}
</style>