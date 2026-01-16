const express = require('express');
const router = express.Router();
const { HTTP_STATUS, RESPONSE_CODES } = require('../constants');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { authenticateToken } = require('../middleware/auth');
const { uploadFile, uploadVideo, uploadImage } = require('../utils/uploadHelper');
const transcodingQueue = require('../utils/transcodingQueue');
const { addVideoTranscodingTask, isQueueEnabled } = require('../utils/queueService');
const config = require('../config/config');
const { pool } = require('../config/config');
const { 
  saveChunk, 
  verifyChunk, 
  checkUploadComplete, 
  mergeChunks,
  mergeImageChunks,
  startCleanupScheduler
} = require('../utils/chunkUploadHelper');
const { validateVideoMedia, deleteInvalidVideo } = require('../utils/videoTranscoder');

const parseWatermarkFlag = (value) => value === true || value === 'true' || value === 1 || value === '1';

// 配置 multer 内存存储（用于云端图床）
const storage = multer.memoryStorage();

// 文件过滤器 - 图片
const imageFileFilter = (req, file, cb) => {
  // 检查文件类型
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('只允许上传图片文件'), false);
  }
};

// 文件过滤器 - 视频
const videoFileFilter = (req, file, cb) => {
  // 检查文件类型
  const allowedTypes = ['video/mp4', 'video/avi', 'video/mov', 'video/wmv', 'video/flv', 'video/webm'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('只允许上传视频文件'), false);
  }
};

// 配置 multer - 图片
const upload = multer({
  storage: storage,
  fileFilter: imageFileFilter,
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB 限制
  }
});

// 配置 multer - 视频
// 混合文件过滤器（支持视频和图片）
const mixedFileFilter = (req, file, cb) => {
  if (file.fieldname === 'file') {
    // 视频文件验证
    if (file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('只支持视频文件'), false);
    }
  } else if (file.fieldname === 'thumbnail') {
    // 缩略图文件验证
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('缩略图只支持图片文件'), false);
    }
  } else {
    cb(new Error('不支持的文件字段'), false);
  }
};

const videoUpload = multer({
  storage: storage,
  fileFilter: mixedFileFilter, // 使用混合文件过滤器
  limits: {
    fileSize: config.upload.video.maxSizeBytes // 使用配置中的视频大小限制
  }
});

// 单图片上传到图床
router.post('/single', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '没有上传文件' });
    }

    // 解析用户是否希望添加水印（默认不添加，需显式传递 true）
    // 用户可通过请求参数 watermark=true 来启用水印
    const watermarkParam = req.body.watermark;
    const applyWatermark = parseWatermarkFlag(watermarkParam);
    console.log(`水印参数解析 - 原始值: ${watermarkParam}, 类型: ${typeof watermarkParam}, 结果: ${applyWatermark}`);
    
    // 解析用户自定义的水印透明度（可选，10-100）
    let customOpacity = null;
    if (req.body.watermarkOpacity !== undefined) {
      const opacity = parseInt(req.body.watermarkOpacity, 10);
      if (!isNaN(opacity) && opacity >= 10 && opacity <= 100) {
        customOpacity = opacity;
      }
    }

    // 解析是否是头像上传（头像强制转换为WebP，质量75%）
    const isAvatarParam = req.body.isAvatar;
    const isAvatar = isAvatarParam === true || isAvatarParam === 'true' || isAvatarParam === 1 || isAvatarParam === '1';

    // 准备用户上下文（用于水印）
    // 格式: nickname @xise_id 或 nickname @user_id
    const userId = req.user?.xise_id || req.user?.user_id || 'guest';
    const nickname = req.user?.nickname || '';
    const context = {
      username: nickname ? `${nickname} @${userId}` : userId,
      userId: req.user?.id,
      applyWatermark: applyWatermark,
      customOpacity: customOpacity,
      isAvatar: isAvatar // 头像上传标记，用于强制WebP转换
    };

    // 使用统一上传函数（根据配置选择策略）
    const result = await uploadFile(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      context
    );

    if (result.success) {
      // 记录用户上传操作日志
      console.log(`单图片上传成功 - 用户ID: ${req.user.id}, 文件名: ${req.file.originalname}, 水印: ${applyWatermark ? '是' : '否'}`);

      res.json({
        code: RESPONSE_CODES.SUCCESS,
        message: '上传成功',
        data: {
          originalname: req.file.originalname,
          size: req.file.size,
          url: result.url
        }
      });
    } else {
      res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: result.message || '图床上传失败' });
    }
  } catch (error) {
    console.error('单图片上传失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '上传失败' });
  }
});

