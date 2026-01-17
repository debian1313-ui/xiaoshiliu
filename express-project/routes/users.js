const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { HTTP_STATUS, RESPONSE_CODES, ERROR_MESSAGES, AUDIT_TYPES, AUDIT_STATUS } = require('../constants');
const { prisma } = require('../config/config');
const { optionalAuth, authenticateToken } = require('../middleware/auth');
const NotificationHelper = require('../utils/notificationHelper');
const { protectPostListItem } = require('../utils/paidContentHelper');
const { auditNickname, auditBio, isAuditEnabled } = require('../utils/contentAudit');
const { addContentAuditTask, addAuditLogTask, isQueueEnabled, generateRandomNickname, addBrowsingHistoryTask, cleanupExpiredBrowsingHistory, BROWSING_HISTORY_CONFIG } = require('../utils/queueService');
const { checkUsernameBannedWords, checkBioBannedWords, getBannedWordAuditResult } = require('../utils/bannedWordsChecker');

// 内容最大长度限制
const MAX_CONTENT_LENGTH = 1000;

// 搜索用户（必须放在 /:id 之前）
router.get('/search', optionalAuth, async (req, res) => {
  try {
    const keyword = req.query.keyword;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const currentUserId = req.user ? BigInt(req.user.id) : null;

    if (!keyword) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '请输入搜索关键词' });
    }

    const users = await prisma.user.findMany({
      where: {
        OR: [
          { nickname: { contains: keyword } },
          { user_id: { contains: keyword } }
        ]
      },
      select: {
        id: true, user_id: true, nickname: true, avatar: true, bio: true,
        location: true, follow_count: true, fans_count: true, like_count: true,
        created_at: true, verified: true,
        _count: { select: { posts: { where: { is_draft: false } } } }
      },
      orderBy: { created_at: 'desc' },
      take: limit,
      skip: skip
    });

    let formattedUsers = users.map(u => ({
      id: Number(u.id),
      user_id: u.user_id,
      nickname: u.nickname,
      avatar: u.avatar,
      bio: u.bio,
      location: u.location,
      follow_count: u.follow_count,
      fans_count: u.fans_count,
      like_count: u.like_count,
      created_at: u.created_at,
      verified: u.verified,
      post_count: u._count.posts,
      isFollowing: false,
      isMutual: false,
      buttonType: 'follow'
    }));

    if (currentUserId) {
      const userIds = users.map(u => u.id);
      const following = await prisma.follow.findMany({
        where: { follower_id: currentUserId, following_id: { in: userIds } },
        select: { following_id: true }
      });
      const followingSet = new Set(following.map(f => f.following_id));
      const followers = await prisma.follow.findMany({
        where: { follower_id: { in: userIds }, following_id: currentUserId },
        select: { follower_id: true }
      });
      const followersSet = new Set(followers.map(f => f.follower_id));

      formattedUsers = formattedUsers.map(user => {
        const userId = BigInt(user.id);
        const isFollowing = followingSet.has(userId);
        const isFollower = followersSet.has(userId);
        user.isFollowing = isFollowing;
        if (userId === currentUserId) {
          user.buttonType = 'self';
        } else if (isFollowing && isFollower) {
          user.buttonType = 'mutual';
          user.isMutual = true;
        } else if (isFollowing) {
          user.buttonType = 'unfollow';
        } else if (isFollower) {
          user.buttonType = 'back';
        }
        return user;
      });
    }

    const total = await prisma.user.count({
      where: { OR: [{ nickname: { contains: keyword } }, { user_id: { contains: keyword } }] }
    });

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: 'success',
      data: {
        users: formattedUsers,
        keyword,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) }
      }
    });
  } catch (error) {
    console.error('搜索用户失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 提交认证申请
router.post('/verification', authenticateToken, async (req, res) => {
  try {
    const { type, content } = req.body;
    const userId = BigInt(req.user.id);

    if (!type || !content) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '认证类型和认证内容都是必填项'
      });
    }

    // 验证内容长度
    if (content.length > MAX_CONTENT_LENGTH) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: `认证内容不能超过${MAX_CONTENT_LENGTH}个字符`
      });
    }

    // 使用常量验证认证类型
    if (type !== AUDIT_TYPES.PERSONAL && type !== AUDIT_TYPES.BUSINESS) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '无效的认证类型'
      });
    }

    const existingAudit = await prisma.audit.findFirst({
      where: { user_id: userId, type: type, status: AUDIT_STATUS.PENDING }
    });

    if (existingAudit) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '您已有相同类型的认证申请正在审核中，请耐心等待'
      });
    }

    const audit = await prisma.audit.create({
      data: { user_id: userId, type: type, content: content, status: AUDIT_STATUS.PENDING }
    });

    res.status(HTTP_STATUS.CREATED).json({
      code: RESPONSE_CODES.SUCCESS,
      message: '认证申请提交成功，请耐心等待审核',
      data: { auditId: Number(audit.id) }
    });
  } catch (error) {
    console.error('提交认证申请错误:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR
    });
  }
});

// 获取用户认证状态
router.get('/verification/status', authenticateToken, async (req, res) => {
  try {
    const userId = BigInt(req.user.id);

    const audits = await prisma.audit.findMany({
      where: { user_id: userId },
      select: { id: true, type: true, status: true, created_at: true, audit_time: true },
      orderBy: { created_at: 'desc' }
    });

    const formattedAudits = audits.map(a => ({
      id: Number(a.id),
      type: a.type,
      status: a.status,
      created_at: a.created_at,
      audit_time: a.audit_time
    }));

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '获取认证状态成功',
      data: formattedAudits
    });
  } catch (error) {
    console.error('获取认证状态错误:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR
    });
  }
});

// 撤回认证申请
router.delete('/verification/revoke', authenticateToken, async (req, res) => {
  try {
    const userId = BigInt(req.user.id);

    const allStatuses = [AUDIT_STATUS.PENDING, AUDIT_STATUS.APPROVED, AUDIT_STATUS.REJECTED];
    const existingAudits = await prisma.audit.findMany({
      where: { user_id: userId, status: { in: allStatuses } },
      select: { id: true, status: true }
    });

    if (existingAudits.length === 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '没有找到可撤回的认证申请'
      });
    }

    await prisma.audit.deleteMany({
      where: { user_id: userId, status: { in: allStatuses } }
    });

    const hasApprovedAudit = existingAudits.some(audit => audit.status === AUDIT_STATUS.APPROVED);
    if (hasApprovedAudit) {
      await prisma.user.update({
        where: { id: userId },
        data: { verified: false }
      });
    }

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '认证申请已撤回',
      success: true
    });
  } catch (error) {
    console.error('撤回认证申请错误:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR
    });
  }
});

