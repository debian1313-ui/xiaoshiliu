import { postApi } from './index.js'
import request from './request.js'
import apiConfig from '@/config/api.js'
import { hasViewedPost, markPostAsViewed } from '@/utils/viewTracker.js'

// 转换后端数据格式为前端瀑布流需要的格式
function transformPostData(backendPost) {
  // 输出后端返回的付费设置数据（调试用）
  if (backendPost.paymentSettings) {
    console.log('🔄 [transformPostData] 后端付费设置:', {
      postId: backendPost.id,
      paymentSettings: backendPost.paymentSettings,
      preview_video_url: backendPost.preview_video_url,
      video_url: backendPost.video_url
    })
  }

  const likeCount = backendPost.like_count || 0
  const liked = backendPost.liked || false


  const collectCount = backendPost.collect_count || 0
  const commentCount = backendPost.comment_count || 0

  // 处理图片数据：提取封面图片URL（兼容字符串和对象格式）
  let coverImage = new URL('@/assets/imgs/未加载.png', import.meta.url).href
  if (backendPost.images && backendPost.images.length > 0) {
    const firstImage = backendPost.images[0]
    coverImage = typeof firstImage === 'object' ? firstImage.url : firstImage
  }

  const transformedData = {
    id: backendPost.id,
    image: coverImage,
    title: backendPost.title,
    content: backendPost.content,
    images: backendPost.images || [],
    // 视频相关字段
    video_url: backendPost.video_url,
    preview_video_url: backendPost.preview_video_url,
    cover_url: backendPost.cover_url,
    videos: backendPost.videos || [],
    avatar: backendPost.user_avatar || new URL('@/assets/imgs/avatar.png', import.meta.url).href,
    author: backendPost.nickname || '匿名用户',
    // 保留原始字段名以供 DetailCard 使用
    nickname: backendPost.nickname || '匿名用户',
    user_avatar: backendPost.user_avatar || new URL('@/assets/imgs/avatar.png', import.meta.url).href,
    location: backendPost.location || '',
    // 统计数据 - 统一使用后端字段名
    view_count: backendPost.view_count || 0,
    like_count: backendPost.like_count || 0,
    comment_count: backendPost.comment_count || 0,
    collect_count: backendPost.collect_count || 0,
    // 兼容旧的字段名
    likeCount: likeCount,
    collectCount: collectCount,
    commentCount: commentCount,
    // 状态字段
    liked: liked,
    collected: backendPost.collected || false,
    // 认证状态字段
    verified: backendPost.verified || 0,
    author_verified: backendPost.verified || 0,
    // 附件字段
    attachment: backendPost.attachment || null,
    // 付费设置字段
    paymentSettings: backendPost.paymentSettings || null,
    hasPurchased: backendPost.hasPurchased || false,
    // 可见性字段
    visibility: backendPost.visibility || 'public',
    // 其他字段
    created_at: backendPost.created_at,
    path: `/post/${backendPost.id}`,
    category: backendPost.category,
    type: backendPost.type || 1,
    author_auto_id: backendPost.author_auto_id,
    author_account: backendPost.author_account,
    user_id: backendPost.user_id,
    // 付费图片相关信息（后端过滤后返回的隐藏付费图片数量）
    hiddenPaidImagesCount: backendPost.hiddenPaidImagesCount || 0,
    totalImagesCount: backendPost.totalImagesCount || (backendPost.images ? backendPost.images.length : 0),
    // 推荐算法调试信息
    _recommendationScore: backendPost._recommendationScore || null,
    _scoreBreakdown: backendPost._scoreBreakdown || null,
    // 保留原始数据以备需要
    originalData: {
      content: backendPost.content,
      images: backendPost.images || [],
      tags: backendPost.tags || [],
      createdAt: backendPost.created_at,
      userId: backendPost.user_id,
      paymentSettings: backendPost.paymentSettings || null,
      visibility: backendPost.visibility || 'public',
      hiddenPaidImagesCount: backendPost.hiddenPaidImagesCount || 0,
      totalImagesCount: backendPost.totalImagesCount || (backendPost.images ? backendPost.images.length : 0),
      _recommendationScore: backendPost._recommendationScore || null,
      _scoreBreakdown: backendPost._scoreBreakdown || null
    }
  }

  return transformedData;
}

