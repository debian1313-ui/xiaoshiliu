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
      paymentSettings: backendPost.paymentSettings
    })
  }

  const likeCount = backendPost.like_count || 0
  const liked = backendPost.liked || false


  const collectCount = backendPost.collect_count || 0
  const commentCount = backendPost.comment_count || 0

  const transformedData = {
    id: backendPost.id,
    image: (backendPost.images && backendPost.images[0]) || new URL('@/assets/imgs/未加载.png', import.meta.url).href,
    title: backendPost.title,
    content: backendPost.content,
    images: backendPost.images || [],
    // 视频相关字段
    video_url: backendPost.video_url,
    cover_url: backendPost.cover_url,
    videos: backendPost.videos || [],
    avatar: backendPost.user_avatar || new URL('@/assets/imgs/avatar.png', import.meta.url).href,
    author: backendPost.nickname || '匿名用户',
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
    // 其他字段
    created_at: backendPost.created_at,
    path: `/post/${backendPost.id}`,
    category: backendPost.category,
    type: backendPost.type || 1,
    author_auto_id: backendPost.author_auto_id,
    author_account: backendPost.author_account,
    user_id: backendPost.user_id,
    // 保留原始数据以备需要
    originalData: {
      content: backendPost.content,
      images: backendPost.images || [],
      tags: backendPost.tags || [],
      createdAt: backendPost.created_at,
      userId: backendPost.user_id,
      paymentSettings: backendPost.paymentSettings || null
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