// 记录浏览历史（使用异步队列，限制每用户每分钟20条）
router.post('/history', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { post_id } = req.body;

    if (!post_id) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '笔记ID不能为空'
      });
    }

    // 检查笔记是否存在
    const post = await prisma.post.findUnique({
      where: { id: BigInt(post_id) },
      select: { id: true, is_draft: true }
    });

    if (!post || post.is_draft) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        code: RESPONSE_CODES.NOT_FOUND,
        message: '笔记不存在'
      });
    }

    // 使用异步队列记录浏览历史（带速率限制）
    const result = await addBrowsingHistoryTask(userId, post_id);
    
    if (result && result.rateLimited) {
      return res.status(HTTP_STATUS.TOO_MANY_REQUESTS || 429).json({
        code: RESPONSE_CODES.ERROR,
        message: `浏览历史记录频率过高，每分钟最多记录${BROWSING_HISTORY_CONFIG.rateLimit}条`
      });
    }

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '浏览记录已保存',
      success: true
    });
  } catch (error) {
    console.error('记录浏览历史失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR
    });
  }
});

// 获取浏览历史列表（只返回48小时内的记录）
router.get('/history', authenticateToken, async (req, res) => {
  try {
    const userId = BigInt(req.user.id);
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    
    // 计算48小时前的时间点
    const cutoffTime = new Date(Date.now() - BROWSING_HISTORY_CONFIG.retentionHours * 60 * 60 * 1000);

    const histories = await prisma.browsingHistory.findMany({
      where: { 
        user_id: userId,
        updated_at: { gte: cutoffTime }
      },
      include: {
        post: {
          include: {
            user: { select: { id: true, user_id: true, nickname: true, avatar: true, location: true } },
            category: { select: { name: true } },
            images: { select: { image_url: true, is_free_preview: true } },
            videos: { select: { video_url: true, cover_url: true }, take: 1 },
            tags: { include: { tag: { select: { id: true, name: true } } } },
            paymentSettings: true
          }
        }
      },
      orderBy: { updated_at: 'desc' },
      take: limit,
      skip: skip
    });

    // 过滤掉草稿和不存在的笔记
    const validHistories = histories.filter(h => h.post && !h.post.is_draft);
    const posts = validHistories.map(h => ({ ...h.post, viewed_at: h.updated_at }));

    let purchasedPostIds = new Set();
    let likedPostIds = new Set();
    let collectedPostIds = new Set();
    if (posts.length > 0) {
      const postIds = posts.map(p => p.id);
      const purchases = await prisma.userPurchasedContent.findMany({ where: { user_id: userId, post_id: { in: postIds } }, select: { post_id: true } });
      purchasedPostIds = new Set(purchases.map(p => p.post_id));
      const likes = await prisma.like.findMany({ where: { user_id: userId, target_type: 1, target_id: { in: postIds } }, select: { target_id: true } });
      likedPostIds = new Set(likes.map(l => l.target_id));
      const collections = await prisma.collection.findMany({ where: { user_id: userId, post_id: { in: postIds } }, select: { post_id: true } });
      collectedPostIds = new Set(collections.map(c => c.post_id));
    }

    const formattedPosts = posts.map(post => {
      const formatted = {
        id: Number(post.id),
        user_id: Number(post.user_id),
        title: post.title,
        content: post.content,
        category_id: post.category_id,
        category: post.category?.name,
        type: post.type,
        view_count: Number(post.view_count),
        like_count: post.like_count,
        collect_count: post.collect_count,
        comment_count: post.comment_count,
        created_at: post.created_at,
        viewed_at: post.viewed_at,
        nickname: post.user?.nickname,
        user_avatar: post.user?.avatar,
        avatar: post.user?.avatar,
        author: post.user?.nickname,
        author_account: post.user?.user_id,
        location: post.user?.location
      };

      const isAuthor = post.user_id === userId;
      const hasPurchased = purchasedPostIds.has(post.id);
      const paymentSetting = post.paymentSettings;
      const imageUrls = post.images.map(img => ({ url: img.image_url, isFreePreview: img.is_free_preview }));
      const videoData = post.videos[0] || null;

      protectPostListItem(formatted, {
        paymentSetting: paymentSetting ? { enabled: paymentSetting.enabled ? 1 : 0, free_preview_count: paymentSetting.free_preview_count, preview_duration: paymentSetting.preview_duration, price: paymentSetting.price, hide_all: paymentSetting.hide_all } : null,
        isAuthor,
        hasPurchased,
        videoData: videoData ? { video_url: videoData.video_url, cover_url: videoData.cover_url } : null,
        imageUrls
      });

      formatted.tags = post.tags.map(pt => ({ id: pt.tag.id, name: pt.tag.name }));
      formatted.liked = likedPostIds.has(post.id);
      formatted.collected = collectedPostIds.has(post.id);
      return formatted;
    });

    const total = await prisma.browsingHistory.count({
      where: {
        user_id: userId,
        post: { is_draft: false },
        updated_at: { gte: cutoffTime }
      }
    });

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: 'success',
      data: {
        posts: formattedPosts,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) }
      }
    });
  } catch (error) {
    console.error('获取浏览历史失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR
    });
  }
});

// 删除单条浏览历史
router.delete('/history/:postId', authenticateToken, async (req, res) => {
  try {
    const userId = BigInt(req.user.id);
    const postId = BigInt(req.params.postId);

    const history = await prisma.browsingHistory.findUnique({
      where: {
        uk_user_post_history: {
          user_id: userId,
          post_id: postId
        }
      }
    });

    if (!history) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        code: RESPONSE_CODES.NOT_FOUND,
        message: '浏览记录不存在'
      });
    }

    await prisma.browsingHistory.delete({
      where: { id: history.id }
    });

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '浏览记录已删除',
      success: true
    });
  } catch (error) {
    console.error('删除浏览历史失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR
    });
  }
});

// 清空所有浏览历史
router.delete('/history', authenticateToken, async (req, res) => {
  try {
    const userId = BigInt(req.user.id);

    await prisma.browsingHistory.deleteMany({
      where: { user_id: userId }
    });

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '浏览历史已清空',
      success: true
    });
  } catch (error) {
    console.error('清空浏览历史失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR
    });
  }
});

