/**
 * 异步队列服务 - 使用 BullMQ 实现
 * 
 * @author ZTMYO
 * @description 基于 BullMQ 和 Redis 的异步队列服务
 *              用于处理非重要的异步操作，如 IP 属地更新、内容 AI 审核等
 */

const { Queue, Worker, QueueEvents } = require('bullmq');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

/**
 * 生成随机昵称（英文和数字组合）
 * 用于昵称审核不通过时替换
 * @returns {string} 随机昵称
 */
function generateRandomNickname() {
  const prefix = 'user';
  const randomStr = Math.random().toString(36).substring(2, 8);
  const randomNum = Math.floor(Math.random() * 1000);
  return `${prefix}_${randomStr}${randomNum}`;
}

// 队列配置
let queueConfig = {
  enabled: process.env.QUEUE_ENABLED === 'true',
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB) || 0
  },
  // 并发配置
  concurrency: {
    ipLocation: parseInt(process.env.QUEUE_IP_LOCATION_CONCURRENCY) || 5,
    contentAudit: parseInt(process.env.QUEUE_CONTENT_AUDIT_CONCURRENCY) || 3,
    generalTask: parseInt(process.env.QUEUE_GENERAL_TASK_CONCURRENCY) || 5,
    videoTranscoding: parseInt(process.env.QUEUE_VIDEO_TRANSCODING_CONCURRENCY) || 1
  },
  // 重试配置
  retry: {
    attempts: parseInt(process.env.QUEUE_RETRY_ATTEMPTS) || 3,
    backoffDelay: parseInt(process.env.QUEUE_RETRY_DELAY) || 1000
  }
};

// 获取 Redis 连接配置
const getRedisConnection = () => {
  const config = {
    host: queueConfig.redis.host,
    port: queueConfig.redis.port,
    db: queueConfig.redis.db
  };
  // 只有当密码非空时才添加
  if (queueConfig.redis.password && queueConfig.redis.password.trim()) {
    config.password = queueConfig.redis.password;
  }
  return config;
};

// 队列名称常量
const QUEUE_NAMES = {
  IP_LOCATION: 'ip-location-update',
  CONTENT_AUDIT: 'content-audit',
  AUDIT_LOG: 'audit-log',
  GENERAL_TASK: 'general-task',
  BROWSING_HISTORY: 'browsing-history',
  VIDEO_TRANSCODING: 'video-transcoding'
};

// 内容截断长度常量
const CONTENT_TRUNCATE_LENGTH = 500;

// 浏览历史配置
const BROWSING_HISTORY_CONFIG = {
  // 每用户每分钟最多写入20条
  rateLimit: 20,
  rateLimitWindow: 60 * 1000, // 1分钟（毫秒）
  // 历史记录保留时间（48小时）
  retentionHours: 48,
  // 速率限制Map清理间隔（5分钟）
  rateLimitCleanupInterval: 5 * 60 * 1000
};

// 用户浏览历史写入计数器（内存中的简单速率限制）
// 结构: Map<userId, { timestamps: number[], lastAccess: number }>
const userHistoryRateLimit = new Map();

// 定期清理过期的速率限制记录
setInterval(() => {
  const now = Date.now();
  const windowStart = now - BROWSING_HISTORY_CONFIG.rateLimitWindow;
  let cleanedCount = 0;
  
  for (const [userId, data] of userHistoryRateLimit.entries()) {
    // 如果用户超过2分钟没有访问，删除记录
    if (data.lastAccess < windowStart) {
      userHistoryRateLimit.delete(userId);
      cleanedCount++;
    }
  }
  
  if (cleanedCount > 0) {
    console.log(`🧹 清理了 ${cleanedCount} 个过期的速率限制记录`);
  }
}, BROWSING_HISTORY_CONFIG.rateLimitCleanupInterval);

// 存储所有队列实例
const queues = {};
const workers = {};
const queueEvents = {};

// 队列是否已初始化
let isInitialized = false;

/**
 * 初始化队列服务
 */
