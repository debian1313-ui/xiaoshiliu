const express = require('express')
const router = express.Router()
const { HTTP_STATUS, RESPONSE_CODES } = require('../constants')
const { prisma } = require('../config/config')
const { adminAuth } = require('../utils/uploadHelper')
const { auditComment } = require('../utils/contentAudit')
const { batchCleanupFiles } = require('../utils/fileCleanup')
const { getQueueStats, getQueueJobs, retryJob, cleanQueue, isQueueEnabled, QUEUE_NAMES } = require('../utils/queueService')
const crypto = require('crypto')

// ===================== AI审核设置 =====================
let aiAutoReviewEnabled = false
router.get('/ai-review-status', adminAuth, (req, res) => {
  res.json({ code: RESPONSE_CODES.SUCCESS, data: { enabled: aiAutoReviewEnabled }, message: 'success' })
})
router.post('/ai-review-toggle', adminAuth, (req, res) => {
  const { enabled } = req.body
  aiAutoReviewEnabled = Boolean(enabled)
  res.json({ code: RESPONSE_CODES.SUCCESS, message: `AI自动审核已${aiAutoReviewEnabled ? '开启' : '关闭'}` })
})
const isAiAutoReviewEnabled = () => aiAutoReviewEnabled

// ===================== 笔记管理 =====================
router.get('/posts', adminAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const limit = parseInt(req.query.limit) || 20
    const skip = (page - 1) * limit
    const { title, user_display_id, category_id, type, is_draft, sortField = 'created_at', sortOrder = 'desc' } = req.query

    const where = {}
    if (title) where.title = { contains: title }
    if (category_id) {
      if (category_id === 'null') {
        where.category_id = null
      } else {
        where.category_id = parseInt(category_id)
      }
    }
    if (type !== undefined && type !== '') where.type = parseInt(type)
    if (is_draft !== undefined && is_draft !== '') where.is_draft = parseInt(is_draft) === 1
    if (user_display_id) where.user = { user_id: { contains: user_display_id } }

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
        orderBy: { [sortField]: sortOrder.toLowerCase() },
        take: limit,
        skip: skip
      })
    ])

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
    }))

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: { data: formattedPosts, pagination: { page, limit, total, pages: Math.ceil(total / limit) } },
      message: 'success'
    })
  } catch (error) {
    console.error('获取笔记列表失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' })
  }
})

router.get('/posts/:id', adminAuth, async (req, res) => {
  try {
    const postId = BigInt(req.params.id)
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
    })

    if (!post) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '笔记不存在' })
    }

    const result = {
      id: Number(post.id),
      user_id: Number(post.user_id),
      title: post.title,
      content: post.content,
      type: post.type,
      category_id: post.category_id,
      category: post.category?.name,
      view_count: Number(post.view_count),
      like_count: post.like_count,
      collect_count: post.collect_count,
      comment_count: post.comment_count,
      is_draft: post.is_draft,
      created_at: post.created_at,
      nickname: post.user?.nickname,
      user_display_id: post.user?.user_id,
      tags: post.tags.map(pt => ({ id: pt.tag.id, name: pt.tag.name })),
      images: post.type === 2 
        ? (post.videos.length > 0 ? [post.videos[0].video_url] : [])
        : post.images.map(img => img.image_url),
      video_url: post.videos.length > 0 ? post.videos[0].video_url : null,
      cover_url: post.videos.length > 0 ? post.videos[0].cover_url : null
    }

    res.json({ code: RESPONSE_CODES.SUCCESS, data: result, message: 'success' })
  } catch (error) {
    console.error('获取笔记详情失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' })
  }
})

