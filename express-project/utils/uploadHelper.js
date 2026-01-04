const axios = require('axios');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { HTTP_STATUS, RESPONSE_CODES } = require('../constants');
const config = require('../config/config');
const crypto = require('crypto');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { processImage, generateWebpFilename, shouldConvert } = require('./webpOptimizer');

/**
 * 处理图片文件（WebP转换和水印）
 * @param {Buffer} fileBuffer - 文件缓冲区
 * @param {string} filename - 文件名
 * @param {string} mimetype - 文件MIME类型
 * @param {Object} context - 上下文（包含用户信息等）
 * @returns {Promise<{buffer: Buffer, filename: string, mimetype: string}>}
 */
async function processImageFile(fileBuffer, filename, mimetype, context = {}) {
  try {
    const result = await processImage(fileBuffer, mimetype, context);
    
    if (result.processed) {
      // 如果处理成功且转换为WebP，更新文件名
      let newFilename = filename;
      if (result.mimetype === 'image/webp' && shouldConvert(mimetype)) {
        newFilename = generateWebpFilename(filename);
      }
      
      return {
        buffer: result.buffer,
        filename: newFilename,
        mimetype: result.mimetype
      };
    }
    
    // 如果没有处理，返回原始数据
    return {
      buffer: fileBuffer,
      filename: filename,
      mimetype: mimetype
    };
  } catch (error) {
    console.error('❌ 图片处理失败:', error.message);
    // 处理失败时返回原始数据
    return {
      buffer: fileBuffer,
      filename: filename,
      mimetype: mimetype
    };
  }
}

/**
 * 保存图片文件到本地
 * @param {Buffer} fileBuffer - 文件缓冲区
 * @param {string} filename - 文件名
 * @param {string} mimetype - 文件MIME类型（可选）
 * @param {Object} context - 上下文（可选，包含用户信息等）
 * @returns {Promise<{success: boolean, url?: string, message?: string}>}
 */
async function saveImageToLocal(fileBuffer, filename, mimetype = null, context = {}) {
  try {
    // 如果提供了mimetype，先处理图片（WebP转换和水印）
    let processedBuffer = fileBuffer;
    let processedFilename = filename;
    
    if (mimetype && mimetype.startsWith('image/')) {
      const processed = await processImageFile(fileBuffer, filename, mimetype, context);
      processedBuffer = processed.buffer;
      processedFilename = processed.filename;
    }
    
    // 确保上传目录存在
    const uploadDir = path.join(process.cwd(), config.upload.image.local.uploadDir);
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    // 生成唯一文件名
    const ext = path.extname(processedFilename);
    const hash = crypto.createHash('md5').update(processedBuffer).digest('hex');
    const uniqueFilename = `${Date.now()}_${hash}${ext}`;
    const filePath = path.join(uploadDir, uniqueFilename);

    // 保存文件
    fs.writeFileSync(filePath, processedBuffer);

    // 返回访问URL
    const url = `${config.upload.image.local.baseUrl}/${config.upload.image.local.uploadDir}/${uniqueFilename}`;
    return {
      success: true,
      url: url
    };
  } catch (error) {
    console.error('❌ 图片本地保存失败:', error.message);
    return {
      success: false,
      message: error.message || '图片本地保存失败'
    };
  }
}

/**
 * 保存视频文件到本地
 * @param {Buffer} fileBuffer - 文件缓冲区
 * @param {string} filename - 文件名
 * @returns {Promise<{success: boolean, url?: string, message?: string}>}
 */
async function saveVideoToLocal(fileBuffer, filename) {
  try {
    // 确保上传目录存在
    const uploadDir = path.join(process.cwd(), config.upload.video.local.uploadDir);
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    // 生成唯一文件名
    const ext = path.extname(filename);
    const hash = crypto.createHash('md5').update(fileBuffer).digest('hex');
    const uniqueFilename = `${Date.now()}_${hash}${ext}`;
    const filePath = path.join(uploadDir, uniqueFilename);

    // 保存文件
    fs.writeFileSync(filePath, fileBuffer);

    // 返回访问URL和文件路径
    const url = `${config.upload.video.local.baseUrl}/${config.upload.video.local.uploadDir}/${uniqueFilename}`;
    return {
      success: true,
      url: url,
      filePath: filePath
    };
  } catch (error) {
    console.error('❌ 视频本地保存失败:', error.message);
    return {
      success: false,
      message: error.message || '视频本地保存失败'
    };
  }
}

/**
 * 上传文件到图床
 * @param {Buffer} fileBuffer - 文件缓冲区
 * @param {string} filename - 文件名
 * @param {string} mimetype - 文件MIME类型
 * @param {Object} context - 上下文（可选，包含用户信息等）
 * @returns {Promise<{success: boolean, url?: string, message?: string}>}
 */