async function initQueueService() {
  if (!queueConfig.enabled) {
    console.log('● 异步队列服务未启用 (QUEUE_ENABLED=false)');
    return false;
  }

  if (isInitialized) {
    return true;
  }

  try {
    const connection = getRedisConnection();
    console.log(`● 正在连接 Redis 队列服务... (${connection.host}:${connection.port})`);

    // 创建队列实例
    for (const [key, name] of Object.entries(QUEUE_NAMES)) {
      queues[name] = new Queue(name, { connection });
      queueEvents[name] = new QueueEvents(name, { connection });
      
      // 监听队列事件
      queueEvents[name].on('completed', ({ jobId, returnvalue }) => {
        console.log(`✅ 队列任务完成 [${name}] ID: ${jobId}`);
      });

      queueEvents[name].on('failed', ({ jobId, failedReason }) => {
        console.error(`❌ 队列任务失败 [${name}] ID: ${jobId}, 原因: ${failedReason}`);
      });
    }

    // 初始化 Workers
    await initWorkers(connection);

    isInitialized = true;
    console.log('● 异步队列服务初始化成功');
    return true;
  } catch (error) {
    console.error('● 异步队列服务初始化失败:', error.message);
    console.log('● 提示: 请检查 Redis 服务是否启动，以及 REDIS_HOST, REDIS_PORT 配置是否正确');
    return false;
  }
}

/**
 * 初始化 Worker 处理器
 */
