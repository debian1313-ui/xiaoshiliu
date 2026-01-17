/**
 * 笔记推荐算法服务
 * 
 * 该服务实现多维度精准推荐算法：
 * 1. 基于用户行为的协同过滤（点赞、收藏、浏览历史）
 * 2. 基于内容的推荐（分类、标签匹配）
 * 3. 热门内容推荐（按互动数据排序）
 * 4. 用户兴趣匹配（基于用户 interests 字段）
 * 5. 时间衰减因子（新内容优先）
 */

const { prisma } = require('../config/config');

// 推荐算法权重配置
const WEIGHTS = {
  // 用户行为权重
  LIKE_WEIGHT: 3.0,           // 点赞权重
  COLLECT_WEIGHT: 4.0,        // 收藏权重（收藏比点赞更有价值）
  VIEW_WEIGHT: 1.0,           // 浏览权重
  
  // 内容匹配权重
  CATEGORY_WEIGHT: 2.0,       // 分类匹配权重
  TAG_WEIGHT: 2.5,            // 标签匹配权重
  
  // 社交关系权重
  FOLLOWING_WEIGHT: 3.0,      // 关注的用户发布的内容
  MUTUAL_FOLLOW_WEIGHT: 4.0,  // 互相关注的用户发布的内容
  
  // 热门度权重
  POPULARITY_WEIGHT: 1.5,     // 热门度权重
  
  // 用户兴趣权重
  INTEREST_WEIGHT: 2.0,       // 用户兴趣匹配权重
  
  // 时间衰减因子
  TIME_DECAY_FACTOR: 0.95,    // 每天衰减5%
  TIME_DECAY_HALF_LIFE: 7     // 半衰期（天）
};

// 调试日志开关（可通过环境变量控制）
const DEBUG_ENABLED = process.env.RECOMMENDATION_DEBUG === 'true';

/**
 * 创建推荐调试日志对象
 */
function createDebugLog() {
  return {
    enabled: DEBUG_ENABLED,
    timestamp: new Date().toISOString(),
    userId: null,
    phases: [],
    candidatePosts: [],
    scoringDetails: [],
    finalRanking: [],
    statistics: {
      totalCandidates: 0,
      scoredPosts: 0,
      returnedPosts: 0,
      executionTimeMs: 0
    }
  };
}

/**
 * 添加调试阶段日志
 */
function addDebugPhase(debugLog, phase, data) {
  if (!debugLog.enabled) return;
  debugLog.phases.push({
    phase,
    timestamp: new Date().toISOString(),
    data
  });
}

/**
 * 计算时间衰减因子
 * @param {Date} createdAt - 内容创建时间
 * @returns {number} 衰减因子 (0-1)
 */
function calculateTimeDecay(createdAt) {
  const now = new Date();
  const ageInDays = (now - new Date(createdAt)) / (1000 * 60 * 60 * 24);
  // 使用指数衰减：e^(-lambda * t)
  // lambda = ln(2) / halfLife
  const lambda = Math.log(2) / WEIGHTS.TIME_DECAY_HALF_LIFE;
  return Math.exp(-lambda * ageInDays);
}

/**
 * 计算热门度分数
 * @param {Object} post - 笔记对象
 * @returns {number} 热门度分数
 */
function calculatePopularityScore(post) {
  const likeScore = (post.like_count || 0) * 1.0;
  const collectScore = (post.collect_count || 0) * 1.5;
  const commentScore = (post.comment_count || 0) * 2.0;
  const viewScore = Math.log10((Number(post.view_count) || 0) + 1) * 0.5;
  
  return likeScore + collectScore + commentScore + viewScore;
}

/**
 * 获取用户行为数据
 * @param {BigInt} userId - 用户ID
 * @returns {Object} 用户行为数据
 */
