const express = require('express');
const router = express.Router();
const { HTTP_STATUS, RESPONSE_CODES, ERROR_MESSAGES } = require('../constants');
const { prisma } = require('../config/config');
const { optionalAuth, authenticateToken } = require('../middleware/auth');
const NotificationHelper = require('../utils/notificationHelper');
const { extractMentionedUsers, hasMentions } = require('../utils/mentionParser');
const { batchCleanupFiles } = require('../utils/fileCleanup');
const { sanitizeContent } = require('../utils/contentSecurity');
const { generatePreviewVideo } = require('../utils/videoTranscoder');
const { 
  isPaidContent, 
  shouldProtectContent, 
  getFreePreviewCount, 
  protectPostListItem,
  protectPostDetail 
} = require('../utils/paidContentHelper');

// Post type constants
const POST_TYPE_IMAGE = 1;
const POST_TYPE_VIDEO = 2;

// Visibility constants
const VISIBILITY_PUBLIC = 'public';
const VISIBILITY_PRIVATE = 'private';
const VISIBILITY_FRIENDS_ONLY = 'friends_only';

// Helper to check if two users mutually follow each other
async function areMutualFollowers(userId1, userId2) {
  if (!userId1 || !userId2 || userId1 === userId2) return false;
  
  const [follows1to2, follows2to1] = await Promise.all([
    prisma.follow.findUnique({
      where: { uk_follow: { follower_id: userId1, following_id: userId2 } }
    }),
    prisma.follow.findUnique({
      where: { uk_follow: { follower_id: userId2, following_id: userId1 } }
    })
  ]);
  
  return !!(follows1to2 && follows2to1);
}

// Helper to check if user can view a post based on visibility
async function canViewPost(post, currentUserId) {
  // Author can always view their own posts
  if (currentUserId && post.user_id === currentUserId) return true;
  
  const visibility = post.visibility || VISIBILITY_PUBLIC;
  
  switch (visibility) {
    case VISIBILITY_PUBLIC:
      return true;
    case VISIBILITY_PRIVATE:
      return false;
    case VISIBILITY_FRIENDS_ONLY:
      if (!currentUserId) return false;
      return await areMutualFollowers(currentUserId, post.user_id);
    default:
      return true;
  }
}

// Helper to normalize payment settings (support both camelCase and snake_case)
function normalizePaymentSettings(settings) {
  if (!settings) return null;
  return {
    paymentType: settings.paymentType || settings.payment_type || 'single',
    price: settings.price || 0,
    freePreviewCount: settings.freePreviewCount || settings.free_preview_count || 0,
    previewDuration: settings.previewDuration || settings.preview_duration || 0,
    hideAll: settings.hideAll || settings.hide_all || false
  };
}

// Helper to format post for response
async function formatPost(post, currentUserId, prisma, options = {}) {
  const { includeTags = true, checkLikeCollect = true } = options;
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
    is_draft: post.is_draft,
    visibility: post.visibility || VISIBILITY_PUBLIC,
    nickname: post.user?.nickname,
    user_avatar: post.user?.avatar,
    author_account: post.user?.user_id,
    author_auto_id: post.user ? Number(post.user.id) : null,
    location: post.user?.location,
    verified: post.user?.verified,
    avatar: post.user?.avatar,
    author: post.user?.nickname
  };

  if (includeTags && post.tags) {
    formatted.tags = post.tags.map(pt => ({ id: pt.tag.id, name: pt.tag.name }));
  }

  if (checkLikeCollect && currentUserId) {
    const like = await prisma.like.findUnique({
      where: { uk_user_target: { user_id: currentUserId, target_type: 1, target_id: post.id } }
    });
    formatted.liked = !!like;
    const collection = await prisma.collection.findUnique({
      where: { uk_user_post: { user_id: currentUserId, post_id: post.id } }
    });
    formatted.collected = !!collection;
  } else {
    formatted.liked = false;
    formatted.collected = false;
  }

  return formatted;
}