// 获取笔记列表
export async function getPostList(params = {}) {
  const {
    page = 1,
    limit = 20,
    category,
    searchKeyword,
    searchTag,
    userId,
    type,
    sort
  } = params

  try {


    let response

    // 如果指定了用户ID和类型（收藏或点赞），获取用户的收藏或点赞内容
    if (userId && type) {
      if (type === 'collections') {
        // 获取用户收藏的笔记
        response = await fetch(`${apiConfig.baseURL}/users/${userId}/collections?page=${page}&limit=${limit}`, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          }
        }).then(res => res.json())

        if (response && response.code === 200 && response.data && response.data.collections) {
          return {
            posts: response.data.collections.map(transformPostData),
            pagination: response.data.pagination,
            hasMore: response.data.pagination.page < response.data.pagination.pages
          }
        }
      } else if (type === 'likes') {
        // 获取用户点赞的笔记
        response = await fetch(`${apiConfig.baseURL}/users/${userId}/likes?page=${page}&limit=${limit}`, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          }
        }).then(res => res.json())

        if (response && response.code === 200 && response.data && response.data.posts) {
          return {
            posts: response.data.posts.map(transformPostData),
            pagination: response.data.pagination,
            hasMore: response.data.pagination.page < response.data.pagination.pages
          }
        }
      } else if (type === 'history') {
        // 获取用户浏览历史
        response = await fetch(`${apiConfig.baseURL}/users/history?page=${page}&limit=${limit}`, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          }
        }).then(res => res.json())

        if (response && response.code === 200 && response.data && response.data.posts) {
          return {
            posts: response.data.posts.map(transformPostData),
            pagination: response.data.pagination,
            hasMore: response.data.pagination.page < response.data.pagination.pages
          }
        }
      } else if (type === 'posts') {
        // 获取用户自己发布的笔记
        const searchParams = new URLSearchParams({
          page: page.toString(),
          limit: limit.toString()
        })

        if (category) {
          searchParams.append('category', category)
        }

        if (searchKeyword && searchKeyword.trim()) {
          searchParams.append('keyword', searchKeyword.trim())
        }

        if (sort) {
          searchParams.append('sort', sort)
        }

        response = await fetch(`${apiConfig.baseURL}/users/${userId}/posts?${searchParams.toString()}`, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          }
        }).then(res => res.json())

        if (response && response.code === 200 && response.data && response.data.posts) {
          return {
            posts: response.data.posts.map(transformPostData),
            pagination: response.data.pagination,
            hasMore: response.data.pagination.page < response.data.pagination.pages
          }
        }
      } else if (type === 'private') {
        // 获取用户自己的私密笔记
        const searchParams = new URLSearchParams({
          page: page.toString(),
          limit: limit.toString(),
          visibility: 'private'
        })

        if (category) {
          searchParams.append('category', category)
        }

        if (searchKeyword && searchKeyword.trim()) {
          searchParams.append('keyword', searchKeyword.trim())
        }

        if (sort) {
          searchParams.append('sort', sort)
        }

        response = await fetch(`${apiConfig.baseURL}/users/${userId}/posts?${searchParams.toString()}`, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          }
        }).then(res => res.json())

        if (response && response.code === 200 && response.data && response.data.posts) {
          return {
            posts: response.data.posts.map(transformPostData),
            pagination: response.data.pagination,
            hasMore: response.data.pagination.page < response.data.pagination.pages
          }
        }
      }
    } else if ((searchKeyword && searchKeyword.trim()) || (searchTag && searchTag.trim())) {
      // 如果有搜索关键词或标签，使用新的统一搜索API
      const searchParams = new URLSearchParams({
        type: type || 'posts',
        page: page.toString(),
        limit: limit.toString()
      })

      if (searchKeyword && searchKeyword.trim()) {
        searchParams.append('keyword', searchKeyword.trim())
      }

      if (searchTag && searchTag.trim()) {
        searchParams.append('tag', searchTag.trim())
      }

      response = await fetch(`${apiConfig.baseURL}/search?${searchParams.toString()}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      }).then(res => res.json())

      // 适配新的搜索API返回格式 - posts模式返回笔记数据
      if (response && response.code === 200 && response.data && response.data.posts && response.data.posts.data) {
        return {
          posts: response.data.posts.data.map(transformPostData),
          pagination: response.data.posts.pagination,
          hasMore: response.data.posts.pagination.page < response.data.posts.pagination.pages
        }
      }
    } else if (userId) {
      // 如果指定了用户ID，获取该用户发布的笔记
      const apiParams = { page, limit, user_id: userId }
      if (category && category !== 'general') {
        apiParams.category = category
      }
      if (type) {
        apiParams.type = type
      }
      response = await postApi.getPosts(apiParams)
    } else {
      // 否则使用普通的获取笔记列表API
      const apiParams = { page, limit }
      if (category && category !== 'general') {
        apiParams.category = category
      }
      if (type) {
        apiParams.type = type
      }
      response = await postApi.getPosts(apiParams)
    }



    if (response && response.data && response.data.posts) {
      const transformedPosts = response.data.posts.map(transformPostData)

      return {
        posts: transformedPosts,
        pagination: response.data.pagination,
        hasMore: response.data.pagination.page < response.data.pagination.pages
      }
    }
  } catch (error) {
    console.error('获取笔记列表失败:', error)
  }

  // 如果API调用失败，返回空数据
  return {
    posts: [],
    pagination: {
      page,
      limit,
      total: 0,
      pages: 0
    },
    hasMore: false
  }
}

// 获取笔记详情
export async function getPostDetail(postId) {
  try {
    // 检查是否已经浏览过该帖子
    const alreadyViewed = hasViewedPost(postId)

    let response
    if (alreadyViewed) {
      // 如果已经浏览过，调用不增加浏览量的API
      response = await request.get(`/posts/${postId}?skipViewCount=true`)
    } else {
      // 如果未浏览过，调用正常API（会增加浏览量）
      response = await postApi.getPostDetail(postId)
      // 标记为已浏览
      markPostAsViewed(postId)
    }

    if (response && response.data) {
      return transformPostData(response.data)
    }
  } catch (error) {
    console.error('获取笔记详情失败:', error)
  }

  return null
}

// 点赞笔记
export async function likePost(postId) {
  try {
    const response = await postApi.likePost(postId)
    return response
  } catch (error) {
    console.error('点赞失败:', error)
    throw error
  }
}

// 取消点赞笔记
export async function unlikePost(postId) {
  try {
    const response = await postApi.unlikePost(postId)
    return response
  } catch (error) {
    console.error('取消点赞失败:', error)
    throw error
  }
}

// 收藏笔记
export async function collectPost(postId) {
  try {
    const response = await postApi.collectPost(postId)
    return response
  } catch (error) {
    console.error('收藏失败:', error)
    throw error
  }
}

// 取消收藏笔记
export async function uncollectPost(postId) {
  try {
    const response = await postApi.uncollectPost(postId)
    return response
  } catch (error) {
    console.error('取消收藏失败:', error)
    throw error
  }
}

// 创建笔记
export async function createPost(data) {
  try {
    const response = await postApi.createPost(data)
    return {
      success: true,
      data: response.data,
      message: response.message
    }
  } catch (error) {
    console.error('创建笔记失败:', error)
    return {
      success: false,
      message: error.response?.data?.message || '创建笔记失败'
    }
  }
}

// 获取用户笔记列表
export async function getUserPosts(params = {}) {
  try {
    const {
      page = 1,
      limit = 10,
      keyword,
      category,
      sort = 'created_at',
      user_id
    } = params

    const queryParams = {
      page,
      limit,
      userId: user_id,
      type: 'posts',
      searchKeyword: keyword,
      category,
      sort
    }

    const response = await getPostList(queryParams)

    return {
      success: true,
      data: {
        posts: response.posts || [],
        pagination: response.pagination || {
          page: 1,
          pages: 1,
          total: 0
        }
      }
    }
  } catch (error) {
    console.error('获取用户笔记失败:', error)
    return {
      success: false,
      message: error.response?.data?.message || '获取笔记失败'
    }
  }
}

// 更新笔记
export async function updatePost(postId, data) {
  try {
    const response = await postApi.updatePost(postId, data)
    return {
      success: true,
      data: response.data,
      message: response.message || '更新成功'
    }
  } catch (error) {
    console.error('更新笔记失败:', error)
    return {
      success: false,
      message: error.response?.data?.message || '更新笔记失败'
    }
  }
}

// 删除笔记
export async function deletePost(postId) {
  try {
    const response = await postApi.deletePost(postId)
    return {
      success: true,
      message: response.message || '删除成功'
    }
  } catch (error) {
    console.error('删除笔记失败:', error)
    return {
      success: false,
      message: error.response?.data?.message || '删除笔记失败'
    }
  }
}

// 获取草稿列表
export async function getDraftPosts(params = {}) {
  try {
    const {
      page = 1,
      limit = 10,
      keyword = '',
      category = '',
      sort = 'created_at',
      user_id
    } = params

    const queryParams = {
      page,
      limit,
      keyword,
      category,
      sort,
      user_id,
      is_draft: 1 // 只获取草稿
    }

    // 过滤空值参数
    Object.keys(queryParams).forEach(key => {
      if (queryParams[key] === '' || queryParams[key] === null || queryParams[key] === undefined) {
        delete queryParams[key]
      }
    })

    const response = await request.get('/posts', { params: queryParams })

    if (response.success && response.data && response.data.posts) {
      const transformedPosts = response.data.posts.map(transformPostData)

      return {
        success: true,
        data: {
          posts: transformedPosts,
          pagination: response.data.pagination
        }
      }
    } else {
      return {
        success: false,
        message: response.message || '获取草稿列表失败',
        data: {
          posts: [],
          pagination: {
            page: 1,
            pages: 1,
            total: 0
          }
        }
      }
    }
  } catch (error) {
    console.error('获取草稿列表失败:', error)
    return {
      success: false,
      message: error.response?.data?.message || '获取草稿列表失败，请重试',
      data: {
        posts: [],
        pagination: {
          page: 1,
          pages: 1,
          total: 0
        }
      }
    }
  }
}

// 获取关注用户的笔记列表
export async function getFollowingPosts(params = {}) {
  const {
    page = 1,
    limit = 20,
    sort = 'time', // 'time' 或 'hot'
    type
  } = params

  try {
    const token = localStorage.getItem('token')
    if (!token) {
      console.warn('获取关注用户笔记需要登录')
      return {
        posts: [],
        recommendedUsers: [],
        hasFollowing: false,
        pagination: { page, limit, total: 0, pages: 0 },
        hasMore: false
      }
    }

    const queryParams = new URLSearchParams({
      page: page.toString(),
      limit: limit.toString(),
      sort
    })

    if (type) {
      queryParams.append('type', type.toString())
    }

    const response = await fetch(`${apiConfig.baseURL}/posts/following?${queryParams.toString()}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    }).then(res => res.json())

    if (response && response.code === 200 && response.data) {
      return {
        posts: (response.data.posts || []).map(transformPostData),
        recommendedUsers: response.data.recommendedUsers || [],
        hasFollowing: response.data.hasFollowing,
        pagination: response.data.pagination,
        hasMore: response.data.pagination.page < response.data.pagination.pages
      }
    } else {
      console.error('获取关注用户笔记返回错误:', response)
    }
  } catch (error) {
    console.error('获取关注用户笔记列表失败:', error)
  }

  // 如果API调用失败，返回空数据
  return {
    posts: [],
    recommendedUsers: [],
    hasFollowing: false,
    pagination: {
      page,
      limit,
      total: 0,
      pages: 0
    },
    hasMore: false
  }
}