router.post('/posts', adminAuth, async (req, res) => {
  try {
    const { user_id, title, content, category_id, images, image_urls, tags, type, is_draft } = req.body

    if (!user_id || !title || !content) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '缺少必填字段' })
    }

    const user = await prisma.user.findUnique({ where: { id: BigInt(user_id) } })
    if (!user) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '用户不存在' })
    }

    const post = await prisma.post.create({
      data: {
        user_id: BigInt(user_id),
        title,
        content,
        category_id: category_id ? parseInt(category_id) : null,
        type: type || 1,
        is_draft: is_draft !== undefined ? Boolean(is_draft) : true
      }
    })

    const allImages = []
    if (images && Array.isArray(images)) {
      for (const image of images) {
        if (typeof image === 'string') {
          allImages.push(image)
        } else if (image && typeof image === 'object') {
          const possibleProps = ['url', 'preview', 'src', 'path', 'link']
          for (const prop of possibleProps) {
            if (image[prop] && typeof image[prop] === 'string') {
              allImages.push(image[prop])
              break
            }
          }
        }
      }
    }
    if (image_urls && Array.isArray(image_urls)) {
      allImages.push(...image_urls.filter(url => url && typeof url === 'string'))
    }

    if (allImages.length > 0) {
      await prisma.postImage.createMany({
        data: allImages.map(url => ({
          post_id: post.id,
          image_url: url.trim().replace(/\`/g, '').replace(/\s+/g, '')
        }))
      })
    }

    if (tags && tags.length > 0) {
      for (const tag of tags) {
        let tagId
        let tagName = typeof tag === 'string' ? tag : tag.name

        const existingTag = await prisma.tag.findUnique({ where: { name: tagName } })
        if (existingTag) {
          tagId = existingTag.id
        } else {
          const newTag = await prisma.tag.create({ data: { name: tagName } })
          tagId = newTag.id
        }

        await prisma.postTag.create({ data: { post_id: post.id, tag_id: tagId } })
        await prisma.tag.update({ where: { id: tagId }, data: { use_count: { increment: 1 } } })
      }
    }

    res.json({ code: RESPONSE_CODES.SUCCESS, data: { id: Number(post.id) }, message: '笔记创建成功' })
  } catch (error) {
    console.error('创建笔记失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '创建失败' })
  }
})

router.put('/posts/:id', adminAuth, async (req, res) => {
  try {
    const postId = BigInt(req.params.id)
    const { title, content, category_id, view_count, is_draft, images, image_urls, tags, video_url, cover_url, video } = req.body

    const existingPost = await prisma.post.findUnique({ where: { id: postId }, include: { videos: true } })
    if (!existingPost) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '笔记不存在' })
    }

    const updateData = {}
    if (title !== undefined) updateData.title = title
    if (content !== undefined) updateData.content = content
    if (category_id !== undefined) updateData.category_id = category_id ? parseInt(category_id) : null
    if (view_count !== undefined) updateData.view_count = BigInt(Math.max(0, parseInt(view_count) || 0))
    if (is_draft !== undefined) updateData.is_draft = Boolean(is_draft)

    await prisma.post.update({ where: { id: postId }, data: updateData })

    if (images !== undefined || image_urls !== undefined) {
      await prisma.postImage.deleteMany({ where: { post_id: postId } })

      const allImagesSet = new Set()
      if (image_urls && Array.isArray(image_urls)) {
        image_urls.forEach(url => { if (url && typeof url === 'string') allImagesSet.add(url) })
      }
      if (images && Array.isArray(images)) {
        for (const image of images) {
          if (typeof image === 'string') {
            allImagesSet.add(image)
          } else if (image && typeof image === 'object') {
            const possibleProps = ['url', 'preview', 'src', 'path', 'link']
            for (const prop of possibleProps) {
              if (image[prop] && typeof image[prop] === 'string') {
                allImagesSet.add(image[prop])
                break
              }
            }
          }
        }
      }

      const allImages = Array.from(allImagesSet)
      if (allImages.length > 0) {
        await prisma.postImage.createMany({
          data: allImages.map(url => ({
            post_id: postId,
            image_url: url.trim().replace(/\`/g, '').replace(/\s+/g, '')
          }))
        })
      }
    }

    const hasVideoUpdate = video_url !== undefined || cover_url !== undefined || video !== undefined
    if (hasVideoUpdate) {
      const oldVideoUrls = existingPost.videos.map(v => v.video_url).filter(Boolean)
      const oldCoverUrls = existingPost.videos.map(v => v.cover_url).filter(Boolean)

      await prisma.postVideo.deleteMany({ where: { post_id: postId } })

      let newVideoUrl = null
      let newCoverUrl = null
      if (video && video.url) {
        newVideoUrl = video.url
        newCoverUrl = video.coverUrl || ''
      } else if (video_url && video_url.trim() !== '') {
        newVideoUrl = video_url
        newCoverUrl = cover_url || ''
      }

      if (newVideoUrl) {
        await prisma.postVideo.create({
          data: { post_id: postId, video_url: newVideoUrl, cover_url: newCoverUrl }
        })
      }

      batchCleanupFiles(oldVideoUrls, oldCoverUrls).catch(err => console.error('清理废弃视频文件失败:', err))
    }

    if (tags !== undefined) {
      const oldTags = await prisma.postTag.findMany({ where: { post_id: postId } })
      await prisma.postTag.deleteMany({ where: { post_id: postId } })

      for (const oldTag of oldTags) {
        await prisma.tag.update({
          where: { id: oldTag.tag_id },
          data: { use_count: { decrement: 1 } }
        })
      }

      if (tags && tags.length > 0) {
        for (const tag of tags) {
          let tagId
          let tagName = typeof tag === 'string' ? tag : tag.name

          if (typeof tag !== 'string' && (tag.is_new || String(tag.id).startsWith('temp_'))) {
            const existingTag = await prisma.tag.findUnique({ where: { name: tagName } })
            tagId = existingTag ? existingTag.id : (await prisma.tag.create({ data: { name: tagName } })).id
          } else if (typeof tag === 'string') {
            const existingTag = await prisma.tag.findUnique({ where: { name: tagName } })
            tagId = existingTag ? existingTag.id : (await prisma.tag.create({ data: { name: tagName } })).id
          } else {
            tagId = tag.id
          }

          await prisma.postTag.create({ data: { post_id: postId, tag_id: parseInt(tagId) } })
          await prisma.tag.update({ where: { id: parseInt(tagId) }, data: { use_count: { increment: 1 } } })
        }
      }
    }

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '笔记更新成功' })
  } catch (error) {
    console.error('更新笔记失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '更新失败' })
  }
})

router.delete('/posts/:id', adminAuth, async (req, res) => {
  try {
    const postId = BigInt(req.params.id)
    const post = await prisma.post.findUnique({
      where: { id: postId },
      include: { images: true, videos: true, tags: true }
    })
    if (!post) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '笔记不存在' })
    }

    for (const pt of post.tags) {
      await prisma.tag.update({ where: { id: pt.tag_id }, data: { use_count: { decrement: 1 } } })
    }

    const filesToDelete = []
    post.images.forEach(img => filesToDelete.push(img.image_url))
    post.videos.forEach(v => { if (v.video_url) filesToDelete.push(v.video_url); if (v.cover_url) filesToDelete.push(v.cover_url) })

    await prisma.post.delete({ where: { id: postId } })
    batchCleanupFiles(filesToDelete)

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '删除成功' })
  } catch (error) {
    console.error('删除笔记失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除失败' })
  }
})

router.delete('/posts', adminAuth, async (req, res) => {
  try {
    const { ids } = req.body
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '请提供要删除的ID列表' })
    }

    const postIds = ids.map(id => BigInt(id))

    const postTags = await prisma.postTag.findMany({ where: { post_id: { in: postIds } } })
    for (const pt of postTags) {
      await prisma.tag.update({ where: { id: pt.tag_id }, data: { use_count: { decrement: 1 } } })
    }

    await prisma.post.deleteMany({ where: { id: { in: postIds } } })

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '成功删除 ' + ids.length + ' 条记录' })
  } catch (error) {
    console.error('批量删除笔记失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除失败' })
  }
})

// ===================== 评论管理 =====================
router.get('/comments', adminAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const limit = parseInt(req.query.limit) || 20
    const skip = (page - 1) * limit
    const { user_display_id, post_id, content, audit_status, sortField = 'created_at', sortOrder = 'desc' } = req.query

    const where = {}
    if (user_display_id) where.user = { user_id: { contains: user_display_id } }
    if (post_id) where.post_id = BigInt(post_id)
    if (content) where.content = { contains: content }
    if (audit_status !== undefined && audit_status !== '') where.audit_status = parseInt(audit_status)

    const [total, comments] = await Promise.all([
      prisma.comment.count({ where }),
      prisma.comment.findMany({
        where,
        include: {
          user: { select: { id: true, user_id: true, nickname: true } },
          post: { select: { id: true, title: true } }
        },
        orderBy: { [sortField]: sortOrder.toLowerCase() },
        take: limit,
        skip: skip
      })
    ])

    const formattedComments = comments.map(c => ({
      id: Number(c.id),
      post_id: Number(c.post_id),
      user_id: Number(c.user_id),
      parent_id: c.parent_id ? Number(c.parent_id) : null,
      content: c.content,
      like_count: c.like_count,
      audit_status: c.audit_status,
      is_public: c.is_public,
      created_at: c.created_at,
      user_display_id: c.user?.user_id,
      nickname: c.user?.nickname,
      post_title: c.post?.title
    }))

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: { data: formattedComments, pagination: { page, limit, total, pages: Math.ceil(total / limit) } },
      message: 'success'
    })
  } catch (error) {
    console.error('获取评论列表失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' })
  }
})

router.get('/comments/:id', adminAuth, async (req, res) => {
  try {
    const commentId = BigInt(req.params.id)
    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
      include: {
        user: { select: { id: true, user_id: true, nickname: true } },
        post: { select: { id: true, title: true } }
      }
    })

    if (!comment) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '评论不存在' })
    }

    res.json({ code: RESPONSE_CODES.SUCCESS, data: comment, message: 'success' })
  } catch (error) {
    console.error('获取评论详情失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' })
  }
})

router.post('/comments', adminAuth, async (req, res) => {
  try {
    const { user_id, post_id, content, parent_id } = req.body

    if (!user_id || !post_id || !content) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '缺少必填字段' })
    }

    const user = await prisma.user.findUnique({ where: { id: BigInt(user_id) } })
    if (!user) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '用户不存在' })
    }

    const post = await prisma.post.findUnique({ where: { id: BigInt(post_id) } })
    if (!post) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '笔记不存在' })
    }

    if (parent_id) {
      const parent = await prisma.comment.findUnique({ where: { id: BigInt(parent_id) } })
      if (!parent) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '父评论不存在' })
      }
    }

    const comment = await prisma.comment.create({
      data: {
        user_id: BigInt(user_id),
        post_id: BigInt(post_id),
        content,
        parent_id: parent_id ? BigInt(parent_id) : null
      }
    })

    await prisma.post.update({ where: { id: BigInt(post_id) }, data: { comment_count: { increment: 1 } } })

    res.json({ code: RESPONSE_CODES.SUCCESS, data: { id: Number(comment.id) }, message: '评论创建成功' })
  } catch (error) {
    console.error('创建评论失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '创建失败' })
  }
})

router.put('/comments/:id', adminAuth, async (req, res) => {
  try {
    const commentId = BigInt(req.params.id)
    const { content } = req.body

    const comment = await prisma.comment.findUnique({ where: { id: commentId } })
    if (!comment) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '评论不存在' })
    }

    await prisma.comment.update({ where: { id: commentId }, data: { content } })
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '更新成功' })
  } catch (error) {
    console.error('更新评论失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '更新失败' })
  }
})

router.delete('/comments/:id', adminAuth, async (req, res) => {
  try {
    const commentId = BigInt(req.params.id)
    const comment = await prisma.comment.findUnique({ where: { id: commentId }, select: { post_id: true } })
    if (!comment) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '评论不存在' })
    }

    await prisma.comment.delete({ where: { id: commentId } })
    await prisma.post.update({ where: { id: comment.post_id }, data: { comment_count: { decrement: 1 } } })

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '删除成功' })
  } catch (error) {
    console.error('删除评论失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除失败' })
  }
})

router.delete('/comments', adminAuth, async (req, res) => {
  try {
    const { ids } = req.body
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '请提供要删除的ID列表' })
    }

    const commentIds = ids.map(id => BigInt(id))
    await prisma.comment.deleteMany({ where: { id: { in: commentIds } } })

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '成功删除 ' + ids.length + ' 条记录' })
  } catch (error) {
    console.error('批量删除评论失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除失败' })
  }
})

// ===================== 标签管理 =====================
router.get('/tags', adminAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const limit = parseInt(req.query.limit) || 20
    const skip = (page - 1) * limit
    const { name, sortField = 'use_count', sortOrder = 'desc' } = req.query

    const where = name ? { name: { contains: name } } : {}

    const [total, tags] = await Promise.all([
      prisma.tag.count({ where }),
      prisma.tag.findMany({
        where,
        orderBy: { [sortField]: sortOrder.toLowerCase() },
        take: limit,
        skip: skip
      })
    ])

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: { data: tags, pagination: { page, limit, total, pages: Math.ceil(total / limit) } },
      message: 'success'
    })
  } catch (error) {
    console.error('获取标签列表失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' })
  }
})

router.get('/tags/:id', adminAuth, async (req, res) => {
  try {
    const tagId = parseInt(req.params.id)
    const tag = await prisma.tag.findUnique({ where: { id: tagId } })

    if (!tag) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '标签不存在' })
    }

    res.json({ code: RESPONSE_CODES.SUCCESS, data: tag, message: 'success' })
  } catch (error) {
    console.error('获取标签详情失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' })
  }
})

router.post('/tags', adminAuth, async (req, res) => {
  try {
    const { name } = req.body
    if (!name) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '标签名不能为空' })
    }

    const existing = await prisma.tag.findUnique({ where: { name } })
    if (existing) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.CONFLICT, message: '标签已存在' })
    }

    const newTag = await prisma.tag.create({ data: { name } })
    res.json({ code: RESPONSE_CODES.SUCCESS, data: { id: newTag.id }, message: '创建成功' })
  } catch (error) {
    console.error('创建标签失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '创建失败' })
  }
})

router.put('/tags/:id', adminAuth, async (req, res) => {
  try {
    const tagId = parseInt(req.params.id)
    const { name } = req.body

    const tag = await prisma.tag.findUnique({ where: { id: tagId } })
    if (!tag) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '标签不存在' })
    }

    const updateData = {}
    if (name !== undefined) updateData.name = name

    await prisma.tag.update({ where: { id: tagId }, data: updateData })
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '更新成功' })
  } catch (error) {
    console.error('更新标签失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '更新失败' })
  }
})

router.delete('/tags/:id', adminAuth, async (req, res) => {
  try {
    const tagId = parseInt(req.params.id)
    await prisma.postTag.deleteMany({ where: { tag_id: tagId } })
    await prisma.tag.delete({ where: { id: tagId } })
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '删除成功' })
  } catch (error) {
    console.error('删除标签失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除失败' })
  }
})

router.delete('/tags', adminAuth, async (req, res) => {
  try {
    const { ids } = req.body
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '请提供要删除的ID列表' })
    }

    await prisma.postTag.deleteMany({ where: { tag_id: { in: ids } } })
    await prisma.tag.deleteMany({ where: { id: { in: ids } } })

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '成功删除 ' + ids.length + ' 条记录' })
  } catch (error) {
    console.error('批量删除标签失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除失败' })
  }
})

// ===================== 点赞管理 =====================
router.get('/likes', adminAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const limit = parseInt(req.query.limit) || 20
    const skip = (page - 1) * limit
    const { user_display_id, target_type, target_id, sortField = 'created_at', sortOrder = 'desc' } = req.query

    const where = {}
    if (user_display_id) where.user = { user_id: { contains: user_display_id } }
    if (target_type) where.target_type = parseInt(target_type)
    if (target_id) where.target_id = BigInt(target_id)

    const [total, likes] = await Promise.all([
      prisma.like.count({ where }),
      prisma.like.findMany({
        where,
        include: {
          user: { select: { id: true, user_id: true, nickname: true } }
        },
        orderBy: { [sortField]: sortOrder.toLowerCase() },
        take: limit,
        skip: skip
      })
    ])

    const formattedLikes = likes.map(l => ({
      id: Number(l.id),
      user_id: Number(l.user_id),
      target_type: l.target_type,
      target_id: Number(l.target_id),
      created_at: l.created_at,
      user_display_id: l.user?.user_id,
      nickname: l.user?.nickname
    }))

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: { data: formattedLikes, pagination: { page, limit, total, pages: Math.ceil(total / limit) } },
      message: 'success'
    })
  } catch (error) {
    console.error('获取点赞列表失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' })
  }
})

router.get('/likes/:id', adminAuth, async (req, res) => {
  try {
    const likeId = BigInt(req.params.id)
    const like = await prisma.like.findUnique({
      where: { id: likeId },
      include: { user: { select: { id: true, user_id: true, nickname: true } } }
    })

    if (!like) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '点赞记录不存在' })
    }

    res.json({ code: RESPONSE_CODES.SUCCESS, data: like, message: 'success' })
  } catch (error) {
    console.error('获取点赞详情失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' })
  }
})

router.post('/likes', adminAuth, async (req, res) => {
  try {
    const { user_id, target_type, target_id } = req.body

    if (!user_id || !target_type || !target_id) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '缺少必填字段' })
    }

    const user = await prisma.user.findUnique({ where: { id: BigInt(user_id) } })
    if (!user) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '用户不存在' })
    }

    // Check target exists
    if (parseInt(target_type) === 1) {
      const post = await prisma.post.findUnique({ where: { id: BigInt(target_id) } })
      if (!post) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '笔记不存在' })
      }
    } else {
      const comment = await prisma.comment.findUnique({ where: { id: BigInt(target_id) } })
      if (!comment) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '评论不存在' })
      }
    }

    const like = await prisma.like.create({
      data: {
        user_id: BigInt(user_id),
        target_type: parseInt(target_type),
        target_id: BigInt(target_id)
      }
    })

    res.json({ code: RESPONSE_CODES.SUCCESS, data: { id: Number(like.id) }, message: '点赞创建成功' })
  } catch (error) {
    console.error('创建点赞失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '创建失败' })
  }
})

router.put('/likes/:id', adminAuth, async (req, res) => {
  try {
    const likeId = BigInt(req.params.id)
    const { target_type, target_id } = req.body

    const like = await prisma.like.findUnique({ where: { id: likeId } })
    if (!like) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '点赞记录不存在' })
    }

    const updateData = {}
    if (target_type !== undefined && target_type !== '') updateData.target_type = parseInt(target_type)
    if (target_id !== undefined && target_id !== '') updateData.target_id = BigInt(target_id)

    await prisma.like.update({ where: { id: likeId }, data: updateData })
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '更新成功' })
  } catch (error) {
    console.error('更新点赞失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '更新失败' })
  }
})

router.delete('/likes/:id', adminAuth, async (req, res) => {
  try {
    const likeId = BigInt(req.params.id)
    await prisma.like.delete({ where: { id: likeId } })
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '删除成功' })
  } catch (error) {
    console.error('删除点赞失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除失败' })
  }
})

router.delete('/likes', adminAuth, async (req, res) => {
  try {
    const { ids } = req.body
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '请提供要删除的ID列表' })
    }

    const likeIds = ids.map(id => BigInt(id))
    await prisma.like.deleteMany({ where: { id: { in: likeIds } } })

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '成功删除 ' + ids.length + ' 条记录' })
  } catch (error) {
    console.error('批量删除点赞失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除失败' })
  }
})

// ===================== 收藏管理 =====================
router.get('/collections', adminAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const limit = parseInt(req.query.limit) || 20
    const skip = (page - 1) * limit
    const { user_display_id, post_id, sortField = 'created_at', sortOrder = 'desc' } = req.query

    const where = {}
    if (user_display_id) where.user = { user_id: { contains: user_display_id } }
    if (post_id) where.post_id = BigInt(post_id)

    const [total, collections] = await Promise.all([
      prisma.collection.count({ where }),
      prisma.collection.findMany({
        where,
        include: {
          user: { select: { id: true, user_id: true, nickname: true } },
          post: { select: { id: true, title: true } }
        },
        orderBy: { [sortField]: sortOrder.toLowerCase() },
        take: limit,
        skip: skip
      })
    ])

    const formattedCollections = collections.map(c => ({
      id: Number(c.id),
      user_id: Number(c.user_id),
      post_id: Number(c.post_id),
      created_at: c.created_at,
      user_display_id: c.user?.user_id,
      nickname: c.user?.nickname,
      post_title: c.post?.title
    }))

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: { data: formattedCollections, pagination: { page, limit, total, pages: Math.ceil(total / limit) } },
      message: 'success'
    })
  } catch (error) {
    console.error('获取收藏列表失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' })
  }
})

router.get('/collections/:id', adminAuth, async (req, res) => {
  try {
    const collectionId = BigInt(req.params.id)
    const collection = await prisma.collection.findUnique({
      where: { id: collectionId },
      include: {
        user: { select: { id: true, user_id: true, nickname: true } },
        post: { select: { id: true, title: true } }
      }
    })

    if (!collection) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '收藏记录不存在' })
    }

    res.json({ code: RESPONSE_CODES.SUCCESS, data: collection, message: 'success' })
  } catch (error) {
    console.error('获取收藏详情失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' })
  }
})

router.post('/collections', adminAuth, async (req, res) => {
  try {
    const { user_id, post_id } = req.body

    if (!user_id || !post_id) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '缺少必填字段' })
    }

    const user = await prisma.user.findUnique({ where: { id: BigInt(user_id) } })
    if (!user) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '用户不存在' })
    }

    const post = await prisma.post.findUnique({ where: { id: BigInt(post_id) } })
    if (!post) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '笔记不存在' })
    }

    const existing = await prisma.collection.findFirst({
      where: { user_id: BigInt(user_id), post_id: BigInt(post_id) }
    })
    if (existing) {
      return res.status(HTTP_STATUS.CONFLICT).json({ code: RESPONSE_CODES.CONFLICT, message: '已经收藏过该笔记' })
    }

    const collection = await prisma.collection.create({
      data: { user_id: BigInt(user_id), post_id: BigInt(post_id) }
    })

    res.json({ code: RESPONSE_CODES.SUCCESS, data: { id: Number(collection.id) }, message: '收藏创建成功' })
  } catch (error) {
    console.error('创建收藏失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '创建失败' })
  }
})

router.put('/collections/:id', adminAuth, async (req, res) => {
  try {
    const collectionId = BigInt(req.params.id)
    const { post_id } = req.body

    const collection = await prisma.collection.findUnique({ where: { id: collectionId } })
    if (!collection) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '收藏记录不存在' })
    }

    if (post_id) {
      const post = await prisma.post.findUnique({ where: { id: BigInt(post_id) } })
      if (!post) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '笔记不存在' })
      }
      await prisma.collection.update({ where: { id: collectionId }, data: { post_id: BigInt(post_id) } })
    }

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '更新成功' })
  } catch (error) {
    console.error('更新收藏失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '更新失败' })
  }
})

router.delete('/collections/:id', adminAuth, async (req, res) => {
  try {
    const collectionId = BigInt(req.params.id)
    await prisma.collection.delete({ where: { id: collectionId } })
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '删除成功' })
  } catch (error) {
    console.error('删除收藏失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除失败' })
  }
})

router.delete('/collections', adminAuth, async (req, res) => {
  try {
    const { ids } = req.body
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '请提供要删除的ID列表' })
    }

    const collectionIds = ids.map(id => BigInt(id))
    await prisma.collection.deleteMany({ where: { id: { in: collectionIds } } })

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '成功删除 ' + ids.length + ' 条记录' })
  } catch (error) {
    console.error('批量删除收藏失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除失败' })
  }
})

// ===================== 关注管理 =====================
router.get('/follows', adminAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const limit = parseInt(req.query.limit) || 20
    const skip = (page - 1) * limit
    const { follower_display_id, following_display_id, sortField = 'created_at', sortOrder = 'desc' } = req.query

    const where = {}
    if (follower_display_id) where.follower = { user_id: follower_display_id }
    if (following_display_id) where.following = { user_id: following_display_id }

    const [total, follows] = await Promise.all([
      prisma.follow.count({ where }),
      prisma.follow.findMany({
        where,
        include: {
          follower: { select: { id: true, user_id: true, nickname: true } },
          following: { select: { id: true, user_id: true, nickname: true } }
        },
        orderBy: { [sortField]: sortOrder.toLowerCase() },
        take: limit,
        skip: skip
      })
    ])

    const formattedFollows = follows.map(f => ({
      id: Number(f.id),
      follower_id: Number(f.follower_id),
      following_id: Number(f.following_id),
      created_at: f.created_at,
      follower_display_id: f.follower?.user_id,
      follower_nickname: f.follower?.nickname,
      following_display_id: f.following?.user_id,
      following_nickname: f.following?.nickname
    }))

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: { data: formattedFollows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } },
      message: 'success'
    })
  } catch (error) {
    console.error('获取关注列表失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' })
  }
})

router.get('/follows/:id', adminAuth, async (req, res) => {
  try {
    const followId = BigInt(req.params.id)
    const follow = await prisma.follow.findUnique({
      where: { id: followId },
      include: {
        follower: { select: { id: true, user_id: true, nickname: true } },
        following: { select: { id: true, user_id: true, nickname: true } }
      }
    })

    if (!follow) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '关注记录不存在' })
    }

    res.json({ code: RESPONSE_CODES.SUCCESS, data: follow, message: 'success' })
  } catch (error) {
    console.error('获取关注详情失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' })
  }
})

router.post('/follows', adminAuth, async (req, res) => {
  try {
    const { follower_id, following_id } = req.body

    if (!follower_id || !following_id) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '缺少必填字段' })
    }

    if (follower_id === following_id) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '不能关注自己' })
    }

    const follower = await prisma.user.findUnique({ where: { id: BigInt(follower_id) } })
    if (!follower) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '关注者不存在' })
    }

    const following = await prisma.user.findUnique({ where: { id: BigInt(following_id) } })
    if (!following) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '被关注者不存在' })
    }

    const existing = await prisma.follow.findFirst({
      where: { follower_id: BigInt(follower_id), following_id: BigInt(following_id) }
    })
    if (existing) {
      return res.status(HTTP_STATUS.CONFLICT).json({ code: RESPONSE_CODES.CONFLICT, message: '已经关注过了' })
    }

    const follow = await prisma.follow.create({
      data: { follower_id: BigInt(follower_id), following_id: BigInt(following_id) }
    })

    res.json({ code: RESPONSE_CODES.SUCCESS, data: { id: Number(follow.id) }, message: '关注创建成功' })
  } catch (error) {
    console.error('创建关注失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '创建失败' })
  }
})

router.put('/follows/:id', adminAuth, async (req, res) => {
  try {
    const followId = BigInt(req.params.id)
    const { following_id } = req.body

    const follow = await prisma.follow.findUnique({ where: { id: followId } })
    if (!follow) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '关注记录不存在' })
    }

    if (following_id) {
      if (BigInt(following_id) === follow.follower_id) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '不能关注自己' })
      }
      await prisma.follow.update({ where: { id: followId }, data: { following_id: BigInt(following_id) } })
    }

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '更新成功' })
  } catch (error) {
    console.error('更新关注失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '更新失败' })
  }
})

router.delete('/follows/:id', adminAuth, async (req, res) => {
  try {
    const followId = BigInt(req.params.id)
    await prisma.follow.delete({ where: { id: followId } })
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '删除成功' })
  } catch (error) {
    console.error('删除关注失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除失败' })
  }
})

router.delete('/follows', adminAuth, async (req, res) => {
  try {
    const { ids } = req.body
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '请提供要删除的ID列表' })
    }

    const followIds = ids.map(id => BigInt(id))
    await prisma.follow.deleteMany({ where: { id: { in: followIds } } })

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '成功删除 ' + ids.length + ' 条记录' })
  } catch (error) {
    console.error('批量删除关注失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除失败' })
  }
})

// ===================== 通知管理 =====================
router.get('/notifications', adminAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const limit = parseInt(req.query.limit) || 20
    const skip = (page - 1) * limit
    const { user_display_id, type, is_read, sortField = 'created_at', sortOrder = 'desc' } = req.query

    const where = {}
    if (user_display_id) where.user = { user_id: { contains: user_display_id } }
    if (type !== undefined && type !== '') where.type = parseInt(type)
    if (is_read !== undefined && is_read !== '') where.is_read = is_read === 'true' || is_read === '1'

    const [total, notifications] = await Promise.all([
      prisma.notification.count({ where }),
      prisma.notification.findMany({
        where,
        include: {
          user: { select: { id: true, user_id: true, nickname: true } },
          sender: { select: { id: true, user_id: true, nickname: true } }
        },
        orderBy: { [sortField]: sortOrder.toLowerCase() },
        take: limit,
        skip: skip
      })
    ])

    const formattedNotifications = notifications.map(n => ({
      id: Number(n.id),
      user_id: Number(n.user_id),
      sender_id: Number(n.sender_id),
      type: n.type,
      title: n.title,
      target_id: n.target_id ? Number(n.target_id) : null,
      comment_id: n.comment_id ? Number(n.comment_id) : null,
      is_read: n.is_read,
      created_at: n.created_at,
      user_display_id: n.user?.user_id,
      user_nickname: n.user?.nickname,
      sender_display_id: n.sender?.user_id,
      sender_nickname: n.sender?.nickname
    }))

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: { data: formattedNotifications, pagination: { page, limit, total, pages: Math.ceil(total / limit) } },
      message: 'success'
    })
  } catch (error) {
    console.error('获取通知列表失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' })
  }
})

router.get('/notifications/:id', adminAuth, async (req, res) => {
  try {
    const notificationId = BigInt(req.params.id)
    const notification = await prisma.notification.findUnique({
      where: { id: notificationId },
      include: {
        user: { select: { id: true, user_id: true, nickname: true } },
        sender: { select: { id: true, user_id: true, nickname: true } }
      }
    })

    if (!notification) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '通知不存在' })
    }

    res.json({ code: RESPONSE_CODES.SUCCESS, data: notification, message: 'success' })
  } catch (error) {
    console.error('获取通知详情失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' })
  }
})

router.post('/notifications', adminAuth, async (req, res) => {
  try {
    const { user_id, sender_id, type, title, target_id, comment_id, is_read } = req.body

    if (!user_id || !sender_id || !type || !title) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '缺少必填字段' })
    }

    const notification = await prisma.notification.create({
      data: {
        user_id: BigInt(user_id),
        sender_id: BigInt(sender_id),
        type: parseInt(type),
        title,
        target_id: target_id ? BigInt(target_id) : null,
        comment_id: comment_id ? BigInt(comment_id) : null,
        is_read: is_read || false
      }
    })

    res.json({ code: RESPONSE_CODES.SUCCESS, data: { id: Number(notification.id) }, message: '通知创建成功' })
  } catch (error) {
    console.error('创建通知失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '创建失败' })
  }
})

router.put('/notifications/:id', adminAuth, async (req, res) => {
  try {
    const notificationId = BigInt(req.params.id)
    const { user_id, sender_id, type, title, target_id, comment_id, is_read } = req.body

    const notification = await prisma.notification.findUnique({ where: { id: notificationId } })
    if (!notification) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '通知不存在' })
    }

    const updateData = {}
    if (user_id !== undefined && user_id !== '') updateData.user_id = BigInt(user_id)
    if (sender_id !== undefined && sender_id !== '') updateData.sender_id = BigInt(sender_id)
    if (type !== undefined && type !== '') updateData.type = parseInt(type)
    if (title !== undefined) updateData.title = title
    if (target_id !== undefined) updateData.target_id = target_id ? BigInt(target_id) : null
    if (comment_id !== undefined) updateData.comment_id = comment_id ? BigInt(comment_id) : null
    if (is_read !== undefined && is_read !== '') updateData.is_read = Boolean(is_read)

    await prisma.notification.update({ where: { id: notificationId }, data: updateData })
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '更新成功' })
  } catch (error) {
    console.error('更新通知失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '更新失败' })
  }
})

router.delete('/notifications/:id', adminAuth, async (req, res) => {
  try {
    const notificationId = BigInt(req.params.id)
    await prisma.notification.delete({ where: { id: notificationId } })
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '删除成功' })
  } catch (error) {
    console.error('删除通知失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除失败' })
  }
})

router.delete('/notifications', adminAuth, async (req, res) => {
  try {
    const { ids } = req.body
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '请提供要删除的ID列表' })
    }

    const notificationIds = ids.map(id => BigInt(id))
    await prisma.notification.deleteMany({ where: { id: { in: notificationIds } } })

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '成功删除 ' + ids.length + ' 条记录' })
  } catch (error) {
    console.error('批量删除通知失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除失败' })
  }
})

// ===================== 会话管理 =====================
router.get('/sessions', adminAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const limit = parseInt(req.query.limit) || 20
    const skip = (page - 1) * limit
    const { user_display_id, is_active, sortField = 'created_at', sortOrder = 'desc' } = req.query

    const where = {}
    if (user_display_id) where.user = { user_id: { contains: user_display_id } }
    if (is_active !== undefined) where.is_active = is_active === 'true' || is_active === '1'

    const [total, sessions] = await Promise.all([
      prisma.userSession.count({ where }),
      prisma.userSession.findMany({
        where,
        include: {
          user: { select: { id: true, user_id: true, nickname: true } }
        },
        orderBy: { [sortField]: sortOrder.toLowerCase() },
        take: limit,
        skip: skip
      })
    ])

    const formattedSessions = sessions.map(s => ({
      id: Number(s.id),
      user_id: Number(s.user_id),
      refresh_token: s.refresh_token,
      user_agent: s.user_agent,
      is_active: s.is_active,
      expires_at: s.expires_at,
      created_at: s.created_at,
      user_display_id: s.user?.user_id,
      nickname: s.user?.nickname
    }))

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: { data: formattedSessions, pagination: { page, limit, total, pages: Math.ceil(total / limit) } },
      message: 'success'
    })
  } catch (error) {
    console.error('获取会话列表失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' })
  }
})

router.get('/sessions/:id', adminAuth, async (req, res) => {
  try {
    const sessionId = BigInt(req.params.id)
    const session = await prisma.userSession.findUnique({
      where: { id: sessionId },
      include: {
        user: { select: { id: true, user_id: true, nickname: true } }
      }
    })

    if (!session) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '会话不存在' })
    }

    res.json({ code: RESPONSE_CODES.SUCCESS, data: session, message: 'success' })
  } catch (error) {
    console.error('获取会话详情失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' })
  }
})

router.post('/sessions', adminAuth, async (req, res) => {
  try {
    const { user_id, user_agent, is_active } = req.body

    if (!user_id) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '缺少必填字段' })
    }

    const token = crypto.randomBytes(32).toString('hex')
    const refresh_token = crypto.randomBytes(32).toString('hex')
    const expires_at = new Date()
    expires_at.setDate(expires_at.getDate() + 30)

    const session = await prisma.userSession.create({
      data: {
        user_id: BigInt(user_id),
        token,
        refresh_token,
        user_agent: user_agent || '',
        is_active: is_active !== undefined ? Boolean(is_active) : true,
        expires_at
      }
    })

    res.json({ code: RESPONSE_CODES.SUCCESS, data: { id: Number(session.id) }, message: '会话创建成功' })
  } catch (error) {
    console.error('创建会话失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '创建失败' })
  }
})

router.put('/sessions/:id', adminAuth, async (req, res) => {
  try {
    const sessionId = BigInt(req.params.id)
    const { user_agent, is_active } = req.body

    const session = await prisma.userSession.findUnique({ where: { id: sessionId } })
    if (!session) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '会话不存在' })
    }

    const updateData = {}
    if (user_agent !== undefined) updateData.user_agent = user_agent
    if (is_active !== undefined) updateData.is_active = Boolean(is_active)

    await prisma.userSession.update({ where: { id: sessionId }, data: updateData })
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '更新成功' })
  } catch (error) {
    console.error('更新会话失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '更新失败' })
  }
})

router.delete('/sessions/:id', adminAuth, async (req, res) => {
  try {
    const sessionId = BigInt(req.params.id)
    await prisma.userSession.delete({ where: { id: sessionId } })
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '删除成功' })
  } catch (error) {
    console.error('删除会话失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除失败' })
  }
})

router.delete('/sessions', adminAuth, async (req, res) => {
  try {
    const { ids } = req.body
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '请提供要删除的ID列表' })
    }

    const sessionIds = ids.map(id => BigInt(id))
    await prisma.userSession.deleteMany({ where: { id: { in: sessionIds } } })

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '成功删除 ' + ids.length + ' 条记录' })
  } catch (error) {
    console.error('批量删除会话失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除失败' })
  }
})

// ===================== 用户管理 =====================
router.get('/users', adminAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const limit = parseInt(req.query.limit) || 20
    const skip = (page - 1) * limit
    const { user_id, nickname, location, is_active, sortField = 'created_at', sortOrder = 'desc' } = req.query

    const where = {}
    if (user_id) where.user_id = { contains: user_id }
    if (nickname) where.nickname = { contains: nickname }
    if (location) where.location = { contains: location }
    if (is_active !== undefined && is_active !== '') where.is_active = parseInt(is_active) === 1

    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        select: {
          id: true, user_id: true, nickname: true, avatar: true, bio: true,
          location: true, email: true, follow_count: true, fans_count: true,
          like_count: true, is_active: true, created_at: true, verified: true
        },
        orderBy: { [sortField]: sortOrder.toLowerCase() },
        take: limit,
        skip: skip
      })
    ])

    const formattedUsers = users.map(u => ({ ...u, id: Number(u.id) }))

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: { data: formattedUsers, pagination: { page, limit, total, pages: Math.ceil(total / limit) } },
      message: 'success'
    })
  } catch (error) {
    console.error('获取用户列表失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' })
  }
})

router.get('/users/:id', adminAuth, async (req, res) => {
  try {
    const userId = BigInt(req.params.id)
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, user_id: true, nickname: true, avatar: true, bio: true,
        location: true, email: true, follow_count: true, fans_count: true,
        like_count: true, is_active: true, created_at: true, verified: true,
        gender: true, zodiac_sign: true, mbti: true, education: true, major: true
      }
    })

    if (!user) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '用户不存在' })
    }

    res.json({ code: RESPONSE_CODES.SUCCESS, data: { ...user, id: Number(user.id) }, message: 'success' })
  } catch (error) {
    console.error('获取用户详情失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' })
  }
})

router.post('/users', adminAuth, async (req, res) => {
  try {
    const { user_id, nickname, avatar, bio, location, is_active, password, gender, zodiac_sign, mbti, education, major, interests, verified } = req.body

    if (!user_id || !nickname) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '缺少必填字段' })
    }

    const existing = await prisma.user.findUnique({ where: { user_id } })
    if (existing) {
      return res.status(HTTP_STATUS.CONFLICT).json({ code: RESPONSE_CODES.CONFLICT, message: 'user_id已存在' })
    }

    // Hash password using SHA256
    const hashedPassword = password 
      ? crypto.createHash('sha256').update(password).digest('hex')
      : crypto.createHash('sha256').update('123456').digest('hex')

    const user = await prisma.user.create({
      data: {
        user_id,
        nickname,
        password: hashedPassword,
        avatar: avatar || '',
        bio: bio || '',
        location: location || '',
        is_active: is_active !== undefined ? Boolean(is_active) : true,
        gender: gender || null,
        zodiac_sign: zodiac_sign || null,
        mbti: mbti || null,
        education: education || null,
        major: major || null,
        interests: interests || null,
        verified: verified || false
      }
    })

    res.json({ code: RESPONSE_CODES.SUCCESS, data: { id: Number(user.id) }, message: '用户创建成功' })
  } catch (error) {
    console.error('创建用户失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '创建失败' })
  }
})

router.put('/users/:id', adminAuth, async (req, res) => {
  try {
    const userId = BigInt(req.params.id)
    const { user_id, nickname, avatar, bio, location, is_active, gender, zodiac_sign, mbti, education, major, interests, verified } = req.body

    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '用户不存在' })
    }

    const updateData = {}
    if (user_id !== undefined) updateData.user_id = user_id
    if (nickname !== undefined) updateData.nickname = nickname
    if (avatar !== undefined) updateData.avatar = avatar
    if (bio !== undefined) updateData.bio = bio
    if (location !== undefined) updateData.location = location
    if (is_active !== undefined) updateData.is_active = Boolean(is_active)
    if (gender !== undefined) updateData.gender = gender
    if (zodiac_sign !== undefined) updateData.zodiac_sign = zodiac_sign
    if (mbti !== undefined) updateData.mbti = mbti
    if (education !== undefined) updateData.education = education
    if (major !== undefined) updateData.major = major
    if (interests !== undefined) updateData.interests = interests
    if (verified !== undefined) updateData.verified = Boolean(verified)

    await prisma.user.update({ where: { id: userId }, data: updateData })
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '更新成功' })
  } catch (error) {
    console.error('更新用户失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '更新失败' })
  }
})

router.delete('/users/:id', adminAuth, async (req, res) => {
  try {
    const userId = BigInt(req.params.id)
    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '用户不存在' })
    }

    await prisma.user.delete({ where: { id: userId } })
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '删除成功' })
  } catch (error) {
    console.error('删除用户失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除失败' })
  }
})

router.delete('/users', adminAuth, async (req, res) => {
  try {
    const { ids } = req.body
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '请提供要删除的ID列表' })
    }

    const userIds = ids.map(id => BigInt(id))
    await prisma.user.deleteMany({ where: { id: { in: userIds } } })

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '成功删除 ' + ids.length + ' 条记录' })
  } catch (error) {
    console.error('批量删除用户失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除失败' })
  }
})

// ===================== 管理员管理 =====================
router.get('/admins', adminAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const limit = parseInt(req.query.limit) || 20
    const skip = (page - 1) * limit
    const { username, sortField = 'created_at', sortOrder = 'desc' } = req.query

    const where = username ? { username: { contains: username } } : {}

    const [total, admins] = await Promise.all([
      prisma.admin.count({ where }),
      prisma.admin.findMany({
        where,
        select: { id: true, username: true, created_at: true },
        orderBy: { [sortField]: sortOrder.toLowerCase() },
        take: limit,
        skip: skip
      })
    ])

    const formattedAdmins = admins.map(a => ({ ...a, id: Number(a.id) }))

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: { data: formattedAdmins, pagination: { page, limit, total, pages: Math.ceil(total / limit) } },
      message: 'success'
    })
  } catch (error) {
    console.error('获取管理员列表失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' })
  }
})

router.get('/admins/:id', adminAuth, async (req, res) => {
  try {
    const adminId = BigInt(req.params.id)
    const admin = await prisma.admin.findUnique({
      where: { id: adminId },
      select: { id: true, username: true, created_at: true }
    })

    if (!admin) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '管理员不存在' })
    }

    res.json({ code: RESPONSE_CODES.SUCCESS, data: { ...admin, id: Number(admin.id) }, message: 'success' })
  } catch (error) {
    console.error('获取管理员详情失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' })
  }
})

router.post('/admins', adminAuth, async (req, res) => {
  try {
    const { username, password } = req.body

    if (!username || !password) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '缺少必填字段' })
    }

    const existing = await prisma.admin.findUnique({ where: { username } })
    if (existing) {
      return res.status(HTTP_STATUS.CONFLICT).json({ code: RESPONSE_CODES.CONFLICT, message: '用户名已存在' })
    }

    const hashedPassword = crypto.createHash('sha256').update(password).digest('hex')

    const admin = await prisma.admin.create({
      data: { username, password: hashedPassword }
    })

    res.json({ code: RESPONSE_CODES.SUCCESS, data: { id: Number(admin.id) }, message: '管理员创建成功' })
  } catch (error) {
    console.error('创建管理员失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '创建失败' })
  }
})

router.put('/admins/:id', adminAuth, async (req, res) => {
  try {
    const adminId = BigInt(req.params.id)
    const { password } = req.body

    const admin = await prisma.admin.findUnique({ where: { id: adminId } })
    if (!admin) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '管理员不存在' })
    }

    if (password) {
      const hashedPassword = crypto.createHash('sha256').update(password).digest('hex')
      await prisma.admin.update({ where: { id: adminId }, data: { password: hashedPassword } })
    }

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '更新成功' })
  } catch (error) {
    console.error('更新管理员失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '更新失败' })
  }
})

router.delete('/admins/:id', adminAuth, async (req, res) => {
  try {
    const adminId = BigInt(req.params.id)
    await prisma.admin.delete({ where: { id: adminId } })
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '删除成功' })
  } catch (error) {
    console.error('删除管理员失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除失败' })
  }
})

router.delete('/admins', adminAuth, async (req, res) => {
  try {
    const { ids } = req.body
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '请提供要删除的ID列表' })
    }

    const adminIds = ids.map(id => BigInt(id))
    await prisma.admin.deleteMany({ where: { id: { in: adminIds } } })

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '成功删除 ' + ids.length + ' 条记录' })
  } catch (error) {
    console.error('批量删除管理员失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除失败' })
  }
})

// ===================== 监控动态 =====================
router.get('/monitor/activities', adminAuth, async (req, res) => {
  try {
    const activities = []

    const [newUsers, newPosts, newComments] = await Promise.all([
      prisma.user.findMany({
        select: { id: true, user_id: true, nickname: true, avatar: true, created_at: true },
        orderBy: { created_at: 'desc' },
        take: 10
      }),
      prisma.post.findMany({
        where: { is_draft: false },
        select: { id: true, title: true, created_at: true, user: { select: { user_id: true, nickname: true, avatar: true } } },
        orderBy: { created_at: 'desc' },
        take: 10
      }),
      prisma.comment.findMany({
        select: { 
          id: true, content: true, post_id: true, created_at: true,
          user: { select: { user_id: true, nickname: true, avatar: true } },
          post: { select: { title: true } }
        },
        orderBy: { created_at: 'desc' },
        take: 10
      })
    ])

    newUsers.forEach(user => {
      activities.push({
        id: 'user_' + user.id,
        type: 'user_register',
        user_id: user.user_id,
        nickname: user.nickname,
        avatar: user.avatar,
        title: '新用户注册',
        content: '用户 ' + user.nickname + ' (' + user.user_id + ') 注册了账号',
        target_id: Number(user.id),
        created_at: user.created_at
      })
    })

    newPosts.forEach(post => {
      activities.push({
        id: 'post_' + post.id,
        type: 'post_publish',
        user_id: post.user?.user_id,
        nickname: post.user?.nickname,
        avatar: post.user?.avatar,
        title: post.title,
        content: post.user?.nickname + ' 发布了笔记《' + post.title + '》',
        target_id: Number(post.id),
        created_at: post.created_at
      })
    })

    newComments.forEach(comment => {
      activities.push({
        id: Number(comment.id),
        type: 'comment_publish',
        user_id: comment.user?.user_id,
        nickname: comment.user?.nickname,
        avatar: comment.user?.avatar,
        title: comment.post?.title,
        content: comment.content,
        description: comment.user?.nickname + ' 在《' + comment.post?.title + '》中发表了评论',
        target_id: Number(comment.post_id),
        created_at: comment.created_at
      })
    })

    activities.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '获取动态成功', data: activities })
  } catch (error) {
    console.error('获取监控动态失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取动态失败', error: error.message })
  }
})

// ===================== 测试用户接口 =====================
router.get('/test-users', adminAuth, async (req, res) => {
  try {
    const likes = await prisma.like.findMany({ select: { user_id: true }, distinct: ['user_id'], take: 10 })
    const userIds = likes.map(l => l.user_id)
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, user_id: true, nickname: true }
    })
    res.json({ code: RESPONSE_CODES.SUCCESS, data: users.map(u => ({ ...u, id: Number(u.id) })) })
  } catch (error) {
    console.error('测试用户数据失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '服务器错误' })
  }
})

// ===================== 审核管理 (认证审核 type 1,2) =====================
router.get('/audit', adminAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const limit = parseInt(req.query.limit) || 20
    const skip = (page - 1) * limit
    const { user_id, user_display_id, type, status, sortBy = 'created_at', sortOrder = 'DESC' } = req.query

    const where = { type: { in: [1, 2] } }
    if (user_id) where.user_id = BigInt(user_id)
    if (user_display_id) where.user = { user_id: { contains: user_display_id } }
    if (type) where.type = parseInt(type)
    if (status !== undefined && status !== '') where.status = parseInt(status)

    const [total, audits] = await Promise.all([
      prisma.audit.count({ where }),
      prisma.audit.findMany({
        where,
        include: { user: { select: { id: true, user_id: true, nickname: true, avatar: true } } },
        orderBy: { [sortBy]: sortOrder.toLowerCase() },
        take: limit,
        skip: skip
      })
    ])

    const formattedAudits = audits.map(a => ({
      id: Number(a.id),
      user_id: Number(a.user_id),
      type: a.type,
      target_id: a.target_id ? Number(a.target_id) : null,
      content: a.content,
      risk_level: a.risk_level,
      categories: a.categories,
      reason: a.reason,
      status: a.status,
      created_at: a.created_at,
      audit_time: a.audit_time,
      user_display_id: a.user?.user_id,
      nickname: a.user?.nickname,
      avatar: a.user?.avatar
    }))

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '获取认证列表成功',
      data: { data: formattedAudits, total, page, limit }
    })
  } catch (error) {
    console.error('获取认证列表失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取认证列表失败', error: error.message })
  }
})

router.get('/audit/:id', adminAuth, async (req, res) => {
  try {
    const auditId = BigInt(req.params.id)
    const audit = await prisma.audit.findFirst({
      where: { id: auditId, type: { in: [1, 2] } },
      include: { user: { select: { id: true, user_id: true, nickname: true, avatar: true } } }
    })

    if (!audit) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '认证记录不存在' })
    }

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '获取认证记录成功', data: audit })
  } catch (error) {
    console.error('获取认证记录失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取认证记录失败', error: error.message })
  }
})

router.post('/audit', adminAuth, async (req, res) => {
  try {
    const { user_id, type, content } = req.body

    if (!user_id || !type || !content) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '缺少必填字段' })
    }

    const audit = await prisma.audit.create({
      data: {
        user_id: BigInt(user_id),
        type: parseInt(type),
        content,
        status: 0
      }
    })

    res.json({ code: RESPONSE_CODES.SUCCESS, data: { id: Number(audit.id) }, message: '审核创建成功' })
  } catch (error) {
    console.error('创建审核失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '创建失败' })
  }
})

router.put('/audit/:id', adminAuth, async (req, res) => {
  try {
    const auditId = BigInt(req.params.id)
    const { type, content, status, audit_time } = req.body

    const audit = await prisma.audit.findUnique({ where: { id: auditId } })
    if (!audit) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '审核记录不存在' })
    }

    const updateData = {}
    if (type !== undefined && type !== '') updateData.type = parseInt(type)
    if (content !== undefined) updateData.content = content
    if (status !== undefined && status !== '') updateData.status = parseInt(status)
    if (audit_time !== undefined && audit_time !== '') updateData.audit_time = new Date(audit_time)

    await prisma.audit.update({ where: { id: auditId }, data: updateData })
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '更新成功' })
  } catch (error) {
    console.error('更新审核失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '更新失败' })
  }
})

router.delete('/audit/:id', adminAuth, async (req, res) => {
  try {
    const auditId = BigInt(req.params.id)
    await prisma.audit.delete({ where: { id: auditId } })
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '删除成功' })
  } catch (error) {
    console.error('删除审核失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除失败' })
  }
})

router.delete('/audit', adminAuth, async (req, res) => {
  try {
    const { ids } = req.body
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '请提供要删除的ID列表' })
    }

    const auditIds = ids.map(id => BigInt(id))
    await prisma.audit.deleteMany({ where: { id: { in: auditIds } } })

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '成功删除 ' + ids.length + ' 条记录' })
  } catch (error) {
    console.error('批量删除审核失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除失败' })
  }
})

router.put('/audit/:id/approve', adminAuth, async (req, res) => {
  try {
    const auditId = BigInt(req.params.id)
    const audit = await prisma.audit.findUnique({ where: { id: auditId } })
    if (!audit) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.ERROR, message: '审核记录不存在' })
    }

    await prisma.audit.update({
      where: { id: auditId },
      data: { status: 1, audit_time: new Date() }
    })

    if (audit.type === 1 || audit.type === 2) {
      await prisma.user.update({ where: { id: audit.user_id }, data: { verified: true } })
    } else if (audit.type === 3 && audit.target_id) {
      await prisma.comment.update({ where: { id: audit.target_id }, data: { audit_status: 1, is_public: true } })
    }

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '审核通过成功' })
  } catch (error) {
    console.error('审核通过失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '审核通过失败', error: error.message })
  }
})

router.put('/audit/:id/reject', adminAuth, async (req, res) => {
  try {
    const auditId = BigInt(req.params.id)
    const audit = await prisma.audit.findUnique({ where: { id: auditId } })
    if (!audit) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.ERROR, message: '审核记录不存在' })
    }

    await prisma.audit.update({
      where: { id: auditId },
      data: { status: 2, audit_time: new Date() }
    })

    if (audit.type === 1 || audit.type === 2) {
      await prisma.user.update({ where: { id: audit.user_id }, data: { verified: false } })
    } else if (audit.type === 3 && audit.target_id) {
      await prisma.comment.update({ where: { id: audit.target_id }, data: { audit_status: 2, is_public: false } })
    }

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '拒绝申请成功' })
  } catch (error) {
    console.error('拒绝申请失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '拒绝申请失败', error: error.message })
  }
})

// ===================== 分类管理 =====================
router.get('/categories', adminAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const limit = parseInt(req.query.limit) || 20
    const skip = (page - 1) * limit
    const { name, category_title, sortField = 'id', sortOrder = 'asc' } = req.query

    const where = {}
    if (name) where.name = { contains: name }
    if (category_title) where.category_title = { contains: category_title }

    const [total, categories] = await Promise.all([
      prisma.category.count({ where }),
      prisma.category.findMany({
        where,
        include: { _count: { select: { posts: true } } },
        orderBy: { [sortField]: sortOrder.toLowerCase() },
        take: limit,
        skip: skip
      })
    ])

    const formatted = categories.map(c => ({
      id: c.id,
      name: c.name,
      category_title: c.category_title,
      created_at: c.created_at,
      post_count: c._count.posts
    }))

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: formatted,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      message: '获取成功'
    })
  } catch (error) {
    console.error('获取分类列表失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取分类列表失败' })
  }
})

router.get('/categories/:id', adminAuth, async (req, res) => {
  try {
    const categoryId = parseInt(req.params.id)
    const category = await prisma.category.findUnique({
      where: { id: categoryId },
      include: { _count: { select: { posts: true } } }
    })

    if (!category) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '分类不存在' })
    }

    res.json({ code: RESPONSE_CODES.SUCCESS, data: category, message: 'success' })
  } catch (error) {
    console.error('获取分类详情失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' })
  }
})

router.post('/categories', adminAuth, async (req, res) => {
  try {
    const { name, category_title } = req.body

    if (!name || !name.trim()) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '分类名称不能为空' })
    }

    if (!category_title || !category_title.trim()) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '分类英文标题不能为空' })
    }

    const existingName = await prisma.category.findUnique({ where: { name: name.trim() } })
    if (existingName) {
      return res.status(HTTP_STATUS.CONFLICT).json({ code: RESPONSE_CODES.CONFLICT, message: '分类名称已存在' })
    }

    const existingTitle = await prisma.category.findUnique({ where: { category_title: category_title.trim() } })
    if (existingTitle) {
      return res.status(HTTP_STATUS.CONFLICT).json({ code: RESPONSE_CODES.CONFLICT, message: '分类英文标题已存在' })
    }

    const newCategory = await prisma.category.create({
      data: { name: name.trim(), category_title: category_title.trim() }
    })

    res.json({ code: RESPONSE_CODES.SUCCESS, data: { id: newCategory.id }, message: '创建成功' })
  } catch (error) {
    console.error('创建分类失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '创建失败' })
  }
})

router.put('/categories/:id', adminAuth, async (req, res) => {
  try {
    const categoryId = parseInt(req.params.id)
    const { name, category_title } = req.body

    const category = await prisma.category.findUnique({ where: { id: categoryId } })
    if (!category) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '分类不存在' })
    }

    const updateData = {}

    if (name !== undefined) {
      if (!name.trim()) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '分类名称不能为空' })
      }
      const existingName = await prisma.category.findFirst({ where: { name: name.trim(), NOT: { id: categoryId } } })
      if (existingName) {
        return res.status(HTTP_STATUS.CONFLICT).json({ code: RESPONSE_CODES.CONFLICT, message: '分类名称已存在' })
      }
      updateData.name = name.trim()
    }

    if (category_title !== undefined) {
      if (!category_title.trim()) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '分类英文标题不能为空' })
      }
      const existingTitle = await prisma.category.findFirst({ where: { category_title: category_title.trim(), NOT: { id: categoryId } } })
      if (existingTitle) {
        return res.status(HTTP_STATUS.CONFLICT).json({ code: RESPONSE_CODES.CONFLICT, message: '分类英文标题已存在' })
      }
      updateData.category_title = category_title.trim()
    }

    await prisma.category.update({ where: { id: categoryId }, data: updateData })
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '更新成功' })
  } catch (error) {
    console.error('更新分类失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '更新失败' })
  }
})

router.delete('/categories/:id', adminAuth, async (req, res) => {
  try {
    const categoryId = parseInt(req.params.id)

    const postCount = await prisma.post.count({ where: { category_id: categoryId } })
    if (postCount > 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.ERROR, message: '该分类下还有 ' + postCount + ' 篇笔记，无法删除' })
    }

    await prisma.category.delete({ where: { id: categoryId } })
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '删除成功' })
  } catch (error) {
    console.error('删除分类失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除失败' })
  }
})

router.delete('/categories', adminAuth, async (req, res) => {
  try {
    const { ids } = req.body
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '请提供要删除的ID列表' })
    }

    const posts = await prisma.post.groupBy({
      by: ['category_id'],
      where: { category_id: { in: ids } },
      _count: true
    })

    if (posts.length > 0) {
      const categoryIds = posts.map(p => p.category_id).join(', ')
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.ERROR, message: '分类 ' + categoryIds + ' 下还有笔记，无法删除' })
    }

    await prisma.category.deleteMany({ where: { id: { in: ids } } })

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '成功删除 ' + ids.length + ' 条记录' })
  } catch (error) {
    console.error('批量删除分类失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除失败' })
  }
})

// ===================== 内容审核管理 (type 3,4) =====================
router.get('/content-review', adminAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const limit = parseInt(req.query.limit) || 20
    const skip = (page - 1) * limit
    const { user_id, user_display_id, type, status, sortBy = 'created_at', sortOrder = 'DESC' } = req.query

    const where = { type: { in: [3, 4] } }
    if (user_id) where.user_id = BigInt(user_id)
    if (user_display_id) where.user = { user_id: { contains: user_display_id } }
    if (type) where.type = parseInt(type)
    if (status !== undefined && status !== '') where.status = parseInt(status)

    const [total, audits] = await Promise.all([
      prisma.audit.count({ where }),
      prisma.audit.findMany({
        where,
        include: { user: { select: { id: true, user_id: true, nickname: true, avatar: true } } },
        orderBy: { [sortBy]: sortOrder.toLowerCase() },
        take: limit,
        skip: skip
      })
    ])

    const formattedAudits = audits.map(a => ({
      id: Number(a.id),
      user_id: Number(a.user_id),
      type: a.type,
      target_id: a.target_id ? Number(a.target_id) : null,
      content: a.content,
      risk_level: a.risk_level,
      categories: a.categories,
      reason: a.reason,
      status: a.status,
      created_at: a.created_at,
      audit_time: a.audit_time,
      user_display_id: a.user?.user_id,
      nickname: a.user?.nickname,
      avatar: a.user?.avatar
    }))

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '获取审核列表成功',
      data: { data: formattedAudits, total, page, limit }
    })
  } catch (error) {
    console.error('获取审核列表失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取审核列表失败', error: error.message })
  }
})

router.get('/content-review/:id', adminAuth, async (req, res) => {
  try {
    const auditId = BigInt(req.params.id)
    const audit = await prisma.audit.findFirst({
      where: { id: auditId, type: { in: [3, 4] } },
      include: { user: { select: { id: true, user_id: true, nickname: true, avatar: true } } }
    })

    if (!audit) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '审核记录不存在' })
    }

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '获取审核记录成功', data: audit })
  } catch (error) {
    console.error('获取审核记录失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取审核记录失败', error: error.message })
  }
})

router.post('/content-review', adminAuth, async (req, res) => {
  try {
    const { user_id, type, content, target_id } = req.body

    if (!user_id || !type || !content) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '缺少必填字段' })
    }

    const audit = await prisma.audit.create({
      data: {
        user_id: BigInt(user_id),
        type: parseInt(type),
        content,
        target_id: target_id ? BigInt(target_id) : null,
        status: 0
      }
    })

    res.json({ code: RESPONSE_CODES.SUCCESS, data: { id: Number(audit.id) }, message: '创建成功' })
  } catch (error) {
    console.error('创建内容审核失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '创建失败' })
  }
})

router.put('/content-review/:id', adminAuth, async (req, res) => {
  try {
    const auditId = BigInt(req.params.id)
    const { type, content, status, audit_time } = req.body

    const audit = await prisma.audit.findFirst({ where: { id: auditId, type: { in: [3, 4] } } })
    if (!audit) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '审核记录不存在' })
    }

    const updateData = {}
    if (type !== undefined && type !== '') updateData.type = parseInt(type)
    if (content !== undefined) updateData.content = content
    if (status !== undefined && status !== '') updateData.status = parseInt(status)
    if (audit_time !== undefined && audit_time !== '') updateData.audit_time = new Date(audit_time)

    await prisma.audit.update({ where: { id: auditId }, data: updateData })
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '更新成功' })
  } catch (error) {
    console.error('更新内容审核失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '更新失败' })
  }
})

router.delete('/content-review/:id', adminAuth, async (req, res) => {
  try {
    const auditId = BigInt(req.params.id)

    const audit = await prisma.audit.findFirst({ where: { id: auditId, type: { in: [3, 4] } } })
    if (!audit) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.ERROR, message: '审核记录不存在' })
    }

    // If comment review and has target_id, delete the comment first
    if (audit.type === 3 && audit.target_id) {
      await prisma.like.deleteMany({ where: { target_type: 2, target_id: audit.target_id } })
      await prisma.comment.deleteMany({ where: { id: audit.target_id } })
    }

    await prisma.audit.delete({ where: { id: auditId } })

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '删除成功' })
  } catch (error) {
    console.error('删除审核记录失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除失败', error: error.message })
  }
})

router.delete('/content-review', adminAuth, async (req, res) => {
  try {
    const { ids } = req.body
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '请提供要删除的ID列表' })
    }

    const auditIds = ids.map(id => BigInt(id))
    await prisma.audit.deleteMany({ where: { id: { in: auditIds }, type: { in: [3, 4] } } })

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '成功删除 ' + ids.length + ' 条记录' })
  } catch (error) {
    console.error('批量删除内容审核失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除失败' })
  }
})

router.put('/content-review/:id/approve', adminAuth, async (req, res) => {
  try {
    const auditId = BigInt(req.params.id)
    const audit = await prisma.audit.findFirst({ where: { id: auditId, type: { in: [3, 4] } } })
    if (!audit) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.ERROR, message: '审核记录不存在' })
    }

    await prisma.audit.update({
      where: { id: auditId },
      data: { status: 1, audit_time: new Date() }
    })

    if (audit.type === 3 && audit.target_id) {
      await prisma.comment.update({ where: { id: audit.target_id }, data: { audit_status: 1, is_public: true } })
    }

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '审核通过成功' })
  } catch (error) {
    console.error('审核通过失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '审核通过失败', error: error.message })
  }
})

router.put('/content-review/:id/reject', adminAuth, async (req, res) => {
  try {
    const auditId = BigInt(req.params.id)
    const audit = await prisma.audit.findFirst({ where: { id: auditId, type: { in: [3, 4] } } })
    if (!audit) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.ERROR, message: '审核记录不存在' })
    }

    await prisma.audit.update({
      where: { id: auditId },
      data: { status: 2, audit_time: new Date() }
    })

    if (audit.type === 3 && audit.target_id) {
      await prisma.comment.update({ where: { id: audit.target_id }, data: { audit_status: 2, is_public: false } })
    }

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '拒绝成功' })
  } catch (error) {
    console.error('拒绝失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '拒绝失败', error: error.message })
  }
})

router.get('/content-review/settings', adminAuth, async (req, res) => {
  res.json({
    code: RESPONSE_CODES.SUCCESS,
    message: '获取设置成功',
    data: { ai_auto_review: aiAutoReviewEnabled }
  })
})

router.put('/content-review/settings', adminAuth, async (req, res) => {
  try {
    const { ai_auto_review } = req.body
    aiAutoReviewEnabled = !!ai_auto_review

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: aiAutoReviewEnabled ? 'AI自动审核已开启' : 'AI自动审核已关闭',
      data: { ai_auto_review: aiAutoReviewEnabled }
    })
  } catch (error) {
    console.error('更新设置失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '更新设置失败', error: error.message })
  }
})

router.put('/content-review/:id/retry', adminAuth, async (req, res) => {
  try {
    const auditId = BigInt(req.params.id)

    const audit = await prisma.audit.findFirst({
      where: { id: auditId, type: { in: [3, 4] } }
    })
    if (!audit) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.ERROR, message: '审核记录不存在' })
    }

    const retryCount = audit.retry_count || 0
    if (retryCount >= 5) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.ERROR, message: '已达到最大重试次数（5次）' })
    }

    if (audit.status !== 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.ERROR, message: '只有待审核状态的记录可以重试' })
    }

    const aiResult = await auditComment(audit.content, Number(audit.user_id))

    let detailedReason = ''
    let newStatus = 0
    if (aiResult) {
      const parts = []
      if (aiResult.reason) parts.push('AI审核结果: ' + aiResult.reason)
      if (aiResult.suggestion) parts.push('建议: ' + aiResult.suggestion)
      if (aiResult.passed !== undefined) parts.push('是否通过: ' + (aiResult.passed ? '是' : '否'))
      if (aiResult.score !== undefined) parts.push('风险分数: ' + aiResult.score)
      if (aiResult.matched_keywords && aiResult.matched_keywords.length > 0) {
        parts.push('匹配关键词: ' + aiResult.matched_keywords.join(', '))
      }
      if (aiResult.problem_sentences && aiResult.problem_sentences.length > 0) {
        parts.push('问题句子: ' + aiResult.problem_sentences.join('; '))
      }
      detailedReason = parts.join(' | ')

      if (aiResult.passed === true) {
        newStatus = 1
        detailedReason = '[AI重试审核通过 第' + (retryCount + 1) + '次] ' + detailedReason
        if (audit.type === 3 && audit.target_id) {
          await prisma.comment.update({ where: { id: audit.target_id }, data: { audit_status: 1, is_public: true } })
        }
      } else if (aiResult.passed === false) {
        newStatus = 2
        detailedReason = '[AI重试审核拒绝 第' + (retryCount + 1) + '次] ' + detailedReason
        if (audit.type === 3 && audit.target_id) {
          await prisma.comment.delete({ where: { id: audit.target_id } })
          await prisma.audit.update({ where: { id: auditId }, data: { target_id: null } })
        }
      } else {
        detailedReason = '[AI重试审核 第' + (retryCount + 1) + '次] ' + detailedReason
      }
    } else {
      detailedReason = '[AI重试审核失败 第' + (retryCount + 1) + '次] AI服务无响应'
    }

    await prisma.audit.update({
      where: { id: auditId },
      data: {
        audit_result: aiResult || undefined,
        risk_level: aiResult?.risk_level || 'unknown',
        categories: aiResult?.categories || [],
        reason: detailedReason,
        status: newStatus,
        retry_count: retryCount + 1,
        audit_time: newStatus !== 0 ? new Date() : audit.audit_time
      }
    })

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: newStatus === 1 ? 'AI重试审核通过' : (newStatus === 2 ? 'AI重试审核拒绝' : 'AI重试完成，仍待审核'),
      data: { status: newStatus, retry_count: retryCount + 1, ai_result: aiResult }
    })
  } catch (error) {
    console.error('重试AI审核失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '重试AI审核失败', error: error.message })
  }
})

// ===================== 统计信息 =====================
router.get('/stats/overview', adminAuth, async (req, res) => {
  try {
    const [usersCount, postsCount, commentsCount, likesCount] = await Promise.all([
      prisma.user.count(),
      prisma.post.count(),
      prisma.comment.count(),
      prisma.like.count()
    ])

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: { users: usersCount, posts: postsCount, comments: commentsCount, likes: likesCount },
      message: 'success'
    })
  } catch (error) {
    console.error('获取统计信息失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' })
  }
})

// ===================== 队列管理 =====================

// 获取队列统计信息
router.get('/queues', adminAuth, async (req, res) => {
  try {
    const stats = await getQueueStats()
    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: stats,
      message: 'success'
    })
  } catch (error) {
    console.error('获取队列统计失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取队列统计失败' })
  }
})

// 获取队列任务列表
router.get('/queues/:name/jobs', adminAuth, async (req, res) => {
  try {
    const { name } = req.params
    const { status = 'waiting', start = 0, end = 20 } = req.query

    const result = await getQueueJobs(name, status, parseInt(start), parseInt(end))
    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: result,
      message: 'success'
    })
  } catch (error) {
    console.error('获取队列任务列表失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取队列任务列表失败' })
  }
})

// 重试失败的任务
router.post('/queues/:name/jobs/:jobId/retry', adminAuth, async (req, res) => {
  try {
    const { name, jobId } = req.params

    const result = await retryJob(name, jobId)
    if (result.success) {
      res.json({ code: RESPONSE_CODES.SUCCESS, message: result.message })
    } else {
      res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.ERROR, message: result.message })
    }
  } catch (error) {
    console.error('重试任务失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '重试任务失败' })
  }
})

// 清空队列
router.delete('/queues/:name', adminAuth, async (req, res) => {
  try {
    const { name } = req.params

    const result = await cleanQueue(name)
    if (result.success) {
      res.json({ code: RESPONSE_CODES.SUCCESS, message: result.message })
    } else {
      res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.ERROR, message: result.message })
    }
  } catch (error) {
    console.error('清空队列失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '清空队列失败' })
  }
})

// 获取队列名称列表
router.get('/queue-names', adminAuth, (req, res) => {
  res.json({
    code: RESPONSE_CODES.SUCCESS,
    data: {
      enabled: isQueueEnabled(),
      names: Object.values(QUEUE_NAMES)
    },
    message: 'success'
  })
})

module.exports = router
module.exports.isAiAutoReviewEnabled = isAiAutoReviewEnabled
