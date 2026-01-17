<script setup>
import BaseSkeleton from './skeleton/BaseSkeleton.vue'
import SkeletonList from './skeleton/SkeletonList.vue'
import SimpleSpinner from './spinner/SimpleSpinner.vue'
import DetailCard from './DetailCard.vue'
import LikeButton from './LikeButton.vue'
import SvgIcon from './SvgIcon.vue'
import { ref, nextTick, watch, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { useLikeStore } from '@/stores/like.js'
import { useCollectStore } from '@/stores/collect.js'
import { useAuthStore } from '@/stores/auth'
import { getPostList, getRecommendedPosts } from '@/api/posts.js'
import { userApi } from '@/api/index.js'
import defaultAvatar from '@/assets/imgs/avatar.png'
import defaultPlaceholder from '@/assets/imgs/未加载.png'

const props = defineProps({
    refreshKey: {
        type: Number,
        default: 0
    },
    category: {
        type: [String, Number],
        default: null
    },
    searchKeyword: {
        type: String,
        default: ''
    },
    searchTag: {
        type: String,
        default: ''
    },
    userId: {
        type: [Number, String],
        default: null
    },
    type: {
        type: [String, Number],
        default: null
    },
    preloadedPosts: {
        type: Array,
        default: () => []
    }
})

const router = useRouter()
const userStore = useUserStore()
const likeStore = useLikeStore()
const collectStore = useCollectStore()
const authStore = useAuthStore()

// 定义emit事件
const emit = defineEmits(['follow', 'unfollow', 'like', 'collect', 'deleteHistory'])

const loading = ref(true)
const loadingMore = ref(false)
const hasMore = ref(true)
const currentPage = ref(1)
const pageSize = 20

// 添加初次加载标识
const isInitialLoad = ref(true)

// DetailCard 相关状态
const showDetailCard = ref(false)
const selectedItem = ref(null)
const clickPosition = ref({ x: 0, y: 0 })

// 瀑布流相关状态
const containerRef = ref(null)
const columnCount = ref(2) // 当前列数
const columnGap = ref(10) // 列间距
const columns = ref([]) // 每列的内容数组
const columnHeights = ref([]) // 每列的高度
const itemHeights = ref({}) // 每个item的高度缓存

// 分批加载控制
const batchSize = ref(8) // 每批加载的数量
const loadedItemCount = ref(0) // 已加载的item数量

// 性能优化相关

// 简化的监控状态
const imageMonitorTimer = ref(null)
// 定义数据数组
const contentList = ref([])
// 每个item的加载状态
const itemLoadingStates = ref({})
// 新加载内容的动画状态
const newItemAnimStates = ref({})

// 计算当前应该使用的列数
const updateColumnCount = () => {
    const width = window.innerWidth
    if (width >= 1420) {
        columnCount.value = 5
        columnGap.value = 16
        batchSize.value = 15 // 超大屏增加批次大小
    } else if (width >= 1200) {
        columnCount.value = 4
        columnGap.value = 16
        batchSize.value = 12 // 大屏增加批次大小
    } else if (width >= 900) {
        columnCount.value = 4
        columnGap.value = 15
        batchSize.value = 10
    } else if (width >= 600) {
        columnCount.value = 3
        columnGap.value = 12
        batchSize.value = 8
    } else {
        columnCount.value = 2
        columnGap.value = 10
        batchSize.value = 6
    }
}

// 初始化列数组
const initColumns = () => {
    columns.value = Array.from({ length: columnCount.value }, () => [])
    columnHeights.value = Array.from({ length: columnCount.value }, () => 0)
}

// 获取最短列的索引
const getShortestColumnIndex = () => {
    let minHeight = Math.min(...columnHeights.value)
    return columnHeights.value.indexOf(minHeight)
}

// 估算item高度（用于初始布局）
const estimateItemHeight = (item) => {
    // 基础高度：图片区域 + 标题 + 底部信息
    const baseHeight = 200 // 图片最小高度
    const bottomHeight = 50 // 底部信息区域高度

    // 根据标题长度调整高度
    const titleLines = Math.ceil(item.title.length / 20) // 估算标题行数
    const adjustedTitleHeight = Math.min(titleLines * 20, 40) // 最多2行

    // 根据图片比例调整高度（如果有的话）
    let imageHeight = baseHeight
    if (item.aspectRatio) {
        // 假设容器宽度，计算图片高度
        const containerWidth = window.innerWidth >= 900 ?
            (window.innerWidth - 60) / 4 : // 4列布局
            (window.innerWidth - 30) / 2   // 2列布局
        imageHeight = Math.min(containerWidth / item.aspectRatio, 400)
    }

    return imageHeight + adjustedTitleHeight + bottomHeight
}

// 将内容分配到列中（优化版）
const distributeContent = (newItems = []) => {
    const itemsToProcess = newItems.length > 0 ? newItems : contentList.value

    if (itemsToProcess.length === 0) {
        return
    }

    // 使用 requestAnimationFrame 延迟布局计算
    requestAnimationFrame(() => {
        if (newItems.length === 0) {
            // 重新分配所有内容（用于初始化或窗口大小变化）
            initColumns()
            distributeItemsToColumns(contentList.value)
        } else {
            // 添加新内容
            distributeItemsToColumns(newItems)
        }
    })
}

// 实际分配项目到列的函数
const distributeItemsToColumns = (items) => {
    items.forEach((item, index) => {
        const shortestColumnIndex = getShortestColumnIndex()
        columns.value[shortestColumnIndex].push(item)

        // 优化的高度估算和缓存
        const estimatedHeight = getOrEstimateItemHeight(item)
        columnHeights.value[shortestColumnIndex] += estimatedHeight

        // 分批加载控制：大屏四列时的优化
        if (columnCount.value >= 4 && index > 0 && index % batchSize.value === 0) {
            // 每处理一批后稍作停顿，避免主线程阻塞
            setTimeout(() => { }, 0)
        }
    })
}

// 优化的高度获取/估算函数
const getOrEstimateItemHeight = (item) => {
    // 先检查缓存
    if (itemHeights.value[item.id]) {
        return itemHeights.value[item.id]
    }

    // 优化的高度估算算法
    const estimatedHeight = estimateItemHeight(item)
    itemHeights.value[item.id] = estimatedHeight
    return estimatedHeight
}

// 当图片加载完成后，更新实际高度（优化版）
const updateItemHeight = (itemId) => {
    // 使用 requestAnimationFrame 避免频繁的重排
    requestAnimationFrame(() => {
        const itemElement = document.querySelector(`[data-item-id="${itemId}"]`)
        if (!itemElement) return

        const actualHeight = itemElement.offsetHeight
        const estimatedHeight = itemHeights.value[itemId] || 0
        const heightDiff = actualHeight - estimatedHeight

        // 只有高度差异超过10px才更新，减少不必要的计算
        if (Math.abs(heightDiff) < 10) {
            return
        }

        // 更新缓存的高度
        itemHeights.value[itemId] = actualHeight

        // 找到该item所在的列，更新列高度（O(1)操作）
        for (let i = 0; i < columns.value.length; i++) {
            const columnItems = columns.value[i]
            if (columnItems.some(item => item.id === itemId)) {
                columnHeights.value[i] += heightDiff
                break
            }
        }

        // 增加已加载计数
        loadedItemCount.value++
    })
}

// 初始化内容
async function initContent() {
    // 只有初次加载时才显示骨架屏
    if (isInitialLoad.value) {
        loading.value = true
    }

    currentPage.value = 1
    hasMore.value = true
    try {
        let content = []

        // 优先使用预加载的笔记数据（来自搜索页面的筛选结果）
        if (props.preloadedPosts && props.preloadedPosts.length > 0) {
            content = props.preloadedPosts
            hasMore.value = false // 预加载数据不支持分页，所以设置为false
        } else if (!props.searchKeyword && !props.searchTag && !props.userId) {
            // 无搜索条件时使用推荐算法
            console.log('📊 [WaterfallFlow] 使用推荐算法获取笔记')
            const result = await getRecommendedPosts({
                page: 1,
                limit: pageSize,
                type: props.type
            })
            content = result.posts || []
            hasMore.value = result.hasMore !== false
        } else {
            // 使用笔记API服务
            // 调用参数已准备完成
            const result = await getPostList({
                page: 1,
                limit: pageSize,
                category: props.category,
                searchKeyword: props.searchKeyword,
                searchTag: props.searchTag,
                userId: props.userId,
                type: props.type
            })
            content = result.posts || []
            hasMore.value = result.hasMore !== false // 默认为true，除非明确返回false
        }

        // 如果不是初次加载，为新内容添加淡入动画
        if (!isInitialLoad.value) {
            const newAnimStates = {}
            content.forEach(item => {
                newAnimStates[item.id] = {
                    isNew: true,
                    fadeIn: false
                }
            })
            Object.assign(newItemAnimStates.value, newAnimStates)
        }

        contentList.value = content

        // 初始化点赞状态到全局store
        likeStore.initPostsLikeStates(content)

        // 初始化收藏状态到全局store
        collectStore.initPostsCollectStates(content)

        // 初始化每个item的加载状态（保留已有的加载状态）
        const loadingStates = {}
        content.forEach(item => {
            // 如果该item已经有加载状态，保留它；否则初始化为false
            loadingStates[item.id] = itemLoadingStates.value[item.id] || {
                imageLoaded: false,
                avatarLoaded: false
            }
        })
        itemLoadingStates.value = loadingStates

        // 如果是初次加载，清空新内容动画状态
        if (isInitialLoad.value) {
            newItemAnimStates.value = {}
        }

        // 更新列数并分配内容
        updateColumnCount()
        distributeContent()

        // 如果不是初次加载，延迟触发淡入动画
        if (!isInitialLoad.value) {
            nextTick(() => {
                setTimeout(() => {
                    content.forEach(item => {
                        if (newItemAnimStates.value[item.id]) {
                            newItemAnimStates.value[item.id].fadeIn = true
                        }
                    })
                }, 100)
            })
        }

    } catch (error) {
        console.error('加载内容失败:', error)
    } finally {
        if (isInitialLoad.value) {
            loading.value = false
            isInitialLoad.value = false // 标记初次加载完成
        }
    }
}

// 加载更多内容
async function loadMoreContent() {
    // 如果使用预加载数据，不支持加载更多
    if (props.preloadedPosts && props.preloadedPosts.length > 0) {
        return
    }

    if (loadingMore.value || !hasMore.value) {
        return
    }
    loadingMore.value = true
    currentPage.value++

    try {
        let result
        
        // 无搜索条件时使用推荐算法
        if (!props.searchKeyword && !props.searchTag && !props.userId) {
            console.log('📊 [WaterfallFlow] 加载更多推荐笔记')
            result = await getRecommendedPosts({
                page: currentPage.value,
                limit: pageSize,
                type: props.type
            })
        } else {
            // 使用笔记API服务
            result = await getPostList({
                page: currentPage.value,
                limit: pageSize,
                category: props.category,
                searchKeyword: props.searchKeyword,
                searchTag: props.searchTag,
                userId: props.userId,
                type: props.type
            })
        }

        const newContent = result.posts || []
        hasMore.value = result.hasMore !== false

        // 如果没有新内容，说明没有更多数据了
        if (newContent.length === 0) {
            hasMore.value = false
            return
        }

        // 添加到现有内容列表
        contentList.value.push(...newContent)

        // 初始化新内容的点赞状态到全局store
        likeStore.initPostsLikeStates(newContent)

        // 初始化新内容的收藏状态到全局store
        collectStore.initPostsCollectStates(newContent)

        // 初始化新内容的加载状态
        const newLoadingStates = {}
        newContent.forEach(item => {
            newLoadingStates[item.id] = {
                imageLoaded: false,
                avatarLoaded: false
            }
        })
        Object.assign(itemLoadingStates.value, newLoadingStates)

        // 为新内容添加淡入动画状态
        const newAnimStates = {}
        newContent.forEach(item => {
            newAnimStates[item.id] = {
                isNew: true,
                fadeIn: false
            }
        })
        Object.assign(newItemAnimStates.value, newAnimStates)

        // 将新内容智能分配到各列
        distributeContent(newContent)

        // 延迟触发淡入动画
        nextTick(() => {
            setTimeout(() => {
                newContent.forEach(item => {
                    if (newItemAnimStates.value[item.id]) {
                        newItemAnimStates.value[item.id].fadeIn = true
                    }
                })
            }, 100) // 100ms延迟确保DOM已渲染
        })

        // 加载完成

    } catch (error) {
        console.error('加载更多内容失败:', error)
        // 发生错误时回退页码
        currentPage.value--
    } finally {
        loadingMore.value = false
    }
}

// 防抖定时器
let scrollTimer = null
let resizeTimer = null
// 是否正在处理滚动事件
let isScrollHandling = ref(false)

// 滚动监听函数
function handleScroll() {
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop
    const windowHeight = window.innerHeight
    const documentHeight = document.documentElement.scrollHeight

    // 如果没有更多内容，严格限制滚动范围
    if (!hasMore.value && contentList.value.length > 0) {
        // 计算最大允许的滚动位置，确保底部不会有多余空间
        const maxScrollTop = Math.max(0, documentHeight - windowHeight - 10)
        if (scrollTop > maxScrollTop) {
            // 立即滚动到最大允许位置
            window.scrollTo({
                top: maxScrollTop,
                behavior: 'auto'
            })
            return
        }
    }

    // 如果正在加载更多、没有更多数据或正在处理滚动事件，直接返回
    if (loadingMore.value || !hasMore.value || isScrollHandling.value) return

    // 清除之前的定时器
    if (scrollTimer) {
        clearTimeout(scrollTimer)
    }

    // 设置防抖，200ms 内只执行一次（减少延迟）
    scrollTimer = setTimeout(() => {
        // 再次检查状态，确保不会重复执行
        if (loadingMore.value || !hasMore.value || isScrollHandling.value) return

        const currentScrollTop = window.pageYOffset || document.documentElement.scrollTop
        const currentWindowHeight = window.innerHeight
        const currentDocumentHeight = document.documentElement.scrollHeight

        // 当滚动到距离底部200px时开始加载
        if (currentScrollTop + currentWindowHeight >= currentDocumentHeight - 200) {
            if (hasMore.value) {
                isScrollHandling.value = true
                loadMoreContent().finally(() => {
                    isScrollHandling.value = false
                })
            }
        }
    }, 200)
}

// 窗口大小变化监听
function handleResize() {
    if (resizeTimer) {
        clearTimeout(resizeTimer)
    }

    resizeTimer = setTimeout(() => {
        const oldColumnCount = columnCount.value
        updateColumnCount()

        // 如果列数发生变化，重新分配内容
        if (oldColumnCount !== columnCount.value) {
            distributeContent()
        }
    }, 300)
}

// 刷新时重新生成内容
watch(() => props.refreshKey, async () => {
    await initContent()
})

// 监听分类变化
watch(() => props.category, async () => {
    await initContent()
})

// 监听搜索关键词变化
watch(() => props.searchKeyword, async () => {
    await initContent()
})

// 监听搜索标签变化
watch(() => props.searchTag, async () => {
    await initContent()
})

// 监听预加载笔记数据变化
watch(() => props.preloadedPosts, async (newPosts, oldPosts) => {
    // 如果新数据和旧数据都存在且长度相同且内容相同，则跳过更新
    if (newPosts && oldPosts && newPosts.length === oldPosts.length && newPosts.length > 0) {
        const isSameData = newPosts.every((post, index) =>
            oldPosts[index] && post.id === oldPosts[index].id
        )
        if (isSameData) {
            return
        }
    }

    await initContent()
}, { deep: true })

// 监听用户ID变化
watch(() => props.userId, async () => {
    await initContent()
})

// 监听类型变化（用于用户页面的tab切换：posts/collections/likes）
watch(() => props.type, async () => {
    // 重置初次加载标识，确保切换tab时显示加载状态
    isInitialLoad.value = true
    await initContent()
})

// 处理浏览器后退/前进按钮
const handlePopState = (event) => {
    if (event.state && event.state.showDetailCard && showDetailCard.value) {
        // 如果当前显示DetailCard且历史状态表明应该显示，不做处理
        return
    }

    if (showDetailCard.value) {
        // 如果当前显示DetailCard但历史状态不支持，关闭DetailCard
        showDetailCard.value = false
        selectedItem.value = null
    }
}

// 初始加载
onMounted(async () => {
    await initContent()

    // 等待DOM渲染完成后强制检查首屏图片
    nextTick(() => {
        setTimeout(() => {
            forceCheckFirstScreenImages()
        }, 100) // 稍微延迟确保DOM完全渲染
    })

    // 添加滚动监听
    window.addEventListener('scroll', handleScroll, { passive: true })
    // 添加窗口大小变化监听
    window.addEventListener('resize', handleResize, { passive: true })
    // 添加浏览器后退/前进监听
    window.addEventListener('popstate', handlePopState)

    // 启动图片加载监控
    startImageLoadingMonitor()

    // 添加强制检查事件监听器
    document.addEventListener('force-recheck', handleForceRecheck)
})

// 简化的图片加载监控
const startImageLoadingMonitor = () => {
    if (imageMonitorTimer.value) {
        clearInterval(imageMonitorTimer.value)
    }

    // 统一的监控定时器，每15秒检查一次
    imageMonitorTimer.value = setInterval(() => {
        checkImageLoadingStatus()
    }, 15000)
}

// 统一的图片加载状态检查
const checkImageLoadingStatus = () => {
    const allItems = document.querySelectorAll('.waterfall-item')
    let stuckCount = 0

    allItems.forEach((item, index) => {
        const rect = item.getBoundingClientRect()
        const img = item.querySelector('.lazy-image')

        // 检查是否在视口内或首屏
        const isInViewport = rect.top < window.innerHeight + 200 && rect.bottom > -200
        const isFirstScreen = index < columnCount.value * 2

        if ((isInViewport || isFirstScreen) && img) {
            const isStuck = !img.src || img.src === 'data:' || img.style.opacity === '0'

            if (isStuck) {
                stuckCount++
                const imgSrc = img.getAttribute('v-img-lazy') || img.dataset.src
                if (imgSrc) {
                    loadImageDirectly(img, imgSrc)
                }
            }
        }
    })

}



// 简化的布局恢复
const triggerLayoutRecovery = () => {
    // 直接调用统一的检查函数
    checkImageLoadingStatus()
}

// 处理强制重新检查事件
const handleForceRecheck = () => {
    checkImageLoadingStatus()
}

// 简化的首屏图片检查
const forceCheckFirstScreenImages = () => {
    const allItems = document.querySelectorAll('.waterfall-item')
    let checkedCount = 0

    allItems.forEach((item, index) => {
        // 只检查前两行的图片
        if (index >= columnCount.value * 2) return

        const img = item.querySelector('.lazy-image')
        if (img && (!img.src || img.src === 'data:' || img.style.opacity === '0')) {
            const imgSrc = img.getAttribute('v-img-lazy') || img.dataset.src
            if (imgSrc) {
                loadImageDirectly(img, imgSrc)
                checkedCount++
            }
        }
    })

}

// 直接加载图片（绕过队列机制）
const loadImageDirectly = (imgElement, src) => {
    const img = new Image()

    // 5秒超时机制
    const timeout = setTimeout(() => {
        img.onload = null
        img.onerror = null
        // 根据图片类型选择不同的占位图
        const isAvatar = imgElement.classList.contains('lazy-avatar')
        const placeholderImg = isAvatar ? defaultAvatar : defaultPlaceholder
        imgElement.src = placeholderImg
        imgElement.alt = '图片加载超时'
        imgElement.style.opacity = '1'
        imgElement.style.visibility = 'visible'
        imgElement.dispatchEvent(new Event('load'))
    }, 5000)

    img.onload = () => {
        clearTimeout(timeout)
        imgElement.src = src
        imgElement.style.opacity = '1'
        imgElement.style.visibility = 'visible'
        imgElement.classList.add('fade-in')
        imgElement.dispatchEvent(new Event('load'))
    }

    img.onerror = () => {
        clearTimeout(timeout)
        // 根据图片类型选择不同的占位图
        const isAvatar = imgElement.classList.contains('lazy-avatar')
        const placeholderImg = isAvatar ? defaultAvatar : defaultPlaceholder
        imgElement.src = placeholderImg
        imgElement.alt = '图片加载失败'
        imgElement.style.opacity = '1'
        imgElement.style.visibility = 'visible'
        imgElement.dispatchEvent(new Event('load'))
    }

    img.src = src
}



// 组件卸载时移除监听
const cleanup = () => {
    window.removeEventListener('scroll', handleScroll)
    window.removeEventListener('resize', handleResize)
    window.removeEventListener('popstate', handlePopState)
    document.removeEventListener('force-recheck', handleForceRecheck)

    // 清理防抖定时器
    if (scrollTimer) {
        clearTimeout(scrollTimer)
        scrollTimer = null
    }
    if (resizeTimer) {
        clearTimeout(resizeTimer)
        resizeTimer = null
    }

    // 清理图片监控定时器
    if (imageMonitorTimer.value) {
        clearInterval(imageMonitorTimer.value)
        imageMonitorTimer.value = null
    }
}

onUnmounted(cleanup)

function onCardClick(item, event) {
    // 记录点击位置
    clickPosition.value = {
        x: event.clientX,
        y: event.clientY
    }
    // 设置选中的item并显示详情卡片（使用深拷贝避免影响原始数据）
    selectedItem.value = JSON.parse(JSON.stringify(item))
    showDetailCard.value = true

    // 记录浏览历史（登录用户）
    if (userStore.isLoggedIn && item.id) {
        userApi.recordHistory(item.id).catch(error => {
            console.debug('记录浏览历史失败:', error)
        })
    }

    // 修改页面标题
    const originalTitle = document.title
    document.title = item.title || '笔记详情'

    // 使用History API添加历史记录并更新URL
    const newUrl = `/post?id=${item.id}`
    window.history.pushState(
        {
            previousUrl: window.location.pathname + window.location.search,
            showDetailCard: true,
            postId: item.id,
            originalTitle: originalTitle
        },
        item.title || '笔记详情',
        newUrl
    )
}

// 关闭详情卡片
function closeDetailCard() {
    showDetailCard.value = false
    selectedItem.value = null

    // 恢复原始页面标题
    if (window.history.state && window.history.state.originalTitle) {
        document.title = window.history.state.originalTitle
    }

    // 恢复原URL状态
    if (window.history.state && window.history.state.previousUrl) {
        window.history.replaceState(window.history.state, '', window.history.state.previousUrl)
    } else {
        // 如果没有前一个URL，回到当前页面的原始状态
        window.history.back()
    }
}

// 用户点击处理函数
function onUserClick(userId, event) {
    event.stopPropagation() // 阻止事件冒泡，避免触发卡片点击
    if (userId) {
        // 使用汐社号作为用户页面路径参数
        const userUrl = `${window.location.origin}/user/${userId}`
        window.open(userUrl, '_blank')
    }
}

// DetailCard事件处理函数
function handleDetailCardFollow(userId) {
    emit('follow', userId)
}

function handleDetailCardUnfollow(userId) {
    emit('unfollow', userId)
}

// 处理DetailCard的点赞事件
const handleDetailCardLike = (data) => {
    emit('like', data)
}

// 处理DetailCard的收藏事件
const handleDetailCardCollect = (data) => {
    emit('collect', data)
}

// 删除单条浏览历史
async function onDeleteHistory(item) {
    try {
        const response = await userApi.deleteHistoryItem(item.id)
        if (response.success) {
            // 从列表中移除该项目
            removeItemFromColumns(item.id)
            emit('deleteHistory', { id: item.id, success: true })
        } else {
            // API返回失败
            console.error('删除浏览历史失败: API返回失败')
            emit('deleteHistory', { id: item.id, success: false, error: 'API返回失败' })
        }
    } catch (error) {
        console.error('删除浏览历史失败:', error)
        emit('deleteHistory', { id: item.id, success: false, error })
    }
}

// 从列表和列中移除指定项目
function removeItemFromColumns(itemId) {
    // 从contentList中移除
    const index = contentList.value.findIndex(item => item.id === itemId)
    if (index > -1) {
        contentList.value.splice(index, 1)
    }
    
    // 从columns中移除
    for (let i = 0; i < columns.value.length; i++) {
        const colIndex = columns.value[i].findIndex(item => item.id === itemId)
        if (colIndex > -1) {
            columns.value[i].splice(colIndex, 1)
            break
        }
    }
}

async function onLikeClick(item, willBeLiked, e) {
    e.stopPropagation()

    // 检查用户是否已登录
    if (!userStore.isLoggedIn) {
        // 显示登录模态框
        authStore.openLoginModal()
        return
    }

    try {
        // 从点赞状态管理器获取当前状态
        const currentState = likeStore.getPostLikeState(item.id)

        // willBeLiked已经表示将要变成的状态，currentLiked应该是当前状态
        const currentLiked = currentState.liked

        // 使用点赞状态管理
        const result = await likeStore.togglePostLike(item.id, currentLiked, currentState.likeCount)

        if (!result.success) {
            console.error('点赞操作失败:', result.error)
        }
    } catch (error) {
        console.error('点赞操作失败:', error)
    }
}

// 图片加载完成回调
function onImageLoaded(itemId, type) {
    if (itemLoadingStates.value[itemId]) {
        itemLoadingStates.value[itemId][type] = true

        // 如果是主图片加载完成，更新实际高度
        if (type === 'imageLoaded') {
            updateItemHeight(itemId)
        }
    }
}

// 检查item是否完全加载完成 - 只需要主图片加载完成即可
function isItemFullyLoaded(itemId) {
    const state = itemLoadingStates.value[itemId]
    // 只要主图片加载完成就显示内容，头像可以后续加载
    return state && state.imageLoaded
}

// 淡入动画结束处理
function onFadeInEnd(item) {
    if (newItemAnimStates.value[item.id]) {
        // 动画结束后移除新内容标记，避免重复动画
        delete newItemAnimStates.value[item.id]
    }
}

// 处理头像加载失败
function handleAvatarError(event) {
    if (event.target) {
        event.target.src = defaultAvatar
    }
}

// 处理封面图加载失败
function handleImageError(event) {
    if (event.target) {
        event.target.src = defaultPlaceholder
    }
}


</script>
<template>

    <SkeletonList v-if="loading" :count="8" type="image-card" layout="waterfall" image-height="random"
        :show-stats="false" :show-button="false" list-class="waterfall-layout" />


    <div v-else ref="containerRef" class="waterfall-container">

        <div v-if="contentList.length === 0 && !loadingMore" class="empty-state">
            <div class="empty-text">
                <template v-if="props.type === 'posts'">
                    还没有发布任何内容
                </template>
                <template v-else-if="props.type === 'collections'">
                    还没有收藏任何内容
                </template>
                <template v-else-if="props.type === 'likes'">
                    还没有点赞任何内容
                </template>
                <template v-else-if="props.type === 'history'">
                    暂无浏览记录
                </template>
                <template v-else-if="props.searchKeyword">
                    没有找到相关内容
                </template>
                <template v-else>
                    暂无内容
                </template>
            </div>
        </div>

        <div v-else class="waterfall-columns" :style="{ gap: columnGap + 'px' }">

            <div v-for="(column, columnIndex) in columns" :key="columnIndex" class="waterfall-column">

                <div v-for="item in column" :key="item.id" :data-item-id="item.id" class="waterfall-item" :class="{
                    'new-item': newItemAnimStates[item.id]?.isNew,
                    'fade-in': newItemAnimStates[item.id]?.fadeIn
                }" @animationend="onFadeInEnd(item)">

                    <BaseSkeleton v-if="!isItemFullyLoaded(item.id)" type="image-card" image-height="random"
                        :show-stats="false" :show-button="false" />


                    <div class="item-content" :class="{ 'content-hidden': !isItemFullyLoaded(item.id) }">
                        <div class="content-img" @click="onCardClick(item, $event)">
                            <img v-img-lazy="item.image" alt="" class="lazy-image" @error="handleImageError"
                                @load="onImageLoaded(item.id, 'imageLoaded')">
                            <!-- 视频笔记标志 -->
                            <div v-if="item.type === 2" class="video-indicator">
                                <SvgIcon name="play" width="12" height="12" />
                            </div>
                            <!-- 历史记录删除按钮 -->
                            <button v-if="props.type === 'history'" class="history-delete-btn" @click.stop="onDeleteHistory(item)" aria-label="删除历史记录" title="删除历史记录">
                                <SvgIcon name="close" width="14" height="14" />
                            </button>
                        </div>
                        <div class="content-title">{{ item.title }}</div>
                        <div class="contentlist">
                            <img v-img-lazy="item.avatar" alt="" class="lazy-avatar clickable-avatar"
                                @error="handleAvatarError" @load="onImageLoaded(item.id, 'avatarLoaded')"
                                @click="onUserClick(item.author_account, $event)">
                            <div class="contentlist-name clickable-name"
                                @click="onUserClick(item.author_account, $event)">
                                {{ item.author }}</div>
                            <div class="action-wrapper">
                                <div class="like-num-wrapper">
                                    <LikeButton :is-liked="likeStore.getPostLikeState(item.id).liked"
                                        @click="(willBeLiked, event) => onLikeClick(item, willBeLiked, event)" />
                                    <span class="like-num">{{ likeStore.getPostLikeState(item.id).likeCount }}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>


        <div class="load-more-indicator" :class="{ 'no-more-content': !hasMore && contentList.length > 0 }">
            <div v-if="loadingMore" class="loading-more">
                <SimpleSpinner size="24" />
                <span class="loading-text">加载中...</span>
            </div>
            <div v-else-if="!hasMore && contentList.length > 0" class="no-more">
                <span class="no-more-text">没有更多内容了</span>
            </div>
        </div>
    </div>


    <Teleport to="body">
        <DetailCard v-if="showDetailCard" :item="selectedItem" :click-position="clickPosition" @close="closeDetailCard"
            @follow="handleDetailCardFollow" @unfollow="handleDetailCardUnfollow" @like="handleDetailCardLike"
            @collect="handleDetailCardCollect" />
    </Teleport>


