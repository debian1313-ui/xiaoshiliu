/**
 * 视频转码队列管理器
 * 异步处理视频转码任务，限制并发数量以避免系统资源过载
 * 
 * @author ZTMYO
 * @description 基于内存的任务队列，支持并发控制和任务状态跟踪
 */

const { convertToDash } = require('./videoTranscoder');
const { pool } = require('../config/config');
const config = require('../config/config');

class TranscodingQueue {
  constructor(maxConcurrent = null) {
    this.queue = []; // 待处理任务队列
    this.processing = new Map(); // 正在处理的任务 Map<taskId, task>
    // 使用配置中的并发数，如果没有配置则使用传入的参数或默认值2
    this.maxConcurrent = maxConcurrent ?? config.videoTranscoding.maxConcurrentTasks ?? 2;
    this.taskIdCounter = 0; // 任务ID计数器
  }

  /**
   * 添加转码任务到队列
   * @param {string} filePath - 视频文件路径
   * @param {number} userId - 用户ID
   * @param {string} originalVideoUrl - 原始视频URL
   * @returns {number} 任务ID
   */
  addTask(filePath, userId, originalVideoUrl) {
    const taskId = ++this.taskIdCounter;
    const task = {
      id: taskId,
      filePath,
      userId,
      originalVideoUrl,
      status: 'pending', // pending, processing, completed, failed
      progress: 0,
      createdAt: new Date(),
      startedAt: null,
      completedAt: null,
      error: null,
      result: null
    };

    this.queue.push(task);
    console.log(`📝 转码任务已加入队列 [ID: ${taskId}] - 队列长度: ${this.queue.length}, 处理中: ${this.processing.size}`);

    // 尝试处理队列
    this.processQueue();

    return taskId;
  }

  /**
   * 处理队列中的任务
   */
  async processQueue() {
    // 如果已达到最大并发数，不处理新任务
    if (this.processing.size >= this.maxConcurrent) {
      console.log(`⏸️ 已达到最大并发数 ${this.maxConcurrent}，等待任务完成...`);
      return;
    }

    // 如果队列为空，不需要处理
    if (this.queue.length === 0) {
      return;
    }

    // 从队列中取出第一个任务
    const task = this.queue.shift();
    task.status = 'processing';
    task.startedAt = new Date();
    this.processing.set(task.id, task);

    console.log(`🎬 开始处理转码任务 [ID: ${task.id}] - 队列剩余: ${this.queue.length}, 处理中: ${this.processing.size}`);

    try {
      // 执行转码
      const result = await convertToDash(
        task.filePath,
        task.userId,
        (progress) => {
          task.progress = progress;
          console.log(`⏳ 转码任务 [ID: ${task.id}] 进度: ${progress}%`);
        }
      );

      if (result.success) {
        task.status = 'completed';
        task.result = result;
        console.log(`✅ 转码任务完成 [ID: ${task.id}]: ${result.manifestUrl}`);

        // 更新数据库中的视频URL
        try {
          const [updateResult] = await pool.query(
            'UPDATE post_videos SET video_url = ? WHERE video_url = ?',
            [result.manifestUrl, task.originalVideoUrl]
          );

          if (updateResult.affectedRows > 0) {
            console.log(`✅ 已更新 ${updateResult.affectedRows} 条视频记录为DASH URL [ID: ${task.id}]`);
          } else {
            console.log(`⚠️ 未找到需要更新的视频记录 [ID: ${task.id}]（视频可能还未关联到帖子）`);
          }
        } catch (dbError) {
          console.error(`❌ 更新数据库视频URL失败 [ID: ${task.id}]:`, dbError.message);
        }
      } else {
        task.status = 'failed';
        task.error = result.message;
        console.error(`❌ 转码任务失败 [ID: ${task.id}]: ${result.message}`);
      }
    } catch (error) {
      task.status = 'failed';
      task.error = error.message;
      console.error(`❌ 转码任务异常 [ID: ${task.id}]:`, error);
    } finally {
      task.completedAt = new Date();
      this.processing.delete(task.id);

      // 继续处理队列中的下一个任务
      console.log(`🔄 任务完成 [ID: ${task.id}]，继续处理队列...`);
      this.processQueue();
    }
  }

  /**
   * 获取任务状态
   * @param {number} taskId - 任务ID
   * @returns {Object|null} 任务信息
   */
  getTaskStatus(taskId) {
    // 检查是否在处理中
    if (this.processing.has(taskId)) {
      return this.processing.get(taskId);
    }

    // 检查是否在队列中
    const queuedTask = this.queue.find(t => t.id === taskId);
    if (queuedTask) {
      return queuedTask;
    }

    return null;
  }

  /**
   * 获取队列统计信息
   * @returns {Object} 统计信息
   */
  getStats() {
    return {
      queueLength: this.queue.length,
      processing: this.processing.size,
      maxConcurrent: this.maxConcurrent,
      totalTasks: this.taskIdCounter,
      tasks: {
        pending: this.queue.length,
        processing: this.processing.size
      }
    };
  }
}

// 创建全局队列实例（使用配置文件中的并发数）
const transcodingQueue = new TranscodingQueue();

module.exports = transcodingQueue;
