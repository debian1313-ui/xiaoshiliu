/**
 * 视频分片上传辅助工具
 * 处理分片上传、验证、合并和清理
 * 
 * @author ZTMYO
 * @description 分片上传工具函数
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config/config');

/**
 * 确保分片临时目录存在
 * @returns {string} 临时目录路径
 */
function ensureChunkDir() {
  const chunkDir = path.join(process.cwd(), config.upload.video.chunk.tempDir);
  if (!fs.existsSync(chunkDir)) {
    fs.mkdirSync(chunkDir, { recursive: true });
  }
  return chunkDir;
}

/**
 * 获取分片目录路径
 * @param {string} identifier - 文件唯一标识符
 * @returns {string} 分片目录路径
 */
function getChunkDir(identifier) {
  const chunkDir = ensureChunkDir();
  return path.join(chunkDir, identifier);
}

/**
 * 获取分片文件路径
 * @param {string} identifier - 文件唯一标识符
 * @param {number} chunkNumber - 分片编号
 * @returns {string} 分片文件路径
 */
function getChunkPath(identifier, chunkNumber) {
  const chunkDir = getChunkDir(identifier);
  return path.join(chunkDir, `chunk_${chunkNumber}`);
}

/**
 * 保存分片文件
 * @param {Buffer} chunkBuffer - 分片数据
 * @param {string} identifier - 文件唯一标识符
 * @param {number} chunkNumber - 分片编号
 * @returns {Promise<{success: boolean, message?: string}>}
 */
async function saveChunk(chunkBuffer, identifier, chunkNumber) {
  try {
    const chunkDir = getChunkDir(identifier);
    
    // 确保分片目录存在
    if (!fs.existsSync(chunkDir)) {
      fs.mkdirSync(chunkDir, { recursive: true });
    }
    
    // 保存分片元数据（用于追踪上传时间）
    const metaPath = path.join(chunkDir, 'meta.json');
    let meta = { createdAt: Date.now(), chunks: {} };
    
    if (fs.existsSync(metaPath)) {
      try {
        meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      } catch (e) {
        // 如果解析失败，使用默认值
      }
    }
    
    // 保存分片
    const chunkPath = getChunkPath(identifier, chunkNumber);
    fs.writeFileSync(chunkPath, chunkBuffer);
    
    // 更新元数据
    meta.chunks[chunkNumber] = {
      uploadedAt: Date.now(),
      size: chunkBuffer.length
    };
    fs.writeFileSync(metaPath, JSON.stringify(meta));
    
    return { success: true };
  } catch (error) {
    console.error(`❌ 保存分片失败 [${identifier}/${chunkNumber}]:`, error.message);
    return { success: false, message: error.message };
  }
}

/**
 * 验证分片是否已存在（用于秒传/断点续传）
 * @param {string} identifier - 文件唯一标识符
 * @param {number} chunkNumber - 分片编号
 * @param {string} [expectedMd5] - 期望的MD5值（可选）
 * @returns {Promise<{exists: boolean, valid: boolean}>}
 */
async function verifyChunk(identifier, chunkNumber, expectedMd5) {
  try {
    const chunkPath = getChunkPath(identifier, chunkNumber);
    
    if (!fs.existsSync(chunkPath)) {
      return { exists: false, valid: false };
    }
    
    // 如果提供了MD5，验证分片完整性
    if (expectedMd5) {
      const chunkBuffer = fs.readFileSync(chunkPath);
      const actualMd5 = crypto.createHash('md5').update(chunkBuffer).digest('hex');
      
      if (actualMd5 !== expectedMd5) {
        // MD5不匹配，删除损坏的分片
        fs.unlinkSync(chunkPath);
        return { exists: false, valid: false };
      }
    }
    
    return { exists: true, valid: true };
  } catch (error) {
    console.error(`❌ 验证分片失败 [${identifier}/${chunkNumber}]:`, error.message);
    return { exists: false, valid: false };
  }
}