/**
 * 检查推荐算法调试模式是否启用
 * @returns {boolean}
 */
function isRecommendationDebugEnabled() {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return false
  }
  return import.meta.env.VITE_RECOMMENDATION_DEBUG === 'true' || 
         localStorage.getItem('recommendationDebug') === 'true'
}

/**
 * 在控制台输出推荐算法调试信息
 * @param {Object} debugData - 后端返回的调试数据
 * @param {Array} posts - 推荐的笔记列表
 */
function logRecommendationDebug(debugData, posts) {
  if (!isRecommendationDebugEnabled()) {
    return
  }

  console.group('📊 [推荐算法] 调试信息')
  
  // 基本统计
  console.log('%c📈 推荐统计', 'color: #4CAF50; font-weight: bold;')
  console.table({
    '用户ID': debugData?.userId || '未登录',
    '候选笔记数': debugData?.statistics?.totalCandidates || 0,
    '评分笔记数': debugData?.statistics?.scoredPosts || 0,
    '返回笔记数': debugData?.statistics?.returnedPosts || 0,
    '执行时间(ms)': debugData?.statistics?.executionTimeMs || 0
  })

  // 输出各阶段详情
  if (debugData?.phases && debugData.phases.length > 0) {
    console.log('%c🔄 执行阶段', 'color: #2196F3; font-weight: bold;')
    debugData.phases.forEach(phase => {
      console.log(`  [${phase.phase}]`, phase.data || '')
    })
  }

  // 输出详细评分信息
  if (debugData?.scoringDetails && debugData.scoringDetails.length > 0) {
    console.log('%c🎯 笔记评分详情 (Top 20)', 'color: #FF9800; font-weight: bold;')
    console.table(debugData.scoringDetails.slice(0, 20).map(item => ({
      '排名': debugData.scoringDetails.indexOf(item) + 1,
      '笔记ID': item.postId,
      '标题': item.title,
      '总分': item.score,
      '基础分': item.breakdown?.base || 0,
      '分类匹配': item.breakdown?.category || 0,
      '标签匹配': item.breakdown?.tag || 0,
      '社交加成': item.breakdown?.social || 0,
      '热门度': item.breakdown?.popularity || 0,
      '兴趣匹配': item.breakdown?.interest || 0,
      '时间衰减': item.breakdown?.timeDecay || 0,
      '作者': item.author
    })))
  }

  // 输出最终排名
  if (debugData?.finalRanking && debugData.finalRanking.length > 0) {
    console.log('%c🏆 最终推荐排名', 'color: #9C27B0; font-weight: bold;')
    debugData.finalRanking.forEach(item => {
      console.log(`  #${item.rank} [ID:${item.postId}] ${item.title} (分数: ${item.score})`)
    })
  }

  // 输出每个笔记的详细评分（如果需要）
  if (posts && posts.length > 0) {
    console.log('%c📝 返回笔记的推荐分数', 'color: #E91E63; font-weight: bold;')
    posts.forEach((post, index) => {
      if (post._recommendationScore) {
        const title = post.title?.substring(0, 25) || '无标题'
        const score = post._recommendationScore?.toFixed(3) || 'N/A'
        console.log(`  ${index + 1}. [${post.id}] ${title}... 分数: ${score}`)
        if (post._scoreBreakdown) {
          console.log('     评分详情:', post._scoreBreakdown)
        }
      }
    })
  }

  console.groupEnd()
}

