const express = require('express');
const router = express.Router();
const { HTTP_STATUS, RESPONSE_CODES } = require('../constants');
const multer = require('multer');
const { authenticateToken } = require('../middleware/auth');
const { uploadFile, uploadVideo } = require('../utils/uploadHelper');
const { convertToDash } = require('../utils/videoTranscoder');
const config = require('../config/config');
const { pool } = require('../config/config');

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
    fileSize: 5 * 1024 * 1024 // 5MB 限制
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
    fileSize: 100 * 1024 * 1024 // 100MB 限制
  }
});

// 单图片上传到图床
router.post('/single', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '没有上传文件' });
    }

    // 使用统一上传函数（根据配置选择策略）
    const result = await uploadFile(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype
    );

    if (result.success) {
      // 记录用户上传操作日志
      console.log(`单图片上传成功 - 用户ID: ${req.user.id}, 文件名: ${req.file.originalname}`);

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

    const uploadResults = [];
    const errors = [];

    for (const file of req.files) {
      const result = await uploadFile(
        file.buffer,
        file.originalname,
        file.mimetype
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
    console.log(`多图片上传成功 - 用户ID: ${req.user.id}, 文件数量: ${uploadResults.length}`);

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

    // 优先使用前端生成的缩略图
    if (thumbnailFile) {
      try {
        console.log('使用前端生成的缩略图');
        const thumbnailUploadResult = await uploadFile(
          thumbnailFile.buffer,
          thumbnailFile.originalname,
          thumbnailFile.mimetype
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

    // 如果启用了视频转码，且是本地存储策略，则启动DASH转码
    let dashManifestUrl = null;
    if (config.videoTranscoding.enabled && 
        config.upload.video.strategy === 'local' && 
        uploadResult.filePath) {
      try {
        console.log('🎬 启动视频DASH转码...');
        const originalVideoUrl = uploadResult.url;
        
        // 异步转码，不阻塞响应
        convertToDash(uploadResult.filePath, req.user.id, (progress) => {
          console.log(`转码进度: ${progress}%`);
        }).then(async (transcodeResult) => {
          if (transcodeResult.success) {
            console.log('✅ DASH转码完成:', transcodeResult.manifestUrl);
            
            // 直接更新数据库中的video_url为DASH manifest URL
            try {
              const [updateResult] = await pool.query(
                'UPDATE post_videos SET video_url = ? WHERE video_url = ?',
                [transcodeResult.manifestUrl, originalVideoUrl]
              );
              
              if (updateResult.affectedRows > 0) {
                console.log(`✅ 已更新 ${updateResult.affectedRows} 条视频记录，替换为DASH URL`);
              } else {
                console.log('⚠️ 未找到需要更新的视频记录（视频可能还未关联到帖子）');
              }
            } catch (dbError) {
              console.error('❌ 更新数据库视频URL失败:', dbError.message);
            }
          } else {
            console.error('❌ DASH转码失败:', transcodeResult.message);
          }
        }).catch((err) => {
          console.error('❌ DASH转码异常:', err);
        });
        
        console.log('⏳ DASH转码已在后台启动');
      } catch (error) {
        console.error('❌ 启动DASH转码失败:', error.message);
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

// 注意：使用云端图床后，文件删除由图床服务商管理

// 错误处理中间件
router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '文件大小超过限制（5MB）' });
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '文件数量超过限制（9个）' });
    }
  }

  if (error.message === '只允许上传图片文件' || error.message === '只允许上传视频文件') {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: error.message });
  }

  console.error('文件上传错误:', error);
  res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '文件上传失败' });
});

module.exports = router;