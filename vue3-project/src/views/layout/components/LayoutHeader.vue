<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import SvgIcon from '@/components/SvgIcon.vue'
import DropdownMenu from '@/components/menu/DropdownMenu.vue'
import CommonMenu from '@/components/menu/CommonMenu.vue'
import SearchDropdown from './SearchDropdown.vue'
import TabContainer from '@/components/TabContainer.vue'
import { useSearchHistoryStore } from '@/stores/searchHistory'
import { useChannelStore } from '@/stores/channel'
import { useNavigationStore } from '@/stores/navigation'
import router from '@/router'

const route = useRoute()
const searchHistoryStore = useSearchHistoryStore()
const channelStore = useChannelStore()
const navigationStore = useNavigationStore()

// 静态资源URL
const logoUrl = new URL('@/assets/imgs/汐社.png', import.meta.url).href

const isLargeScreen = ref(window.innerWidth > 695)
const showSidebar = ref(window.innerWidth > 960)

// 检查是否在用户页面（需要透明导航栏）
const isUserPage = computed(() => {
    return route.path === '/user' || route.name === 'user'
})

// 检查是否在探索页面（需要显示频道标签）
const isExplorePage = computed(() => {
    return route.path === '/explore' || 
           route.path.startsWith('/explore/') || 
           route.name === 'explore' || 
           route.name === 'recommend' || 
           route.name === 'video' ||
           route.name === 'following' ||
           route.name === 'channel'
})

// 检查是否在搜索结果页面
const isSearchResultPage = computed(() => {
    return route.path.startsWith('/search_result')
})

// 搜索结果页面的tabs
const searchTabs = [
    { id: 'all', label: '全部', path: '/all' },
    { id: 'posts', label: '图文', path: '/posts' },
    { id: 'videos', label: '视频', path: '/videos' },
    { id: 'users', label: '用户', path: '/users' }
]

// 当前搜索tab
const activeSearchTab = computed(() => {
    return route.params.tab || 'all'
})

// 搜索tab切换处理
function handleSearchTabChange(item) {
    if (activeSearchTab.value === item.id) return
    
    navigationStore.scrollToTop('instant')
    
    router.push({
        name: 'search_result_tab',
        params: { tab: item.id },
        query: route.query
    })
}

const showSearch = ref(false)
const searchText = ref('')
const showSearchDropdown = ref(false)
const isSearchEditMode = ref(false)

// 频道切换处理
function handleTabChange(item) {
    // 如果切换到相同频道，不执行任何操作
    if (channelStore.activeChannelId === item.id) return

    // 更新 store 中的活跃频道（UI立即响应）
    channelStore.setActiveChannel(item.id)

    // 立即返回顶部
    navigationStore.scrollToTop('instant')

    // 执行路由跳转
    router.push(`/explore${item.path}`)
}

// 监听路由变化，更新活跃频道
watch(() => route.path, (newPath, oldPath) => {
    const isInSearchPage = newPath.startsWith('/search_result')
    const wasInSearchPage = oldPath?.startsWith('/search_result')

    if (isInSearchPage && !wasInSearchPage) {
        const keyword = route.query.keyword
        if (keyword && isLargeScreen.value) {
            searchText.value = keyword
        }
    } else if (!isInSearchPage && wasInSearchPage) {
        if (isLargeScreen.value) {
            searchText.value = ''
        }
    }
    
    // 更新频道状态
    if (newPath.startsWith('/explore')) {
        const channelId = channelStore.getChannelIdByPath(newPath)
        channelStore.setActiveChannel(channelId)
    }
}, { immediate: true })

watch(() => route.query.keyword, (newKeyword) => {
    if (route.path.startsWith('/search_result') && isLargeScreen.value) {
        searchText.value = newKeyword || ''
    }
})

function handleSearchFocus() {
    showSearchDropdown.value = true
}

function handleSearchBlur() {
    if (isSearchEditMode.value) {
        return
    }

    setTimeout(() => {
        if (!isSearchEditMode.value) {
            showSearchDropdown.value = false
        }
    }, 200)
}

function handleResize() {
    isLargeScreen.value = window.innerWidth > 695
    showSidebar.value = window.innerWidth > 960
}

const displaySearch = computed(() => {
    return isLargeScreen.value || showSearch.value
})

function openSearch() {
    showSearch.value = true
}
function closeSearch() {
    showSearch.value = false
    showSearchDropdown.value = false
    searchText.value = ''
}
function clearInput() {
    searchText.value = ''
    // 点击清除图标时也显示下拉菜单
    showSearchDropdown.value = true
    // 聚焦到输入框
    nextTick(() => {
        const input = document.querySelector('.search-bar input')
        if (input) {
            input.focus()
        }
    })
}