async function getUserBehaviorData(userId) {
  const [likes, collections, history, following] = await Promise.all([
    // 获取用户点赞的笔记
    prisma.like.findMany({
      where: { user_id: userId, target_type: 1 },
      select: { target_id: true, created_at: true },
      orderBy: { created_at: 'desc' },
      take: 100
    }),
    // 获取用户收藏的笔记
    prisma.collection.findMany({
      where: { user_id: userId },
      select: { post_id: true, created_at: true },
      orderBy: { created_at: 'desc' },
      take: 100
    }),
    // 获取用户浏览历史
    prisma.browsingHistory.findMany({
      where: { user_id: userId },
      select: { post_id: true, updated_at: true },
      orderBy: { updated_at: 'desc' },
      take: 100
    }),
    // 获取用户关注的人
    prisma.follow.findMany({
      where: { follower_id: userId },
      select: { following_id: true }
    })
  ]);

  // 获取互相关注的用户
  const followingIds = following.map(f => f.following_id);
  const mutualFollows = followingIds.length > 0 ? await prisma.follow.findMany({
    where: {
      follower_id: { in: followingIds },
      following_id: userId
    },
    select: { follower_id: true }
  }) : [];
  const mutualFollowIds = new Set(mutualFollows.map(f => f.follower_id));

  return {
    likedPostIds: new Set(likes.map(l => l.target_id)),
    collectedPostIds: new Set(collections.map(c => c.post_id)),
    viewedPostIds: new Set(history.map(h => h.post_id)),
    followingIds: new Set(followingIds),
    mutualFollowIds
  };
}

/**
 * 获取用户偏好的分类和标签
 * @param {BigInt} userId - 用户ID
 * @param {Object} behaviorData - 用户行为数据
 * @returns {Object} 用户偏好数据
 */
async function getUserPreferences(userId, behaviorData) {
  const interactedPostIds = [
    ...behaviorData.likedPostIds,
    ...behaviorData.collectedPostIds
  ];

  if (interactedPostIds.length === 0) {
    return { preferredCategories: new Map(), preferredTags: new Map() };
  }

  // 获取用户互动过的笔记的分类和标签
  const posts = await prisma.post.findMany({
    where: { id: { in: interactedPostIds } },
    select: {
      id: true,
      category_id: true,
      tags: {
        select: { tag_id: true }
      }
    }
  });

  // 统计分类偏好
  const categoryCount = new Map();
  // 统计标签偏好
  const tagCount = new Map();

  posts.forEach(post => {
    // 分类计数
    if (post.category_id) {
      const count = categoryCount.get(post.category_id) || 0;
      const weight = behaviorData.likedPostIds.has(post.id) ? WEIGHTS.LIKE_WEIGHT :
                     behaviorData.collectedPostIds.has(post.id) ? WEIGHTS.COLLECT_WEIGHT : 1;
      categoryCount.set(post.category_id, count + weight);
    }

    // 标签计数
    post.tags.forEach(t => {
      const count = tagCount.get(t.tag_id) || 0;
      const weight = behaviorData.likedPostIds.has(post.id) ? WEIGHTS.LIKE_WEIGHT :
                     behaviorData.collectedPostIds.has(post.id) ? WEIGHTS.COLLECT_WEIGHT : 1;
      tagCount.set(t.tag_id, count + weight);
    });
  });

  return {
    preferredCategories: categoryCount,
    preferredTags: tagCount
  };
}

/**
 * 获取用户兴趣标签
 * @param {BigInt} userId - 用户ID
 * @returns {Array} 用户兴趣数组
 */
async function getUserInterests(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { interests: true }
  });
  
  if (!user || !user.interests) return [];
  
  // interests 是 JSON 字段，可能是数组或对象
  if (Array.isArray(user.interests)) {
    return user.interests;
  }
  
  return [];
}

/**
 * 计算单个笔记的推荐分数
 * @param {Object} post - 笔记对象
 * @param {Object} context - 计算上下文
 * @returns {Object} 分数详情
 */