</template>
<style scoped>
/* 瀑布流容器 */
.waterfall-container {
    width: 100%;
    position: relative;
    padding: 0 16px;
    box-sizing: border-box;
    /* 确保容器有正确的层级和渲染上下文 */
    isolation: isolate;
}

/* 瀑布流列容器 */
.waterfall-columns {
    display: flex;
    align-items: flex-start;
    width: 100%;
    gap: 16px;
    /* 优化大屏多列布局的渲染性能 */
    contain: layout style;
    /* 禁用硬件加速可能导致的渲染问题 */
    transform: none;
    will-change: auto;
}

/* 瀑布流列 */
.waterfall-column {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 16px;
    /* 确保列有正确的最小宽度 */
    min-width: 0;
    /* 优化列的渲染 */
    contain: layout;
}

/* 瀑布流项目 */
.waterfall-item {
    width: 100%;
    border-radius: 10px;
    overflow: hidden;
    background-color: var(--bg-color-primary);
    position: relative;
    box-sizing: border-box;
    transition: border-color 0.2s ease, background-color 0.2s ease;
    /* 修复大屏多列可能的显示问题 */
    visibility: visible;
    opacity: 1;
    /* 确保内容不被意外隐藏 */
    contain: layout style paint;
    /* 避免transform导致的层级问题 */
    transform: translateZ(0);
    backface-visibility: hidden;
}