// 搜索功能
function handleSearch(keyword = null) {
    // 如果传入的是事件对象，忽略它
    const searchKeyword = (typeof keyword === 'string' ? keyword : searchText.value).trim()

    // 跳转到搜索结果页面的all tab（即使搜索词为空也跳转）
    router.push({
        name: 'search_result_tab',
        params: { tab: 'all' },
        query: searchKeyword ? { keyword: searchKeyword } : {}
    })

    // 如果有搜索关键词，添加到搜索历史
    if (searchKeyword) {
        searchHistoryStore.addSearchRecord(searchKeyword)
        // 更新搜索框内容
        searchText.value = searchKeyword
    }

    // 隐藏下拉菜单
    showSearchDropdown.value = false

    // 小屏模式下搜索后关闭搜索框
    if (!isLargeScreen.value) {
        closeSearch()
    }
}

// 处理搜索下拉菜单的搜索事件
function handleDropdownSearch(keyword) {
    handleSearch(keyword)
}

// 处理搜索历史编辑模式变化
function handleEditModeChange(isEditMode) {
    isSearchEditMode.value = isEditMode
}

// 处理聚焦搜索框事件
function handleFocusSearch() {
    nextTick(() => {
        const input = document.querySelector('.search-bar input')
        if (input) {
            input.focus()
        }
    })
}

// 处理回车键搜索
function handleKeyPress(event) {
    if (event.key === 'Enter') {
        handleSearch()
    }
}

// 点击外部关闭搜索下拉菜单
function handleClickOutside(event) {
    // 如果正在编辑模式，不关闭
    if (isSearchEditMode.value) {
        return
    }

    // 检查点击的元素是否在搜索区域内
    const searchContainer = event.target.closest('.search-bar-container')
    if (!searchContainer && showSearchDropdown.value) {
        showSearchDropdown.value = false
    }
}

// 生命周期钩子
onMounted(() => {
    window.addEventListener('resize', handleResize)
    document.addEventListener('click', handleClickOutside)
})
onUnmounted(() => {
    window.removeEventListener('resize', handleResize)
    document.removeEventListener('click', handleClickOutside)
})
</script>

<template>
    <header :class="{ 'transparent-header': isUserPage }">
        <div class="header-container">
            <!-- 居中显示的频道标签 - 仅在探索页面显示 -->
            <div v-if="isExplorePage && isLargeScreen" class="channel-tabs-center">
                <TabContainer 
                    :tabs="channelStore.channels" 
                    :activeTab="channelStore.activeChannelId" 
                    :enableDrag="false"
                    @tab-change="handleTabChange" 
                />
            </div>
            
            <!-- 居中显示的搜索结果标签 - 仅在搜索结果页面显示 -->
            <div v-if="isSearchResultPage && isLargeScreen" class="channel-tabs-center">
                <TabContainer 
                    :tabs="searchTabs" 
                    :activeTab="activeSearchTab" 
                    :enableDrag="false"
                    @tab-change="handleSearchTabChange" 
                />
            </div>
            
            <template v-if="displaySearch">
                <div class="search-row" :class="{ 'large-screen': isLargeScreen, 'small-screen': !isLargeScreen, 'with-channel-tabs': (isExplorePage || isSearchResultPage) && isLargeScreen }">
                    <div class="search-bar-container">
                        <div class="search-bar">
                            <input v-model="searchText" type="text" placeholder="搜索汐社" @keypress="handleKeyPress"
                                @focus="handleSearchFocus" @blur="handleSearchBlur" />
                            <div class="input-controls">
                                <div class="clear-btn" @click="clearInput"
                                    :style="{ visibility: searchText ? 'visible' : 'hidden' }">
                                    <SvgIcon name="close" class="btn-icon" height="20" width="20" />
                                </div>
                                <div class="search-btn" @click="handleSearch">
                                    <SvgIcon name="search" class="btn-icon" height="20" width="20" />
                                </div>
                            </div>
                        </div>
                        <SearchDropdown :visible="showSearchDropdown" :searchText="searchText"
                            @search="handleDropdownSearch" @edit-mode-change="handleEditModeChange"
                            @focus-search="handleFocusSearch" @close="showSearchDropdown = false" />
                    </div>
                    <div v-if="!isLargeScreen" class="cancel-btn" @click="closeSearch">取消</div>
                </div>
                <div v-if="isLargeScreen && !showSidebar" class="header-right">
                    <DropdownMenu direction="down" menuClass="header-dropdown">
                        <template #trigger>
                            <div class="circle-btn">
                                <SvgIcon name="menu" class="btn-icon" height="20" width="20" />
                            </div>
                        </template>
                        <template #menu>
                            <CommonMenu />
                        </template>
                    </DropdownMenu>
                </div>

            </template>

            <template v-else>
                <!-- 小屏幕下在探索页面显示频道标签 -->
                <div v-if="isExplorePage" class="channel-tabs-mobile">
                    <TabContainer 
                        :tabs="channelStore.channels" 
                        :activeTab="channelStore.activeChannelId" 
                        :enableDrag="false"
                        @tab-change="handleTabChange" 
                    />
                </div>
                <!-- 小屏幕下在搜索结果页面显示搜索标签 -->
                <div v-else-if="isSearchResultPage" class="channel-tabs-mobile">
                    <TabContainer 
                        :tabs="searchTabs" 
                        :activeTab="activeSearchTab" 
                        :enableDrag="false"
                        @tab-change="handleSearchTabChange" 
                    />
                </div>
                <div class="header-right">
                    <div @click="openSearch" class="circle-btn">
                        <SvgIcon name="search" class="btn-icon" height="20" width="20" />
                    </div>
                    <DropdownMenu v-if="!showSidebar" direction="down" menuClass="header-dropdown">
                        <template #trigger>
                            <div class="circle-btn">
                                <SvgIcon name="menu" class="btn-icon" height="20" width="20" />
                            </div>
                        </template>
                        <template #menu>
                            <CommonMenu />
                        </template>
                    </DropdownMenu>
                </div>
            </template>
        </div>
    </header>