function calculatePostScore(post, context) {
  const {
    behaviorData,
    preferences,
    userInterests,
    currentUserId
  } = context;

  let totalScore = 0;
  const scoreBreakdown = {
    baseScore: 0,
    categoryMatch: 0,
    tagMatch: 0,
    socialBoost: 0,
    popularityScore: 0,
    interestMatch: 0,
    timeDecay: 1,
    finalScore: 0
  };

  // 1. 基础分数（所有笔记都有）
  scoreBreakdown.baseScore = 1.0;
  totalScore += scoreBreakdown.baseScore;

  // 2. 分类匹配分数
  if (post.category_id && preferences.preferredCategories.has(post.category_id)) {
    const categoryWeight = preferences.preferredCategories.get(post.category_id);
    scoreBreakdown.categoryMatch = Math.min(categoryWeight * WEIGHTS.CATEGORY_WEIGHT * 0.1, 5);
    totalScore += scoreBreakdown.categoryMatch;
  }

  // 3. 标签匹配分数
  if (post.tags && post.tags.length > 0) {
    let tagScore = 0;
    post.tags.forEach(t => {
      const tagId = t.tag_id || t.tag?.id;
      if (tagId && preferences.preferredTags.has(tagId)) {
        const tagWeight = preferences.preferredTags.get(tagId);
        tagScore += tagWeight * WEIGHTS.TAG_WEIGHT * 0.1;
      }
    });
    scoreBreakdown.tagMatch = Math.min(tagScore, 8);
    totalScore += scoreBreakdown.tagMatch;
  }

  // 4. 社交关系加成
  if (post.user_id) {
    if (behaviorData.mutualFollowIds.has(post.user_id)) {
      scoreBreakdown.socialBoost = WEIGHTS.MUTUAL_FOLLOW_WEIGHT;
    } else if (behaviorData.followingIds.has(post.user_id)) {
      scoreBreakdown.socialBoost = WEIGHTS.FOLLOWING_WEIGHT;
    }
    totalScore += scoreBreakdown.socialBoost;
  }

  // 5. 热门度分数
  const rawPopularity = calculatePopularityScore(post);
  scoreBreakdown.popularityScore = Math.log10(rawPopularity + 1) * WEIGHTS.POPULARITY_WEIGHT;
  totalScore += scoreBreakdown.popularityScore;

  // 6. 用户兴趣匹配（基于笔记内容关键词匹配）
  if (userInterests.length > 0 && post.title) {
    const titleLower = post.title.toLowerCase();
    const contentLower = (post.content || '').toLowerCase();
    let interestScore = 0;
    
    userInterests.forEach(interest => {
      if (typeof interest === 'string') {
        const interestLower = interest.toLowerCase();
        if (titleLower.includes(interestLower) || contentLower.includes(interestLower)) {
          interestScore += WEIGHTS.INTEREST_WEIGHT;
        }
      }
    });
    scoreBreakdown.interestMatch = Math.min(interestScore, 6);
    totalScore += scoreBreakdown.interestMatch;
  }

  // 7. 时间衰减
  scoreBreakdown.timeDecay = calculateTimeDecay(post.created_at);
  totalScore *= scoreBreakdown.timeDecay;

  scoreBreakdown.finalScore = totalScore;

  return {
    postId: Number(post.id),
    score: totalScore,
    breakdown: scoreBreakdown
  };
}

/**
 * 获取推荐笔记列表
 * @param {Object} options - 推荐选项
 * @returns {Object} 推荐结果和调试信息
 */