// 获取用户个性标签
router.get('/:id/personality-tags', async (req, res) => {
  try {
    const userIdParam = req.params.id;

    const user = await prisma.user.findUnique({
      where: { user_id: userIdParam },
      select: { gender: true, zodiac_sign: true, mbti: true, education: true, major: true, interests: true }
    });

    if (!user) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        code: RESPONSE_CODES.NOT_FOUND,
        message: '用户不存在',
        data: null
      });
    }

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: 'success',
      data: user
    });
  } catch (error) {
    console.error('获取用户个性标签失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 获取用户信息
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const userIdParam = req.params.id;
    const currentUserId = req.user ? BigInt(req.user.id) : null;

    // 只通过汐社号(user_id)进行查找
    const user = await prisma.user.findUnique({
      where: { user_id: userIdParam }
    });

    if (!user) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        code: RESPONSE_CODES.NOT_FOUND,
        message: '用户不存在',
        data: null
      });
    }

    // 判断是否是本人
    const isOwner = currentUserId && currentUserId === user.id;

    // 处理个人简介的可见性
    let displayBio = user.bio;
    let bioAuditStatus = user.bio_audit_status;
    
    if (!isOwner) {
      // 非本人查看：检查简介审核状态
      if (bioAuditStatus === 0) {
        // 待审核：显示提示文字
        displayBio = '正在等待审核';
      } else if (bioAuditStatus === 2) {
        // 已拒绝：显示内容审核失败
        displayBio = '内容审核失败';
      }
      // 已通过(1)：正常显示
    }

    // 格式化用户数据
    const userData = {
      id: Number(user.id),
      user_id: user.user_id,
      nickname: user.nickname,
      avatar: user.avatar,
      background: user.background, // 用户背景图
      bio: displayBio,
      bio_audit_status: isOwner ? bioAuditStatus : undefined, // 仅本人可见审核状态
      location: user.location,
      follow_count: user.follow_count,
      fans_count: user.fans_count,
      like_count: user.like_count,
      created_at: user.created_at,
      verified: user.verified,
      gender: user.gender,
      zodiac_sign: user.zodiac_sign,
      mbti: user.mbti,
      education: user.education,
      major: user.major,
      interests: user.interests
    };

    res.json({ code: RESPONSE_CODES.SUCCESS, message: 'success', data: userData });
  } catch (error) {
    console.error('获取用户信息失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 获取用户列表
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const users = await prisma.user.findMany({
      select: {
        id: true, user_id: true, nickname: true, avatar: true, bio: true,
        location: true, follow_count: true, fans_count: true, like_count: true, created_at: true
      },
      orderBy: { created_at: 'desc' },
      take: limit,
      skip: skip
    });

    const formattedUsers = users.map(u => ({
      ...u,
      id: Number(u.id)
    }));

    const total = await prisma.user.count();

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: 'success',
      data: {
        users: formattedUsers,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) }
      }
    });
  } catch (error) {
    console.error('获取用户列表失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 更新用户资料（用户自己）
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const userIdParam = req.params.id;
    const currentUserId = BigInt(req.user.id);
    const { nickname, avatar, background, bio, location, gender, zodiac_sign, mbti, education, major, interests } = req.body;

    // 始终通过汐社号查找对应的数字ID
    const userRecord = await prisma.user.findUnique({
      where: { user_id: userIdParam },
      select: { id: true, nickname: true, bio: true }
    });

    if (!userRecord) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '用户不存在' });
    }
    const targetUserId = userRecord.id;

    // 检查是否是用户本人
    if (currentUserId !== targetUserId) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ code: RESPONSE_CODES.FORBIDDEN, message: '只能修改自己的资料' });
    }

    // 验证必填字段
    if (!nickname || !nickname.trim()) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '昵称不能为空' });
    }

    const trimmedNickname = nickname.trim();
    const trimmedBio = bio !== undefined ? (bio || '').trim() : undefined;

    // 检查昵称是否有修改
    const nicknameChanged = trimmedNickname !== userRecord.nickname;
    // 检查个人简介是否有修改
    const bioChanged = trimmedBio !== undefined && trimmedBio !== (userRecord.bio || '');

    const updateData = { nickname: trimmedNickname };
    if (avatar !== undefined) updateData.avatar = avatar || '';
    if (background !== undefined) updateData.background = background || ''; // 背景图
    if (trimmedBio !== undefined) updateData.bio = trimmedBio;
    if (location !== undefined) updateData.location = location || '';
    if (gender !== undefined) updateData.gender = gender || null;
    if (zodiac_sign !== undefined) updateData.zodiac_sign = zodiac_sign || null;
    if (mbti !== undefined) updateData.mbti = mbti || null;
    if (education !== undefined) updateData.education = education || null;
    if (major !== undefined) updateData.major = major || null;
    if (interests !== undefined) updateData.interests = interests || null;

    // 检查昵称违禁词
    if (nicknameChanged) {
      const nicknameCheck = await checkUsernameBannedWords(prisma, trimmedNickname);
      if (nicknameCheck.matched) {
        // 触发本地违禁词，生成随机昵称替换
        const randomNickname = generateRandomNickname();
        updateData.nickname = randomNickname;
        addAuditLogTask({
          userId: Number(targetUserId),
          type: AUDIT_TYPES.NICKNAME,
          targetId: Number(targetUserId),
          content: trimmedNickname,
          auditResult: getBannedWordAuditResult(nicknameCheck.matchedWords),
          riskLevel: 'high',
          categories: ['banned_word'],
          reason: `[本地违禁词拒绝] 昵称触发违禁词: ${nicknameCheck.matchedWords.join(', ')}，已自动替换为随机昵称: ${randomNickname}`,
          status: AUDIT_STATUS.REJECTED
        });
      } else if (isAuditEnabled()) {
        // 如果启用了审核，添加异步审核任务
        if (isQueueEnabled()) {
          addContentAuditTask(trimmedNickname, Number(targetUserId), 'nickname', Number(targetUserId));
        } else {
          // 同步审核
          const auditResult = await auditNickname(trimmedNickname, Number(targetUserId));
          let replacementNickname = null;
          if (!auditResult?.passed) {
            // AI审核不通过，生成随机昵称替换
            replacementNickname = generateRandomNickname();
            updateData.nickname = replacementNickname;
          }
          addAuditLogTask({
            userId: Number(targetUserId),
            type: AUDIT_TYPES.NICKNAME,
            targetId: Number(targetUserId),
            content: trimmedNickname,
            auditResult: auditResult,
            riskLevel: auditResult?.risk_level || 'low',
            categories: auditResult?.categories || [],
            reason: auditResult?.passed ? '[AI审核通过] 昵称审核通过' : `[AI审核拒绝] ${auditResult?.reason || '昵称审核未通过'}，已自动替换为随机昵称: ${replacementNickname}`,
            status: auditResult?.passed ? AUDIT_STATUS.APPROVED : AUDIT_STATUS.REJECTED
          });
        }
      }
    }

    // 检查个人简介违禁词
    if (bioChanged && trimmedBio) {
      const bioCheck = await checkBioBannedWords(prisma, trimmedBio);
      if (bioCheck.matched) {
        // 触发本地违禁词，设置简介为空并拒绝
        updateData.bio = '';
        updateData.bio_audit_status = AUDIT_STATUS.REJECTED;
        addAuditLogTask({
          userId: Number(targetUserId),
          type: AUDIT_TYPES.BIO,
          targetId: Number(targetUserId),
          content: trimmedBio,
          auditResult: getBannedWordAuditResult(bioCheck.matchedWords),
          riskLevel: 'high',
          categories: ['banned_word'],
          reason: `[本地违禁词拒绝] 个人简介触发违禁词: ${bioCheck.matchedWords.join(', ')}，已自动清空简介`,
          status: AUDIT_STATUS.REJECTED
        });
      } else if (isAuditEnabled()) {
        // 需要审核，设置为待审核状态
        updateData.bio_audit_status = AUDIT_STATUS.PENDING;
        if (isQueueEnabled()) {
          addContentAuditTask(trimmedBio, Number(targetUserId), 'bio', Number(targetUserId));
        } else {
          // 同步审核
          const auditResult = await auditBio(trimmedBio, Number(targetUserId));
          const passed = auditResult?.passed !== false;
          updateData.bio_audit_status = passed ? AUDIT_STATUS.APPROVED : AUDIT_STATUS.REJECTED;
          if (!passed) {
            // AI审核不通过，清空简介
            updateData.bio = '';
          }
          addAuditLogTask({
            userId: Number(targetUserId),
            type: AUDIT_TYPES.BIO,
            targetId: Number(targetUserId),
            content: trimmedBio,
            auditResult: auditResult,
            riskLevel: auditResult?.risk_level || 'low',
            categories: auditResult?.categories || [],
            reason: passed ? '[AI审核通过] 个人简介审核通过' : `[AI审核拒绝] ${auditResult?.reason || '个人简介不符合规范'}，已自动清空简介`,
            status: passed ? AUDIT_STATUS.APPROVED : AUDIT_STATUS.REJECTED
          });
        }
      } else {
        // 未启用审核，直接通过
        updateData.bio_audit_status = AUDIT_STATUS.APPROVED;
      }
    }

    await prisma.user.update({ where: { id: targetUserId }, data: updateData });

    const updatedUser = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: {
        id: true, user_id: true, nickname: true, avatar: true, background: true, bio: true, bio_audit_status: true,
        location: true, email: true, gender: true, zodiac_sign: true, mbti: true, education: true,
        major: true, interests: true, follow_count: true, fans_count: true, like_count: true
      }
    });

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '资料更新成功',
      success: true,
      data: { ...updatedUser, id: Number(updatedUser.id) }
    });
  } catch (error) {
    console.error('更新用户资料失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 修改密码
router.put('/:id/password', authenticateToken, async (req, res) => {
  try {
    const userIdParam = req.params.id;
    const currentUserId = BigInt(req.user.id);
    const { currentPassword, newPassword } = req.body;

    // 验证必填字段
    if (!currentPassword || !newPassword) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '当前密码和新密码不能为空' });
    }

    if (newPassword.length < 6) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '新密码长度不能少于6位' });
    }

    // 始终通过汐社号查找对应的数字ID
    const userRecord = await prisma.user.findUnique({
      where: { user_id: userIdParam },
      select: { id: true, password: true }
    });

    if (!userRecord) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '用户不存在' });
    }
    const targetUserId = userRecord.id;

    // 检查是否是用户本人
    if (currentUserId !== targetUserId) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ code: RESPONSE_CODES.FORBIDDEN, message: '只能修改自己的密码' });
    }

    // 验证当前密码（使用SHA256哈希比较）
    const currentPasswordHash = crypto.createHash('sha256').update(currentPassword).digest('hex');
    if (userRecord.password !== currentPasswordHash) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '当前密码错误' });
    }

    // 更新密码（使用SHA256哈希加密）
    const newPasswordHash = crypto.createHash('sha256').update(newPassword).digest('hex');
    await prisma.user.update({
      where: { id: targetUserId },
      data: { password: newPasswordHash }
    });

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '密码修改成功',
      success: true
    });
  } catch (error) {
    console.error('修改密码失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 删除账号
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const userIdParam = req.params.id;
    const currentUserId = BigInt(req.user.id);

    // 始终通过汐社号查找对应的数字ID
    const userRecord = await prisma.user.findUnique({
      where: { user_id: userIdParam },
      select: { id: true }
    });

    if (!userRecord) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '用户不存在' });
    }
    const targetUserId = userRecord.id;

    // 检查是否是用户本人
    if (currentUserId !== targetUserId) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ code: RESPONSE_CODES.FORBIDDEN, message: '只能删除自己的账号' });
    }

    // 使用事务删除用户相关的所有数据
    await prisma.$transaction(async (tx) => {
      await tx.comment.deleteMany({ where: { user_id: targetUserId } });
      await tx.like.deleteMany({ where: { user_id: targetUserId } });
      await tx.collection.deleteMany({ where: { user_id: targetUserId } });
      await tx.follow.deleteMany({ where: { OR: [{ follower_id: targetUserId }, { following_id: targetUserId }] } });
      await tx.notification.deleteMany({ where: { OR: [{ user_id: targetUserId }, { sender_id: targetUserId }] } });
      await tx.audit.deleteMany({ where: { user_id: targetUserId } });
      await tx.post.deleteMany({ where: { user_id: targetUserId } });
      await tx.user.delete({ where: { id: targetUserId } });
    });

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '账号删除成功',
      success: true
    });
  } catch (error) {
    console.error('删除账号失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 关注用户
router.post('/:id/follow', authenticateToken, async (req, res) => {
  try {
    const userIdParam = req.params.id;
    const followerId = BigInt(req.user.id);

    // 始终通过汐社号查找对应的数字ID
    const userRecord = await prisma.user.findUnique({
      where: { user_id: userIdParam },
      select: { id: true }
    });

    if (!userRecord) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '用户不存在' });
    }
    const userId = userRecord.id;

    // 不能关注自己
    if (followerId === userId) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '不能关注自己' });
    }

    // 检查是否已经关注
    const existingFollow = await prisma.follow.findUnique({
      where: { uk_follow: { follower_id: followerId, following_id: userId } }
    });

    if (existingFollow) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '已经关注了该用户' });
    }

    // 添加关注记录
    await prisma.follow.create({
      data: { follower_id: followerId, following_id: userId }
    });

    // 更新关注者的关注数
    await prisma.user.update({ where: { id: followerId }, data: { follow_count: { increment: 1 } } });

    // 更新被关注者的粉丝数
    await prisma.user.update({ where: { id: userId }, data: { fans_count: { increment: 1 } } });

    // 创建关注通知
    try {
      const notificationData = NotificationHelper.createFollowNotification(Number(userId), Number(followerId));
      await NotificationHelper.insertNotification(prisma, notificationData);
    } catch (notificationError) {
      console.error('关注通知创建失败:', notificationError);
    }

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '关注成功' });
  } catch (error) {
    console.error('关注失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 取消关注用户
router.delete('/:id/follow', authenticateToken, async (req, res) => {
  try {
    const userIdParam = req.params.id;
    const followerId = BigInt(req.user.id);

    // 始终通过汐社号查找对应的数字ID
    const userRecord = await prisma.user.findUnique({
      where: { user_id: userIdParam },
      select: { id: true }
    });

    if (!userRecord) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '用户不存在' });
    }
    const userId = userRecord.id;

    // 删除关注记录
    const followRecord = await prisma.follow.findUnique({
      where: { uk_follow: { follower_id: followerId, following_id: userId } }
    });

    if (!followRecord) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '关注记录不存在' });
    }

    await prisma.follow.delete({ where: { id: followRecord.id } });

    // 更新关注者的关注数
    await prisma.user.update({ where: { id: followerId }, data: { follow_count: { decrement: 1 } } });

    // 更新被关注者的粉丝数
    await prisma.user.update({ where: { id: userId }, data: { fans_count: { decrement: 1 } } });

    // 删除相关的关注通知
    await prisma.notification.deleteMany({
      where: { user_id: userId, sender_id: followerId, type: NotificationHelper.TYPES.FOLLOW }
    });

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '取消关注成功' });
  } catch (error) {
    console.error('取消关注失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 获取关注状态
router.get('/:id/follow-status', optionalAuth, async (req, res) => {
  try {
    const userIdParam = req.params.id;
    const followerId = req.user ? BigInt(req.user.id) : null;

    // 始终通过汐社号查找对应的数字ID
    const userRecord = await prisma.user.findUnique({
      where: { user_id: userIdParam },
      select: { id: true }
    });

    if (!userRecord) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '用户不存在' });
    }
    const userId = userRecord.id;

    let isFollowing = false;
    let isMutual = false;
    let buttonType = 'follow';

    // 如果用户已登录，检查关注状态
    if (followerId) {
      // 检查关注状态
      const followResult = await prisma.follow.findUnique({
        where: { uk_follow: { follower_id: followerId, following_id: userId } }
      });
      isFollowing = !!followResult;

      // 检查是否互相关注
      const mutualResult = await prisma.follow.findUnique({
        where: { uk_follow: { follower_id: userId, following_id: followerId } }
      });
      isMutual = isFollowing && !!mutualResult;

      // 确定按钮类型
      if (userId === followerId) {
        buttonType = 'self';
      } else if (isMutual) {
        buttonType = 'mutual';
      } else if (isFollowing) {
        buttonType = 'unfollow';
      } else if (mutualResult) {
        buttonType = 'back';
      }
    }

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: 'success',
      data: {
        followed: isFollowing,
        isFollowing,
        isMutual,
        buttonType
      }
    });
  } catch (error) {
    console.error('获取关注状态失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 获取用户关注列表
router.get('/:id/following', optionalAuth, async (req, res) => {
  try {
    const userIdParam = req.params.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const currentUserId = req.user ? BigInt(req.user.id) : null;

    // 始终通过汐社号查找对应的数字ID
    const userRecord = await prisma.user.findUnique({
      where: { user_id: userIdParam },
      select: { id: true }
    });

    if (!userRecord) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '用户不存在' });
    }
    const userId = userRecord.id;

    const follows = await prisma.follow.findMany({
      where: { follower_id: userId },
      include: {
        following: {
          select: {
            id: true, user_id: true, nickname: true, avatar: true, bio: true, location: true,
            follow_count: true, fans_count: true, like_count: true, created_at: true, verified: true,
            _count: { select: { posts: { where: { is_draft: false } } } }
          }
        }
      },
      orderBy: { created_at: 'desc' },
      take: limit,
      skip: skip
    });

    let users = follows.map(f => ({
      id: Number(f.following.id),
      user_id: f.following.user_id,
      nickname: f.following.nickname,
      avatar: f.following.avatar,
      bio: f.following.bio,
      location: f.following.location,
      follow_count: f.following.follow_count,
      fans_count: f.following.fans_count,
      like_count: f.following.like_count,
      created_at: f.following.created_at,
      verified: f.following.verified,
      post_count: f.following._count.posts,
      followed_at: f.created_at,
      isFollowing: false,
      isMutual: false,
      buttonType: 'follow'
    }));

    // 检查当前用户与这些用户的关注状态
    if (currentUserId && users.length > 0) {
      const targetIds = users.map(u => BigInt(u.id));
      const myFollowing = await prisma.follow.findMany({
        where: { follower_id: currentUserId, following_id: { in: targetIds } },
        select: { following_id: true }
      });
      const myFollowingSet = new Set(myFollowing.map(f => f.following_id));
      const theyFollowMe = await prisma.follow.findMany({
        where: { follower_id: { in: targetIds }, following_id: currentUserId },
        select: { follower_id: true }
      });
      const theyFollowMeSet = new Set(theyFollowMe.map(f => f.follower_id));

      users = users.map(u => {
        const uId = BigInt(u.id);
        const isFollowing = myFollowingSet.has(uId);
        const isFollower = theyFollowMeSet.has(uId);
        u.isFollowing = isFollowing;
        u.isMutual = isFollowing && isFollower;
        if (uId === currentUserId) {
          u.buttonType = 'self';
        } else if (u.isMutual) {
          u.buttonType = 'mutual';
        } else if (isFollowing) {
          u.buttonType = 'unfollow';
        } else if (isFollower) {
          u.buttonType = 'back';
        }
        return u;
      });
    }

    const total = await prisma.follow.count({ where: { follower_id: userId } });

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: 'success',
      data: { following: users, pagination: { page, limit, total, pages: Math.ceil(total / limit) } }
    });
  } catch (error) {
    console.error('获取关注列表失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 获取用户粉丝列表
router.get('/:id/followers', optionalAuth, async (req, res) => {
  try {
    const userIdParam = req.params.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const currentUserId = req.user ? BigInt(req.user.id) : null;

    // 始终通过汐社号查找对应的数字ID
    const userRecord = await prisma.user.findUnique({
      where: { user_id: userIdParam },
      select: { id: true }
    });

    if (!userRecord) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '用户不存在' });
    }
    const userId = userRecord.id;

    const follows = await prisma.follow.findMany({
      where: { following_id: userId },
      include: {
        follower: {
          select: {
            id: true, user_id: true, nickname: true, avatar: true, bio: true, location: true,
            follow_count: true, fans_count: true, like_count: true, created_at: true, verified: true,
            _count: { select: { posts: { where: { is_draft: false } } } }
          }
        }
      },
      orderBy: { created_at: 'desc' },
      take: limit,
      skip: skip
    });

    let users = follows.map(f => ({
      id: Number(f.follower.id),
      user_id: f.follower.user_id,
      nickname: f.follower.nickname,
      avatar: f.follower.avatar,
      bio: f.follower.bio,
      location: f.follower.location,
      follow_count: f.follower.follow_count,
      fans_count: f.follower.fans_count,
      like_count: f.follower.like_count,
      created_at: f.follower.created_at,
      verified: f.follower.verified,
      post_count: f.follower._count.posts,
      followed_at: f.created_at,
      isFollowing: false,
      isMutual: false,
      buttonType: 'follow'
    }));

    // 检查当前用户与这些用户的关注状态
    if (currentUserId && users.length > 0) {
      const targetIds = users.map(u => BigInt(u.id));
      const myFollowing = await prisma.follow.findMany({
        where: { follower_id: currentUserId, following_id: { in: targetIds } },
        select: { following_id: true }
      });
      const myFollowingSet = new Set(myFollowing.map(f => f.following_id));
      const theyFollowMe = await prisma.follow.findMany({
        where: { follower_id: { in: targetIds }, following_id: currentUserId },
        select: { follower_id: true }
      });
      const theyFollowMeSet = new Set(theyFollowMe.map(f => f.follower_id));

      users = users.map(u => {
        const uId = BigInt(u.id);
        const isFollowing = myFollowingSet.has(uId);
        const isFollower = theyFollowMeSet.has(uId);
        u.isFollowing = isFollowing;
        u.isMutual = isFollowing && isFollower;
        if (uId === currentUserId) {
          u.buttonType = 'self';
        } else if (u.isMutual) {
          u.buttonType = 'mutual';
        } else if (isFollowing) {
          u.buttonType = 'unfollow';
        } else if (isFollower) {
          u.buttonType = 'back';
        }
        return u;
      });
    }

    const total = await prisma.follow.count({ where: { following_id: userId } });

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: 'success',
      data: { followers: users, pagination: { page, limit, total, pages: Math.ceil(total / limit) } }
    });
  } catch (error) {
    console.error('获取粉丝列表失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 获取互相关注列表
router.get('/:id/mutual-follows', optionalAuth, async (req, res) => {
  try {
    const userIdParam = req.params.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const currentUserId = req.user ? BigInt(req.user.id) : null;

    // 始终通过汐社号查找对应的数字ID
    const userRecord = await prisma.user.findUnique({
      where: { user_id: userIdParam },
      select: { id: true }
    });

    if (!userRecord) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '用户不存在' });
    }
    const userId = userRecord.id;

    // 查询互关用户：先获取我关注的人，再筛选出也关注我的人
    const myFollowings = await prisma.follow.findMany({
      where: { follower_id: userId },
      select: { following_id: true }
    });
    const myFollowingIds = myFollowings.map(f => f.following_id);

    // 找出这些人中也关注我的
    const mutualFollows = await prisma.follow.findMany({
      where: {
        follower_id: { in: myFollowingIds },
        following_id: userId
      },
      select: { follower_id: true }
    });
    const mutualFollowIds = mutualFollows.map(f => f.follower_id);

    // 获取互关用户的详细信息
    const users = await prisma.user.findMany({
      where: { id: { in: mutualFollowIds } },
      select: {
        id: true, user_id: true, nickname: true, avatar: true, bio: true, location: true,
        follow_count: true, fans_count: true, like_count: true, created_at: true, verified: true,
        _count: { select: { posts: { where: { is_draft: false } } } }
      },
      orderBy: { created_at: 'desc' },
      take: limit,
      skip: skip
    });

    let formattedUsers = users.map(u => ({
      id: Number(u.id),
      user_id: u.user_id,
      nickname: u.nickname,
      avatar: u.avatar,
      bio: u.bio,
      location: u.location,
      follow_count: u.follow_count,
      fans_count: u.fans_count,
      like_count: u.like_count,
      created_at: u.created_at,
      verified: u.verified,
      post_count: u._count.posts,
      isFollowing: false,
      isMutual: false,
      buttonType: 'follow'
    }));

    // 检查当前用户与这些用户的关注状态
    if (currentUserId && formattedUsers.length > 0) {
      const targetIds = formattedUsers.map(u => BigInt(u.id));
      const myFollowing = await prisma.follow.findMany({
        where: { follower_id: currentUserId, following_id: { in: targetIds } },
        select: { following_id: true }
      });
      const myFollowingSet = new Set(myFollowing.map(f => f.following_id));
      const theyFollowMe = await prisma.follow.findMany({
        where: { follower_id: { in: targetIds }, following_id: currentUserId },
        select: { follower_id: true }
      });
      const theyFollowMeSet = new Set(theyFollowMe.map(f => f.follower_id));

      formattedUsers = formattedUsers.map(u => {
        const uId = BigInt(u.id);
        const isFollowing = myFollowingSet.has(uId);
        const isFollower = theyFollowMeSet.has(uId);
        u.isFollowing = isFollowing;
        u.isMutual = isFollowing && isFollower;
        if (uId === currentUserId) {
          u.buttonType = 'self';
        } else if (u.isMutual) {
          u.buttonType = 'mutual';
        } else if (isFollowing) {
          u.buttonType = 'unfollow';
        } else if (isFollower) {
          u.buttonType = 'back';
        }
        return u;
      });
    }

    const total = mutualFollowIds.length;

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: 'success',
      data: { mutualFollows: formattedUsers, pagination: { page, limit, total, pages: Math.ceil(total / limit) } }
    });
  } catch (error) {
    console.error('获取互关列表失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 获取用户发布的笔记列表
router.get('/:id/posts', optionalAuth, async (req, res) => {
  try {
    const userIdParam = req.params.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const currentUserId = req.user ? BigInt(req.user.id) : null;
    const category = req.query.category;
    const keyword = req.query.keyword;
    const sort = req.query.sort || 'created_at';
    const visibilityFilter = req.query.visibility;

    // 始终通过汐社号查找对应的数字ID
    const userRecord = await prisma.user.findUnique({
      where: { user_id: userIdParam },
      select: { id: true }
    });

    if (!userRecord) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '用户不存在' });
    }
    const userId = userRecord.id;

    // Check if current user is mutual follower with the target user
    let isMutualFollower = false;
    if (currentUserId && currentUserId !== userId) {
      const [followsTarget, followedByTarget] = await Promise.all([
        prisma.follow.findUnique({ where: { uk_follow: { follower_id: currentUserId, following_id: userId } } }),
        prisma.follow.findUnique({ where: { uk_follow: { follower_id: userId, following_id: currentUserId } } })
      ]);
      isMutualFollower = !!(followsTarget && followedByTarget);
    }

    // 构建查询条件
    const whereConditions = { user_id: userId, is_draft: false };
    
    // Add visibility filter based on viewer relationship
    if (currentUserId && currentUserId === userId) {
      // Author viewing their own posts
      // If visibility filter is specified, apply it (for private tab)
      if (visibilityFilter && ['public', 'private', 'friends_only'].includes(visibilityFilter)) {
        whereConditions.visibility = visibilityFilter;
      }
      // Otherwise no visibility filter - show all
    } else if (isMutualFollower) {
      // Mutual follower can see public and friends_only posts
      whereConditions.visibility = { in: ['public', 'friends_only'] };
    } else {
      // Others can only see public posts
      whereConditions.visibility = 'public';
    }
    
    if (category) {
      whereConditions.category_id = parseInt(category);
    }
    if (keyword) {
      whereConditions.OR = [
        { title: { contains: keyword } },
        { content: { contains: keyword } }
      ];
    }

    // 构建排序条件
    const allowedSortFields = ['created_at', 'view_count', 'like_count', 'collect_count', 'comment_count'];
    const sortField = allowedSortFields.includes(sort) ? sort : 'created_at';
    const orderBy = { [sortField]: 'desc' };

    const posts = await prisma.post.findMany({
      where: whereConditions,
      include: {
        user: { select: { id: true, user_id: true, nickname: true, avatar: true, location: true } },
        category: { select: { name: true } },
        images: { select: { image_url: true, is_free_preview: true } },
        videos: { select: { video_url: true, cover_url: true }, take: 1 },
        tags: { include: { tag: { select: { id: true, name: true } } } },
        paymentSettings: true
      },
      orderBy: orderBy,
      take: limit,
      skip: skip
    });

    let purchasedPostIds = new Set();
    let likedPostIds = new Set();
    let collectedPostIds = new Set();
    if (currentUserId && posts.length > 0) {
      const postIds = posts.map(p => p.id);
      const purchases = await prisma.userPurchasedContent.findMany({ where: { user_id: currentUserId, post_id: { in: postIds } }, select: { post_id: true } });
      purchasedPostIds = new Set(purchases.map(p => p.post_id));
      const likes = await prisma.like.findMany({ where: { user_id: currentUserId, target_type: 1, target_id: { in: postIds } }, select: { target_id: true } });
      likedPostIds = new Set(likes.map(l => l.target_id));
      const collections = await prisma.collection.findMany({ where: { user_id: currentUserId, post_id: { in: postIds } }, select: { post_id: true } });
      collectedPostIds = new Set(collections.map(c => c.post_id));
    }

    const formattedPosts = posts.map(post => {
      const formatted = {
        id: Number(post.id),
        user_id: Number(post.user_id),
        title: post.title,
        content: post.content,
        category_id: post.category_id,
        category: post.category?.name,
        type: post.type,
        view_count: Number(post.view_count),
        like_count: post.like_count,
        collect_count: post.collect_count,
        comment_count: post.comment_count,
        created_at: post.created_at,
        visibility: post.visibility || 'public',
        nickname: post.user?.nickname,
        user_avatar: post.user?.avatar,
        avatar: post.user?.avatar,
        author: post.user?.nickname,
        location: post.user?.location
      };

      const isAuthor = currentUserId && post.user_id === currentUserId;
      const hasPurchased = purchasedPostIds.has(post.id);
      const paymentSetting = post.paymentSettings;
      const imageUrls = post.images.map(img => ({ url: img.image_url, isFreePreview: img.is_free_preview }));
      const videoData = post.videos[0] || null;

      protectPostListItem(formatted, {
        paymentSetting: paymentSetting ? { enabled: paymentSetting.enabled ? 1 : 0, free_preview_count: paymentSetting.free_preview_count, preview_duration: paymentSetting.preview_duration, price: paymentSetting.price, hide_all: paymentSetting.hide_all } : null,
        isAuthor,
        hasPurchased,
        videoData: videoData ? { video_url: videoData.video_url, cover_url: videoData.cover_url } : null,
        imageUrls
      });

      formatted.tags = post.tags.map(pt => ({ id: pt.tag.id, name: pt.tag.name }));
      formatted.liked = likedPostIds.has(post.id);
      formatted.collected = collectedPostIds.has(post.id);
      return formatted;
    });

    const total = await prisma.post.count({ where: whereConditions });

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: 'success',
      data: { posts: formattedPosts, pagination: { page, limit, total, pages: Math.ceil(total / limit) } }
    });
  } catch (error) {
    console.error('获取用户笔记列表失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 获取用户收藏列表
router.get('/:id/collections', optionalAuth, async (req, res) => {
  try {
    const userIdParam = req.params.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const currentUserId = req.user ? BigInt(req.user.id) : null;

    // 始终通过汐社号查找对应的数字ID
    const userRecord = await prisma.user.findUnique({
      where: { user_id: userIdParam },
      select: { id: true }
    });

    if (!userRecord) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '用户不存在' });
    }
    const userId = userRecord.id;

    const collections = await prisma.collection.findMany({
      where: { user_id: userId },
      include: {
        post: {
          include: {
            user: { select: { id: true, user_id: true, nickname: true, avatar: true, location: true } },
            category: { select: { name: true } },
            images: { select: { image_url: true, is_free_preview: true } },
            videos: { select: { video_url: true, cover_url: true }, take: 1 },
            tags: { include: { tag: { select: { id: true, name: true } } } },
            paymentSettings: true
          }
        }
      },
      orderBy: { created_at: 'desc' },
      take: limit,
      skip: skip
    });

    // 过滤掉草稿
    const validCollections = collections.filter(c => c.post && !c.post.is_draft);
    const posts = validCollections.map(c => ({ ...c.post, collected_at: c.created_at }));

    let purchasedPostIds = new Set();
    let likedPostIds = new Set();
    if (currentUserId && posts.length > 0) {
      const postIds = posts.map(p => p.id);
      const purchases = await prisma.userPurchasedContent.findMany({ where: { user_id: currentUserId, post_id: { in: postIds } }, select: { post_id: true } });
      purchasedPostIds = new Set(purchases.map(p => p.post_id));
      const likes = await prisma.like.findMany({ where: { user_id: currentUserId, target_type: 1, target_id: { in: postIds } }, select: { target_id: true } });
      likedPostIds = new Set(likes.map(l => l.target_id));
    }

    const formattedPosts = posts.map(post => {
      const formatted = {
        id: Number(post.id),
        user_id: Number(post.user_id),
        title: post.title,
        content: post.content,
        category_id: post.category_id,
        category: post.category?.name,
        type: post.type,
        view_count: Number(post.view_count),
        like_count: post.like_count,
        collect_count: post.collect_count,
        comment_count: post.comment_count,
        created_at: post.created_at,
        collected_at: post.collected_at,
        nickname: post.user?.nickname,
        user_avatar: post.user?.avatar,
        avatar: post.user?.avatar,
        author: post.user?.nickname,
        author_account: post.user?.user_id,
        location: post.user?.location
      };

      const isAuthor = currentUserId && post.user_id === currentUserId;
      const hasPurchased = purchasedPostIds.has(post.id);
      const paymentSetting = post.paymentSettings;
      const imageUrls = post.images.map(img => ({ url: img.image_url, isFreePreview: img.is_free_preview }));
      const videoData = post.videos[0] || null;

      protectPostListItem(formatted, {
        paymentSetting: paymentSetting ? { enabled: paymentSetting.enabled ? 1 : 0, free_preview_count: paymentSetting.free_preview_count, preview_duration: paymentSetting.preview_duration, price: paymentSetting.price, hide_all: paymentSetting.hide_all } : null,
        isAuthor,
        hasPurchased,
        videoData: videoData ? { video_url: videoData.video_url, cover_url: videoData.cover_url } : null,
        imageUrls
      });

      formatted.tags = post.tags.map(pt => ({ id: pt.tag.id, name: pt.tag.name }));
      formatted.liked = likedPostIds.has(post.id);
      formatted.collected = true;
      return formatted;
    });

    // 只计算非草稿的收藏
    const total = await prisma.collection.count({
      where: {
        user_id: userId,
        post: { is_draft: false }
      }
    });

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: 'success',
      data: { collections: formattedPosts, pagination: { page, limit, total, pages: Math.ceil(total / limit) } }
    });
  } catch (error) {
    console.error('获取收藏列表失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 获取用户点赞列表
router.get('/:id/likes', optionalAuth, async (req, res) => {
  try {
    const userIdParam = req.params.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const currentUserId = req.user ? BigInt(req.user.id) : null;

    // 始终通过汐社号查找对应的数字ID
    const userRecord = await prisma.user.findUnique({
      where: { user_id: userIdParam },
      select: { id: true }
    });

    if (!userRecord) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '用户不存在' });
    }
    const userId = userRecord.id;

    const likes = await prisma.like.findMany({
      where: { user_id: userId, target_type: 1 },
      orderBy: { created_at: 'desc' },
      take: limit,
      skip: skip
    });

    const postIds = likes.map(l => l.target_id);
    const posts = await prisma.post.findMany({
      where: { id: { in: postIds }, is_draft: false },
      include: {
        user: { select: { id: true, user_id: true, nickname: true, avatar: true, location: true } },
        category: { select: { name: true } },
        images: { select: { image_url: true, is_free_preview: true } },
        videos: { select: { video_url: true, cover_url: true }, take: 1 },
        tags: { include: { tag: { select: { id: true, name: true } } } },
        paymentSettings: true
      }
    });

    // 添加 liked_at 字段
    const likeMap = new Map(likes.map(l => [l.target_id, l.created_at]));
    const postsWithLikedAt = posts.map(p => ({ ...p, liked_at: likeMap.get(p.id) }));

    let purchasedPostIds = new Set();
    let collectedPostIds = new Set();
    if (currentUserId && posts.length > 0) {
      const purchases = await prisma.userPurchasedContent.findMany({ where: { user_id: currentUserId, post_id: { in: postIds } }, select: { post_id: true } });
      purchasedPostIds = new Set(purchases.map(p => p.post_id));
      const collections = await prisma.collection.findMany({ where: { user_id: currentUserId, post_id: { in: postIds } }, select: { post_id: true } });
      collectedPostIds = new Set(collections.map(c => c.post_id));
    }

    const formattedPosts = postsWithLikedAt.map(post => {
      const formatted = {
        id: Number(post.id),
        user_id: Number(post.user_id),
        title: post.title,
        content: post.content,
        category_id: post.category_id,
        category: post.category?.name,
        type: post.type,
        view_count: Number(post.view_count),
        like_count: post.like_count,
        collect_count: post.collect_count,
        comment_count: post.comment_count,
        created_at: post.created_at,
        liked_at: post.liked_at,
        nickname: post.user?.nickname,
        user_avatar: post.user?.avatar,
        avatar: post.user?.avatar,
        author: post.user?.nickname,
        author_account: post.user?.user_id,
        location: post.user?.location
      };

      const isAuthor = currentUserId && post.user_id === currentUserId;
      const hasPurchased = purchasedPostIds.has(post.id);
      const paymentSetting = post.paymentSettings;
      const imageUrls = post.images.map(img => ({ url: img.image_url, isFreePreview: img.is_free_preview }));
      const videoData = post.videos[0] || null;

      protectPostListItem(formatted, {
        paymentSetting: paymentSetting ? { enabled: paymentSetting.enabled ? 1 : 0, free_preview_count: paymentSetting.free_preview_count, preview_duration: paymentSetting.preview_duration, price: paymentSetting.price, hide_all: paymentSetting.hide_all } : null,
        isAuthor,
        hasPurchased,
        videoData: videoData ? { video_url: videoData.video_url, cover_url: videoData.cover_url } : null,
        imageUrls
      });

      formatted.tags = post.tags.map(pt => ({ id: pt.tag.id, name: pt.tag.name }));
      formatted.liked = true;
      formatted.collected = collectedPostIds.has(post.id);
      return formatted;
    });

    // 只计算点赞的非草稿帖子
    const total = await prisma.like.count({
      where: {
        user_id: userId,
        target_type: 1
      }
    });

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: 'success',
      data: { posts: formattedPosts, pagination: { page, limit, total, pages: Math.ceil(total / limit) } }
    });
  } catch (error) {
    console.error('获取点赞列表失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 获取用户统计信息
router.get('/:id/stats', async (req, res) => {
  try {
    const userIdParam = req.params.id;

    // 通过汐社号查找对应的数字ID
    const user = await prisma.user.findUnique({
      where: { user_id: userIdParam },
      select: { id: true, follow_count: true, fans_count: true, like_count: true }
    });

    if (!user) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '用户不存在' });
    }

    const userId = user.id;

    // 获取笔记数量
    const postCount = await prisma.post.count({
      where: { user_id: userId, is_draft: false }
    });

    // 获取该用户发布的笔记被收藏的总数量
    const collectCount = await prisma.collection.count({
      where: { post: { user_id: userId, is_draft: false } }
    });

    // 计算获赞与收藏总数
    const likesAndCollects = user.like_count + collectCount;

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: 'success',
      data: {
        follow_count: user.follow_count,
        fans_count: user.fans_count,
        post_count: postCount,
        like_count: user.like_count,
        collect_count: collectCount,
        likes_and_collects: likesAndCollects
      }
    });
  } catch (error) {
    console.error('获取用户统计信息失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

module.exports = router;