// 获取笔记列表
router.get('/', optionalAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const category = req.query.category ? parseInt(req.query.category) : null;
    const isDraft = req.query.is_draft !== undefined ? parseInt(req.query.is_draft) === 1 : false;
    const type = req.query.type ? parseInt(req.query.type) : null;
    const currentUserId = req.user ? BigInt(req.user.id) : null;

    // Handle user_id which can be a numeric ID or a string username
    let userId = null;
    if (req.query.user_id) {
      if (/^\d+$/.test(req.query.user_id)) {
        // user_id is a numeric string, convert directly to BigInt
        userId = BigInt(req.query.user_id);
      } else {
        // user_id is a string username, look up the numeric ID
        const user = await prisma.user.findUnique({ where: { user_id: req.query.user_id }, select: { id: true } });
        if (user) {
          userId = user.id;
        }
      }
    }

    const where = {};
    where.is_draft = isDraft;
    if (isDraft) {
      if (!currentUserId) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ code: RESPONSE_CODES.UNAUTHORIZED, message: '查看草稿需要登录' });
      }
      where.user_id = currentUserId;
    } else if (userId) {
      where.user_id = userId;
      // When viewing specific user's posts, only show public posts to others
      // Authors can see all their own posts
      if (!currentUserId || currentUserId !== userId) {
        where.visibility = VISIBILITY_PUBLIC;
      }
    } else {
      // When browsing all posts (no specific user), only show public posts
      where.visibility = VISIBILITY_PUBLIC;
    }
    if (category) where.category_id = category;
    if (type) where.type = type;

    const posts = await prisma.post.findMany({
      where,
      include: {
        user: { select: { id: true, user_id: true, nickname: true, avatar: true, location: true, verified: true } },
        category: { select: { name: true } },
        images: { select: { image_url: true, is_free_preview: true } },
        videos: { select: { video_url: true, cover_url: true, preview_video_url: true }, take: 1 },
        tags: { include: { tag: { select: { id: true, name: true } } } },
        paymentSettings: true
      },
      orderBy: { created_at: 'desc' },
      take: limit,
      skip: skip
    });

    // For friends_only posts, we need to filter them based on mutual follow status
    // This is done after fetching if we're viewing a specific user's posts as the author
    let filteredPosts = posts;
    if (userId && currentUserId && currentUserId === userId) {
      // Author is viewing their own posts, show all
      filteredPosts = posts;
    }

    // Batch fetch purchase, like, collect status
    let purchasedPostIds = new Set();
    let likedPostIds = new Set();
    let collectedPostIds = new Set();
    if (currentUserId && filteredPosts.length > 0) {
      const postIds = filteredPosts.map(p => p.id);
      const [purchases, likes, collections] = await Promise.all([
        prisma.userPurchasedContent.findMany({ where: { user_id: currentUserId, post_id: { in: postIds } }, select: { post_id: true } }),
        prisma.like.findMany({ where: { user_id: currentUserId, target_type: 1, target_id: { in: postIds } }, select: { target_id: true } }),
        prisma.collection.findMany({ where: { user_id: currentUserId, post_id: { in: postIds } }, select: { post_id: true } })
      ]);
      purchasedPostIds = new Set(purchases.map(p => p.post_id));
      likedPostIds = new Set(likes.map(l => l.target_id));
      collectedPostIds = new Set(collections.map(c => c.post_id));
    }

    const formattedPosts = filteredPosts.map(post => {
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
        is_draft: post.is_draft,
        visibility: post.visibility || VISIBILITY_PUBLIC,
        nickname: post.user?.nickname,
        user_avatar: post.user?.avatar,
        author_account: post.user?.user_id,
        author_auto_id: post.user ? Number(post.user.id) : null,
        location: post.user?.location,
        verified: post.user?.verified,
        avatar: post.user?.avatar,
        author: post.user?.nickname
      };

      const isAuthor = currentUserId && post.user_id === currentUserId;
      const hasPurchased = purchasedPostIds.has(post.id);
      const paymentSetting = post.paymentSettings;
      const imageUrls = post.images.map(img => ({ url: img.image_url, isFreePreview: img.is_free_preview }));
      const videoData = post.videos[0] || null;

      protectPostListItem(formatted, {
        paymentSetting: paymentSetting ? { enabled: paymentSetting.enabled ? 1 : 0, free_preview_count: paymentSetting.free_preview_count, preview_duration: paymentSetting.preview_duration, price: Number(paymentSetting.price), hide_all: paymentSetting.hide_all } : null,
        isAuthor,
        hasPurchased,
        videoData: videoData ? { video_url: videoData.video_url, cover_url: videoData.cover_url, preview_video_url: videoData.preview_video_url } : null,
        imageUrls
      });

      formatted.tags = post.tags.map(pt => ({ id: pt.tag.id, name: pt.tag.name }));
      formatted.liked = likedPostIds.has(post.id);
      formatted.collected = collectedPostIds.has(post.id);
      return formatted;
    });

    const total = await prisma.post.count({ where });

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: 'success',
      data: { posts: formattedPosts, pagination: { page, limit, total, pages: Math.ceil(total / limit) } }
    });
  } catch (error) {
    console.error('获取笔记列表失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 获取笔记评论列表 (兼容路由 /posts/:id/comments)
// 注意：此路由必须在 /:id 之前定义，否则会被 /:id 捕获
router.get('/:id/comments', optionalAuth, async (req, res) => {
  try {
    const postId = BigInt(req.params.id);
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const currentUserId = req.user ? BigInt(req.user.id) : null;

    // 验证笔记是否存在
    const postExists = await prisma.post.findUnique({ where: { id: postId }, select: { id: true } });
    if (!postExists) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '笔记不存在' });
    }

    // 构建查询条件 - 只获取顶级评论
    const where = { post_id: postId, parent_id: null };
    if (currentUserId) {
      where.OR = [{ is_public: true }, { user_id: currentUserId }];
    } else {
      where.is_public = true;
    }

    const comments = await prisma.comment.findMany({
      where,
      include: {
        user: { select: { id: true, nickname: true, avatar: true, user_id: true, location: true, verified: true } }
      },
      orderBy: { created_at: 'desc' },
      take: limit,
      skip: skip
    });

    // 格式化评论并添加额外信息
    const formattedComments = await Promise.all(comments.map(async (comment) => {
      const formatted = {
        id: Number(comment.id),
        post_id: Number(comment.post_id),
        user_id: Number(comment.user_id),
        parent_id: comment.parent_id ? Number(comment.parent_id) : null,
        content: comment.content,
        like_count: comment.like_count,
        audit_status: comment.audit_status,
        is_public: comment.is_public,
        audit_result: comment.audit_result,
        created_at: comment.created_at,
        nickname: comment.user?.nickname,
        user_avatar: comment.user?.avatar,
        user_auto_id: comment.user ? Number(comment.user.id) : null,
        user_display_id: comment.user?.user_id,
        user_location: comment.user?.location,
        verified: comment.user?.verified
      };

      // 检查点赞状态
      if (currentUserId) {
        const likeExists = await prisma.like.findUnique({
          where: { uk_user_target: { user_id: currentUserId, target_type: 2, target_id: comment.id } }
        });
        formatted.liked = !!likeExists;
      } else {
        formatted.liked = false;
      }

      // 获取子评论数量
      const childCountWhere = { parent_id: comment.id };
      if (currentUserId) {
        childCountWhere.OR = [{ is_public: true }, { user_id: currentUserId }];
      } else {
        childCountWhere.is_public = true;
      }
      formatted.reply_count = await prisma.comment.count({ where: childCountWhere });

      return formatted;
    }));

    const total = await prisma.comment.count({ where });

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: 'success',
      data: {
        comments: formattedComments,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) }
      }
    });
  } catch (error) {
    console.error('获取笔记评论列表失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 获取笔记详情
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const postId = BigInt(req.params.id);
    const currentUserId = req.user ? BigInt(req.user.id) : null;

    const post = await prisma.post.findUnique({
      where: { id: postId },
      include: {
        user: { select: { id: true, user_id: true, nickname: true, avatar: true, location: true, verified: true } },
        category: { select: { name: true } },
        images: { select: { id: true, image_url: true, is_free_preview: true } },
        videos: { select: { id: true, video_url: true, cover_url: true, dash_url: true, preview_video_url: true } },
        attachments: { select: { id: true, attachment_url: true, filename: true, filesize: true } },
        tags: { include: { tag: { select: { id: true, name: true } } } },
        paymentSettings: true
      }
    });

    if (!post) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '笔记不存在' });
    }

    // Check visibility permissions
    const canView = await canViewPost(post, currentUserId);
    if (!canView) {
      const visibility = post.visibility || VISIBILITY_PUBLIC;
      let message = '无权查看该笔记';
      if (visibility === VISIBILITY_PRIVATE) {
        message = '该笔记为私密笔记';
      } else if (visibility === VISIBILITY_FRIENDS_ONLY) {
        message = '该笔记仅互关好友可见';
      }
      return res.status(HTTP_STATUS.FORBIDDEN).json({ code: RESPONSE_CODES.FORBIDDEN, message });
    }

    // Increment view count
    await prisma.post.update({ where: { id: postId }, data: { view_count: { increment: 1 } } });

    const formatted = {
      id: Number(post.id),
      user_id: Number(post.user_id),
      title: post.title,
      content: post.content,
      category_id: post.category_id,
      category: post.category?.name,
      type: post.type,
      view_count: Number(post.view_count) + 1,
      like_count: post.like_count,
      collect_count: post.collect_count,
      comment_count: post.comment_count,
      created_at: post.created_at,
      is_draft: post.is_draft,
      visibility: post.visibility || VISIBILITY_PUBLIC,
      nickname: post.user?.nickname,
      user_avatar: post.user?.avatar,
      author_account: post.user?.user_id,
      author_auto_id: post.user ? Number(post.user.id) : null,
      location: post.user?.location,
      verified: post.user?.verified,
      images: post.images.map(img => ({ id: Number(img.id), url: img.image_url, isFreePreview: img.is_free_preview })),
      videos: post.videos.map(v => ({ id: Number(v.id), video_url: v.video_url, cover_url: v.cover_url, dash_url: v.dash_url, preview_video_url: v.preview_video_url })),
      attachment: post.attachments[0] ? { url: post.attachments[0].attachment_url, filename: post.attachments[0].filename, filesize: Number(post.attachments[0].filesize) } : null,
      tags: post.tags.map(pt => ({ id: pt.tag.id, name: pt.tag.name }))
    };

    // Add flattened video fields for video posts
    if (post.type === POST_TYPE_VIDEO && post.videos.length > 0) {
      const firstVideo = post.videos[0];
      formatted.video_url = firstVideo.video_url;
      formatted.cover_url = firstVideo.cover_url;
      formatted.preview_video_url = firstVideo.preview_video_url;
    }

    // Check payment and purchase status
    const isAuthor = currentUserId && post.user_id === currentUserId;
    let hasPurchased = false;
    if (currentUserId && !isAuthor) {
      const purchase = await prisma.userPurchasedContent.findUnique({
        where: { uk_user_post: { user_id: currentUserId, post_id: postId } }
      });
      hasPurchased = !!purchase;
    }

    const paymentSetting = post.paymentSettings;
    formatted.isPaidContent = paymentSetting?.enabled || false;
    formatted.hasPurchased = hasPurchased || isAuthor;
    formatted.isAuthor = isAuthor;

    if (paymentSetting) {
      formatted.paymentSettings = {
        enabled: paymentSetting.enabled,
        freePreviewCount: paymentSetting.free_preview_count,
        previewDuration: paymentSetting.preview_duration,
        price: Number(paymentSetting.price),
        hideAll: paymentSetting.hide_all
      };
    }

    // Protect content if needed
    if (shouldProtectContent(paymentSetting ? { enabled: paymentSetting.enabled ? 1 : 0 } : null, isAuthor, hasPurchased)) {
      protectPostDetail(formatted, {
        freePreviewCount: paymentSetting?.free_preview_count || 0,
        previewDuration: paymentSetting?.preview_duration || 0,
        hideAll: paymentSetting?.hide_all || false
      });
    }

    // Check like and collect status
    if (currentUserId) {
      const [like, collection] = await Promise.all([
        prisma.like.findUnique({ where: { uk_user_target: { user_id: currentUserId, target_type: 1, target_id: postId } } }),
        prisma.collection.findUnique({ where: { uk_user_post: { user_id: currentUserId, post_id: postId } } })
      ]);
      formatted.liked = !!like;
      formatted.collected = !!collection;
    } else {
      formatted.liked = false;
      formatted.collected = false;
    }

    res.json({ code: RESPONSE_CODES.SUCCESS, message: 'success', data: formatted });
  } catch (error) {
    console.error('获取笔记详情失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 创建笔记
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { title, content, category_id, type = 1, images = [], video, tags = [], is_draft = false, paymentSettings, attachment, visibility = VISIBILITY_PUBLIC } = req.body;
    const userId = BigInt(req.user.id);

    if (!title || !content) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '标题和内容不能为空' });
    }

    // Validate visibility value
    const validVisibility = [VISIBILITY_PUBLIC, VISIBILITY_PRIVATE, VISIBILITY_FRIENDS_ONLY].includes(visibility) ? visibility : VISIBILITY_PUBLIC;

    const sanitizedContent = sanitizeContent(content);

    // Create post
    const newPost = await prisma.post.create({
      data: {
        user_id: userId,
        title,
        content: sanitizedContent,
        category_id: category_id ? parseInt(category_id) : null,
        type: parseInt(type),
        is_draft,
        visibility: validVisibility
      }
    });

    const postId = newPost.id;

    // Add images
    if (images.length > 0) {
      await prisma.postImage.createMany({
        data: images.map(img => ({
          post_id: postId,
          image_url: typeof img === 'string' ? img : img.url,
          is_free_preview: typeof img === 'object' ? (img.isFreePreview !== false) : true
        }))
      });
    }

    // Add video
    if (video && video.url) {
      await prisma.postVideo.create({
        data: {
          post_id: postId,
          video_url: video.url,
          cover_url: video.coverUrl || video.cover_url || null
        }
      });
    }

    // Add attachment
    if (attachment && attachment.url) {
      await prisma.postAttachment.create({
        data: {
          post_id: postId,
          attachment_url: attachment.url,
          filename: attachment.filename || 'attachment',
          filesize: attachment.filesize || 0
        }
      });
    }

    // Handle tags
    if (tags.length > 0) {
      for (const tagName of tags) {
        let tag = await prisma.tag.findUnique({ where: { name: tagName } });
        if (!tag) {
          tag = await prisma.tag.create({ data: { name: tagName } });
        }
        await prisma.postTag.create({ data: { post_id: postId, tag_id: tag.id } });
        await prisma.tag.update({ where: { id: tag.id }, data: { use_count: { increment: 1 } } });
      }
    }

    // Handle payment settings
    if (paymentSettings && paymentSettings.enabled) {
      const normalized = normalizePaymentSettings(paymentSettings);

      await prisma.postPaymentSetting.create({
        data: {
          post_id: postId,
          enabled: true,
          payment_type: normalized.paymentType,
          price: normalized.price,
          free_preview_count: normalized.freePreviewCount,
          preview_duration: normalized.previewDuration,
          hide_all: normalized.hideAll
        }
      });

      // Generate preview video if needed
      if (parseInt(type) === POST_TYPE_VIDEO && video && video.url && normalized.previewDuration > 0) {
        try {
          const previewResult = await generatePreviewVideo(video.url, normalized.previewDuration, Number(postId));
          if (previewResult.success && previewResult.previewUrl) {
            await prisma.postVideo.updateMany({
              where: { post_id: postId },
              data: { preview_video_url: previewResult.previewUrl }
            });
          }
        } catch (previewError) {
          console.error('生成预览视频失败:', previewError);
        }
      }
    }

    // Handle mentions
    if (hasMentions(content)) {
      const mentionedUsers = extractMentionedUsers(content);
      for (const mentionedUser of mentionedUsers) {
        try {
          const user = await prisma.user.findUnique({ where: { user_id: mentionedUser.userId }, select: { id: true } });
          if (user && user.id !== userId) {
            const notificationData = NotificationHelper.createNotificationData({
              userId: Number(user.id),
              senderId: Number(userId),
              type: NotificationHelper.TYPES.MENTION,
              targetId: Number(postId)
            });
            await NotificationHelper.insertNotification(prisma, notificationData);
          }
        } catch (error) {
          console.error(`处理@用户通知失败:`, error);
        }
      }
    }

    console.log(`创建笔记成功 - 用户ID: ${userId}, 笔记ID: ${postId}`);

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: is_draft ? '草稿保存成功' : '发布成功',
      data: { id: Number(postId) }
    });
  } catch (error) {
    console.error('创建笔记失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 更新笔记
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const postId = BigInt(req.params.id);
    const userId = BigInt(req.user.id);
    const { title, content, category_id, type, images = [], video, tags = [], is_draft, paymentSettings, attachment, visibility } = req.body;

    const post = await prisma.post.findUnique({ where: { id: postId }, select: { user_id: true } });
    if (!post) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '笔记不存在' });
    }
    if (post.user_id !== userId) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ code: RESPONSE_CODES.FORBIDDEN, message: '只能编辑自己的笔记' });
    }

    const updateData = {};
    if (title !== undefined) updateData.title = title;
    if (content !== undefined) updateData.content = sanitizeContent(content);
    if (category_id !== undefined) updateData.category_id = category_id ? parseInt(category_id) : null;
    if (type !== undefined) updateData.type = parseInt(type);
    if (is_draft !== undefined) updateData.is_draft = is_draft;
    if (visibility !== undefined) {
      // Validate visibility value
      updateData.visibility = [VISIBILITY_PUBLIC, VISIBILITY_PRIVATE, VISIBILITY_FRIENDS_ONLY].includes(visibility) ? visibility : VISIBILITY_PUBLIC;
    }

    await prisma.post.update({ where: { id: postId }, data: updateData });

    // Update images
    if (images && images.length > 0) {
      await prisma.postImage.deleteMany({ where: { post_id: postId } });
      await prisma.postImage.createMany({
        data: images.map(img => ({
          post_id: postId,
          image_url: typeof img === 'string' ? img : img.url,
          is_free_preview: typeof img === 'object' ? (img.isFreePreview !== false) : true
        }))
      });
    }

    // Update video
    if (video !== undefined) {
      await prisma.postVideo.deleteMany({ where: { post_id: postId } });
      if (video && video.url) {
        await prisma.postVideo.create({
          data: { post_id: postId, video_url: video.url, cover_url: video.coverUrl || video.cover_url || null }
        });
      }
    }

    // Update attachment
    if (attachment !== undefined) {
      await prisma.postAttachment.deleteMany({ where: { post_id: postId } });
      if (attachment && attachment.url) {
        await prisma.postAttachment.create({
          data: { post_id: postId, attachment_url: attachment.url, filename: attachment.filename || 'attachment', filesize: attachment.filesize || 0 }
        });
      }
    }

    // Update tags
    if (tags !== undefined) {
      const oldTags = await prisma.postTag.findMany({ where: { post_id: postId }, include: { tag: true } });
      for (const oldTag of oldTags) {
        await prisma.tag.update({ where: { id: oldTag.tag_id }, data: { use_count: { decrement: 1 } } });
      }
      await prisma.postTag.deleteMany({ where: { post_id: postId } });
      for (const tagName of tags) {
        let tag = await prisma.tag.findUnique({ where: { name: tagName } });
        if (!tag) {
          tag = await prisma.tag.create({ data: { name: tagName } });
        }
        await prisma.postTag.create({ data: { post_id: postId, tag_id: tag.id } });
        await prisma.tag.update({ where: { id: tag.id }, data: { use_count: { increment: 1 } } });
      }
    }

    // Update payment settings
    if (paymentSettings !== undefined) {
      await prisma.postPaymentSetting.deleteMany({ where: { post_id: postId } });
      if (paymentSettings && paymentSettings.enabled) {
        const normalized = normalizePaymentSettings(paymentSettings);

        await prisma.postPaymentSetting.create({
          data: {
            post_id: postId,
            enabled: true,
            payment_type: normalized.paymentType,
            price: normalized.price,
            free_preview_count: normalized.freePreviewCount,
            preview_duration: normalized.previewDuration,
            hide_all: normalized.hideAll
          }
        });
      }
    }

    console.log(`更新笔记成功 - 用户ID: ${userId}, 笔记ID: ${postId}`);
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '更新成功' });
  } catch (error) {
    console.error('更新笔记失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 删除笔记
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const postId = BigInt(req.params.id);
    const userId = BigInt(req.user.id);

    const post = await prisma.post.findUnique({
      where: { id: postId },
      include: { images: true, videos: true, attachments: true }
    });

    if (!post) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '笔记不存在' });
    }
    if (post.user_id !== userId) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ code: RESPONSE_CODES.FORBIDDEN, message: '只能删除自己的笔记' });
    }

    // Collect files to delete
    const filesToDelete = [];
    post.images.forEach(img => filesToDelete.push(img.image_url));
    post.videos.forEach(v => { if (v.video_url) filesToDelete.push(v.video_url); if (v.cover_url) filesToDelete.push(v.cover_url); });
    post.attachments.forEach(a => filesToDelete.push(a.attachment_url));

    // Update tag counts
    const postTags = await prisma.postTag.findMany({ where: { post_id: postId } });
    for (const pt of postTags) {
      await prisma.tag.update({ where: { id: pt.tag_id }, data: { use_count: { decrement: 1 } } });
    }

    // Delete the post (cascades will handle related records)
    await prisma.post.delete({ where: { id: postId } });

    // Cleanup files
    batchCleanupFiles(filesToDelete);

    console.log(`删除笔记成功 - 用户ID: ${userId}, 笔记ID: ${postId}`);
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '删除成功' });
  } catch (error) {
    console.error('删除笔记失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 收藏/取消收藏笔记
router.post('/:id/collect', authenticateToken, async (req, res) => {
  try {
    const postId = BigInt(req.params.id);
    const userId = BigInt(req.user.id);

    const post = await prisma.post.findUnique({ where: { id: postId }, select: { id: true, user_id: true } });
    if (!post) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '笔记不存在' });
    }

    const existingCollection = await prisma.collection.findUnique({
      where: { uk_user_post: { user_id: userId, post_id: postId } }
    });

    if (existingCollection) {
      await prisma.collection.delete({ where: { id: existingCollection.id } });
      await prisma.post.update({ where: { id: postId }, data: { collect_count: { decrement: 1 } } });
      res.json({ code: RESPONSE_CODES.SUCCESS, message: '取消收藏成功', data: { collected: false } });
    } else {
      await prisma.collection.create({ data: { user_id: userId, post_id: postId } });
      await prisma.post.update({ where: { id: postId }, data: { collect_count: { increment: 1 } } });
      if (post.user_id !== userId) {
        const notificationData = NotificationHelper.createCollectPostNotification(Number(post.user_id), Number(userId), Number(postId));
        await NotificationHelper.insertNotification(prisma, notificationData);
      }
      res.json({ code: RESPONSE_CODES.SUCCESS, message: '收藏成功', data: { collected: true } });
    }
  } catch (error) {
    console.error('收藏操作失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

module.exports = router;