async function initWorkers(connection) {
  // IP 属地更新 Worker
  workers[QUEUE_NAMES.IP_LOCATION] = new Worker(
    QUEUE_NAMES.IP_LOCATION,
    async (job) => {
      const { userId, ip } = job.data;
      console.log(`🔄 处理 IP 属地更新任务 - 用户: ${userId}, IP: ${ip}`);
      
      try {
        const { getIPLocation } = require('./ipLocation');
        const { prisma } = require('../config/config');
        
        const location = await getIPLocation(ip);
        
        await prisma.user.update({
          where: { id: BigInt(userId) },
          data: { location }
        });
        
        console.log(`✅ IP 属地更新成功 - 用户: ${userId}, 属地: ${location}`);
        return { success: true, location };
      } catch (error) {
        console.error(`❌ IP 属地更新失败 - 用户: ${userId}`, error.message);
        throw error;
      }
    },
    { connection, concurrency: queueConfig.concurrency.ipLocation }
  );

  // 内容审核 Worker
  workers[QUEUE_NAMES.CONTENT_AUDIT] = new Worker(
    QUEUE_NAMES.CONTENT_AUDIT,
    async (job) => {
      const { content, userId, type, targetId } = job.data;
      console.log(`🔄 处理内容审核任务 - 类型: ${type}, 用户: ${userId}`);
      
      try {
        const { auditContent } = require('./contentAudit');
        const { prisma } = require('../config/config');
        
        const result = await auditContent(content, `user-${userId}`);
        
        // 如果是评论审核，更新评论状态
        if (type === 'comment' && targetId) {
          if (result.passed) {
            // 审核通过：更新状态为公开
            await prisma.comment.update({
              where: { id: BigInt(targetId) },
              data: { audit_status: 1, is_public: true }
            });
            console.log(`✅ 评论审核通过 - 评论ID: ${targetId}`);
          } else {
            // 审核不通过：删除评论（与同步审核行为一致）
            // 先获取评论信息以更新帖子评论数
            const comment = await prisma.comment.findUnique({
              where: { id: BigInt(targetId) },
              select: { post_id: true }
            });
            
            if (comment) {
              // 删除评论
              await prisma.comment.delete({
                where: { id: BigInt(targetId) }
              });
              
              // 更新帖子评论数
              await prisma.post.update({
                where: { id: comment.post_id },
                data: { comment_count: { decrement: 1 } }
              });
              
              console.log(`🗑️ 违规评论已删除 - 评论ID: ${targetId}, 原因: ${result.reason || '内容不符合社区规范'}`);
            }
          }
          
          // 创建审核记录
          await prisma.audit.create({
            data: {
              user_id: BigInt(userId),
              type: 3, // 评论审核
              target_id: BigInt(targetId),
              content: content.substring(0, CONTENT_TRUNCATE_LENGTH),
              risk_level: result.risk_level || 'unknown',
              categories: result.categories || [],
              reason: result.passed ? '审核通过' : `[AI自动审核拒绝] ${result.reason || '内容不符合社区规范'}`,
              status: result.passed ? 1 : 2,
              audit_time: new Date()
            }
          });
        }
        
        // 如果是昵称审核，审核不通过则修改为随机昵称
        if (type === 'nickname' && targetId) {
          if (result.passed) {
            console.log(`✅ 昵称审核通过 - 用户ID: ${targetId}`);
          } else {
            // 审核不通过：生成随机昵称并更新
            const randomNickname = generateRandomNickname();
            await prisma.user.update({
              where: { id: BigInt(targetId) },
              data: { nickname: randomNickname }
            });
            console.log(`⚠️ 昵称审核不通过，已修改为随机昵称 - 用户ID: ${targetId}, 新昵称: ${randomNickname}, 原因: ${result.reason || '昵称不符合社区规范'}`);
          }
          
          // 创建审核记录
          await prisma.audit.create({
            data: {
              user_id: BigInt(targetId),
              type: 4, // 昵称审核
              target_id: BigInt(targetId),
              content: content.substring(0, 100),
              risk_level: result.risk_level || 'unknown',
              categories: result.categories || [],
              reason: result.passed ? '昵称审核通过' : `[AI自动审核] 昵称不符合规范，已修改为随机昵称。原因: ${result.reason || '昵称不符合社区规范'}`,
              status: result.passed ? 1 : 2,
              audit_time: new Date()
            }
          });
        }

        // 如果是个人简介审核，审核不通过则设置bio_audit_status为2并清空bio
        if (type === 'bio' && targetId) {
          if (result.passed) {
            await prisma.user.update({
              where: { id: BigInt(targetId) },
              data: { bio_audit_status: 1 }
            });
            console.log(`✅ 个人简介审核通过 - 用户ID: ${targetId}`);
          } else {
            await prisma.user.update({
              where: { id: BigInt(targetId) },
              data: { bio: '', bio_audit_status: 2 }
            });
            console.log(`⚠️ 个人简介审核不通过，已清空简介 - 用户ID: ${targetId}, 原因: ${result.reason || '个人简介不符合社区规范'}`);
          }
          
          // 创建审核记录
          await prisma.audit.create({
            data: {
              user_id: BigInt(targetId),
              type: 5, // 个人简介审核
              target_id: BigInt(targetId),
              content: content.substring(0, CONTENT_TRUNCATE_LENGTH),
              risk_level: result.risk_level || 'unknown',
              categories: result.categories || [],
              reason: result.passed ? '个人简介审核通过' : `[AI自动审核拒绝] 个人简介不符合规范。原因: ${result.reason || '个人简介不符合社区规范'}`,
              status: result.passed ? 1 : 2,
              audit_time: new Date()
            }
          });
        }
        
        console.log(`✅ 内容审核完成 - 类型: ${type}, 结果: ${result.passed ? '通过' : '不通过'}`);
        return { success: true, result };
      } catch (error) {
        console.error(`❌ 内容审核失败 - 类型: ${type}`, error.message);
        throw error;
      }
    },
    { connection, concurrency: queueConfig.concurrency.contentAudit }
  );

  // 审核日志 Worker
  workers[QUEUE_NAMES.AUDIT_LOG] = new Worker(
    QUEUE_NAMES.AUDIT_LOG,
    async (job) => {
      const { userId, type, targetId, content, auditResult, riskLevel, categories, reason, status } = job.data;
      console.log(`🔄 处理审核日志写入任务 - 类型: ${type}, 用户: ${userId}`);
      
      try {
        const { prisma } = require('../config/config');
        
        await prisma.audit.create({
          data: {
            user_id: BigInt(userId),
            type: type,
            target_id: targetId ? BigInt(targetId) : null,
            content: content.substring(0, CONTENT_TRUNCATE_LENGTH),
            audit_result: auditResult,
            risk_level: riskLevel || 'unknown',
            categories: categories || [],
            reason: reason || '',
            status: status,
            audit_time: status !== 0 ? new Date() : null
          }
        });
        
        console.log(`✅ 审核日志写入成功 - 类型: ${type}, 用户: ${userId}`);
        return { success: true };
      } catch (error) {
        console.error(`❌ 审核日志写入失败 - 类型: ${type}`, error.message);
        throw error;
      }
    },
    { connection, concurrency: queueConfig.concurrency.generalTask }
  );

  // 通用任务 Worker
  workers[QUEUE_NAMES.GENERAL_TASK] = new Worker(
    QUEUE_NAMES.GENERAL_TASK,
    async (job) => {
      const { taskType, data } = job.data;
      console.log(`🔄 处理通用任务 - 类型: ${taskType}`);
      
      try {
        // 可以根据 taskType 执行不同的任务
        switch (taskType) {
          case 'cleanup':
            // 执行清理任务
            console.log('执行清理任务...');
            break;
          case 'notification':
            // 发送通知
            console.log('发送通知...');
            break;
          default:
            console.log(`未知任务类型: ${taskType}`);
        }
        
        return { success: true };
      } catch (error) {
        console.error(`❌ 通用任务失败 - 类型: ${taskType}`, error.message);
        throw error;
      }
    },
    { connection, concurrency: queueConfig.concurrency.generalTask }
  );

  // 浏览历史 Worker
  workers[QUEUE_NAMES.BROWSING_HISTORY] = new Worker(
    QUEUE_NAMES.BROWSING_HISTORY,
    async (job) => {
      const { userId, postId } = job.data;
      console.log(`🔄 处理浏览历史任务 - 用户: ${userId}, 笔记: ${postId}`);
      
      try {
        const { prisma } = require('../config/config');
        
        // 使用upsert来记录或更新浏览历史
        await prisma.browsingHistory.upsert({
          where: {
            uk_user_post_history: {
              user_id: BigInt(userId),
              post_id: BigInt(postId)
            }
          },
          update: {
            updated_at: new Date()
          },
          create: {
            user_id: BigInt(userId),
            post_id: BigInt(postId)
          }
        });
        
        console.log(`✅ 浏览历史记录成功 - 用户: ${userId}, 笔记: ${postId}`);
        return { success: true };
      } catch (error) {
        console.error(`❌ 浏览历史记录失败 - 用户: ${userId}`, error.message);
        throw error;
      }
    },
    { connection, concurrency: queueConfig.concurrency.generalTask }
  );

  // 视频转码 Worker
  workers[QUEUE_NAMES.VIDEO_TRANSCODING] = new Worker(
    QUEUE_NAMES.VIDEO_TRANSCODING,
    async (job) => {
      const { filePath, userId, originalVideoUrl } = job.data;
      console.log(`🔄 处理视频转码任务 - 用户: ${userId}, 文件: ${filePath}`);
      
      try {
        const { convertToDash } = require('./videoTranscoder');
        const { prisma } = require('../config/config');
        
        // 执行转码，并报告进度
        const result = await convertToDash(
          filePath,
          userId,
          async (progress) => {
            // 更新任务进度
            await job.updateProgress(progress);
            console.log(`⏳ 转码任务 [ID: ${job.id}] 进度: ${progress}%`);
          }
        );
        
        if (result.success) {
          console.log(`✅ 转码任务完成 [ID: ${job.id}]: ${result.manifestUrl}`);
          
          // 更新数据库中的视频URL
          try {
            const updateResult = await prisma.postVideo.updateMany({
              where: { video_url: originalVideoUrl },
              data: { video_url: result.manifestUrl }
            });
            
            if (updateResult.count > 0) {
              console.log(`✅ 已更新 ${updateResult.count} 条视频记录为DASH URL [ID: ${job.id}]`);
            } else {
              console.log(`⚠️ 未找到需要更新的视频记录 [ID: ${job.id}]（视频可能还未关联到帖子）`);
            }
          } catch (dbError) {
            console.error(`❌ 更新数据库视频URL失败 [ID: ${job.id}]:`, dbError.message);
          }
          
          return { success: true, manifestUrl: result.manifestUrl };
        } else {
          console.error(`❌ 转码任务失败 [ID: ${job.id}]: ${result.message}`);
          throw new Error(result.message || '转码失败');
        }
      } catch (error) {
        console.error(`❌ 视频转码失败 - 用户: ${userId}`, error.message);
        throw error;
      }
    },
    { connection, concurrency: queueConfig.concurrency.videoTranscoding }
  );

  console.log('● 队列 Workers 初始化完成');
}

