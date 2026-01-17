<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import ExplorePageTemplate from './components/ExplorePageTemplate.vue'

const route = useRoute()

// 根据路由参数或路由名称获取频道类型
const channelType = computed(() => {
    if (route.params.channel) {
        return route.params.channel
    }
    return route.name || 'recommend'
})

// 频道配置映射
const channelConfig = computed(() => {
    return {
        'recommend': { category: 'recommend', title: '推荐', type: null },
        'video': { category: 'recommend', title: '视频', type: 2 }
    }
})

// 获取当前频道配置
const currentChannel = computed(() => {
    return channelConfig.value[channelType.value] || channelConfig.value['recommend']
})
</script>

<template>
    <ExplorePageTemplate :category="currentChannel.category" :forceType="currentChannel.type" />
</template>
