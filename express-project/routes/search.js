const express = require('express');
const router = express.Router();
const { HTTP_STATUS, RESPONSE_CODES, ERROR_MESSAGES } = require('../constants');
const { prisma } = require('../config/config');
const { optionalAuth } = require('../middleware/auth');
const { protectPostListItem } = require('../utils/paidContentHelper');

// 搜索（通用搜索接口）
router.get('/', optionalAuth, async (req, res) => {
  try {
    const keyword = req.query.keyword || '';
    const tag = req.query.tag || '';
    const type = req.query.type || 'all'; // all, posts, videos, users
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const currentUserId = req.user ? BigInt(req.user.id) : null;

    // 如果既没有关键词也没有标签，返回空结果
    if (!keyword.trim() && !tag.trim()) {
      return res.json({
        code: RESPONSE_CODES.SUCCESS,
        message: 'success',
        data: {
          keyword,
          tag,
          type,
          data: [],
          tagStats: [],
          pagination: {
            page,
            limit,
            total: 0,
            pages: 0
          }
        }
      });
    }

    let result = {};

    // all、posts、videos都返回笔记内容，但根据type过滤不同类型
    if (type === 'all' || type === 'posts' || type === 'videos') {
      // 构建Prisma查询条件
      const where = {
        is_draft: false
      };

      // 关键词搜索条件
      if (keyword.trim()) {
        where.OR = [
          { title: { contains: keyword } },
          { content: { contains: keyword } },
          { user: { nickname: { contains: keyword } } },
          { user: { user_id: { contains: keyword } } },
          { tags: { some: { tag: { name: { contains: keyword } } } } }
        ];
      }

      // 标签搜索条件
      if (tag.trim()) {
        if (where.OR) {
          // 有keyword时，添加AND条件
          where.AND = [
            { tags: { some: { tag: { name: tag } } } }
          ];
        } else {
          // 没有keyword时，直接按tag搜索
          where.tags = { some: { tag: { name: tag } } };
        }
      }

      // 根据type添加内容类型过滤
      if (type === 'posts') {
        where.type = 1;
      } else if (type === 'videos') {
        where.type = 2;
      }

      // 搜索笔记
      const posts = await prisma.post.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              user_id: true,
              nickname: true,
              avatar: true,
              location: true
            }
          },
          images: {
            select: { image_url: true, is_free_preview: true }
          },
          videos: {
            select: { video_url: true, cover_url: true },
            take: 1
          },
          tags: {
            include: {
              tag: { select: { id: true, name: true } }
            }
          },
          paymentSettings: {
            select: { enabled: true, free_preview_count: true, preview_duration: true, price: true, hide_all: true }
          }
        },
        orderBy: { created_at: 'desc' },
        take: limit,
        skip: skip
      });

      // 获取用户购买记录
      let purchasedPostIds = new Set();
      if (currentUserId && posts.length > 0) {
        const postIds = posts.map(p => p.id);
        const purchases = await prisma.userPurchasedContent.findMany({
          where: { user_id: currentUserId, post_id: { in: postIds } },
          select: { post_id: true }
        });
        purchasedPostIds = new Set(purchases.map(p => p.post_id));
      }

      // 获取点赞和收藏状态
      let likedPostIds = new Set();
      let collectedPostIds = new Set();
      if (currentUserId && posts.length > 0) {
        const postIds = posts.map(p => p.id);
        const likes = await prisma.like.findMany({
          where: { user_id: currentUserId, target_type: 1, target_id: { in: postIds } },
          select: { target_id: true }
        });
        likedPostIds = new Set(likes.map(l => l.target_id));

        const collections = await prisma.collection.findMany({
          where: { user_id: currentUserId, post_id: { in: postIds } },
          select: { post_id: true }
        });
        collectedPostIds = new Set(collections.map(c => c.post_id));
      }

      // 格式化帖子
      const formattedPosts = posts.map(post => {
        const formatted = {
          id: Number(post.id),
          user_id: Number(post.user_id),
          title: post.title,
          content: post.content,
          category_id: post.category_id,
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
          avatar: post.user?.avatar,
          author: post.user?.nickname,
          location: post.user?.location
        };

        const isAuthor = currentUserId && post.user_id === currentUserId;
        const hasPurchased = purchasedPostIds.has(post.id);
        const paymentSetting = post.paymentSettings;

        // 获取图片URLs
        const imageUrls = post.images.map(img => ({
          url: img.image_url,
          isFreePreview: img.is_free_preview
        }));

        // 获取视频数据
        const videoData = post.videos[0] || null;

        protectPostListItem(formatted, {
          paymentSetting: paymentSetting ? {
            enabled: paymentSetting.enabled ? 1 : 0,
            free_preview_count: paymentSetting.free_preview_count,
            preview_duration: paymentSetting.preview_duration,
            price: paymentSetting.price,
            hide_all: paymentSetting.hide_all
          } : null,
          isAuthor,
          hasPurchased,
          videoData: videoData ? {
            video_url: videoData.video_url,
            cover_url: videoData.cover_url
          } : null,
          imageUrls
        });

        formatted.tags = post.tags.map(pt => ({ id: pt.tag.id, name: pt.tag.name }));
        formatted.liked = likedPostIds.has(post.id);
        formatted.collected = collectedPostIds.has(post.id);

        return formatted;
      });

      // 获取总数
      const total = await prisma.post.count({ where });

      // 统计标签频率
      let tagStats = [];
      if (keyword.trim()) {
        const tagStatsQuery = await prisma.$queryRaw`
          SELECT t.name, COUNT(*) as count
          FROM tags t
          JOIN post_tags pt ON t.id = pt.tag_id
          JOIN posts p ON pt.post_id = p.id
          LEFT JOIN users u ON p.user_id = u.id
          WHERE p.is_draft = 0 AND (
            p.title LIKE ${`%${keyword}%`} 
            OR p.content LIKE ${`%${keyword}%`}
            OR u.nickname LIKE ${`%${keyword}%`}
            OR u.user_id LIKE ${`%${keyword}%`}
            OR EXISTS (SELECT 1 FROM post_tags pt2 JOIN tags t2 ON pt2.tag_id = t2.id WHERE pt2.post_id = p.id AND t2.name LIKE ${`%${keyword}%`})
          )
          GROUP BY t.id, t.name
          ORDER BY t.name ASC
          LIMIT 10
        `;

        tagStats = tagStatsQuery.map(item => ({
          id: item.name,
          label: item.name,
          count: Number(item.count)
        }));
      }

      if (type === 'all') {
        result = {
          data: formattedPosts,
          tagStats: tagStats,
          pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit)
          }
        };
      } else if (type === 'posts' || type === 'videos') {
        result.posts = {
          data: formattedPosts,
          tagStats: tagStats,
          pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit)
          }
        };
      }
    }

    // 只有当type为'users'时才搜索用户
    if (type === 'users') {
      const users = await prisma.user.findMany({
        where: {
          OR: [
            { nickname: { contains: keyword } },
            { user_id: { contains: keyword } }
          ]
        },
        select: {
          id: true,
          user_id: true,
          nickname: true,
          avatar: true,
          bio: true,
          location: true,
          follow_count: true,
          fans_count: true,
          like_count: true,
          created_at: true,
          verified: true,
          _count: {
            select: { posts: { where: { is_draft: false } } }
          }
        },
        orderBy: { created_at: 'desc' },
        take: limit,
        skip: skip
      });

      // 获取关注状态
      let formattedUsers = users.map(user => ({
        id: Number(user.id),
        user_id: user.user_id,
        nickname: user.nickname,
        avatar: user.avatar,
        bio: user.bio,
        location: user.location,
        follow_count: user.follow_count,
        fans_count: user.fans_count,
        like_count: user.like_count,
        created_at: user.created_at,
        verified: user.verified,
        post_count: user._count.posts,
        isFollowing: false,
        isMutual: false,
        buttonType: 'follow'
      }));

      if (currentUserId) {
        const userIds = users.map(u => u.id);
        
        // 检查我关注的用户
        const following = await prisma.follow.findMany({
          where: { follower_id: currentUserId, following_id: { in: userIds } },
          select: { following_id: true }
        });
        const followingSet = new Set(following.map(f => f.following_id));

        // 检查关注我的用户
        const followers = await prisma.follow.findMany({
          where: { follower_id: { in: userIds }, following_id: currentUserId },
          select: { follower_id: true }
        });
        const followersSet = new Set(followers.map(f => f.follower_id));

        formattedUsers = formattedUsers.map(user => {
          const userId = BigInt(user.id);
          const isFollowing = followingSet.has(userId);
          const isFollower = followersSet.has(userId);

          if (userId === currentUserId) {
            user.buttonType = 'self';
          } else if (isFollowing && isFollower) {
            user.buttonType = 'mutual';
            user.isMutual = true;
          } else if (isFollowing) {
            user.buttonType = 'unfollow';
          } else if (isFollower) {
            user.buttonType = 'back';
          } else {
            user.buttonType = 'follow';
          }
          user.isFollowing = isFollowing;

          return user;
        });
      }

      // 获取用户总数
      const userTotal = await prisma.user.count({
        where: {
          OR: [
            { nickname: { contains: keyword } },
            { user_id: { contains: keyword } }
          ]
        }
      });

      result.users = {
        data: formattedUsers,
        pagination: {
          page,
          limit,
          total: userTotal,
          pages: Math.ceil(userTotal / limit)
        }
      };
    }

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: 'success',
      data: {
        keyword,
        tag,
        type: type,
        ...result
      }
    });
  } catch (error) {
    console.error('搜索失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

module.exports = router;
