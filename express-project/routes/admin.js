const express = require('express')
const router = express.Router()
const { HTTP_STATUS, RESPONSE_CODES } = require('../constants')
const { prisma } = require('../config/config')
const { adminAuth } = require('../utils/uploadHelper')
const { auditComment } = require('../utils/contentAudit')
const { batchCleanupFiles } = require('../utils/fileCleanup')

// ===================== 审核设置 =====================
let aiAutoReviewEnabled = false;
router.get('/ai-review-status', adminAuth, (req, res) => {
  res.json({ code: RESPONSE_CODES.SUCCESS, data: { enabled: aiAutoReviewEnabled }, message: 'success' });
});
router.post('/ai-review-toggle', adminAuth, (req, res) => {
  const { enabled } = req.body;
  aiAutoReviewEnabled = Boolean(enabled);
  res.json({ code: RESPONSE_CODES.SUCCESS, message: `AI自动审核已${aiAutoReviewEnabled ? '开启' : '关闭'}` });
});
const isAiAutoReviewEnabled = () => aiAutoReviewEnabled;

// ===================== 笔记管理 =====================
router.get('/posts', adminAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const { title, user_display_id, category_id, type, is_draft, sortField = 'created_at', sortOrder = 'desc' } = req.query;

    const where = {};
    if (title) where.title = { contains: title };
    if (category_id) where.category_id = parseInt(category_id);
    if (type !== undefined) where.type = parseInt(type);
    if (is_draft !== undefined) where.is_draft = parseInt(is_draft) === 1;
    if (user_display_id) where.user = { user_id: user_display_id };

    const [total, posts] = await Promise.all([
      prisma.post.count({ where }),
      prisma.post.findMany({
        where,
        include: {
          user: { select: { id: true, user_id: true, nickname: true } },
          category: { select: { name: true } },
          images: { select: { image_url: true } },
          tags: { include: { tag: { select: { id: true, name: true } } } }
        },
        orderBy: { [sortField]: sortOrder },
        take: limit,
        skip: skip
      })
    ]);

    const formattedPosts = posts.map(post => ({
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
      user_display_id: post.user?.user_id,
      nickname: post.user?.nickname,
      images: post.images.map(img => img.image_url),
      tags: post.tags.map(pt => ({ id: pt.tag.id, name: pt.tag.name }))
    }));

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: { posts: formattedPosts, pagination: { page, limit, total, pages: Math.ceil(total / limit) } },
      message: 'success'
    });
  } catch (error) {
    console.error('获取笔记列表失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' });
  }
});

router.get('/posts/:id', adminAuth, async (req, res) => {
  try {
    const postId = BigInt(req.params.id);
    const post = await prisma.post.findUnique({
      where: { id: postId },
      include: {
        user: { select: { id: true, user_id: true, nickname: true } },
        category: { select: { name: true } },
        images: { select: { id: true, image_url: true, is_free_preview: true } },
        videos: { select: { id: true, video_url: true, cover_url: true } },
        tags: { include: { tag: { select: { id: true, name: true } } } },
        paymentSettings: true
      }
    });

    if (!post) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '笔记不存在' });
    }

    res.json({ code: RESPONSE_CODES.SUCCESS, data: post, message: 'success' });
  } catch (error) {
    console.error('获取笔记详情失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' });
  }
});

router.delete('/posts/:id', adminAuth, async (req, res) => {
  try {
    const postId = BigInt(req.params.id);
    const post = await prisma.post.findUnique({
      where: { id: postId },
      include: { images: true, videos: true }
    });
    if (!post) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '笔记不存在' });
    }

    const filesToDelete = [];
    post.images.forEach(img => filesToDelete.push(img.image_url));
    post.videos.forEach(v => { if (v.video_url) filesToDelete.push(v.video_url); if (v.cover_url) filesToDelete.push(v.cover_url); });

    await prisma.post.delete({ where: { id: postId } });
    batchCleanupFiles(filesToDelete);

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '删除成功' });
  } catch (error) {
    console.error('删除笔记失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除失败' });
  }
});

// ===================== 评论管理 =====================
router.get('/comments', adminAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const { user_display_id, audit_status, sortField = 'created_at', sortOrder = 'desc' } = req.query;

    const where = {};
    if (user_display_id) where.user = { user_id: user_display_id };
    if (audit_status !== undefined) where.audit_status = parseInt(audit_status);

    const [total, comments] = await Promise.all([
      prisma.comment.count({ where }),
      prisma.comment.findMany({
        where,
        include: {
          user: { select: { id: true, user_id: true, nickname: true } },
          post: { select: { id: true, title: true } }
        },
        orderBy: { [sortField]: sortOrder },
        take: limit,
        skip: skip
      })
    ]);

    const formattedComments = comments.map(c => ({
      id: Number(c.id),
      post_id: Number(c.post_id),
      user_id: Number(c.user_id),
      content: c.content,
      like_count: c.like_count,
      audit_status: c.audit_status,
      is_public: c.is_public,
      created_at: c.created_at,
      user_display_id: c.user?.user_id,
      nickname: c.user?.nickname,
      post_title: c.post?.title
    }));

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: { comments: formattedComments, pagination: { page, limit, total, pages: Math.ceil(total / limit) } },
      message: 'success'
    });
  } catch (error) {
    console.error('获取评论列表失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' });
  }
});