/* 优化动画性能 */
.waterfall-item.new-item {
    opacity: 0;
    transform: translateY(20px) translateZ(0);
    transition: opacity 0.6s ease-out, transform 0.6s ease-out;
    /* 确保动画不影响布局 */
    will-change: opacity, transform;
}

.waterfall-item.new-item.fade-in {
    opacity: 1;
    transform: translateY(0) translateZ(0);
}

/* 动画完成后移除will-change */
.waterfall-item:not(.new-item) {
    will-change: auto;
}

/* 空状态样式 */
.empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    min-height: 200px;
}

.empty-text {
    color: var(--text-color-secondary);
    font-size: 16px;
    line-height: 1.5;
}

/* 隐藏未加载完成的真实内容 */
.content-hidden {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    opacity: 0;
    pointer-events: none;
    z-index: -1;
    /* 确保隐藏内容不影响布局 */
    visibility: hidden;
}

.content-img {
    cursor: pointer;
    /* 优化图片容器的渲染 */
    position: relative;
    overflow: hidden;
    /* 确保图片容器有正确的层级 */
    z-index: 1;
}

/* 视频笔记标志样式 */
.video-indicator {
    position: absolute;
    top: 8px;
    right: 8px;
    width: 20px;
    height: 20px;
    background: rgba(0, 0, 0, 0.323);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    z-index: 2;
    backdrop-filter: blur(4px);
    transition: all 0.2s ease;
}