// 多图片上传到图床
router.post('/multiple', authenticateToken, upload.array('files', 9), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ 
        success: false, 
        data: null, 
        message: '没有上传文件' 
      });
    }

    // 解析用户是否希望添加水印（默认不添加，需显式传递 true）
    const watermarkParamMultiple = req.body.watermark;
    const applyWatermark = parseWatermarkFlag(watermarkParamMultiple);
    console.log(`[多图上传] 水印参数解析 - 原始值: ${watermarkParamMultiple}, 类型: ${typeof watermarkParamMultiple}, 结果: ${applyWatermark}`);
    
    // 解析用户自定义的水印透明度（可选，10-100）
    let customOpacity = null;
    if (req.body.watermarkOpacity !== undefined) {
      const opacity = parseInt(req.body.watermarkOpacity, 10);
      if (!isNaN(opacity) && opacity >= 10 && opacity <= 100) {
        customOpacity = opacity;
      }
    }

    // 准备用户上下文（用于水印）
    // 格式: nickname @xise_id 或 nickname @user_id
    const odIdMultiple = req.user?.xise_id || req.user?.user_id || 'guest';
    const nicknameMultiple = req.user?.nickname || '';
    const context = {
      username: nicknameMultiple ? `${nicknameMultiple} @${odIdMultiple}` : odIdMultiple,
      userId: req.user?.id,
      applyWatermark: applyWatermark,
      customOpacity: customOpacity
    };

    const uploadResults = [];
    const errors = [];

    for (const file of req.files) {
      const result = await uploadFile(
        file.buffer,
        file.originalname,
        file.mimetype,
        context
      );

      if (result.success) {
        uploadResults.push({
          originalname: file.originalname,
          size: file.size,
          url: result.url
        });
      } else {
        errors.push({ file: file.originalname, error: result.message });
      }
    }

    if (uploadResults.length === 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ 
        success: false, 
        data: null, 
        message: '所有图片上传失败' 
      });
    }

    // 记录用户上传操作日志
    console.log(`多图片上传成功 - 用户ID: ${req.user.id}, 文件数量: ${uploadResults.length}, 水印: ${applyWatermark ? '是' : '否'}`);

    res.json({
      success: true,
      data: {
        uploaded: uploadResults,
        errors,
        total: req.files.length,
        successCount: uploadResults.length,
        errorCount: errors.length
      },
      message: errors.length === 0 ? '所有图片上传成功' : `${uploadResults.length}张上传成功，${errors.length}张失败`
    });
  } catch (error) {
    console.error('多图片上传失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ 
      success: false, 
      data: null, 
      message: '上传失败' 
    });
  }
});

