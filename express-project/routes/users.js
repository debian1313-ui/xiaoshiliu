const express = require('express');
const router = express.Router();
const { HTTP_STATUS, RESPONSE_CODES, ERROR_MESSAGES } = require('../constants');
const { prisma } = require('../config/config');
const { optionalAuth, authenticateToken } = require('../middleware/auth');
const NotificationHelper = require('../utils/notificationHelper');
const { protectPostListItem } = require('../utils/paidContentHelper');

// 搜索用户
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
        pagination: { page, limit, total, pages: Math.ceil(total / limit) }
      }
    });
  } catch (error) {
    console.error('搜索用户失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 获取用户主页信息
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const userId = req.params.id;
    const currentUserId = req.user ? BigInt(req.user.id) : null;

    let user;
    if (isNaN(userId)) {
      user = await prisma.user.findUnique({ where: { user_id: userId } });
    } else {
      user = await prisma.user.findUnique({ where: { id: BigInt(userId) } });
    }

    if (!user) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '用户不存在' });
    }

    const postCount = await prisma.post.count({ where: { user_id: user.id, is_draft: false } });

    const userData = {
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
      gender: user.gender,
      zodiac_sign: user.zodiac_sign,
      mbti: user.mbti,
      education: user.education,
      major: user.major,
      interests: user.interests,
      post_count: postCount
    };

    if (currentUserId) {
      const isFollowing = await prisma.follow.findUnique({
        where: { uk_follow: { follower_id: currentUserId, following_id: user.id } }
      });
      const isFollower = await prisma.follow.findUnique({
        where: { uk_follow: { follower_id: user.id, following_id: currentUserId } }
      });
      userData.isFollowing = !!isFollowing;
      userData.isMutual = !!isFollowing && !!isFollower;
      userData.isSelf = currentUserId === user.id;
    } else {
      userData.isFollowing = false;
      userData.isMutual = false;
      userData.isSelf = false;
    }

    res.json({ code: RESPONSE_CODES.SUCCESS, message: 'success', data: userData });
  } catch (error) {
    console.error('获取用户信息失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 更新用户资料
router.put('/profile', authenticateToken, async (req, res) => {
  try {
    const userId = BigInt(req.user.id);
    const { nickname, avatar, bio, gender, zodiac_sign, mbti, education, major, interests } = req.body;
    const updateData = {};
    if (nickname !== undefined) updateData.nickname = nickname;
    if (avatar !== undefined) updateData.avatar = avatar;
    if (bio !== undefined) updateData.bio = bio;
    if (gender !== undefined) updateData.gender = gender;
    if (zodiac_sign !== undefined) updateData.zodiac_sign = zodiac_sign;
    if (mbti !== undefined) updateData.mbti = mbti;
    if (education !== undefined) updateData.education = education;
    if (major !== undefined) updateData.major = major;
    if (interests !== undefined) updateData.interests = interests;

    await prisma.user.update({ where: { id: userId }, data: updateData });

    const updatedUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, user_id: true, nickname: true, avatar: true, bio: true, location: true, gender: true, zodiac_sign: true, mbti: true, education: true, major: true, interests: true, verified: true }
    });

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '更新成功',
      data: { ...updatedUser, id: Number(updatedUser.id) }
    });
  } catch (error) {
    console.error('更新用户资料失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 关注/取消关注用户
router.post('/:id/follow', authenticateToken, async (req, res) => {
  try {
    const targetIdParam = req.params.id;
    const followerId = BigInt(req.user.id);

    // Handle both numeric IDs and string usernames
    let targetId;
    if (/^\d+$/.test(targetIdParam)) {
      targetId = BigInt(targetIdParam);
    } else {
      const user = await prisma.user.findUnique({ where: { user_id: targetIdParam }, select: { id: true } });
      if (!user) return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '用户不存在' });
      targetId = user.id;
    }

    if (targetId === followerId) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '不能关注自己' });
    }

    const targetUser = await prisma.user.findUnique({ where: { id: targetId } });
    if (!targetUser) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '用户不存在' });
    }

    const existingFollow = await prisma.follow.findUnique({
      where: { uk_follow: { follower_id: followerId, following_id: targetId } }
    });

    if (existingFollow) {
      await prisma.follow.delete({ where: { id: existingFollow.id } });
      await prisma.user.update({ where: { id: followerId }, data: { follow_count: { decrement: 1 } } });
      await prisma.user.update({ where: { id: targetId }, data: { fans_count: { decrement: 1 } } });
      res.json({ code: RESPONSE_CODES.SUCCESS, message: '取消关注成功', data: { isFollowing: false } });
    } else {
      await prisma.follow.create({ data: { follower_id: followerId, following_id: targetId } });
      await prisma.user.update({ where: { id: followerId }, data: { follow_count: { increment: 1 } } });
      await prisma.user.update({ where: { id: targetId }, data: { fans_count: { increment: 1 } } });
      const notificationData = NotificationHelper.createFollowNotification(Number(targetId), Number(followerId));
      await NotificationHelper.insertNotification(prisma, notificationData);
      res.json({ code: RESPONSE_CODES.SUCCESS, message: '关注成功', data: { isFollowing: true } });
    }
  } catch (error) {
    console.error('关注操作失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 获取关注状态
router.get('/:id/follow-status', authenticateToken, async (req, res) => {
  try {
    const targetIdParam = req.params.id;
    const currentUserId = BigInt(req.user.id);

    // Handle both numeric IDs and string usernames
    let targetId;
    if (/^\d+$/.test(targetIdParam)) {
      targetId = BigInt(targetIdParam);
    } else {
      const user = await prisma.user.findUnique({ where: { user_id: targetIdParam }, select: { id: true } });
      if (!user) return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '用户不存在' });
      targetId = user.id;
    }

    // Handle self-follow case
    if (targetId === currentUserId) {
      return res.json({
        code: RESPONSE_CODES.SUCCESS,
        message: 'success',
        data: { followed: false, isMutual: false, buttonType: 'self' }
      });
    }

    // Check if current user follows target user
    const followRecord = await prisma.follow.findUnique({
      where: { uk_follow: { follower_id: currentUserId, following_id: targetId } }
    });
    const followed = !!followRecord;

    // Check if target user follows current user (for mutual follow)
    const reverseFollowRecord = await prisma.follow.findUnique({
      where: { uk_follow: { follower_id: targetId, following_id: currentUserId } }
    });
    const isMutual = followed && !!reverseFollowRecord;

    // Determine button type (consistent with search endpoint)
    let buttonType = 'follow'; // default: not following
    if (followed && isMutual) {
      buttonType = 'mutual'; // mutual follow
    } else if (followed) {
      buttonType = 'unfollow'; // following but not mutual
    } else if (reverseFollowRecord) {
      buttonType = 'back'; // they follow me, I don't follow them
    }

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: 'success',
      data: { followed, isMutual, buttonType }
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

    // Handle both numeric IDs and string usernames
    let userId;
    if (/^\d+$/.test(userIdParam)) {
      userId = BigInt(userIdParam);
    } else {
      const user = await prisma.user.findUnique({ where: { user_id: userIdParam }, select: { id: true } });
      if (!user) return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '用户不存在' });
      userId = user.id;
    }

    const follows = await prisma.follow.findMany({
      where: { follower_id: userId },
      include: {
        following: {
          select: { id: true, user_id: true, nickname: true, avatar: true, bio: true, fans_count: true, verified: true }
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
      fans_count: f.following.fans_count,
      verified: f.following.verified,
      isFollowing: false,
      isMutual: false
    }));

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
        u.isFollowing = myFollowingSet.has(BigInt(u.id));
        u.isMutual = u.isFollowing && theyFollowMeSet.has(BigInt(u.id));
        return u;
      });
    }

    const total = await prisma.follow.count({ where: { follower_id: userId } });

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: 'success',
      data: { users, pagination: { page, limit, total, pages: Math.ceil(total / limit) } }
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

    // Handle both numeric IDs and string usernames
    let userId;
    if (/^\d+$/.test(userIdParam)) {
      userId = BigInt(userIdParam);
    } else {
      const user = await prisma.user.findUnique({ where: { user_id: userIdParam }, select: { id: true } });
      if (!user) return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '用户不存在' });
      userId = user.id;
    }

    const follows = await prisma.follow.findMany({
      where: { following_id: userId },
      include: {
        follower: {
          select: { id: true, user_id: true, nickname: true, avatar: true, bio: true, fans_count: true, verified: true }
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
      fans_count: f.follower.fans_count,
      verified: f.follower.verified,
      isFollowing: false,
      isMutual: false
    }));

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
        u.isFollowing = myFollowingSet.has(BigInt(u.id));
        u.isMutual = u.isFollowing && theyFollowMeSet.has(BigInt(u.id));
        return u;
      });
    }

    const total = await prisma.follow.count({ where: { following_id: userId } });

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: 'success',
      data: { users, pagination: { page, limit, total, pages: Math.ceil(total / limit) } }
    });
  } catch (error) {
    console.error('获取粉丝列表失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 获取用户笔记列表
router.get('/:id/posts', optionalAuth, async (req, res) => {
  try {
    const userId = req.params.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const currentUserId = req.user ? BigInt(req.user.id) : null;

    let targetUserId;
    if (isNaN(userId)) {
      const user = await prisma.user.findUnique({ where: { user_id: userId }, select: { id: true } });
      if (!user) return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '用户不存在' });
      targetUserId = user.id;
    } else {
      targetUserId = BigInt(userId);
    }

    const posts = await prisma.post.findMany({
      where: { user_id: targetUserId, is_draft: false },
      include: {
        user: { select: { id: true, user_id: true, nickname: true, avatar: true, location: true } },
        images: { select: { image_url: true, is_free_preview: true } },
        videos: { select: { video_url: true, cover_url: true }, take: 1 },
        tags: { include: { tag: { select: { id: true, name: true } } } },
        paymentSettings: true
      },
      orderBy: { created_at: 'desc' },
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
        type: post.type,
        view_count: Number(post.view_count),
        like_count: post.like_count,
        collect_count: post.collect_count,
        comment_count: post.comment_count,
        created_at: post.created_at,
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

    const total = await prisma.post.count({ where: { user_id: targetUserId, is_draft: false } });

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

    // Handle both numeric IDs and string usernames
    let userId;
    if (/^\d+$/.test(userIdParam)) {
      userId = BigInt(userIdParam);
    } else {
      const user = await prisma.user.findUnique({ where: { user_id: userIdParam }, select: { id: true } });
      if (!user) return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '用户不存在' });
      userId = user.id;
    }

    const collections = await prisma.collection.findMany({
      where: { user_id: userId },
      include: {
        post: {
          include: {
            user: { select: { id: true, user_id: true, nickname: true, avatar: true, location: true } },
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

    const posts = collections.map(c => c.post);
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
        type: post.type,
        view_count: Number(post.view_count),
        like_count: post.like_count,
        collect_count: post.collect_count,
        comment_count: post.comment_count,
        created_at: post.created_at,
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
      formatted.collected = true;
      return formatted;
    });

    const total = await prisma.collection.count({ where: { user_id: userId } });

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: 'success',
      data: { posts: formattedPosts, pagination: { page, limit, total, pages: Math.ceil(total / limit) } }
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

    // Handle both numeric IDs and string usernames
    let userId;
    if (/^\d+$/.test(userIdParam)) {
      userId = BigInt(userIdParam);
    } else {
      const user = await prisma.user.findUnique({ where: { user_id: userIdParam }, select: { id: true } });
      if (!user) return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '用户不存在' });
      userId = user.id;
    }

    const likes = await prisma.like.findMany({
      where: { user_id: userId, target_type: 1 },
      orderBy: { created_at: 'desc' },
      take: limit,
      skip: skip
    });

    const postIds = likes.map(l => l.target_id);
    const posts = await prisma.post.findMany({
      where: { id: { in: postIds } },
      include: {
        user: { select: { id: true, user_id: true, nickname: true, avatar: true, location: true } },
        images: { select: { image_url: true, is_free_preview: true } },
        videos: { select: { video_url: true, cover_url: true }, take: 1 },
        tags: { include: { tag: { select: { id: true, name: true } } } },
        paymentSettings: true
      }
    });

    let purchasedPostIds = new Set();
    let collectedPostIds = new Set();
    if (currentUserId && posts.length > 0) {
      const purchases = await prisma.userPurchasedContent.findMany({ where: { user_id: currentUserId, post_id: { in: postIds } }, select: { post_id: true } });
      purchasedPostIds = new Set(purchases.map(p => p.post_id));
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
        type: post.type,
        view_count: Number(post.view_count),
        like_count: post.like_count,
        collect_count: post.collect_count,
        comment_count: post.comment_count,
        created_at: post.created_at,
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
      formatted.liked = true;
      formatted.collected = collectedPostIds.has(post.id);
      return formatted;
    });

    const total = await prisma.like.count({ where: { user_id: userId, target_type: 1 } });

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

    // Handle both numeric IDs and string usernames, and get user data in one query
    let user;
    if (/^\d+$/.test(userIdParam)) {
      user = await prisma.user.findUnique({
        where: { id: BigInt(userIdParam) },
        select: { id: true, follow_count: true, fans_count: true }
      });
    } else {
      user = await prisma.user.findUnique({
        where: { user_id: userIdParam },
        select: { id: true, follow_count: true, fans_count: true }
      });
    }

    if (!user) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '用户不存在' });
    }

    const userId = user.id;

    // Use aggregation to get posts count and sums in one query
    const postStats = await prisma.post.aggregate({
      where: { user_id: userId, is_draft: false },
      _count: { id: true },
      _sum: { like_count: true, view_count: true }
    });

    const postsCount = postStats._count.id;
    const likesCount = postStats._sum.like_count || 0;
    const viewsCount = Number(postStats._sum.view_count || 0);

    // Get collections count (collections received on user's posts)
    const collectionsCount = await prisma.collection.count({
      where: { post: { user_id: userId, is_draft: false } }
    });

    // Get comments count (comments on user's posts)
    const commentsCount = await prisma.comment.count({
      where: { post: { user_id: userId, is_draft: false } }
    });

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: 'success',
      data: {
        posts_count: postsCount,
        likes_count: likesCount,
        collections_count: collectionsCount,
        comments_count: commentsCount,
        followers_count: user.fans_count,
        following_count: user.follow_count,
        views_count: viewsCount
      }
    });
  } catch (error) {
    console.error('获取用户统计信息失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

module.exports = router;