router.delete('/comments/:id', adminAuth, async (req, res) => {
  try {
    const commentId = BigInt(req.params.id);
    const comment = await prisma.comment.findUnique({ where: { id: commentId }, select: { post_id: true } });
    if (!comment) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '评论不存在' });
    }

    await prisma.comment.delete({ where: { id: commentId } });
    await prisma.post.update({ where: { id: comment.post_id }, data: { comment_count: { decrement: 1 } } });

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '删除成功' });
  } catch (error) {
    console.error('删除评论失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除失败' });
  }
});

// ===================== 用户管理 =====================
router.get('/users', adminAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const { user_id, nickname, is_active, sortField = 'created_at', sortOrder = 'desc' } = req.query;

    const where = {};
    if (user_id) where.user_id = { contains: user_id };
    if (nickname) where.nickname = { contains: nickname };
    if (is_active !== undefined) where.is_active = parseInt(is_active) === 1;

    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        select: {
          id: true, user_id: true, nickname: true, avatar: true, bio: true,
          location: true, email: true, follow_count: true, fans_count: true,
          like_count: true, is_active: true, created_at: true, verified: true
        },
        orderBy: { [sortField]: sortOrder },
        take: limit,
        skip: skip
      })
    ]);

    const formattedUsers = users.map(u => ({ ...u, id: Number(u.id) }));

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: { users: formattedUsers, pagination: { page, limit, total, pages: Math.ceil(total / limit) } },
      message: 'success'
    });
  } catch (error) {
    console.error('获取用户列表失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' });
  }
});

router.get('/users/:id', adminAuth, async (req, res) => {
  try {
    const userId = BigInt(req.params.id);
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, user_id: true, nickname: true, avatar: true, bio: true,
        location: true, email: true, follow_count: true, fans_count: true,
        like_count: true, is_active: true, created_at: true, verified: true,
        gender: true, zodiac_sign: true, mbti: true, education: true, major: true
      }
    });

    if (!user) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '用户不存在' });
    }

    res.json({ code: RESPONSE_CODES.SUCCESS, data: { ...user, id: Number(user.id) }, message: 'success' });
  } catch (error) {
    console.error('获取用户详情失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' });
  }
});

router.put('/users/:id', adminAuth, async (req, res) => {
  try {
    const userId = BigInt(req.params.id);
    const { nickname, bio, is_active, verified } = req.body;

    const updateData = {};
    if (nickname !== undefined) updateData.nickname = nickname;
    if (bio !== undefined) updateData.bio = bio;
    if (is_active !== undefined) updateData.is_active = is_active;
    if (verified !== undefined) updateData.verified = verified;

    await prisma.user.update({ where: { id: userId }, data: updateData });
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '更新成功' });
  } catch (error) {
    console.error('更新用户失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '更新失败' });
  }
});

router.delete('/users/:id', adminAuth, async (req, res) => {
  try {
    const userId = BigInt(req.params.id);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '用户不存在' });
    }

    await prisma.user.delete({ where: { id: userId } });
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '删除成功' });
  } catch (error) {
    console.error('删除用户失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除失败' });
  }
});

// ===================== 标签管理 =====================
router.get('/tags', adminAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const { name, sortField = 'use_count', sortOrder = 'desc' } = req.query;

    const where = name ? { name: { contains: name } } : {};

    const [total, tags] = await Promise.all([
      prisma.tag.count({ where }),
      prisma.tag.findMany({
        where,
        orderBy: { [sortField]: sortOrder },
        take: limit,
        skip: skip
      })
    ]);

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: { tags, pagination: { page, limit, total, pages: Math.ceil(total / limit) } },
      message: 'success'
    });
  } catch (error) {
    console.error('获取标签列表失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' });
  }
});

router.post('/tags', adminAuth, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '标签名不能为空' });
    }

    const existing = await prisma.tag.findUnique({ where: { name } });
    if (existing) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.CONFLICT, message: '标签已存在' });
    }

    const newTag = await prisma.tag.create({ data: { name } });
    res.json({ code: RESPONSE_CODES.SUCCESS, data: newTag, message: '创建成功' });
  } catch (error) {
    console.error('创建标签失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '创建失败' });
  }
});

router.delete('/tags/:id', adminAuth, async (req, res) => {
  try {
    const tagId = parseInt(req.params.id);
    await prisma.postTag.deleteMany({ where: { tag_id: tagId } });
    await prisma.tag.delete({ where: { id: tagId } });
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '删除成功' });
  } catch (error) {
    console.error('删除标签失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除失败' });
  }
});