async function getRecommendedPosts(options = {}) {
  const startTime = Date.now();
  const debugLog = createDebugLog();
  
  const {
    userId = null,
    page = 1,
    limit = 20,
    excludePostIds = [],
    type = null
  } = options;

  debugLog.userId = userId ? Number(userId) : null;
  addDebugPhase(debugLog, 'INIT', { options: { page, limit, type, excludePostIds: excludePostIds.length } });

  try {
    let currentUserId = userId ? BigInt(userId) : null;
    let behaviorData = {
      likedPostIds: new Set(),
      collectedPostIds: new Set(),
      viewedPostIds: new Set(),
      followingIds: new Set(),
      mutualFollowIds: new Set()
    };
    let preferences = { preferredCategories: new Map(), preferredTags: new Map() };
    let userInterests = [];

    // 如果用户已登录，获取个性化数据
    if (currentUserId) {
      addDebugPhase(debugLog, 'FETCH_USER_DATA', { userId: Number(currentUserId) });
      
      // 并行获取用户行为数据和兴趣数据
      [behaviorData, userInterests] = await Promise.all([
        getUserBehaviorData(currentUserId),
        getUserInterests(currentUserId)
      ]);

      // 基于行为数据获取用户偏好
      preferences = await getUserPreferences(currentUserId, behaviorData);

      addDebugPhase(debugLog, 'USER_DATA_LOADED', {
        likedCount: behaviorData.likedPostIds.size,
        collectedCount: behaviorData.collectedPostIds.size,
        viewedCount: behaviorData.viewedPostIds.size,
        followingCount: behaviorData.followingIds.size,
        mutualFollowCount: behaviorData.mutualFollowIds.size,
        preferredCategoriesCount: preferences.preferredCategories.size,
        preferredTagsCount: preferences.preferredTags.size,
        userInterests: userInterests
      });
    }

    // 构建查询条件
    const whereCondition = {
      is_draft: false,
      visibility: 'public'
    };

    if (type) {
      whereCondition.type = parseInt(type);
    }

    if (excludePostIds.length > 0) {
      whereCondition.id = { notIn: excludePostIds.map(id => BigInt(id)) };
    }

    addDebugPhase(debugLog, 'QUERY_CONDITION', whereCondition);

    // 获取候选笔记（获取更多以便排序）
    const candidateLimit = Math.min(limit * 5, 200);
    const skip = 0; // 我们会在排序后进行分页

    const candidatePosts = await prisma.post.findMany({
      where: whereCondition,
      include: {
        user: { select: { id: true, user_id: true, nickname: true, avatar: true, location: true, verified: true } },
        category: { select: { name: true } },
        images: { select: { image_url: true, is_free_preview: true } },
        videos: { select: { video_url: true, cover_url: true, preview_video_url: true }, take: 1 },
        tags: { include: { tag: { select: { id: true, name: true } } } },
        paymentSettings: true
      },
      orderBy: { created_at: 'desc' },
      take: candidateLimit
    });

    addDebugPhase(debugLog, 'CANDIDATES_FETCHED', { count: candidatePosts.length });
    debugLog.statistics.totalCandidates = candidatePosts.length;

    // 计算每个笔记的推荐分数
    const context = {
      behaviorData,
      preferences,
      userInterests,
      currentUserId
    };

    const scoredPosts = candidatePosts.map(post => {
      const scoreResult = calculatePostScore(post, context);
      return {
        post,
        ...scoreResult
      };
    });

    // 过滤掉用户已经互动过的笔记（可选）
    const filteredPosts = currentUserId ? scoredPosts.filter(sp => {
      const postId = sp.post.id;
      // 不过滤已浏览的，但过滤已点赞和已收藏的（可选策略）
      // return !behaviorData.likedPostIds.has(postId) && !behaviorData.collectedPostIds.has(postId);
      return true; // 暂时不过滤，让用户可以再次看到喜欢的内容
    }) : scoredPosts;

    // 按分数排序
    filteredPosts.sort((a, b) => b.score - a.score);

    debugLog.statistics.scoredPosts = filteredPosts.length;

    // 记录详细的评分信息（用于调试）
    debugLog.scoringDetails = filteredPosts.slice(0, Math.min(50, filteredPosts.length)).map(sp => ({
      postId: sp.postId,
      title: sp.post.title.substring(0, 30),
      score: Math.round(sp.score * 1000) / 1000,
      breakdown: {
        base: Math.round(sp.breakdown.baseScore * 100) / 100,
        category: Math.round(sp.breakdown.categoryMatch * 100) / 100,
        tag: Math.round(sp.breakdown.tagMatch * 100) / 100,
        social: Math.round(sp.breakdown.socialBoost * 100) / 100,
        popularity: Math.round(sp.breakdown.popularityScore * 100) / 100,
        interest: Math.round(sp.breakdown.interestMatch * 100) / 100,
        timeDecay: Math.round(sp.breakdown.timeDecay * 100) / 100
      },
      author: sp.post.user?.nickname || 'Unknown'
    }));

    // 分页
    const startIndex = (page - 1) * limit;
    const paginatedPosts = filteredPosts.slice(startIndex, startIndex + limit);

    debugLog.statistics.returnedPosts = paginatedPosts.length;
    debugLog.statistics.executionTimeMs = Date.now() - startTime;

    addDebugPhase(debugLog, 'PAGINATION', { 
      page, 
      limit, 
      startIndex, 
      returnedCount: paginatedPosts.length 
    });

    // 记录最终排名
    debugLog.finalRanking = paginatedPosts.map((sp, index) => ({
      rank: startIndex + index + 1,
      postId: sp.postId,
      title: sp.post.title.substring(0, 30),
      score: Math.round(sp.score * 1000) / 1000
    }));

    addDebugPhase(debugLog, 'COMPLETE', { 
      executionTimeMs: debugLog.statistics.executionTimeMs 
    });

    return {
      posts: paginatedPosts.map(sp => ({
        ...sp.post,
        _recommendationScore: sp.score,
        _scoreBreakdown: sp.breakdown
      })),
      pagination: {
        page,
        limit,
        total: filteredPosts.length,
        pages: Math.ceil(filteredPosts.length / limit)
      },
      debug: debugLog
    };

  } catch (error) {
    addDebugPhase(debugLog, 'ERROR', { message: error.message, stack: error.stack });
    debugLog.statistics.executionTimeMs = Date.now() - startTime;
    
    console.error('推荐算法执行错误:', error);
    throw error;
  }
}