/**
 * 获取推荐笔记列表 - 使用精准推荐算法
 * @param {Object} params - 请求参数
 * @returns {Object} 推荐结果
 */
export async function getRecommendedPosts(params = {}) {
  const {
    page = 1,
    limit = 20,
    type
  } = params

  try {
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null
    const debug = isRecommendationDebugEnabled()
    
    const queryParams = new URLSearchParams({
      page: page.toString(),
      limit: limit.toString(),
      debug: debug.toString()
    })

    if (type) {
      queryParams.append('type', type.toString())
    }

    console.log(`📊 [推荐算法] 请求推荐列表 - 页码: ${page}`)

    const headers = {}
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }

    const response = await fetch(`${apiConfig.baseURL}/posts/recommended?${queryParams.toString()}`, {
      headers
    }).then(res => res.json())

    if (response && response.code === 200 && response.data && response.data.posts) {
      const transformedPosts = response.data.posts.map(transformPostData)
      
      // 输出推荐算法调试信息
      if (debug && response.data._recommendationDebug) {
        logRecommendationDebug(response.data._recommendationDebug, transformedPosts)
      } else if (debug && transformedPosts.some(p => p._recommendationScore)) {
        // 即使没有完整调试数据，也输出简单的分数信息
        console.log('%c📊 [推荐算法] 笔记推荐分数', 'color: #4CAF50; font-weight: bold;')
        transformedPosts.slice(0, 10).forEach((post, index) => {
          if (post._recommendationScore) {
            console.log(`  ${index + 1}. [${post.id}] ${post.title?.substring(0, 20) || '无标题'}... 分数: ${post._recommendationScore.toFixed(3)}`)
          }
        })
      }

      return {
        posts: transformedPosts,
        pagination: response.data.pagination,
        hasMore: response.data.pagination.page < response.data.pagination.pages,
        _debug: response.data._recommendationDebug || null
      }
    } else {
      console.error('获取推荐笔记返回错误:', response)
    }
  } catch (error) {
    console.error('获取推荐笔记列表失败:', error)
  }

  // 如果API调用失败，返回空数据
  return {
    posts: [],
    pagination: {
      page,
      limit,
      total: 0,
      pages: 0
    },
    hasMore: false,
    _debug: null
  }
}

