const express = require('express');
const router = express.Router();
const { HTTP_STATUS, RESPONSE_CODES, ERROR_MESSAGES } = require('../constants');
const { pool } = require('../config/config');
const { authenticateToken, optionalAuth } = require('../middleware/auth');
const NotificationHelper = require('../utils/notificationHelper');
const { extractMentionedUsers, hasMentions } = require('../utils/mentionParser');
const { sanitizeContent } = require('../utils/contentSecurity');
const { auditComment, isAuditEnabled } = require('../utils/contentAudit');

// 递归删除评论及其子评论，返回删除的评论总数
async function deleteCommentRecursive(commentId) {
  let deletedCount = 0;

  // 获取所有子评论
  const [children] = await pool.execute('SELECT id FROM comments WHERE parent_id = ?', [commentId.toString()]);

  // 递归删除子评论
  for (const child of children) {
    deletedCount += await deleteCommentRecursive(child.id);
  }

  // 删除当前评论的点赞记录
  await pool.execute('DELETE FROM likes WHERE target_type = 2 AND target_id = ?', [commentId.toString()]);

  // 删除当前评论
  await pool.execute('DELETE FROM comments WHERE id = ?', [commentId.toString()]);

  // 当前评论也算一个
  deletedCount += 1;

  return deletedCount;
}

