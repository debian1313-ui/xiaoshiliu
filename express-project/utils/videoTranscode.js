/**
 * 视频转码工具 - 使用 FFmpeg 进行 DASH 编码
 * 支持动态码率配置
 * 支持从 .env 配置 FFmpeg 二进制文件路径
 * 支持转码队列管理和进度可视化
 * 支持输出目录日期时间组织
 */

const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const config = require('../config/config');
const { pool } = config;
const { EventEmitter } = require('events');

// 转码队列管理器
class TranscodeQueueManager extends EventEmitter {
  constructor() {
    super();
    this.queue = [];           // 待处理队列
    this.activeJobs = new Map(); // 正在处理的任务 { taskId: jobInfo }
    this.completedJobs = [];   // 已完成任务（保留最近100个）
    this.maxConcurrent = 2;    // 默认最大并发数
    this.taskIdCounter = 0;
    this.isProcessing = false;
  }

  /**
   * 设置最大并发任务数
   * @param {number} count - 并发数
   */
  setMaxConcurrent(count) {
    this.maxConcurrent = Math.max(1, Math.min(10, count));
    this.emit('configChanged', { maxConcurrent: this.maxConcurrent });
    this._processQueue();
  }

  /**
   * 获取当前最大并发数
   * @returns {number} 最大并发数
   */
  getMaxConcurrent() {
    return this.maxConcurrent;
  }

  /**
   * 添加转码任务到队列
   * @param {Object} job - 任务信息
   * @returns {string} 任务ID
   */
  addJob(job) {
    const taskId = `task_${Date.now()}_${++this.taskIdCounter}`;
    const jobInfo = {
      taskId,
      ...job,
      status: 'pending',
      progress: 0,
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      error: null
    };
    this.queue.push(jobInfo);
    this.emit('jobAdded', jobInfo);
    this._processQueue();
    return taskId;
  }

  /**
   * 获取任务状态
   * @param {string} taskId - 任务ID
   * @returns {Object|null} 任务信息
   */
  getJobStatus(taskId) {
    // 先查找活动任务
    if (this.activeJobs.has(taskId)) {
      return this.activeJobs.get(taskId);
    }
    // 查找队列中的任务
    const queuedJob = this.queue.find(j => j.taskId === taskId);
    if (queuedJob) return queuedJob;
    // 查找已完成任务
    return this.completedJobs.find(j => j.taskId === taskId) || null;
  }

  /**
   * 设置任务的关联postId
   * @param {string} taskId - 任务ID
   * @param {number} postId - 帖子ID
   * @returns {boolean} 是否设置成功
   */
  setJobPostId(taskId, postId) {
    // 先查找活动任务
    if (this.activeJobs.has(taskId)) {
      const job = this.activeJobs.get(taskId);
      job.postId = postId;
      return true;
    }
    // 查找队列中的任务
    const queuedJob = this.queue.find(j => j.taskId === taskId);
    if (queuedJob) {
      queuedJob.postId = postId;
      return true;
    }
    return false;
  }

  /**
   * 获取队列状态概览
   * @returns {Object} 队列状态
   */
  getQueueStatus() {
    return {
      pending: this.queue.length,
      active: this.activeJobs.size,
      completed: this.completedJobs.length,
      maxConcurrent: this.maxConcurrent,
      jobs: {
        pending: this.queue.map(j => ({ taskId: j.taskId, fileName: j.fileName, status: j.status })),
        active: Array.from(this.activeJobs.values()).map(j => ({
          taskId: j.taskId,
          fileName: j.fileName,
          status: j.status,
          progress: j.progress
        })),
        recentCompleted: this.completedJobs.slice(-10).map(j => ({
          taskId: j.taskId,
          fileName: j.fileName,
          status: j.status,
          completedAt: j.completedAt
        }))
      }
    };
  }

  /**
   * 更新任务进度
   * @param {string} taskId - 任务ID
   * @param {number} progress - 进度百分比
   */
  updateProgress(taskId, progress) {
    if (this.activeJobs.has(taskId)) {
      const job = this.activeJobs.get(taskId);
      job.progress = progress;
      this.emit('progressUpdate', { taskId, progress });
    }
  }