</template>

<style scoped>
header {
    height: 72px;
    background: var(--bg-color-primary);
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 1000;
    width: 100%;
    transition: border-color 0.2s ease, background-color 0.2s ease;
}

/* 用户页面透明导航栏 */
header.transparent-header {
    background: transparent;
}

.header-container {
    max-width: 1500px;
    margin: 0 auto;
    height: 100%;
    padding: 0 24px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    box-sizing: border-box;
    width: 100%;
}

.header-right {
    display: flex;
    align-items: center;
    margin-left: auto;
}

/* 按钮基础样式 */
.btn-base,
.circle-btn,
.cancel-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    background: transparent;
}

.btn-base:hover,
.circle-btn:hover,
.cancel-btn:hover {
    background: var(--bg-color-secondary);
}

.circle-btn {
    border-radius: 50%;
    width: 40px;
    height: 40px;
    border: none;
}

/* 通用的图标颜色样式 */
.btn-icon {
    color: var(--text-color-secondary);
}

.btn-icon:hover,
.circle-btn:hover .btn-icon {
    color: var(--text-color-primary);
}

.search-row {
    display: flex;
    align-items: center;
    flex: 1;
    min-width: 0;
    height: 40px;
}

.search-row.large-screen {
    width: 465px;
    max-width: 500px;
    margin: 0 auto;
    flex-grow: 0;
}


@media (min-width: 696px) {
    .header-container {
        justify-content: space-between;
        position: relative;
    }

    .header-right {
        margin-left: auto;
    }

    /* 大屏模式下搜索栏居中 */
    .search-row.large-screen {
        position: absolute;
        left: 50%;
        transform: translateX(-50%);
        z-index: 1;
    }
}

.search-bar-container {
    flex: 1;
    min-width: 0;
    position: relative;
}

.search-bar {
    display: flex;
    align-items: center;
    background: var(--bg-color-secondary);
    border-radius: 999px;
    height: 40px;
    padding: 0 15px;
    position: relative;
    box-sizing: border-box;
    transition: background-color 0.2s ease;
}

.search-bar input {
    border: none;
    outline: none;
    background: transparent;
    flex: 1 1 0%;
    font-size: 16px;
    min-width: 0;
    color: var(--text-color-primary);
    caret-color: var(--primary-color);
    padding-right: 80px;
}

.search-bar input::placeholder {
    color: var(--text-color-quaternary);
}

.input-controls {
    position: absolute;
    right: 12px;
    display: flex;
    align-items: center;
    width: 60px;
}

/* 通用的图标按钮样式 */
.icon-btn,
.clear-btn,
.search-btn {
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
}

.clear-btn {
    visibility: hidden;
    margin-right: 8px;
}

.search-btn {
    margin-left: auto;
}

.cancel-btn {
    text-align: center;
    width: 64px;
    height: 40px;
    font-size: 16px;
    color: var(--text-color-secondary);
    margin-left: 12px;
    border-radius: 999px;
    flex-shrink: 0;
}

.cancel-btn:hover {
    color: var(--text-color-primary);
}

/* 主题切换器容器样式 */
.theme-switcher-container {
    padding: 0;
}

.theme-label {
    font-size: 14px;
    color: var(--text-color-primary);
    font-weight: 500;
}

/* 头部下拉菜单右对齐 */
:deep(.header-dropdown) {
    right: 0;
    left: auto;
}

/* 居中的频道标签容器 */
.channel-tabs-center {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    z-index: 1;
}

.channel-tabs-center :deep(.tab-container) {
    height: 72px;
    margin-left: 0;
    padding: 0;
    justify-content: center;
}

.channel-tabs-center :deep(.tab-item) {
    height: 36px;
    line-height: 36px;
    font-size: 15px;
    padding: 0 14px;
}

.channel-tabs-center :deep(.tab-slider) {
    height: 36px;
    bottom: 18px;
}

/* 小屏幕频道标签 */
.channel-tabs-mobile {
    flex: 1;
    display: flex;
    justify-content: center;
    margin-right: auto;
}

.channel-tabs-mobile :deep(.tab-container) {
    height: 72px;
    margin-left: 0;
    padding: 0;
    justify-content: center;
}

.channel-tabs-mobile :deep(.tab-item) {
    height: 36px;
    line-height: 36px;
    font-size: 15px;
    padding: 0 14px;
}

.channel-tabs-mobile :deep(.tab-slider) {
    height: 36px;
    bottom: 18px;
}

/* 当有频道标签时，搜索栏靠左 */
.search-row.with-channel-tabs {
    position: static !important;
    transform: none !important;
    margin: 0 !important;
}
</style>