// 获取评论列表
router.get('/', optionalAuth, async (req, res) => {
  try {
    const postId = req.query.post_id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const currentUserId = req.user ? req.user.id : null;

    if (!postId) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '缺少笔记ID' });
    }

    // 获取顶级评论（parent_id为NULL）
    // 只显示公开的评论或用户自己的评论（包括待审核的）
    let query;
    let queryParams;
    
    if (currentUserId) {
      // 已登录用户：显示公开评论 + 自己的评论（包括待审核的）
      query = `SELECT c.*, u.nickname, u.avatar as user_avatar, u.id as user_auto_id, u.user_id as user_display_id, u.location as user_location, u.verified
       FROM comments c
       LEFT JOIN users u ON c.user_id = u.id
       WHERE c.post_id = ? AND c.parent_id IS NULL AND (c.is_public = 1 OR c.user_id = ?)
       ORDER BY c.created_at DESC
       LIMIT ? OFFSET ?`;
      queryParams = [postId.toString(), currentUserId.toString(), limit.toString(), offset.toString()];
    } else {
      // 未登录用户：只显示公开评论
      query = `SELECT c.*, u.nickname, u.avatar as user_avatar, u.id as user_auto_id, u.user_id as user_display_id, u.location as user_location, u.verified
       FROM comments c
       LEFT JOIN users u ON c.user_id = u.id
       WHERE c.post_id = ? AND c.parent_id IS NULL AND c.is_public = 1
       ORDER BY c.created_at DESC
       LIMIT ? OFFSET ?`;
      queryParams = [postId.toString(), limit.toString(), offset.toString()];
    }
    
    const [rows] = await pool.execute(query, queryParams);

    // 为每个评论检查点赞状态
    for (let comment of rows) {
      if (currentUserId) {
        const [likeResult] = await pool.execute(
          'SELECT id FROM likes WHERE user_id = ? AND target_type = 2 AND target_id = ?',
          [currentUserId.toString(), comment.id.toString()]
        );
        comment.liked = likeResult.length > 0;
      } else {
        comment.liked = false;
      }

      // 获取子评论数量（只统计公开的或用户自己的）
      let childCountQuery;
      let childCountParams;
      if (currentUserId) {
        childCountQuery = 'SELECT COUNT(*) as count FROM comments WHERE parent_id = ? AND (is_public = 1 OR user_id = ?)';
        childCountParams = [comment.id.toString(), currentUserId.toString()];
      } else {
        childCountQuery = 'SELECT COUNT(*) as count FROM comments WHERE parent_id = ? AND is_public = 1';
        childCountParams = [comment.id.toString()];
      }
      const [childCount] = await pool.execute(childCountQuery, childCountParams);
      comment.reply_count = childCount[0].count;
    }

    // 获取总数（只统计公开的或用户自己的）
    let countQuery;
    let countParams;
    if (currentUserId) {
      countQuery = 'SELECT COUNT(*) as total FROM comments WHERE post_id = ? AND parent_id IS NULL AND (is_public = 1 OR user_id = ?)';
      countParams = [postId.toString(), currentUserId.toString()];
    } else {
      countQuery = 'SELECT COUNT(*) as total FROM comments WHERE post_id = ? AND parent_id IS NULL AND is_public = 1';
      countParams = [postId.toString()];
    }
    const [countResult] = await pool.execute(countQuery, countParams);
    const total = countResult[0].total;

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: 'success',
      data: {
        comments: rows,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('获取评论列表失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 创建评论
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { post_id, content, parent_id } = req.body;
    const userId = req.user.id;

    // 验证必填字段
    if (!post_id || !content) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '笔记ID和评论内容不能为空' });
    }

    // 对内容进行安全过滤，防止XSS攻击
    const sanitizedContent = sanitizeContent(content);
    
    // 再次验证过滤后的内容不为空
    if (!sanitizedContent.trim()) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '评论内容不能为空' });
    }

    // 验证笔记是否存在
    const [postRows] = await pool.execute('SELECT id FROM posts WHERE id = ?', [post_id.toString()]);
    if (postRows.length === 0) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '笔记不存在' });
    }

    // 如果是回复评论，验证父评论是否存在
    if (parent_id) {
      const [parentRows] = await pool.execute('SELECT id FROM comments WHERE id = ?', [parent_id.toString()]);
      if (parentRows.length === 0) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '父评论不存在' });
      }
    }

    // 进行内容审核
    let auditStatus = 1; // 默认审核通过
    let isPublic = 1; // 默认公开可见
    let auditResult = null;

    if (isAuditEnabled()) {
      try {
        // 调用审核API
        auditResult = await auditComment(sanitizedContent, userId);
        
        // 确保审核结果存在
        if (auditResult && auditResult.passed === false) {
          // 审核不通过，待人工审核
          auditStatus = 0;
          isPublic = 0; // 仅自己可见
          
          // 记录审核事件到audit表
          await pool.execute(
            `INSERT INTO audit (user_id, type, target_id, content, audit_result, risk_level, categories, reason, status) 
             VALUES (?, 3, NULL, ?, ?, ?, ?, ?, 0)`,
            [
              userId.toString(),
              sanitizedContent,
              JSON.stringify(auditResult),
              auditResult.risk_level || 'medium',
              JSON.stringify(auditResult.categories || []),
              auditResult.reason || ''
            ]
          );
        }
        // 如果审核通过或审核结果为null，保持默认值
      } catch (auditError) {
        console.error('评论审核异常:', auditError);
        // 审核异常时默认通过，不阻塞用户发表评论
        auditResult = null;
      }
    }

    // 插入评论
    const [result] = await pool.execute(
      'INSERT INTO comments (post_id, user_id, content, parent_id, audit_status, is_public, audit_result) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        post_id.toString(), 
        userId.toString(), 
        sanitizedContent, 
        parent_id ? parent_id.toString() : null,
        auditStatus.toString(),
        isPublic.toString(),
        auditResult ? JSON.stringify(auditResult) : null
      ]
    );

    const commentId = result.insertId;
    
    // 如果审核不通过，更新audit表中的target_id为评论ID
    if (isAuditEnabled() && !auditResult?.passed) {
      await pool.execute(
        'UPDATE audit SET target_id = ? WHERE user_id = ? AND type = 3 AND target_id IS NULL ORDER BY id DESC LIMIT 1',
        [commentId.toString(), userId.toString()]
      );
    }

    // 更新笔记评论数
    await pool.execute('UPDATE posts SET comment_count = comment_count + 1 WHERE id = ?', [post_id.toString()]);

    // 创建通知
    if (parent_id) {
      // 回复评论，给被回复的评论作者发通知
      const [parentCommentResult] = await pool.execute('SELECT user_id FROM comments WHERE id = ?', [parent_id.toString()]);
      if (parentCommentResult.length > 0) {
        const parentUserId = parentCommentResult[0].user_id;
        // 不给自己发通知
        if (parentUserId !== userId) {
          const notificationData = NotificationHelper.createReplyCommentNotification(parentUserId, userId, post_id, commentId);
          await NotificationHelper.insertNotification(pool, notificationData);
        }
      }
    } else {
      // 评论笔记，给笔记作者发通知
      const [postResult] = await pool.execute('SELECT user_id FROM posts WHERE id = ?', [post_id.toString()]);
      if (postResult.length > 0) {
        const postUserId = postResult[0].user_id;
        // 不给自己发通知
        if (postUserId !== userId) {
          const notificationData = NotificationHelper.createCommentPostNotification(postUserId, userId, post_id, commentId);
          await NotificationHelper.insertNotification(pool, notificationData);
        }
      }
    }

    // 处理@用户通知
    if (hasMentions(content)) {
      const mentionedUsers = extractMentionedUsers(content);

      for (const mentionedUser of mentionedUsers) {
        try {
          // 根据汐社号查找用户的自增ID
          const [userRows] = await pool.execute('SELECT id FROM users WHERE user_id = ?', [mentionedUser.userId]);

          if (userRows.length > 0) {
            const mentionedUserId = userRows[0].id;

            // 不给自己发通知
            if (mentionedUserId !== userId) {
              // 创建@用户通知
              const mentionNotificationData = NotificationHelper.createNotificationData({
                userId: mentionedUserId,
                senderId: userId,
                type: NotificationHelper.TYPES.MENTION_COMMENT,
                targetId: post_id,
                commentId: commentId
              });

              await NotificationHelper.insertNotification(pool, mentionNotificationData);
            }
          }
        } catch (error) {
          console.error(`处理@用户通知失败 - 用户: ${mentionedUser.userId}:`, error);
        }
      }
    }

    // 获取刚创建的评论的完整信息
    const [commentRows] = await pool.execute(
      `SELECT c.*, u.nickname, u.avatar as user_avatar, u.id as user_auto_id, u.user_id as user_display_id, u.location as user_location, u.verified
       FROM comments c
       LEFT JOIN users u ON c.user_id = u.id
       WHERE c.id = ?`,
      [commentId.toString()]
    );

    const commentData = commentRows[0];
    commentData.liked = false; // 新创建的评论默认未点赞
    commentData.reply_count = 0; // 新创建的评论默认无回复

    console.log(`创建评论成功 - 用户ID: ${userId}, 评论ID: ${commentId}`);

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '评论成功',
      data: commentData
    });
  } catch (error) {
    console.error('创建评论失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 获取子评论列表
router.get('/:id/replies', optionalAuth, async (req, res) => {
  try {
    const parentId = req.params.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const currentUserId = req.user ? req.user.id : null;


    // 获取子评论（只显示公开的或用户自己的）
    let query;
    let queryParams;
    
    if (currentUserId) {
      query = `SELECT c.*, u.nickname, u.avatar as user_avatar, u.id as user_auto_id, u.user_id as user_display_id, u.location as user_location, u.verified
       FROM comments c
       LEFT JOIN users u ON c.user_id = u.id
       WHERE c.parent_id = ? AND (c.is_public = 1 OR c.user_id = ?)
       ORDER BY c.created_at ASC
       LIMIT ? OFFSET ?`;
      queryParams = [parentId.toString(), currentUserId.toString(), limit.toString(), offset.toString()];
    } else {
      query = `SELECT c.*, u.nickname, u.avatar as user_avatar, u.id as user_auto_id, u.user_id as user_display_id, u.location as user_location, u.verified
       FROM comments c
       LEFT JOIN users u ON c.user_id = u.id
       WHERE c.parent_id = ? AND c.is_public = 1
       ORDER BY c.created_at ASC
       LIMIT ? OFFSET ?`;
      queryParams = [parentId.toString(), limit.toString(), offset.toString()];
    }
    
    const [rows] = await pool.execute(query, queryParams);

    // 为每个评论检查点赞状态
    for (let comment of rows) {
      if (currentUserId) {
        const [likeResult] = await pool.execute(
          'SELECT id FROM likes WHERE user_id = ? AND target_type = 2 AND target_id = ?',
          [currentUserId.toString(), comment.id.toString()]
        );
        comment.liked = likeResult.length > 0;
      } else {
        comment.liked = false;
      }
    }

    // 获取总数（只统计公开的或用户自己的）
    let countQuery;
    let countParams;
    if (currentUserId) {
      countQuery = 'SELECT COUNT(*) as total FROM comments WHERE parent_id = ? AND (is_public = 1 OR user_id = ?)';
      countParams = [parentId.toString(), currentUserId.toString()];
    } else {
      countQuery = 'SELECT COUNT(*) as total FROM comments WHERE parent_id = ? AND is_public = 1';
      countParams = [parentId.toString()];
    }
    const [countResult] = await pool.execute(countQuery, countParams);
    const total = countResult[0].total;


    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: 'success',
      data: {
        comments: rows,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('获取子评论列表失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});



// 删除评论
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const commentId = req.params.id;
    const userId = req.user.id;

    // 验证评论是否存在并且是当前用户发布的
    const [commentRows] = await pool.execute(
      'SELECT id, post_id, user_id, parent_id FROM comments WHERE id = ?',
      [commentId.toString()]
    );

    if (commentRows.length === 0) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '评论不存在' });
    }

    const comment = commentRows[0];

    // 检查是否是评论作者
    if (comment.user_id !== userId) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ code: RESPONSE_CODES.FORBIDDEN, message: '只能删除自己发布的评论' });
    }

    // 使用递归删除函数删除评论及其所有子评论，获取删除的评论总数
    const deletedCount = await deleteCommentRecursive(commentId);

    // 根据实际删除的评论数量更新笔记的评论计数
    await pool.execute('UPDATE posts SET comment_count = comment_count - ? WHERE id = ?', [deletedCount.toString(), comment.post_id.toString()]);

    console.log(`删除评论成功 - 用户ID: ${userId}, 评论ID: ${commentId}`);

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '删除成功',
      data: {
        id: commentId,
        deletedCount: deletedCount
      }
    });
  } catch (error) {
    console.error('删除评论失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

module.exports = router;