/* 历史记录删除按钮样式 */
.history-delete-btn {
    position: absolute;
    top: 8px;
    left: 8px;
    width: 24px;
    height: 24px;
    background: rgba(0, 0, 0, 0.5);
    border-radius: 50%;
    border: none;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    z-index: 3;
    backdrop-filter: blur(4px);
    cursor: pointer;
    opacity: 0;
    transition: all 0.2s ease;
}

.content-img:hover .history-delete-btn {
    opacity: 1;
}

.history-delete-btn:hover {
    background: rgba(255, 77, 79, 0.8);
    transform: scale(1.1);
}


.content-img img {
    width: 100%;
    height: auto;
    object-fit: cover;
    border-radius: 10px;
    display: block;
    max-width: 100%;
    opacity: 1;
    visibility: visible;
    object-position: center;
    transition: filter 0.8s ease;
}

.content-img img:hover {
    filter: brightness(0.7);
}

/* 懒加载图片样式 */
.lazy-image {
    transition: opacity 0.5s ease, filter 0.3s ease !important;
    opacity: 0;
    visibility: hidden;
}

.lazy-image.fade-in {
    opacity: 1 !important;
    visibility: visible !important;
}

/* 加载完成的图片确保显示 */
.lazy-image[src]:not([src=""]):not([src="data:"]) {
    opacity: 1;
    visibility: visible;
}