// 单视频上传到图床
router.post('/video', authenticateToken, videoUpload.fields([
  { name: 'file', maxCount: 1 },
  { name: 'thumbnail', maxCount: 1 }
]), async (req, res) => {
  try {
    if (!req.files || !req.files.file || !req.files.file[0]) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ 
        code: RESPONSE_CODES.VALIDATION_ERROR, 
        message: '没有上传视频文件' 
      });
    }

    const videoFile = req.files.file[0];
    const thumbnailFile = req.files.thumbnail ? req.files.thumbnail[0] : null;

    console.log(`视频上传开始 - 用户ID: ${req.user.id}, 视频文件: ${videoFile.originalname}`);
    if (thumbnailFile) {
      console.log(`包含前端生成的缩略图: ${thumbnailFile.originalname}`);
    }

    // 上传视频文件
    const uploadResult = await uploadVideo(
      videoFile.buffer,
      videoFile.originalname,
      videoFile.mimetype
    );

    if (!uploadResult.success) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ 
        code: RESPONSE_CODES.VALIDATION_ERROR, 
        message: uploadResult.message || '视频上传失败' 
      });
    }

    let coverUrl = null;

    // 解析用户是否希望添加水印（默认不添加，需显式传递 true）
    const applyWatermark = parseWatermarkFlag(req.body.watermark);

    // 准备用户上下文（用于缩略图水印）
    // 格式: nickname @xise_id 或 nickname @user_id
    const userIdVideo = req.user?.xise_id || req.user?.user_id || 'guest';
    const nicknameVideo = req.user?.nickname || '';
    const context = {
      username: nicknameVideo ? `${nicknameVideo} @${userIdVideo}` : userIdVideo,
      userId: req.user?.id,
      applyWatermark: applyWatermark
    };

    // 优先使用前端生成的缩略图
    if (thumbnailFile) {
      try {
        console.log('使用前端生成的缩略图');
        const thumbnailUploadResult = await uploadFile(
          thumbnailFile.buffer,
          thumbnailFile.originalname,
          thumbnailFile.mimetype,
          context
        );
        
        if (thumbnailUploadResult.success) {
          coverUrl = thumbnailUploadResult.url;
          console.log('前端缩略图上传成功:', coverUrl);
        } else {
          console.warn('前端缩略图上传失败:', thumbnailUploadResult.message);
        }
      } catch (error) {
        console.warn('前端缩略图处理失败:', error.message);
      }
    }

    // 如果启用了视频转码，且是本地存储策略，则添加到转码队列
    if (config.videoTranscoding.enabled && 
        config.upload.video.strategy === 'local' && 
        uploadResult.filePath) {
      try {
        console.log('🎬 将视频添加到转码队列...');
        const originalVideoUrl = uploadResult.url;
        
        // 优先使用BullMQ队列，如果队列未启用则使用内存队列
        if (isQueueEnabled()) {
          const job = await addVideoTranscodingTask(
            uploadResult.filePath,
            req.user.id,
            originalVideoUrl
          );
          console.log(`✅ 视频已加入BullMQ转码队列 [任务ID: ${job?.id}]`);
        } else {
          // 回退到内存队列
          const taskId = transcodingQueue.addTask(
            uploadResult.filePath,
            req.user.id,
            originalVideoUrl
          );
          console.log(`✅ 视频已加入内存转码队列 [任务ID: ${taskId}]`);
        }
      } catch (error) {
        console.error('❌ 添加到转码队列失败:', error.message);
        // 转码失败不影响视频上传
      }
    }

    // 记录用户上传操作日志
    console.log(`视频上传成功 - 用户ID: ${req.user.id}, 文件名: ${videoFile.originalname}, 缩略图: ${coverUrl ? '有' : '无'}`);

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '上传成功',
      data: {
        originalname: videoFile.originalname,
        size: videoFile.size,
        url: uploadResult.url,
        filePath: uploadResult.filePath,
        coverUrl: coverUrl,
        transcoding: config.videoTranscoding.enabled && config.upload.video.strategy === 'local'
      }
    });
  } catch (error) {
    console.error('视频上传失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ 
      code: RESPONSE_CODES.ERROR, 
      message: '上传失败' 
    });
  }
});

// 启动分片清理调度器
startCleanupScheduler();

// 配置 multer - 分片上传
const chunkUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.upload.video.chunk.chunkSize + 1024 * 1024 // 分片大小 + 1MB余量
  }
});

// 获取分片上传配置
router.get('/chunk/config', authenticateToken, (req, res) => {
  res.json({
    code: RESPONSE_CODES.SUCCESS,
    message: '获取分片配置成功',
    data: {
      chunkSize: config.upload.video.chunk.chunkSize,
      maxFileSize: config.upload.video.maxSizeBytes, // 使用配置中的视频大小限制
      imageMaxSize: 100 * 1024 * 1024, // 图片最大100MB
      imageChunkThreshold: 3 * 1024 * 1024 // 图片超过3MB使用分片上传
    }
  });
});

// 验证分片是否已存在（用于秒传/断点续传）
router.get('/chunk/verify', authenticateToken, async (req, res) => {
  try {
    const { identifier, chunkNumber, md5 } = req.query;
    
    if (!identifier || !chunkNumber) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '缺少必要参数'
      });
    }
    
    const result = await verifyChunk(identifier, parseInt(chunkNumber), md5);
    
    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '验证完成',
      data: {
        exists: result.exists,
        valid: result.valid
      }
    });
  } catch (error) {
    console.error('分片验证失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: '分片验证失败'
    });
  }
});