/**
 * 检查所有分片是否已上传完成
 * @param {string} identifier - 文件唯一标识符
 * @param {number} totalChunks - 总分片数
 * @returns {Promise<{complete: boolean, uploadedChunks: number[], missingChunks: number[]}>}
 */
async function checkUploadComplete(identifier, totalChunks) {
  try {
    const uploadedChunks = [];
    const missingChunks = [];
    
    for (let i = 1; i <= totalChunks; i++) {
      const chunkPath = getChunkPath(identifier, i);
      if (fs.existsSync(chunkPath)) {
        uploadedChunks.push(i);
      } else {
        missingChunks.push(i);
      }
    }
    
    return {
      complete: missingChunks.length === 0,
      uploadedChunks,
      missingChunks
    };
  } catch (error) {
    console.error(`❌ 检查上传完成状态失败 [${identifier}]:`, error.message);
    return { complete: false, uploadedChunks: [], missingChunks: [] };
  }
}

/**
 * 合并分片文件
 * @param {string} identifier - 文件唯一标识符
 * @param {number} totalChunks - 总分片数
 * @param {string} filename - 原始文件名
 * @returns {Promise<{success: boolean, filePath?: string, message?: string}>}
 */
async function mergeChunks(identifier, totalChunks, filename) {
  try {
    const chunkDir = getChunkDir(identifier);
    
    // 确保所有分片都存在
    const { complete, missingChunks } = await checkUploadComplete(identifier, totalChunks);
    if (!complete) {
      return { 
        success: false, 
        message: `分片不完整，缺少: ${missingChunks.join(', ')}` 
      };
    }
    
    // 生成输出文件路径
    const uploadDir = path.join(process.cwd(), config.upload.video.local.uploadDir);
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    
    const ext = path.extname(filename);
    const hash = crypto.createHash('md5').update(identifier + Date.now()).digest('hex');
    const uniqueFilename = `${Date.now()}_${hash}${ext}`;
    const outputPath = path.join(uploadDir, uniqueFilename);
    
    // 创建写入流
    const writeStream = fs.createWriteStream(outputPath);
    
    // 按顺序合并分片
    for (let i = 1; i <= totalChunks; i++) {
      const chunkPath = getChunkPath(identifier, i);
      const chunkBuffer = fs.readFileSync(chunkPath);
      writeStream.write(chunkBuffer);
    }
    
    // 关闭写入流
    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
      writeStream.end();
    });
    
    // 清理分片目录
    await cleanupChunkDir(identifier);
    
    console.log(`✅ 分片合并完成: ${outputPath}`);
    
    return { success: true, filePath: outputPath };
  } catch (error) {
    console.error(`❌ 合并分片失败 [${identifier}]:`, error.message);
    return { success: false, message: error.message };
  }
}

/**
 * 清理指定的分片目录
 * @param {string} identifier - 文件唯一标识符
 * @returns {Promise<boolean>}
 */
async function cleanupChunkDir(identifier) {
  try {
    const chunkDir = getChunkDir(identifier);
    
    if (fs.existsSync(chunkDir)) {
      // 使用 fs.rmSync 递归删除目录（Node.js 14.14.0+）
      fs.rmSync(chunkDir, { recursive: true, force: true });
    }
    
    return true;
  } catch (error) {
    console.error(`❌ 清理分片目录失败 [${identifier}]:`, error.message);
    return false;
  }
}

/**
 * 清理过期的分片目录（定期任务）
 * @returns {Promise<{cleaned: number, errors: number}>}
 */