/**
 * 获取热门笔记（不需要登录）
 * @param {Object} options - 选项
 * @returns {Object} 热门笔记列表
 */
async function getHotPosts(options = {}) {
  const {
    page = 1,
    limit = 20,
    timeRange = 7, // 天数
    category = null,
    type = null
  } = options;

  const whereCondition = {
    is_draft: false,
    visibility: 'public',
    created_at: {
      gte: new Date(Date.now() - timeRange * 24 * 60 * 60 * 1000)
    }
  };

  if (category && category !== 'recommend') {
    whereCondition.category_id = parseInt(category);
  }

  if (type) {
    whereCondition.type = parseInt(type);
  }

  const posts = await prisma.post.findMany({
    where: whereCondition,
    include: {
      user: { select: { id: true, user_id: true, nickname: true, avatar: true, location: true, verified: true } },
      category: { select: { name: true } },
      images: { select: { image_url: true, is_free_preview: true } },
      videos: { select: { video_url: true, cover_url: true, preview_video_url: true }, take: 1 },
      tags: { include: { tag: { select: { id: true, name: true } } } },
      paymentSettings: true
    },
    orderBy: [
      { like_count: 'desc' },
      { collect_count: 'desc' },
      { comment_count: 'desc' }
    ],
    take: limit * 3,
    skip: 0
  });

  // 计算综合热门分数
  const scoredPosts = posts.map(post => ({
    post,
    hotScore: calculatePopularityScore(post) * calculateTimeDecay(post.created_at)
  }));

  scoredPosts.sort((a, b) => b.hotScore - a.hotScore);

  const startIndex = (page - 1) * limit;
  const paginatedPosts = scoredPosts.slice(startIndex, startIndex + limit);

  return {
    posts: paginatedPosts.map(sp => sp.post),
    pagination: {
      page,
      limit,
      total: scoredPosts.length,
      pages: Math.ceil(scoredPosts.length / limit)
    }
  };
}

module.exports = {
  getRecommendedPosts,
  getHotPosts,
  calculateTimeDecay,
  calculatePopularityScore,
  WEIGHTS
};