// 上传分片
router.post('/chunk', authenticateToken, chunkUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '没有上传分片'
      });
    }
    
    const { identifier, chunkNumber, totalChunks, filename } = req.body;
    
    if (!identifier || !chunkNumber || !totalChunks) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '缺少必要参数'
      });
    }
    
    // 保存分片
    const saveResult = await saveChunk(
      req.file.buffer,
      identifier,
      parseInt(chunkNumber)
    );
    
    if (!saveResult.success) {
      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        code: RESPONSE_CODES.ERROR,
        message: saveResult.message || '分片保存失败'
      });
    }
    
    // 检查是否所有分片都已上传
    const checkResult = await checkUploadComplete(identifier, parseInt(totalChunks));
    
    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '分片上传成功',
      data: {
        chunkNumber: parseInt(chunkNumber),
        uploaded: checkResult.uploadedChunks.length,
        total: parseInt(totalChunks),
        complete: checkResult.complete
      }
    });
  } catch (error) {
    console.error('分片上传失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: '分片上传失败'
    });
  }
});

// 合并分片
router.post('/chunk/merge', authenticateToken, async (req, res) => {
  try {
    const { identifier, totalChunks, filename } = req.body;
    
    if (!identifier || !totalChunks || !filename) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '缺少必要参数'
      });
    }
    
    console.log(`🔄 开始合并分片 - 用户ID: ${req.user.id}, 文件名: ${filename}, 总分片数: ${totalChunks}`);
    
    // 合并分片
    const mergeResult = await mergeChunks(identifier, parseInt(totalChunks), filename);
    
    if (!mergeResult.success) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: mergeResult.message || '分片合并失败'
      });
    }
    
    const filePath = mergeResult.filePath;
    
    // 使用 ffprobe 验证视频文件有效性
    console.log(`🔍 使用 ffprobe 验证视频文件: ${filePath}`);
    const validationResult = await validateVideoMedia(filePath);
    
    if (!validationResult.valid) {
      console.error(`❌ 视频验证失败: ${validationResult.message}`);
      // 删除无效的视频文件
      await deleteInvalidVideo(filePath);
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: validationResult.message || '视频文件无效，已删除'
      });
    }
    
    // 生成视频访问URL
    const ext = path.extname(filename);
    const basename = path.basename(filePath);
    const videoUrl = `${config.upload.video.local.baseUrl}/${config.upload.video.local.uploadDir}/${basename}`;
    
    let coverUrl = null;
    
    // 如果启用了视频转码，且是本地存储策略，则添加到转码队列
    if (config.videoTranscoding.enabled && config.upload.video.strategy === 'local') {
      try {
        console.log('🎬 将视频添加到转码队列...');
        
        // 优先使用BullMQ队列，如果队列未启用则使用内存队列
        if (isQueueEnabled()) {
          const job = await addVideoTranscodingTask(
            filePath,
            req.user.id,
            videoUrl
          );
          console.log(`✅ 视频已加入BullMQ转码队列 [任务ID: ${job?.id}]`);
        } else {
          // 回退到内存队列
          const taskId = transcodingQueue.addTask(
            filePath,
            req.user.id,
            videoUrl
          );
          console.log(`✅ 视频已加入内存转码队列 [任务ID: ${taskId}]`);
        }
      } catch (error) {
        console.error('❌ 添加到转码队列失败:', error.message);
        // 转码失败不影响视频上传
      }
    }
    
    console.log(`✅ 分片合并完成 - 用户ID: ${req.user.id}, 文件名: ${filename}, URL: ${videoUrl}`);
    
    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '视频上传成功',
      data: {
        originalname: filename,
        url: videoUrl,
        filePath: filePath,
        coverUrl: coverUrl,
        transcoding: config.videoTranscoding.enabled && config.upload.video.strategy === 'local',
        videoInfo: validationResult.info
      }
    });
  } catch (error) {
    console.error('分片合并失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: '分片合并失败'
    });
  }
});

// 注意：使用云端图床后，文件删除由图床服务商管理

