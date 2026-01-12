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

    // Batch fetch purchase, like, collect status
    let purchasedPostIds = new Set();
    let likedPostIds = new Set();
    let collectedPostIds = new Set();
    if (currentUserId && posts.length > 0) {
      const postIds = posts.map(p => p.id);
      const [purchases, likes, collections] = await Promise.all([
        prisma.userPurchasedContent.findMany({ where: { user_id: currentUserId, post_id: { in: postIds } }, select: { post_id: true } }),
        prisma.like.findMany({ where: { user_id: currentUserId, target_type: 1, target_id: { in: postIds } }, select: { target_id: true } }),
        prisma.collection.findMany({ where: { user_id: currentUserId, post_id: { in: postIds } }, select: { post_id: true } })
      ]);
      purchasedPostIds = new Set(purchases.map(p => p.post_id));
      likedPostIds = new Set(likes.map(l => l.target_id));
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
        is_draft: post.is_draft,
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
      nickname: post.user?.nickname,
      user_avatar: post.user?.avatar,
      author_account: post.user?.user_id,
      author_auto_id: post.user ? Number(post.user.id) : null,
      location: post.user?.location,
      verified: post.user?.verified,
      images: post.images.map(img => ({ id: Number(img.id), image_url: img.image_url, isFreePreview: img.is_free_preview })),
      videos: post.videos.map(v => ({ id: Number(v.id), video_url: v.video_url, cover_url: v.cover_url, dash_url: v.dash_url, preview_video_url: v.preview_video_url })),
      attachment: post.attachments[0] ? { url: post.attachments[0].attachment_url, filename: post.attachments[0].filename, filesize: Number(post.attachments[0].filesize) } : null,
      tags: post.tags.map(pt => ({ id: pt.tag.id, name: pt.tag.name }))
    };

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
    const { title, content, category_id, type = 1, images = [], video, tags = [], is_draft = false, paymentSettings, attachment } = req.body;
    const userId = BigInt(req.user.id);

    if (!title || !content) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '标题和内容不能为空' });
    }

    const sanitizedContent = sanitizeContent(content);

    // Create post
    const newPost = await prisma.post.create({
      data: {
        user_id: userId,
        title,
        content: sanitizedContent,
        category_id: category_id ? parseInt(category_id) : null,
        type: parseInt(type),
        is_draft
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
          cover_url: video.cover_url || null
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
      await prisma.postPaymentSetting.create({
        data: {
          post_id: postId,
          enabled: true,
          payment_type: paymentSettings.payment_type || 'single',
          price: paymentSettings.price || 0,
          free_preview_count: paymentSettings.free_preview_count || 0,
          preview_duration: paymentSettings.preview_duration || 0,
          hide_all: paymentSettings.hide_all || false
        }
      });

      // Generate preview video if needed
      if (type === 2 && video && video.url && paymentSettings.preview_duration > 0) {
        try {
          const previewUrl = await generatePreviewVideo(video.url, paymentSettings.preview_duration, Number(postId));
          if (previewUrl) {
            await prisma.postVideo.updateMany({
              where: { post_id: postId },
              data: { preview_video_url: previewUrl }
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
            await NotificationHelper.insertNotificationPrisma(prisma, notificationData);
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
    const { title, content, category_id, type, images = [], video, tags = [], is_draft, paymentSettings, attachment } = req.body;

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
          data: { post_id: postId, video_url: video.url, cover_url: video.cover_url || null }
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
        await prisma.postPaymentSetting.create({
          data: {
            post_id: postId,
            enabled: true,
            payment_type: paymentSettings.payment_type || 'single',
            price: paymentSettings.price || 0,
            free_preview_count: paymentSettings.free_preview_count || 0,
            preview_duration: paymentSettings.preview_duration || 0,
            hide_all: paymentSettings.hide_all || false
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
        await NotificationHelper.insertNotificationPrisma(prisma, notificationData);
      }
      res.json({ code: RESPONSE_CODES.SUCCESS, message: '收藏成功', data: { collected: true } });
    }
  } catch (error) {
    console.error('收藏操作失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

module.exports = router;