  /**
   * 标记任务完成
   * @param {string} taskId - 任务ID
   * @param {Object} result - 转码结果
   */
  completeJob(taskId, result) {
    if (this.activeJobs.has(taskId)) {
      const job = this.activeJobs.get(taskId);
      job.status = result.success ? 'completed' : 'failed';
      job.completedAt = new Date().toISOString();
      job.result = result;
      job.progress = result.success ? 100 : job.progress;
      if (!result.success) {
        job.error = result.message;
      }
      this.completedJobs.push(job);
      this.activeJobs.delete(taskId);
      
      // 保留最近100个已完成任务
      if (this.completedJobs.length > 100) {
        this.completedJobs = this.completedJobs.slice(-100);
      }
      
      this.emit('jobCompleted', job);
      this._processQueue();
    }
  }

  /**
   * 处理队列
   */
  async _processQueue() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    while (this.queue.length > 0 && this.activeJobs.size < this.maxConcurrent) {
      const job = this.queue.shift();
      job.status = 'processing';
      job.startedAt = new Date().toISOString();
      this.activeJobs.set(job.taskId, job);
      this.emit('jobStarted', job);
      
      // 异步执行转码，不阻塞队列处理
      this._executeTranscode(job).catch(err => {
        console.error(`转码任务 ${job.taskId} 执行失败:`, err);
        this.completeJob(job.taskId, { success: false, message: err.message });
      });
    }

    this.isProcessing = false;
  }

  /**
   * 执行转码任务
   * @param {Object} job - 任务信息
   */
  async _executeTranscode(job) {
    try {
      const result = await transcodeToDashInternal(
        job.inputPath,
        job.outputDir,
        job.options,
        (progress) => this.updateProgress(job.taskId, progress)
      );
      this.completeJob(job.taskId, result);
    } catch (error) {
      this.completeJob(job.taskId, { success: false, message: error.message });
    }
  }
}

// 全局队列管理器实例
const transcodeQueue = new TranscodeQueueManager();

/**
 * 初始化 FFmpeg 路径配置
 * 从 .env 配置读取 FFmpeg 和 FFprobe 二进制文件路径
 */
function initFfmpegPath() {
  const ffmpegPath = config.ffmpeg?.ffmpegPath;
  const ffprobePath = config.ffmpeg?.ffprobePath;
  
  // 设置 FFmpeg 路径
  if (ffmpegPath && ffmpegPath.trim() !== '') {
    if (fs.existsSync(ffmpegPath)) {
      ffmpeg.setFfmpegPath(ffmpegPath);
      console.log(`FFmpeg 路径已设置: ${ffmpegPath}`);
    } else {
      console.warn(`FFmpeg 路径不存在: ${ffmpegPath}，将尝试使用系统 PATH`);
    }
  }
  
  // 设置 FFprobe 路径
  if (ffprobePath && ffprobePath.trim() !== '') {
    if (fs.existsSync(ffprobePath)) {
      ffmpeg.setFfprobePath(ffprobePath);
      console.log(`FFprobe 路径已设置: ${ffprobePath}`);
    } else {
      console.warn(`FFprobe 路径不存在: ${ffprobePath}，将尝试使用系统 PATH`);
    }
  }
}

// 初始化 FFmpeg 路径
initFfmpegPath();

/**
 * 获取系统设置
 * @param {string} key - 设置键名
 * @param {string} defaultValue - 默认值
 * @returns {Promise<string>} 设置值
 */
async function getSetting(key, defaultValue = '') {
  try {
    const [rows] = await pool.execute(
      'SELECT setting_value FROM system_settings WHERE setting_key = ?',
      [key]
    );
    return rows.length > 0 ? rows[0].setting_value : defaultValue;
  } catch (error) {
    console.error(`获取设置 ${key} 失败:`, error);
    return defaultValue;
  }
}

/**
 * 获取视频转码配置
 * @returns {Promise<Object>} 转码配置
 */
async function getTranscodeConfig() {
  const [
    enabled,
    minBitrate,
    maxBitrate,
    format,
    outputDirMode,
    retainOriginal,
    maxConcurrentTasks,
    segmentDuration
  ] = await Promise.all([
    getSetting('video_transcode_enabled', 'false'),
    getSetting('video_transcode_min_bitrate', '500'),
    getSetting('video_transcode_max_bitrate', '2500'),
    getSetting('video_transcode_format', 'dash'),
    getSetting('video_transcode_output_dir_mode', 'datetime'),
    getSetting('video_transcode_retain_original', 'true'),
    getSetting('video_transcode_max_concurrent', '2'),
    getSetting('video_transcode_segment_duration', '4')
  ]);

  return {
    enabled: enabled === 'true',
    minBitrate: parseInt(minBitrate, 10) || 500,
    maxBitrate: parseInt(maxBitrate, 10) || 2500,
    format: format || 'dash',
    outputDirMode: outputDirMode || 'datetime', // 'flat', 'datetime', 'date'
    retainOriginal: retainOriginal !== 'false', // 默认保留
    maxConcurrentTasks: parseInt(maxConcurrentTasks, 10) || 2,
    segmentDuration: parseInt(segmentDuration, 10) || 4 // DASH切片秒数，默认4秒
  };
}