// 合并图片分片
router.post('/chunk/merge/image', authenticateToken, async (req, res) => {
  try {
    const { identifier, totalChunks, filename, watermark, watermarkOpacity } = req.body;
    
    if (!identifier || !totalChunks || !filename) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '缺少必要参数'
      });
    }
    
    console.log(`🔄 开始合并图片分片 - 用户ID: ${req.user.id}, 文件名: ${filename}, 总分片数: ${totalChunks}`);
    
    // 合并分片得到Buffer
    const mergeResult = await mergeImageChunks(identifier, parseInt(totalChunks), filename);
    
    if (!mergeResult.success) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: mergeResult.message || '图片分片合并失败'
      });
    }
    
    // 解析水印选项
    const applyWatermark = parseWatermarkFlag(watermark);
    let customOpacity = null;
    if (watermarkOpacity !== undefined) {
      const opacity = parseInt(watermarkOpacity, 10);
      if (!isNaN(opacity) && opacity >= 10 && opacity <= 100) {
        customOpacity = opacity;
      }
    }
    
    // 准备用户上下文（用于水印）
    const userId = req.user?.xise_id || req.user?.user_id || 'guest';
    const nickname = req.user?.nickname || '';
    const context = {
      username: nickname ? `${nickname} @${userId}` : userId,
      userId: req.user?.id,
      applyWatermark: applyWatermark,
      customOpacity: customOpacity
    };
    
    // 根据文件扩展名确定MIME类型
    const ext = path.extname(filename).toLowerCase();
    const mimeTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp'
    };
    const mimetype = mimeTypes[ext] || 'image/jpeg';
    
    // 使用统一上传函数处理图片（根据配置选择策略）
    const uploadResult = await uploadImage(
      mergeResult.buffer,
      filename,
      mimetype,
      context
    );
    
    if (uploadResult.success) {
      console.log(`✅ 图片分片上传成功 - 用户ID: ${req.user.id}, 文件名: ${filename}`);
      
      res.json({
        code: RESPONSE_CODES.SUCCESS,
        message: '图片上传成功',
        data: {
          originalname: filename,
          size: mergeResult.buffer.length,
          url: uploadResult.url
        }
      });
    } else {
      res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: uploadResult.message || '图片上传失败'
      });
    }
  } catch (error) {
    console.error('图片分片合并失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: '图片分片合并失败'
    });
  }
});

// 文件过滤器 - 附件
const attachmentFileFilter = (req, file, cb) => {
  // 检查文件类型
  const allowedTypes = config.upload.attachment?.allowedTypes || [
    'application/zip',
    'application/x-zip-compressed',
    'application/x-rar-compressed',
    'application/x-7z-compressed',
    'application/gzip',
    'application/x-tar',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain'
  ];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('不支持的附件类型'), false);
  }
};

// 配置 multer - 附件
const attachmentUpload = multer({
  storage: storage,
  fileFilter: attachmentFileFilter,
  limits: {
    fileSize: config.upload.attachment?.maxSizeBytes || 50 * 1024 * 1024 // 50MB 限制
  }
});

// 附件上传
router.post('/attachment', authenticateToken, attachmentUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '没有上传文件' });
    }

    // 获取附件存储策略
    const strategy = config.upload.attachment?.strategy || 'local';

    let result;
    if (strategy === 'local') {
      // 保存到本地
      const uploadDir = path.join(process.cwd(), config.upload.attachment?.local?.uploadDir || 'uploads/attachments');
      
      // 确保上传目录存在
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      // 生成唯一文件名
      const ext = path.extname(req.file.originalname);
      const hash = crypto.createHash('md5').update(req.file.buffer).digest('hex');
      const uniqueFilename = `${Date.now()}_${hash}${ext}`;
      const filePath = path.join(uploadDir, uniqueFilename);

      // 保存文件
      fs.writeFileSync(filePath, req.file.buffer);

      // 返回访问URL
      const baseUrl = config.upload.attachment?.local?.baseUrl || 'http://localhost:3001';
      const uploadPath = config.upload.attachment?.local?.uploadDir || 'uploads/attachments';
      result = {
        success: true,
        url: `${baseUrl}/${uploadPath}/${uniqueFilename}`
      };
    } else {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '不支持的上传策略' });
    }

    if (result.success) {
      console.log(`附件上传成功 - 用户ID: ${req.user.id}, 文件名: ${req.file.originalname}`);

      res.json({
        code: RESPONSE_CODES.SUCCESS,
        message: '上传成功',
        data: {
          originalname: req.file.originalname,
          size: req.file.size,
          url: result.url
        }
      });
    } else {
      res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: result.message || '附件上传失败' });
    }
  } catch (error) {
    console.error('附件上传失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '上传失败' });
  }
});

// 错误处理中间件
router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '文件大小超过限制（100MB）' });
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '文件数量超过限制（9个）' });
    }
  }

  if (error.message === '只允许上传图片文件' || error.message === '只允许上传视频文件' || error.message === '不支持的附件类型') {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: error.message });
  }

  console.error('文件上传错误:', error);
  res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '文件上传失败' });
});

module.exports = router;