/* 懒加载头像样式 */
.lazy-avatar {
    transition: opacity 0.3s ease;
    opacity: 1;
    visibility: visible;
}

.lazy-avatar.fade-in {
    opacity: 1 !important;
    visibility: visible !important;
}

.content-title {
    margin: 5px 10px;
    font-size: 14px;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
}

.contentlist {
    display: flex;
    align-items: center;
    padding: 10px;
}

.contentlist img {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    margin-right: 5px;
}

.clickable-avatar {
    cursor: pointer;
}

.contentlist-name {
    font-size: 12px;
    color: var(--text-color-secondary);
    white-space: nowrap;
    text-overflow: ellipsis;
    overflow: hidden;
    flex: 1;
}

.clickable-name {
    cursor: pointer;
    transition: color 0.2s ease;
}

.clickable-name:hover {
    color: var(--text-color-primary);
}

.action-wrapper {
    display: flex;
    align-items: center;
    margin-left: auto;
}

.like-num-wrapper {
    display: flex;
    align-items: center;
    gap: 4px;
}

.like-num {
    font-size: 12px;
    color: var(--text-color-secondary);
}

/* 加载更多指示器样式 */
.load-more-indicator {
    width: 100%;
    padding: 15px 0;
    display: flex;
    justify-content: center;
    align-items: center;
}