/**
 * 生成输出目录路径（支持日期时间子目录）
 * @param {string} baseDir - 基础目录
 * @param {string} mode - 目录模式 'flat', 'datetime', 'date'
 * @returns {string} 完整输出目录路径
 */
function generateOutputDir(baseDir, mode = 'datetime') {
  const now = new Date();
  let subDir = '';
  
  switch (mode) {
    case 'datetime':
      // 格式: YYYY/MM/DD/HH
      subDir = path.join(
        String(now.getFullYear()),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0'),
        String(now.getHours()).padStart(2, '0')
      );
      break;
    case 'date':
      // 格式: YYYY/MM/DD
      subDir = path.join(
        String(now.getFullYear()),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0')
      );
      break;
    case 'flat':
    default:
      // 不使用子目录
      subDir = '';
      break;
  }
  
  return subDir ? path.join(baseDir, subDir) : baseDir;
}

/**
 * 获取当前 FFmpeg 配置信息
 * @returns {Object} FFmpeg 配置信息
 */
function getFfmpegConfig() {
  return {
    ffmpegPath: config.ffmpeg?.ffmpegPath || '(系统 PATH)',
    ffprobePath: config.ffmpeg?.ffprobePath || '(系统 PATH)'
  };
}

/**
 * 检查 FFmpeg 是否可用
 * @returns {Promise<boolean>} 是否可用
 */