/**
 * 添加 IP 属地更新任务到队列
 * @param {number} userId - 用户 ID
 * @param {string} ip - IP 地址
 */
async function addIPLocationTask(userId, ip) {
  if (!queueConfig.enabled || !isInitialized) {
    // 如果队列未启用，同步执行
    return null;
  }

  try {
    const queue = queues[QUEUE_NAMES.IP_LOCATION];
    const job = await queue.add('update-location', { userId, ip }, {
      attempts: queueConfig.retry.attempts,
      backoff: { type: 'exponential', delay: queueConfig.retry.backoffDelay },
      removeOnComplete: 100,
      removeOnFail: 50
    });
    console.log(`📝 IP 属地更新任务已加入队列 - 用户: ${userId}, 任务 ID: ${job.id}`);
    return job;
  } catch (error) {
    console.error('添加 IP 属地任务失败:', error.message);
    return null;
  }
}

/**
 * 添加内容审核任务到队列
 * @param {string} content - 待审核内容
 * @param {number} userId - 用户 ID
 * @param {string} type - 审核类型 (comment, post, nickname)
 * @param {number} targetId - 目标 ID (可选)
 */
async function addContentAuditTask(content, userId, type, targetId = null) {
  if (!queueConfig.enabled || !isInitialized) {
    return null;
  }

  try {
    const queue = queues[QUEUE_NAMES.CONTENT_AUDIT];
    const job = await queue.add('audit-content', { content, userId, type, targetId }, {
      attempts: queueConfig.retry.attempts,
      backoff: { type: 'exponential', delay: queueConfig.retry.backoffDelay * 2 },
      removeOnComplete: 100,
      removeOnFail: 50
    });
    console.log(`📝 内容审核任务已加入队列 - 类型: ${type}, 任务 ID: ${job.id}`);
    return job;
  } catch (error) {
    console.error('添加内容审核任务失败:', error.message);
    return null;
  }
}