async function uploadToImageHost(fileBuffer, filename, mimetype, context = {}) {
  try {
    // 检查配置是否存在
    if (!config.upload || !config.upload.image || !config.upload.image.imagehost || !config.upload.image.imagehost.apiUrl) {
      console.error('❌ 图床配置不完整:', config.upload?.image?.imagehost);
      return {
        success: false,
        message: '图床配置不完整，缺少apiUrl'
      };
    }

    // 先处理图片（WebP转换和水印）
    let processedBuffer = fileBuffer;
    let processedFilename = filename;
    let processedMimetype = mimetype;
    
    if (mimetype && mimetype.startsWith('image/')) {
      const processed = await processImageFile(fileBuffer, filename, mimetype, context);
      processedBuffer = processed.buffer;
      processedFilename = processed.filename;
      processedMimetype = processed.mimetype;
    }

    // 构建multipart/form-data请求体
    const boundary = `----formdata-${Date.now()}`;

    const formDataBody = Buffer.concat([
      Buffer.from(`--${boundary}\r\n`),
      Buffer.from(`Content-Disposition: form-data; name="file"; filename="${processedFilename}"\r\n`),
      Buffer.from(`Content-Type: ${processedMimetype}\r\n\r\n`),
      processedBuffer,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);

    // 上传到图床
    const response = await axios.post(config.upload.image.imagehost.apiUrl, formDataBody, {
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': formDataBody.length
      },
      timeout: config.upload.image.imagehost.timeout,
      httpsAgent: new https.Agent({
        rejectUnauthorized: false
      })
    });

    if (response.data && response.data.errno === 0 && response.data.data && response.data.data.url) {
      const imageUrl = response.data.data.url.trim().replace(/\`/g, '').replace(/\s+/g, '');
      return {
        success: true,
        url: imageUrl
      };
    } else {
      console.log('❌ 图床返回错误:', response.data);
      return {
        success: false,
        message: '图床上传失败'
      };
    }
  } catch (error) {
    console.error('❌ 图床上传失败:', error.message);
    return {
      success: false,
      message: error.message || '图床上传失败'
    };
  }
}


/**
 * 上传图片到 Cloudflare R2
 * @param {Buffer} fileBuffer - 文件缓冲区
 * @param {string} filename - 文件名
 * @param {string} mimetype - 文件MIME类型
 * @param {Object} context - 上下文（可选，包含用户信息等）
 * @returns {Promise<{success: boolean, url?: string, message?: string}>}
 */
async function uploadImageToR2(fileBuffer, filename, mimetype, context = {}) {
  try {
    const r2Config = config.upload.image.r2;
    
    // 验证必要的配置
    if (!r2Config.accessKeyId || !r2Config.secretAccessKey || !r2Config.bucketName || !r2Config.endpoint) {
      throw new Error('Cloudflare R2 配置不完整');
    }

    // 先处理图片（WebP转换和水印）
    let processedBuffer = fileBuffer;
    let processedFilename = filename;
    let processedMimetype = mimetype;
    
    if (mimetype && mimetype.startsWith('image/')) {
      const processed = await processImageFile(fileBuffer, filename, mimetype, context);
      processedBuffer = processed.buffer;
      processedFilename = processed.filename;
      processedMimetype = processed.mimetype;
    }

    // 创建 S3 客户端（Cloudflare R2 兼容 S3 API）
    const s3Client = new S3Client({
      region: r2Config.region,
      endpoint: r2Config.endpoint,
      credentials: {
        accessKeyId: r2Config.accessKeyId,
        secretAccessKey: r2Config.secretAccessKey,
      },
    });

    // 生成唯一文件名
    const ext = path.extname(processedFilename);
    const hash = crypto.createHash('md5').update(processedBuffer).digest('hex');
    const uniqueFilename = `images/${Date.now()}_${hash}${ext}`;

    // 上传参数
    const uploadParams = {
      Bucket: r2Config.bucketName,
      Key: uniqueFilename,
      Body: processedBuffer,
      ContentType: processedMimetype,
    };

    // 执行上传
    const command = new PutObjectCommand(uploadParams);
    await s3Client.send(command);

    // 构建访问URL
    let fileUrl;
    if (r2Config.publicUrl) {
      // 使用自定义域名
      fileUrl = `${r2Config.publicUrl}/${uniqueFilename}`;
    } else {
      // 使用默认的 R2 公共URL格式
      const accountId = r2Config.accountId;
      fileUrl = `https://pub-${accountId}.r2.dev/${uniqueFilename}`;
    }

    return {
      success: true,
      url: fileUrl
    };
  } catch (error) {
    console.error('Cloudflare R2 图片上传失败:', error.message);
    return {
      success: false,
      message: error.message || 'Cloudflare R2 图片上传失败'
    };
  }
}

/**
 * 上传视频到 Cloudflare R2
 * @param {Buffer} fileBuffer - 文件缓冲区
 * @param {string} filename - 文件名
 * @param {string} mimetype - 文件MIME类型
 * @returns {Promise<{success: boolean, url?: string, message?: string}>}
 */
async function uploadVideoToR2(fileBuffer, filename, mimetype) {
  try {
    const r2Config = config.upload.video.r2;
    
    // 验证必要的配置
    if (!r2Config.accessKeyId || !r2Config.secretAccessKey || !r2Config.bucketName || !r2Config.endpoint) {
      throw new Error('Cloudflare R2 配置不完整');
    }

    // 创建 S3 客户端（Cloudflare R2 兼容 S3 API）
    const s3Client = new S3Client({
      region: r2Config.region,
      endpoint: r2Config.endpoint,
      credentials: {
        accessKeyId: r2Config.accessKeyId,
        secretAccessKey: r2Config.secretAccessKey,
      },
    });

    // 生成唯一文件名
    const ext = path.extname(filename);
    const hash = crypto.createHash('md5').update(fileBuffer).digest('hex');
    const uniqueFilename = `videos/${Date.now()}_${hash}${ext}`;

    // 上传参数
    const uploadParams = {
      Bucket: r2Config.bucketName,
      Key: uniqueFilename,
      Body: fileBuffer,
      ContentType: mimetype,
    };

    // 执行上传
    const command = new PutObjectCommand(uploadParams);
    await s3Client.send(command);

    // 构建访问URL
    let fileUrl;
    if (r2Config.publicUrl) {
      // 使用自定义域名
      fileUrl = `${r2Config.publicUrl}/${uniqueFilename}`;
    } else {
      // 使用默认的 R2 公共URL格式
      const accountId = r2Config.accountId;
      fileUrl = `https://pub-${accountId}.r2.dev/${uniqueFilename}`;
    }

    return {
      success: true,
      url: fileUrl
    };
  } catch (error) {
    console.error('Cloudflare R2 视频上传失败:', error.message);
    return {
      success: false,
      message: error.message || 'Cloudflare R2 视频上传失败'
    };
  }
}

/**
 * 从文件路径上传到图床
 * @param {string} filePath - 文件路径
 * @param {string} originalname - 原始文件名
 * @param {string} mimetype - 文件MIME类型
 * @param {boolean} deleteAfterUpload - 上传后是否删除本地文件
 * @returns {Promise<{success: boolean, url?: string, message?: string}>}
 */
async function uploadFileToImageHost(filePath, originalname, mimetype, deleteAfterUpload = true) {
  try {
    // 读取文件
    const fileBuffer = fs.readFileSync(filePath);
    const filename = originalname || path.basename(filePath);

    const result = await uploadToImageHost(fileBuffer, filename, mimetype);

    // 上传成功后删除本地文件
    if (result.success && deleteAfterUpload && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    return result;
  } catch (error) {
    console.error('❌ 图片上传失败:', error.message);
    // 确保删除临时文件
    if (deleteAfterUpload && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    return {
      success: false,
      message: error.message || '图片上传失败'
    };
  }
}

/**
 * 管理员权限验证中间件
 * @param {Object} req - 请求对象
 * @param {Object} res - 响应对象
 * @param {Function} next - 下一个中间件函数
 */
function adminAuth(req, res, next) {
  const { authenticateToken } = require('../middleware/auth');

  authenticateToken(req, res, (err) => {
    if (err) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        code: RESPONSE_CODES.UNAUTHORIZED,
        message: '认证失败'
      });
    }

    if (!req.user.type || req.user.type !== 'admin') {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        code: RESPONSE_CODES.FORBIDDEN,
        message: '权限不足，需要管理员权限'
      });
    }

    next();
  });
}