/* 没有更多内容时减少底部空间 */
.load-more-indicator.no-more-content {
    padding: 8px 0 5px 0;
    margin: 0;
    min-height: auto;
}

.loading-more {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 10px;
}

.loading-text {
    color: var(--text-color-secondary);
    font-size: 14px;
}

.no-more {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 10px 0;
}

.no-more-text {
    color: var(--text-color-tertiary);
    font-size: 12px;
    position: relative;
}

.no-more-text::before,
.no-more-text::after {
    content: '';
    position: absolute;
    top: 50%;
    width: 40px;
    height: 1px;
    background: var(--border-color-secondary);
}

.no-more-text::before {
    right: 100%;
    margin-right: 10px;
}

.no-more-text::after {
    left: 100%;
    margin-left: 10px;
}



/* 响应式设计优化 */
@media (min-width: 1420px) {
    .waterfall-columns {
        gap: 20px;
    }

    .waterfall-column {
        gap: 20px;
    }
}

@media (min-width: 1200px) {
    .waterfall-columns {
        gap: 18px;
    }

    .waterfall-column {
        gap: 18px;
    }
}

@media (max-width: 600px) {
    .waterfall-container {
        padding: 0 12px;
    }

    .waterfall-columns {
        gap: 12px;
    }

    .waterfall-column {
        gap: 12px;
    }
}
</style>