// ===================== 分类管理 =====================
router.get('/categories', adminAuth, async (req, res) => {
  try {
    const categories = await prisma.category.findMany({
      orderBy: { id: 'asc' },
      include: { _count: { select: { posts: true } } }
    });

    const formatted = categories.map(c => ({
      id: c.id,
      name: c.name,
      category_title: c.category_title,
      created_at: c.created_at,
      post_count: c._count.posts
    }));

    res.json({ code: RESPONSE_CODES.SUCCESS, data: { categories: formatted }, message: 'success' });
  } catch (error) {
    console.error('获取分类列表失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' });
  }
});

router.post('/categories', adminAuth, async (req, res) => {
  try {
    const { name, category_title } = req.body;
    if (!name) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '分类名不能为空' });
    }

    const newCategory = await prisma.category.create({
      data: { name, category_title: category_title || '' }
    });
    res.json({ code: RESPONSE_CODES.SUCCESS, data: newCategory, message: '创建成功' });
  } catch (error) {
    console.error('创建分类失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '创建失败' });
  }
});

router.put('/categories/:id', adminAuth, async (req, res) => {
  try {
    const categoryId = parseInt(req.params.id);
    const { name, category_title } = req.body;

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (category_title !== undefined) updateData.category_title = category_title;

    await prisma.category.update({ where: { id: categoryId }, data: updateData });
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '更新成功' });
  } catch (error) {
    console.error('更新分类失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '更新失败' });
  }
});

router.delete('/categories/:id', adminAuth, async (req, res) => {
  try {
    const categoryId = parseInt(req.params.id);
    await prisma.post.updateMany({ where: { category_id: categoryId }, data: { category_id: null } });
    await prisma.category.delete({ where: { id: categoryId } });
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '删除成功' });
  } catch (error) {
    console.error('删除分类失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除失败' });
  }
});

// ===================== 审核管理 =====================
router.get('/audits', adminAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const { status, type, sortField = 'created_at', sortOrder = 'desc' } = req.query;

    const where = {};
    if (status !== undefined) where.status = parseInt(status);
    if (type !== undefined) where.type = parseInt(type);

    const [total, audits] = await Promise.all([
      prisma.audit.count({ where }),
      prisma.audit.findMany({
        where,
        include: {
          user: { select: { id: true, user_id: true, nickname: true } }
        },
        orderBy: { [sortField]: sortOrder },
        take: limit,
        skip: skip
      })
    ]);

    const formattedAudits = audits.map(a => ({
      ...a,
      id: Number(a.id),
      user_id: Number(a.user_id),
      target_id: a.target_id ? Number(a.target_id) : null,
      user_display_id: a.user?.user_id,
      nickname: a.user?.nickname
    }));

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: { audits: formattedAudits, pagination: { page, limit, total, pages: Math.ceil(total / limit) } },
      message: 'success'
    });
  } catch (error) {
    console.error('获取审核列表失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' });
  }
});

router.put('/audits/:id/approve', adminAuth, async (req, res) => {
  try {
    const auditId = BigInt(req.params.id);
    const audit = await prisma.audit.findUnique({ where: { id: auditId } });
    if (!audit) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '审核记录不存在' });
    }

    await prisma.audit.update({
      where: { id: auditId },
      data: { status: 1, audit_time: new Date(), reason: '管理员审核通过' }
    });

    // Update related content status
    if (audit.type === 3 && audit.target_id) {
      await prisma.comment.update({
        where: { id: audit.target_id },
        data: { audit_status: 1, is_public: true }
      });
    }

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '审核通过' });
  } catch (error) {
    console.error('审核失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '操作失败' });
  }
});

router.put('/audits/:id/reject', adminAuth, async (req, res) => {
  try {
    const auditId = BigInt(req.params.id);
    const { reason } = req.body;
    const audit = await prisma.audit.findUnique({ where: { id: auditId } });
    if (!audit) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '审核记录不存在' });
    }

    await prisma.audit.update({
      where: { id: auditId },
      data: { status: 2, audit_time: new Date(), reason: reason || '管理员审核拒绝' }
    });

    // Update related content status
    if (audit.type === 3 && audit.target_id) {
      await prisma.comment.update({
        where: { id: audit.target_id },
        data: { audit_status: 2, is_public: false }
      });
    }

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '已拒绝' });
  } catch (error) {
    console.error('审核失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '操作失败' });
  }
});

// ===================== 统计信息 =====================
router.get('/stats/overview', adminAuth, async (req, res) => {
  try {
    const [usersCount, postsCount, commentsCount, likesCount] = await Promise.all([
      prisma.user.count(),
      prisma.post.count(),
      prisma.comment.count(),
      prisma.like.count()
    ]);

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: { users: usersCount, posts: postsCount, comments: commentsCount, likes: likesCount },
      message: 'success'
    });
  } catch (error) {
    console.error('获取统计信息失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' });
  }
});

// Export the AI review status function
router.isAiAutoReviewEnabled = isAiAutoReviewEnabled;

module.exports = router;