/**
 * 统一上传接口 - 根据配置选择上传策略
 * @param {Buffer} fileBuffer - 文件缓冲区
 * @param {string} filename - 文件名
 * @param {string} mimetype - 文件MIME类型
 * @param {Object} context - 上下文（可选，包含用户信息等）
 * @returns {Promise<{success: boolean, url?: string, message?: string}>}
 */
/**
 * 上传图片文件
 * @param {Buffer} fileBuffer - 文件缓冲区
 * @param {string} filename - 文件名
 * @param {string} mimetype - 文件MIME类型
 * @param {Object} context - 上下文（可选，包含用户信息等）
 * @returns {Promise<{success: boolean, url?: string, message?: string}>}
 */
async function uploadImage(fileBuffer, filename, mimetype, context = {}) {
  const strategy = config.upload.image.strategy;
  
  if (strategy === 'local') {
    return await saveImageToLocal(fileBuffer, filename, mimetype, context);
  } else if (strategy === 'imagehost') {
    return await uploadToImageHost(fileBuffer, filename, mimetype, context);
  } else if (strategy === 'r2') {
    return await uploadImageToR2(fileBuffer, filename, mimetype, context);
  } else {
    return {
      success: false,
      message: '未知的图片上传策略'
    };
  }
}

/**
 * 上传视频文件
 * @param {Buffer} fileBuffer - 文件缓冲区
 * @param {string} filename - 文件名
 * @param {string} mimetype - 文件MIME类型
 * @returns {Promise<{success: boolean, url?: string, filePath?: string, message?: string}>}
 */