/**
 * 添加审核日志写入任务到队列
 * @param {Object} auditData - 审核日志数据
 * @param {number} auditData.userId - 用户 ID
 * @param {number} auditData.type - 审核类型
 * @param {number} auditData.targetId - 目标 ID (可选)
 * @param {string} auditData.content - 审核内容
 * @param {Object} auditData.auditResult - 审核结果 (可选)
 * @param {string} auditData.riskLevel - 风险等级
 * @param {Array} auditData.categories - 分类
 * @param {string} auditData.reason - 原因
 * @param {number} auditData.status - 状态 (0:待审核 1:通过 2:拒绝)
 */
async function addAuditLogTask(auditData) {
  if (!queueConfig.enabled || !isInitialized) {
    // 队列未启用时，同步写入
    try {
      const { prisma } = require('../config/config');
      await prisma.audit.create({
        data: {
          user_id: BigInt(auditData.userId),
          type: auditData.type,
          target_id: auditData.targetId ? BigInt(auditData.targetId) : null,
          content: auditData.content.substring(0, CONTENT_TRUNCATE_LENGTH),
          audit_result: auditData.auditResult,
          risk_level: auditData.riskLevel || 'unknown',
          categories: auditData.categories || [],
          reason: auditData.reason || '',
          status: auditData.status,
          audit_time: auditData.status !== 0 ? new Date() : null
        }
      });
      console.log(`📝 审核日志同步写入成功 - 类型: ${auditData.type}, 用户: ${auditData.userId}`);
    } catch (error) {
      console.error('审核日志同步写入失败:', error.message);
    }
    return null;
  }

  try {
    const queue = queues[QUEUE_NAMES.AUDIT_LOG];
    const job = await queue.add('write-audit-log', auditData, {
      attempts: queueConfig.retry.attempts,
      backoff: { type: 'exponential', delay: queueConfig.retry.backoffDelay },
      removeOnComplete: 100,
      removeOnFail: 50
    });
    console.log(`📝 审核日志任务已加入队列 - 类型: ${auditData.type}, 任务 ID: ${job.id}`);
    return job;
  } catch (error) {
    console.error('添加审核日志任务失败:', error.message);
    return null;
  }
}