/**
 * 获取热门笔记列表
 * @param {Object} params - 请求参数
 * @returns {Object} 热门笔记结果
 */
export async function getHotPosts(params = {}) {
  const {
    page = 1,
    limit = 20,
    category,
    type,
    timeRange = 7
  } = params

  try {
    const token = localStorage.getItem('token')
    
    const queryParams = new URLSearchParams({
      page: page.toString(),
      limit: limit.toString(),
      timeRange: timeRange.toString()
    })

    if (category && category !== 'recommend') {
      queryParams.append('category', category)
    }

    if (type) {
      queryParams.append('type', type.toString())
    }

    console.log(`🔥 [热门算法] 请求热门列表 - 页码: ${page}, 时间范围: ${timeRange}天`)

    const headers = {}
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }

    const response = await fetch(`${apiConfig.baseURL}/posts/hot?${queryParams.toString()}`, {
      headers
    }).then(res => res.json())

    if (response && response.code === 200 && response.data && response.data.posts) {
      const transformedPosts = response.data.posts.map(transformPostData)
      
      console.log(`🔥 [热门算法] 获取成功 - 返回 ${transformedPosts.length} 条热门笔记`)

      return {
        posts: transformedPosts,
        pagination: response.data.pagination,
        hasMore: response.data.pagination.page < response.data.pagination.pages
      }
    } else {
      console.error('获取热门笔记返回错误:', response)
    }
  } catch (error) {
    console.error('获取热门笔记列表失败:', error)
  }

  // 如果API调用失败，返回空数据
  return {
    posts: [],
    pagination: {
      page,
      limit,
      total: 0,
      pages: 0
    },
    hasMore: false
  }
}

/**
 * 启用/禁用推荐算法调试模式
 * @param {boolean} enabled - 是否启用
 */
export function setRecommendationDebugMode(enabled) {
  if (enabled) {
    localStorage.setItem('recommendationDebug', 'true')
    console.log('%c📊 [推荐算法] 调试模式已启用', 'color: #4CAF50; font-weight: bold; font-size: 14px;')
    console.log('刷新页面后，推荐算法的详细评分信息将显示在控制台中。')
    console.log('调用 setRecommendationDebugMode(false) 可禁用调试模式。')
  } else {
    localStorage.removeItem('recommendationDebug')
    console.log('%c📊 [推荐算法] 调试模式已禁用', 'color: #FF5722; font-weight: bold; font-size: 14px;')
  }
}

// 将调试函数暴露到全局，方便在控制台中调用
if (typeof window !== 'undefined') {
  window.setRecommendationDebugMode = setRecommendationDebugMode
  
  // 在控制台输出使用说明
  console.log('%c📊 推荐算法调试工具已加载', 'color: #2196F3; font-weight: bold;')
  console.log('在控制台中调用 setRecommendationDebugMode(true) 可启用推荐算法调试模式')
}