function checkFfmpegAvailable() {
  return new Promise((resolve) => {
    ffmpeg.getAvailableFormats((err, formats) => {
      if (err) {
        console.warn('FFmpeg 不可用:', err.message);
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

/**
 * 获取视频信息
 * @param {string} inputPath - 输入视频路径
 * @returns {Promise<Object>} 视频信息
 */
function getVideoInfo(inputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err, metadata) => {
      if (err) {
        reject(err);
      } else {
        const videoStream = metadata.streams.find(s => s.codec_type === 'video');
        const audioStream = metadata.streams.find(s => s.codec_type === 'audio');
        
        // 解析帧率 (格式如 "30/1" 或 "25/1")
        let framerate = 30; // 默认30fps
        if (videoStream?.r_frame_rate) {
          const parts = videoStream.r_frame_rate.split('/');
          if (parts.length === 2) {
            framerate = Math.round(parseInt(parts[0]) / parseInt(parts[1]));
          }
        }
        
        resolve({
          duration: metadata.format.duration,
          width: videoStream?.width,
          height: videoStream?.height,
          bitrate: metadata.format.bit_rate,
          videoCodec: videoStream?.codec_name,
          audioCodec: audioStream?.codec_name,
          framerate: framerate
        });
      }
    });
  });
}

// 视频转码配置常量
const TRANSCODE_DEFAULTS = {
  DEFAULT_WIDTH: 1280,
  DEFAULT_HEIGHT: 720,
  DEFAULT_BITRATE: 2500000, // bps
  MIN_BITRATE_THRESHOLD: 0.8, // 源视频码率必须达到目标码率的80%
  ASPECT_RATIO_TOLERANCE: 0.01, // 宽高比允许的最大偏差
  FALLBACK_BITRATE: 1000, // kbps，当没有合适分辨率时的回退码率
  STANDARD_ASPECT_RATIO: 16 / 9 // 标准宽高比 (16:9)
};

/**
 * 验证并净化正整数值（防止命令注入）
 * @param {number} value - 待验证的值
 * @param {number} minValue - 最小值（默认为1）
 * @returns {number} 净化后的正整数
 */
function sanitizePositiveInteger(value, minValue = 1) {
  return Math.max(minValue, Math.floor(Math.abs(value)));
}

/**
 * 解析DASH分辨率配置
 * 支持两种格式:
 * 1. 宽x高:码率 (例如: 1920x1080:5000)
 * 2. 高度p:码率 (例如: 1080p:5000，自动使用16:9宽高比)
 * @param {string} dashResolutionsConfig - DASH分辨率配置字符串
 * @returns {Array} 解析后的分辨率配置数组
 */
function parseDashResolutions(dashResolutionsConfig) {
  if (!dashResolutionsConfig) {
    // 默认配置
    return [
      { height: 360, width: 640, bitrate: 500, label: '360p' },
      { height: 480, width: 854, bitrate: 1000, label: '480p' },
      { height: 720, width: 1280, bitrate: 2500, label: '720p' },
      { height: 1080, width: 1920, bitrate: 5000, label: '1080p' }
    ];
  }

  const resolutions = [];
  const items = dashResolutionsConfig.split(',').map(s => s.trim()).filter(s => s);

  for (const item of items) {
    const parts = item.split(':');
    if (parts.length !== 2) continue;

    const bitrateStr = parts[1].trim();
    const bitrate = parseInt(bitrateStr, 10);
    if (isNaN(bitrate)) continue;

    const dimensionStr = parts[0].trim();
    
    // 检查是否是 "高度p" 格式
    if (dimensionStr.endsWith('p')) {
      const height = parseInt(dimensionStr.slice(0, -1), 10);
      if (isNaN(height)) continue;
      
      // 使用标准宽高比计算宽度
      const width = Math.round(height * TRANSCODE_DEFAULTS.STANDARD_ASPECT_RATIO);
      resolutions.push({
        height,
        width,
        bitrate,
        label: `${height}p`
      });
    } else {
      // 检查是否是 "宽x高" 格式
      const dimensions = dimensionStr.split('x');
      if (dimensions.length !== 2) continue;

      const width = parseInt(dimensions[0], 10);
      const height = parseInt(dimensions[1], 10);
      if (isNaN(width) || isNaN(height)) continue;

      resolutions.push({
        height,
        width,
        bitrate,
        label: `${height}p`
      });
    }
  }

  // 按高度排序（从低到高）
  resolutions.sort((a, b) => a.height - b.height);
  
  return resolutions.length > 0 ? resolutions : [
    { height: 360, width: 640, bitrate: 500, label: '360p' },
    { height: 480, width: 854, bitrate: 1000, label: '480p' },
    { height: 720, width: 1280, bitrate: 2500, label: '720p' },
    { height: 1080, width: 1920, bitrate: 5000, label: '1080p' }
  ];
}

/**
 * 根据视频方向确定较短边和较长边
 * @param {number} width - 视频宽度
 * @param {number} height - 视频高度
 * @returns {Object} { shortSide, longSide, isPortrait }
 */
function getVideoOrientation(width, height) {
  const isPortrait = height > width;
  return {
    shortSide: isPortrait ? width : height,
    longSide: isPortrait ? height : width,
    isPortrait
  };
}

/**
 * 生成视频质量配置（支持智能分辨率检测和等比例缩放）
 * 支持任意分辨率，自动保持原始宽高比，不会变形
 * @param {Object} videoInfo - 视频信息
 * @param {number} minBitrate - 最小码率 (kbps) - 已弃用，使用配置中的码率
 * @param {number} maxBitrate - 最大码率 (kbps) - 已弃用，使用配置中的码率
 * @returns {Array} 质量配置数组
 */
function generateQualityLevels(videoInfo, minBitrate, maxBitrate) {
  const sourceWidth = videoInfo.width || TRANSCODE_DEFAULTS.DEFAULT_WIDTH;
  const sourceHeight = videoInfo.height || TRANSCODE_DEFAULTS.DEFAULT_HEIGHT;
  const sourceBitrate = Math.round((videoInfo.bitrate || TRANSCODE_DEFAULTS.DEFAULT_BITRATE) / 1000); // 转换为kbps
  
  // 计算源视频宽高比
  const sourceAspectRatio = sourceWidth / sourceHeight;

  // 获取DASH分辨率配置
  const dashResolutionsConfig = config.ffmpeg?.dashResolutions;
  const configuredResolutions = parseDashResolutions(dashResolutionsConfig);

  // 确定源视频的方向
  const sourceOrientation = getVideoOrientation(sourceWidth, sourceHeight);
  const sourceShortSide = sourceOrientation.shortSide;
  const sourceLongSide = sourceOrientation.longSide;
  const isSourcePortrait = sourceOrientation.isPortrait;

  console.log(`源视频信息: ${sourceWidth}x${sourceHeight}, 宽高比: ${sourceAspectRatio.toFixed(3)}, 码率: ${sourceBitrate}kbps, 方向: ${isSourcePortrait ? '竖屏' : '横屏'}`);
  console.log(`源视频短边: ${sourceShortSide}, 长边: ${sourceLongSide}`);

  const qualities = [];

  // 遍历配置的分辨率
  for (const resolution of configuredResolutions) {
    const targetBitrate = resolution.bitrate;
    
    // 使用配置中的短边作为参考，但根据源视频实际宽高比计算输出尺寸
    const configOrientation = getVideoOrientation(resolution.width, resolution.height);
    const targetShortSide = configOrientation.shortSide;

    // 使用较短边进行比较（这样720x1280的竖屏视频会匹配720p配置）
    // 如果源视频的短边小于目标分辨率的短边，则跳过此分辨率
    if (sourceShortSide < targetShortSide) {
      console.log(`跳过 ${resolution.label}: 源视频短边 ${sourceShortSide} < 目标短边 ${targetShortSide}`);
      continue;
    }

    // 检查源视频码率是否足够支持目标码率
    // 如果源视频码率低于目标码率的指定阈值，跳过此分辨率
    if (sourceBitrate < targetBitrate * TRANSCODE_DEFAULTS.MIN_BITRATE_THRESHOLD) {
      console.log(`跳过 ${resolution.label}: 源码率 ${sourceBitrate}kbps 不足以支持目标码率 ${targetBitrate}kbps`);
      continue;
    }

    // 根据源视频宽高比和目标短边，计算输出尺寸（保持原始宽高比，不变形）
    let outputWidth, outputHeight;
    
    if (isSourcePortrait) {
      // 竖屏视频: 较短边（宽度）匹配目标短边，按比例计算高度
      outputWidth = targetShortSide;
      outputHeight = Math.round(outputWidth / sourceAspectRatio);
      
      // 确保不超过源视频尺寸
      if (outputHeight > sourceHeight) {
        outputHeight = sourceHeight;
        outputWidth = Math.round(outputHeight * sourceAspectRatio);
      }
    } else {
      // 横屏视频: 较短边（高度）匹配目标短边，按比例计算宽度
      outputHeight = targetShortSide;
      outputWidth = Math.round(outputHeight * sourceAspectRatio);
      
      // 确保不超过源视频尺寸
      if (outputWidth > sourceWidth) {
        outputWidth = sourceWidth;
        outputHeight = Math.round(outputWidth / sourceAspectRatio);
      }
    }

    // 确保尺寸是偶数（H.264编码要求）
    outputWidth = Math.round(outputWidth / 2) * 2;
    outputHeight = Math.round(outputHeight / 2) * 2;

    // 验证最终输出尺寸确实保持了宽高比（允许小误差）
    const outputAspectRatio = outputWidth / outputHeight;
    const aspectRatioDiff = Math.abs(outputAspectRatio - sourceAspectRatio);
    if (aspectRatioDiff > TRANSCODE_DEFAULTS.ASPECT_RATIO_TOLERANCE) {
      console.warn(`警告: 输出宽高比 ${outputAspectRatio.toFixed(3)} 与源视频 ${sourceAspectRatio.toFixed(3)} 有偏差`);
    }

    qualities.push({
      height: outputHeight,
      width: outputWidth,
      label: resolution.label,
      bitrate: targetBitrate,
      maxrate: Math.round(targetBitrate * 1.2),
      bufsize: Math.round(targetBitrate * 2)
    });

    console.log(`添加分辨率 ${resolution.label}: ${outputWidth}x${outputHeight} (宽高比: ${outputAspectRatio.toFixed(3)}) @ ${targetBitrate}kbps`);
  }

  // 如果没有合适的分辨率，至少保留一个最低质量
  if (qualities.length === 0) {
    console.log('没有合适的目标分辨率，使用源视频尺寸和较低码率');
    const fallbackBitrate = Math.min(sourceBitrate, TRANSCODE_DEFAULTS.FALLBACK_BITRATE);
    qualities.push({
      height: sourceHeight,
      width: sourceWidth,
      label: `${sourceOrientation.shortSide}p`,
      bitrate: fallbackBitrate,
      maxrate: Math.round(fallbackBitrate * 1.2),
      bufsize: Math.round(fallbackBitrate * 2)
    });
  }

  return qualities;
}

/**
 * 内部转码函数（带进度回调）
 * @param {string} inputPath - 输入视频路径
 * @param {string} outputDir - 输出目录
 * @param {Object} options - 转码选项
 * @param {Function} onProgress - 进度回调
 * @returns {Promise<Object>} 转码结果
 */
async function transcodeToDashInternal(inputPath, outputDir, options = {}, onProgress = null) {
  const transcodeConfig = await getTranscodeConfig();
  
  if (!transcodeConfig.enabled) {
    return { success: false, message: '视频转码未启用' };
  }

  const ffmpegAvailable = await checkFfmpegAvailable();
  if (!ffmpegAvailable) {
    return { success: false, message: 'FFmpeg 不可用' };
  }

  try {
    // 获取视频信息
    const videoInfo = await getVideoInfo(inputPath);
    
    // 获取切片时长（秒）
    const segmentDuration = options.segmentDuration || transcodeConfig.segmentDuration || 4;
    // 计算关键帧间隔（使用实际帧率，默认30fps）
    const framerate = videoInfo.framerate || 30;
    const gopSize = segmentDuration * framerate;
    
    // 生成质量等级
    const qualities = generateQualityLevels(
      videoInfo,
      options.minBitrate || transcodeConfig.minBitrate,
      options.maxBitrate || transcodeConfig.maxBitrate
    );

    // 生成输出目录（支持日期时间子目录）
    const finalOutputDir = generateOutputDir(outputDir, transcodeConfig.outputDirMode);
    
    // 确保输出目录存在
    if (!fs.existsSync(finalOutputDir)) {
      fs.mkdirSync(finalOutputDir, { recursive: true });
    }

    // 生成唯一的输出文件名
    const hash = crypto.randomBytes(8).toString('hex');
    const timestamp = Date.now();
    const baseName = `video_${timestamp}_${hash}`;
    
    // 使用FFmpeg原生DASH输出（直接生成MPD和分片文件）
    const mpdPath = path.join(finalOutputDir, `${baseName}.mpd`);
    
    // 构建多码率输出参数
    const outputOptions = [];
    const filterComplex = [];
    const maps = [];
    
    // 为每个质量等级创建输出流
    qualities.forEach((quality, index) => {
      // 验证尺寸和码率是正整数（防止命令注入）
      const width = sanitizePositiveInteger(quality.width);
      const height = sanitizePositiveInteger(quality.height);
      const bitrate = sanitizePositiveInteger(quality.bitrate);
      const maxrate = sanitizePositiveInteger(quality.maxrate);
      const bufsize = sanitizePositiveInteger(quality.bufsize);
      
      // 缩放滤镜 - 使用精确的宽度和高度
      filterComplex.push(`[0:v]scale=${width}:${height}[v${index}]`);
      
      // 视频流映射
      maps.push(`-map [v${index}]`);
      maps.push(`-map 0:a?`);
      
      // 每个流的编码参数
      outputOptions.push(`-c:v:${index} libx264`);
      outputOptions.push(`-b:v:${index} ${bitrate}k`);
      outputOptions.push(`-maxrate:v:${index} ${maxrate}k`);
      outputOptions.push(`-bufsize:v:${index} ${bufsize}k`);
      outputOptions.push(`-profile:v:${index} main`);
      outputOptions.push(`-level:v:${index} 3.1`);
    });
    
    // 音频编码参数（所有流共用）
    outputOptions.push('-c:a aac');
    outputOptions.push('-b:a 128k');
    outputOptions.push('-ac 2');
    
    // DASH输出参数
    outputOptions.push('-f dash');
    outputOptions.push(`-seg_duration ${segmentDuration}`);
    outputOptions.push('-use_timeline 1');
    outputOptions.push('-use_template 1');
    outputOptions.push(`-init_seg_name ${baseName}_init_$RepresentationID$.m4s`);
    outputOptions.push(`-media_seg_name ${baseName}_chunk_$RepresentationID$_$Number%05d$.m4s`);
    outputOptions.push(`-adaptation_sets id=0,streams=v id=1,streams=a`);
    
    // 关键帧设置
    outputOptions.push(`-g ${gopSize}`);
    outputOptions.push(`-keyint_min ${gopSize}`);
    outputOptions.push('-sc_threshold 0');
    outputOptions.push('-preset medium');
    
    try {
      await new Promise((resolve, reject) => {
        let cmd = ffmpeg(inputPath);
        
        // 应用滤镜
        if (filterComplex.length > 0) {
          cmd = cmd.complexFilter(filterComplex);
        }
        
        // 应用映射和输出选项
        cmd
          .outputOptions([...maps, ...outputOptions])
          .on('start', (cmdStr) => {
            console.log(`开始DASH转码: ${cmdStr}`);
          })
          .on('progress', (progress) => {
            const percent = progress.percent || 0;
            console.log(`DASH转码进度: ${Math.round(percent)}%`);
            if (onProgress) onProgress(Math.round(percent));
          })
          .on('end', () => {
            console.log('DASH转码完成');
            resolve();
          })
          .on('error', (err) => {
            console.error('DASH转码失败:', err);
            reject(err);
          })
          .save(mpdPath);
      });
      
      // 检查MPD文件是否生成成功
      if (!fs.existsSync(mpdPath)) {
        throw new Error('MPD文件生成失败');
      }
      
      // 收集生成的文件信息
      const transcodedFiles = qualities.map((quality, index) => ({
        quality: quality.label,
        height: quality.height,
        width: quality.width,
        bitrate: quality.bitrate
      }));

    // 清理临时输入文件（始终清理temp目录中的文件）
    if (inputPath && fs.existsSync(inputPath) && inputPath.includes(path.join('uploads', 'temp'))) {
      try {
        fs.unlinkSync(inputPath);
        console.log('已清理临时输入文件:', inputPath);
      } catch (deleteError) {
        console.warn('清理临时输入文件失败:', deleteError.message);
      }
    } else if (!transcodeConfig.retainOriginal && inputPath && fs.existsSync(inputPath)) {
      // 根据配置决定是否删除非临时原文件
      try {
        fs.unlinkSync(inputPath);
        console.log('已删除原始文件:', inputPath);
      } catch (deleteError) {
        console.warn('删除原始文件失败:', deleteError.message);
      }
    }

    return {
      success: true,
      message: '视频转码完成',
      data: {
        baseName,
        mpdPath,
        outputDir: finalOutputDir,
        files: transcodedFiles,
        qualities: qualities.map(q => q.label),
        retainedOriginal: transcodeConfig.retainOriginal
      }
    };
    } catch (dashError) {
      console.error('DASH转码失败，尝试使用简单模式:', dashError.message);
      
      // 回退到简单的单文件转码模式
      const singleOutputFile = path.join(finalOutputDir, `${baseName}.mp4`);
      // 选择中等质量：如果有多个质量等级，取中间值；否则取第一个
      // qualities数组已按分辨率从低到高排列（360p -> 720p等）
      const middleIndex = Math.floor(qualities.length / 2);
      const quality = qualities[middleIndex] || qualities[0];
      
      // 验证尺寸和码率是正整数（防止命令注入）
      const width = sanitizePositiveInteger(quality.width);
      const height = sanitizePositiveInteger(quality.height);
      const bitrate = sanitizePositiveInteger(quality.bitrate);
      const maxrate = sanitizePositiveInteger(quality.maxrate);
      const bufsize = sanitizePositiveInteger(quality.bufsize);
      
      await new Promise((resolve, reject) => {
        ffmpeg(inputPath)
          .videoCodec('libx264')
          .audioCodec('aac')
          .size(`${width}x${height}`)
          .videoBitrate(`${bitrate}k`)
          .audioChannels(2)
          .audioBitrate('128k')
          .outputOptions([
            `-maxrate ${maxrate}k`,
            `-bufsize ${bufsize}k`,
            '-preset medium',
            '-profile:v main',
            '-level 3.1',
            '-movflags +faststart'
          ])
          .on('start', (cmd) => {
            console.log(`开始简单转码: ${cmd}`);
          })
          .on('progress', (progress) => {
            if (onProgress) onProgress(Math.round(progress.percent || 0));
          })
          .on('end', () => {
            console.log('简单转码完成');
            resolve();
          })
          .on('error', (err) => {
            reject(err);
          })
          .save(singleOutputFile);
      });
      
      // 生成简单的MPD（指向单个MP4文件）
      await generateSimpleDashManifest(singleOutputFile, mpdPath, videoInfo, quality);
      
      // 清理临时文件
      if (inputPath && fs.existsSync(inputPath) && inputPath.includes(path.join('uploads', 'temp'))) {
        try {
          fs.unlinkSync(inputPath);
        } catch (e) {}
      }
      
      return {
        success: true,
        message: '视频转码完成（简单模式）',
        data: {
          baseName,
          mpdPath,
          outputDir: finalOutputDir,
          files: [{ quality: quality.label, path: singleOutputFile, bitrate: quality.bitrate }],
          qualities: [quality.label],
          retainedOriginal: transcodeConfig.retainOriginal
        }
      };
    }
  } catch (error) {
    console.error('视频转码失败:', error);
    return {
      success: false,
      message: error.message || '视频转码失败'
    };
  }
}

/**
 * 转码视频为 DASH 格式（队列模式）
 * @param {string} inputPath - 输入视频路径
 * @param {string} outputDir - 输出目录
 * @param {Object} options - 转码选项
 * @returns {Promise<Object>} 转码结果或任务ID
 */
async function transcodeToDash(inputPath, outputDir, options = {}) {
  const transcodeConfig = await getTranscodeConfig();
  
  // 更新队列并发数配置
  transcodeQueue.setMaxConcurrent(transcodeConfig.maxConcurrentTasks);
  
  if (options.useQueue === true) {
    // 队列模式：返回任务ID（需要显式启用）
    const taskId = transcodeQueue.addJob({
      inputPath,
      outputDir,
      options,
      fileName: path.basename(inputPath)
    });
    return {
      success: true,
      queued: true,
      taskId,
      message: '转码任务已加入队列'
    };
  } else {
    // 同步模式：直接执行转码（默认行为）
    return await transcodeToDashInternal(inputPath, outputDir, options);
  }
}

/**
 * 格式化时长为 ISO 8601 duration 格式
 * @param {number} seconds - 秒数
 * @returns {string} ISO 8601 duration 字符串
 */
function formatDuration(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  let duration = 'PT';
  if (hours > 0) duration += `${hours}H`;
  if (minutes > 0) duration += `${minutes}M`;
  duration += `${secs}S`;
  
  return duration;
}

/**
 * 生成简单的DASH MPD清单（用于单个MP4文件回退模式）
 * Shaka Player可以直接播放普通MP4，此MPD只是提供兼容接口
 * @param {string} videoPath - 视频文件路径
 * @param {string} mpdPath - MPD输出路径
 * @param {Object} videoInfo - 视频信息
 * @param {Object} quality - 质量信息
 */
async function generateSimpleDashManifest(videoPath, mpdPath, videoInfo, quality) {
  const duration = videoInfo.duration || 0;
  const durationStr = formatDuration(duration);
  const fileName = path.basename(videoPath);
  const width = quality.width || Math.round((quality.height || 720) * 16 / 9);
  const height = quality.height || 720;
  
  // 生成指向单个MP4的简单MPD
  // 注意：这种方式Shaka Player可能无法完美支持，但可以作为回退
  const mpd = `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" 
     type="static" 
     mediaPresentationDuration="${durationStr}" 
     minBufferTime="PT2S" 
     profiles="urn:mpeg:dash:profile:isoff-main:2011">
  <Period id="0" duration="${durationStr}">
    <AdaptationSet id="0" contentType="video" mimeType="video/mp4" segmentAlignment="true">
      <Representation id="0" bandwidth="${quality.bitrate * 1000}" width="${width}" height="${height}" codecs="avc1.4d401f,mp4a.40.2">
        <BaseURL>${fileName}</BaseURL>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>`;

  fs.writeFileSync(mpdPath, mpd, 'utf8');
  console.log('简单DASH MPD清单已生成:', mpdPath);
}

/**
 * 清理转码临时文件
 * @param {string} outputDir - 输出目录
 * @param {string} baseName - 基础文件名
 */
function cleanupTranscodedFiles(outputDir, baseName) {
  try {
    const files = fs.readdirSync(outputDir);
    files.forEach(file => {
      if (file.startsWith(baseName)) {
        const filePath = path.join(outputDir, file);
        fs.unlinkSync(filePath);
        console.log('已清理转码文件:', filePath);
      }
    });
  } catch (error) {
    console.error('清理转码文件失败:', error);
  }
}

module.exports = {
  getSetting,
  getTranscodeConfig,
  getFfmpegConfig,
  checkFfmpegAvailable,
  getVideoInfo,
  transcodeToDash,
  generateQualityLevels,
  cleanupTranscodedFiles,
  generateOutputDir,
  // 队列管理相关
  transcodeQueue,
  getQueueStatus: () => transcodeQueue.getQueueStatus(),
  getJobStatus: (taskId) => transcodeQueue.getJobStatus(taskId),
  setMaxConcurrent: (count) => transcodeQueue.setMaxConcurrent(count)
};