/**
 * 添加通用任务到队列
 * @param {string} taskType - 任务类型
 * @param {object} data - 任务数据
 */
async function addGeneralTask(taskType, data = {}) {
  if (!queueConfig.enabled || !isInitialized) {
    return null;
  }

  try {
    const queue = queues[QUEUE_NAMES.GENERAL_TASK];
    const job = await queue.add(taskType, { taskType, data }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: 100,
      removeOnFail: 50
    });
    return job;
  } catch (error) {
    console.error('添加通用任务失败:', error.message);
    return null;
  }
}

/**
 * 添加视频转码任务到队列
 * @param {string} filePath - 视频文件路径
 * @param {number|string} userId - 用户 ID
 * @param {string} originalVideoUrl - 原始视频URL
 * @returns {Object|null} - 返回任务对象或null
 */
async function addVideoTranscodingTask(filePath, userId, originalVideoUrl) {
  if (!queueConfig.enabled || !isInitialized) {
    // 如果队列未启用，使用原有的内存队列处理
    console.log('⚠️ 队列服务未启用，视频转码将使用内存队列');
    return null;
  }

  try {
    const queue = queues[QUEUE_NAMES.VIDEO_TRANSCODING];
    const job = await queue.add('transcode-video', { filePath, userId: String(userId), originalVideoUrl }, {
      attempts: queueConfig.retry.attempts,
      backoff: { type: 'exponential', delay: queueConfig.retry.backoffDelay * 2 },
      removeOnComplete: 100,
      removeOnFail: 50
    });
    console.log(`📝 视频转码任务已加入队列 - 用户: ${userId}, 任务 ID: ${job.id}`);
    return job;
  } catch (error) {
    console.error('添加视频转码任务失败:', error.message);
    return null;
  }
}

/**
 * 检查用户浏览历史写入速率限制
 * @param {number|string} userId - 用户 ID
 * @returns {boolean} - 是否在限制内（true表示可以写入）
 */
function checkBrowsingHistoryRateLimit(userId) {
  const key = String(userId);
  const now = Date.now();
  const windowStart = now - BROWSING_HISTORY_CONFIG.rateLimitWindow;
  
  // 获取用户的写入记录
  let userData = userHistoryRateLimit.get(key) || { timestamps: [], lastAccess: now };
  
  // 清理过期的记录
  userData.timestamps = userData.timestamps.filter(timestamp => timestamp > windowStart);
  userData.lastAccess = now;
  
  // 检查是否超过限制
  if (userData.timestamps.length >= BROWSING_HISTORY_CONFIG.rateLimit) {
    userHistoryRateLimit.set(key, userData);
    return false;
  }
  
  // 添加新记录
  userData.timestamps.push(now);
  userHistoryRateLimit.set(key, userData);
  
  return true;
}

/**
 * 添加浏览历史任务到队列
 * @param {number|string} userId - 用户 ID
 * @param {number|string} postId - 笔记 ID
 * @returns {Object|null} - 返回任务对象或null（如果被限流或队列未启用）
 */
async function addBrowsingHistoryTask(userId, postId) {
  // 检查速率限制
  if (!checkBrowsingHistoryRateLimit(userId)) {
    console.log(`⚠️ 用户 ${userId} 浏览历史写入已达到速率限制 (${BROWSING_HISTORY_CONFIG.rateLimit}条/分钟)`);
    return { rateLimited: true };
  }
  
  // 如果队列未启用，同步执行
  if (!queueConfig.enabled || !isInitialized) {
    try {
      const { prisma } = require('../config/config');
      await prisma.browsingHistory.upsert({
        where: {
          uk_user_post_history: {
            user_id: BigInt(userId),
            post_id: BigInt(postId)
          }
        },
        update: {
          updated_at: new Date()
        },
        create: {
          user_id: BigInt(userId),
          post_id: BigInt(postId)
        }
      });
      console.log(`📝 浏览历史同步写入成功 - 用户: ${userId}, 笔记: ${postId}`);
      return { success: true, sync: true };
    } catch (error) {
      console.error('浏览历史同步写入失败:', error.message);
      return null;
    }
  }

  try {
    const queue = queues[QUEUE_NAMES.BROWSING_HISTORY];
    const job = await queue.add('record-history', { userId: String(userId), postId: String(postId) }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: 100,
      removeOnFail: 50
    });
    console.log(`📝 浏览历史任务已加入队列 - 用户: ${userId}, 笔记: ${postId}, 任务 ID: ${job.id}`);
    return job;
  } catch (error) {
    console.error('添加浏览历史任务失败:', error.message);
    return null;
  }
}