async function cleanupExpiredChunks() {
  try {
    const chunkBaseDir = ensureChunkDir();
    const expireTime = config.upload.video.chunk.expireTime;
    const now = Date.now();
    
    let cleaned = 0;
    let errors = 0;
    
    if (!fs.existsSync(chunkBaseDir)) {
      return { cleaned, errors };
    }
    
    const identifiers = fs.readdirSync(chunkBaseDir);
    
    for (const identifier of identifiers) {
      try {
        const chunkDir = path.join(chunkBaseDir, identifier);
        const stat = fs.statSync(chunkDir);
        
        if (!stat.isDirectory()) continue;
        
        const metaPath = path.join(chunkDir, 'meta.json');
        let shouldClean = false;
        
        if (fs.existsSync(metaPath)) {
          try {
            const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
            if (now - meta.createdAt > expireTime) {
              shouldClean = true;
            }
          } catch (e) {
            // 元数据解析失败，根据目录修改时间判断
            if (now - stat.mtimeMs > expireTime) {
              shouldClean = true;
            }
          }
        } else {
          // 没有元数据文件，根据目录修改时间判断
          if (now - stat.mtimeMs > expireTime) {
            shouldClean = true;
          }
        }
        
        if (shouldClean) {
          const success = await cleanupChunkDir(identifier);
          if (success) {
            cleaned++;
            console.log(`🗑️ 已清理过期分片目录: ${identifier}`);
          } else {
            errors++;
          }
        }
      } catch (e) {
        errors++;
        console.error(`❌ 处理分片目录失败 [${identifier}]:`, e.message);
      }
    }
    
    if (cleaned > 0) {
      console.log(`✅ 分片清理完成: 清理 ${cleaned} 个, 错误 ${errors} 个`);
    }
    
    return { cleaned, errors };
  } catch (error) {
    console.error('❌ 清理过期分片失败:', error.message);
    return { cleaned: 0, errors: 1 };
  }
}

/**
 * 启动定期清理任务
 */
let cleanupTimer = null;

function startCleanupScheduler() {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
  }
  
  const interval = config.upload.video.chunk.cleanupInterval;
  
  console.log(`🕐 分片清理调度器已启动，间隔: ${interval / 1000 / 60} 分钟`);
  
  // 立即执行一次清理
  cleanupExpiredChunks();
  
  // 设置定期清理
  cleanupTimer = setInterval(() => {
    cleanupExpiredChunks();
  }, interval);
}

function stopCleanupScheduler() {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
    console.log('🛑 分片清理调度器已停止');
  }
}

/**
 * 合并图片分片文件
 * @param {string} identifier - 文件唯一标识符
 * @param {number} totalChunks - 总分片数
 * @param {string} filename - 原始文件名
 * @returns {Promise<{success: boolean, buffer?: Buffer, message?: string}>}
 */
async function mergeImageChunks(identifier, totalChunks, filename) {
  try {
    const chunkDir = getChunkDir(identifier);
    
    // 确保所有分片都存在
    const { complete, missingChunks } = await checkUploadComplete(identifier, totalChunks);
    if (!complete) {
      return { 
        success: false, 
        message: `分片不完整，缺少: ${missingChunks.join(', ')}` 
      };
    }
    
    // 合并所有分片到内存
    const buffers = [];
    for (let i = 1; i <= totalChunks; i++) {
      const chunkPath = getChunkPath(identifier, i);
      const chunkBuffer = fs.readFileSync(chunkPath);
      buffers.push(chunkBuffer);
    }
    
    const mergedBuffer = Buffer.concat(buffers);
    
    // 清理分片目录
    await cleanupChunkDir(identifier);
    
    console.log(`✅ 图片分片合并完成: ${filename}, 大小: ${mergedBuffer.length} bytes`);
    
    return { success: true, buffer: mergedBuffer };
  } catch (error) {
    console.error(`❌ 合并图片分片失败 [${identifier}]:`, error.message);
    return { success: false, message: error.message };
  }
}

module.exports = {
  ensureChunkDir,
  getChunkDir,
  getChunkPath,
  saveChunk,
  verifyChunk,
  checkUploadComplete,
  mergeChunks,
  mergeImageChunks,
  cleanupChunkDir,
  cleanupExpiredChunks,
  startCleanupScheduler,
  stopCleanupScheduler
};