async function uploadVideo(fileBuffer, filename, mimetype) {
  const strategy = config.upload.video.strategy;
  
  if (strategy === 'local') {
    return await saveVideoToLocal(fileBuffer, filename);
  } else if (strategy === 'r2') {
    return await uploadVideoToR2(fileBuffer, filename, mimetype);
  } else {
    return {
      success: false,
      message: '未知的视频上传策略'
    };
  }
}

// 保持向后兼容的旧函数
async function uploadFile(fileBuffer, filename, mimetype, context = {}) {
  // 根据文件类型判断是图片还是视频
  if (mimetype.startsWith('image/')) {
    return await uploadImage(fileBuffer, filename, mimetype, context);
  } else if (mimetype.startsWith('video/')) {
    return await uploadVideo(fileBuffer, filename, mimetype);
  } else {
    return {
      success: false,
      message: '不支持的文件类型'
    };
  }
}

/**
 * 保存附件文件到本地
 * @param {Buffer} fileBuffer - 文件缓冲区
 * @param {string} filename - 文件名
 * @param {string} mimetype - 文件MIME类型
 * @returns {Promise<{success: boolean, url?: string, filePath?: string, message?: string}>}
 */
async function saveAttachmentToLocal(fileBuffer, filename, mimetype) {
  try {
    // 确保上传目录存在
    const uploadDir = path.join(process.cwd(), config.upload.attachment.local.uploadDir);
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    // 生成唯一文件名（保留原始扩展名）
    const ext = path.extname(filename);
    const hash = crypto.createHash('md5').update(fileBuffer).digest('hex');
    const uniqueFilename = `${Date.now()}_${hash}${ext}`;
    const filePath = path.join(uploadDir, uniqueFilename);

    // 保存文件
    fs.writeFileSync(filePath, fileBuffer);

    // 返回访问URL和文件路径
    // 使用 URL 构造函数安全地构建 URL，避免路径拼接问题
    const baseUrl = config.upload.attachment.local.baseUrl.replace(/\/+$/, '');
    const uploadDirPath = config.upload.attachment.local.uploadDir.replace(/^\/+/, '').replace(/\/+$/, '');
    const url = `${baseUrl}/${uploadDirPath}/${uniqueFilename}`;
    return {
      success: true,
      url: url,
      filePath: filePath,
      filename: uniqueFilename,
      originalFilename: filename
    };
  } catch (error) {
    console.error('❌ 附件本地保存失败:', error.message);
    return {
      success: false,
      message: error.message || '附件本地保存失败'
    };
  }
}

/**
 * 上传附件文件
 * @param {Buffer} fileBuffer - 文件缓冲区
 * @param {string} filename - 文件名
 * @param {string} mimetype - 文件MIME类型
 * @returns {Promise<{success: boolean, url?: string, filePath?: string, message?: string}>}
 */
async function uploadAttachment(fileBuffer, filename, mimetype) {
  // 目前只支持本地存储
  return await saveAttachmentToLocal(fileBuffer, filename, mimetype);
}

/**
 * 获取附件文件路径
 * @param {string} filename - 文件名
 * @returns {string} 文件路径
 */
function getAttachmentFilePath(filename) {
  return path.join(process.cwd(), config.upload.attachment.local.uploadDir, filename);
}

/**
 * 检查附件文件是否存在
 * @param {string} filename - 文件名
 * @returns {boolean}
 */
function attachmentExists(filename) {
  const filePath = getAttachmentFilePath(filename);
  return fs.existsSync(filePath);
}

module.exports = {
  uploadToImageHost,
  uploadFileToImageHost,
  saveImageToLocal,
  saveVideoToLocal,
  uploadImageToR2,
  uploadVideoToR2,
  uploadImage,
  uploadVideo,
  uploadFile,
  adminAuth,
  processImageFile,
  saveAttachmentToLocal,
  uploadAttachment,
  getAttachmentFilePath,
  attachmentExists
};