/**
 * 清理过期的浏览历史记录（超过48小时）
 * @returns {Object} - 返回清理结果
 */
async function cleanupExpiredBrowsingHistory() {
  try {
    const { prisma } = require('../config/config');
    const cutoffTime = new Date(Date.now() - BROWSING_HISTORY_CONFIG.retentionHours * 60 * 60 * 1000);
    
    const result = await prisma.browsingHistory.deleteMany({
      where: {
        updated_at: {
          lt: cutoffTime
        }
      }
    });
    
    console.log(`🗑️ 清理过期浏览历史完成 - 删除了 ${result.count} 条记录（超过 ${BROWSING_HISTORY_CONFIG.retentionHours} 小时）`);
    return { success: true, deletedCount: result.count };
  } catch (error) {
    console.error('清理过期浏览历史失败:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * 获取队列统计信息
 */
async function getQueueStats() {
  if (!queueConfig.enabled || !isInitialized) {
    return { enabled: false, queues: [] };
  }

  const stats = [];
  for (const [name, queue] of Object.entries(queues)) {
    try {
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        queue.getWaitingCount(),
        queue.getActiveCount(),
        queue.getCompletedCount(),
        queue.getFailedCount(),
        queue.getDelayedCount()
      ]);

      stats.push({
        name,
        waiting,
        active,
        completed,
        failed,
        delayed,
        total: waiting + active + delayed
      });
    } catch (error) {
      console.error(`获取队列 ${name} 统计失败:`, error.message);
      stats.push({ name, error: error.message });
    }
  }

  return { enabled: true, queues: stats };
}

/**
 * 获取队列中的任务列表
 * @param {string} queueName - 队列名称
 * @param {string} status - 任务状态 (waiting, active, completed, failed, delayed)
 * @param {number} start - 起始位置
 * @param {number} end - 结束位置
 */
async function getQueueJobs(queueName, status = 'waiting', start = 0, end = 20) {
  if (!queueConfig.enabled || !isInitialized) {
    return { enabled: false, jobs: [] };
  }

  const queue = queues[queueName];
  if (!queue) {
    return { enabled: true, error: '队列不存在', jobs: [] };
  }

  try {
    let jobs;
    switch (status) {
      case 'waiting':
        jobs = await queue.getWaiting(start, end);
        break;
      case 'active':
        jobs = await queue.getActive(start, end);
        break;
      case 'completed':
        jobs = await queue.getCompleted(start, end);
        break;
      case 'failed':
        jobs = await queue.getFailed(start, end);
        break;
      case 'delayed':
        jobs = await queue.getDelayed(start, end);
        break;
      default:
        jobs = await queue.getWaiting(start, end);
    }

    return {
      enabled: true,
      jobs: jobs.map(job => {
        // 计算处理时间和响应时间
        const enqueuedAt = job.timestamp;
        const processedOn = job.processedOn;
        const finishedOn = job.finishedOn;
        
        // 计算等待时间（入队到开始处理）
        let waitTimeSeconds = null;
        if (processedOn && enqueuedAt) {
          waitTimeSeconds = ((processedOn - enqueuedAt) / 1000).toFixed(1);
        }
        
        // 计算处理时间（开始处理到完成）
        let processTimeSeconds = null;
        if (finishedOn && processedOn) {
          processTimeSeconds = ((finishedOn - processedOn) / 1000).toFixed(1);
        }
        
        // 计算总耗时（入队到完成）
        let totalTimeSeconds = null;
        if (finishedOn && enqueuedAt) {
          totalTimeSeconds = ((finishedOn - enqueuedAt) / 1000).toFixed(1);
        }
        
        return {
          id: job.id,
          name: job.name,
          data: job.data,
          timestamp: enqueuedAt,
          processedOn: processedOn,
          finishedOn: finishedOn,
          attempts: job.attemptsMade,
          failedReason: job.failedReason,
          // 包含任务返回结果（如AI审核结果）
          returnValue: job.returnvalue || null,
          // 时间统计
          timing: {
            waitTimeSeconds,      // 等待时间（入队到开始处理）
            processTimeSeconds,   // 处理时间（开始处理到完成）
            totalTimeSeconds      // 总耗时（入队到完成）
          }
        };
      })
    };
  } catch (error) {
    console.error(`获取队列 ${queueName} 任务列表失败:`, error.message);
    return { enabled: true, error: error.message, jobs: [] };
  }
}

/**
 * 重试失败的任务
 * @param {string} queueName - 队列名称
 * @param {string} jobId - 任务 ID
 */
async function retryJob(queueName, jobId) {
  if (!queueConfig.enabled || !isInitialized) {
    return { success: false, message: '队列服务未启用' };
  }

  const queue = queues[queueName];
  if (!queue) {
    return { success: false, message: '队列不存在' };
  }

  try {
    const job = await queue.getJob(jobId);
    if (!job) {
      return { success: false, message: '任务不存在' };
    }

    await job.retry();
    return { success: true, message: '任务已重新加入队列' };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

/**
 * 清空队列中的所有任务
 * @param {string} queueName - 队列名称
 */
async function cleanQueue(queueName) {
  if (!queueConfig.enabled || !isInitialized) {
    return { success: false, message: '队列服务未启用' };
  }

  const queue = queues[queueName];
  if (!queue) {
    return { success: false, message: '队列不存在' };
  }

  try {
    await queue.obliterate({ force: true });
    return { success: true, message: '队列已清空' };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

/**
 * 检查队列服务是否启用
 */
function isQueueEnabled() {
  return queueConfig.enabled && isInitialized;
}

/**
 * 获取单个任务的详细信息
 * @param {string} queueName - 队列名称
 * @param {string} jobId - 任务 ID
 */
async function getJobDetails(queueName, jobId) {
  if (!queueConfig.enabled || !isInitialized) {
    return { enabled: false, job: null };
  }

  const queue = queues[queueName];
  if (!queue) {
    return { enabled: true, error: '队列不存在', job: null };
  }

  try {
    const job = await queue.getJob(jobId);
    if (!job) {
      return { enabled: true, error: '任务不存在', job: null };
    }

    const state = await job.getState();
    
    return {
      enabled: true,
      job: {
        id: job.id,
        name: job.name,
        data: job.data,
        timestamp: job.timestamp,
        processedOn: job.processedOn,
        finishedOn: job.finishedOn,
        attempts: job.attemptsMade,
        failedReason: job.failedReason,
        returnValue: job.returnvalue || null,
        state: state,
        progress: job.progress,
        stacktrace: job.stacktrace || []
      }
    };
  } catch (error) {
    console.error(`获取任务 ${jobId} 详情失败:`, error.message);
    return { enabled: true, error: error.message, job: null };
  }
}

/**
 * 关闭队列服务
 */
async function closeQueueService() {
  if (!isInitialized) {
    return;
  }

  try {
    // 关闭所有 Workers
    for (const [name, worker] of Object.entries(workers)) {
      await worker.close();
    }

    // 关闭所有 QueueEvents
    for (const [name, events] of Object.entries(queueEvents)) {
      await events.close();
    }

    // 关闭所有队列
    for (const [name, queue] of Object.entries(queues)) {
      await queue.close();
    }

    isInitialized = false;
    console.log('● 异步队列服务已关闭');
  } catch (error) {
    console.error('关闭队列服务失败:', error.message);
  }
}

module.exports = {
  initQueueService,
  addIPLocationTask,
  addContentAuditTask,
  addAuditLogTask,
  addGeneralTask,
  addVideoTranscodingTask,
  addBrowsingHistoryTask,
  cleanupExpiredBrowsingHistory,
  getQueueStats,
  getQueueJobs,
  getJobDetails,
  retryJob,
  cleanQueue,
  isQueueEnabled,
  closeQueueService,
  generateRandomNickname,
  QUEUE_NAMES,
  BROWSING_HISTORY_CONFIG
};
