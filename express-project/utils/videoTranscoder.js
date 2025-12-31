/**
 * 视频转码工具模块
 * 支持将视频转换为DASH格式，智能检测分辨率，自动生成多码率版本
 * 
 * @author ZTMYO
 * @description 视频转码和DASH格式转换
 */

const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const config = require('../config/config');

// 设置 FFmpeg 和 FFprobe 路径
if (config.videoTranscoding.ffmpegPath) {
  ffmpeg.setFfmpegPath(config.videoTranscoding.ffmpegPath);
}
if (config.videoTranscoding.ffprobePath) {
  ffmpeg.setFfprobePath(config.videoTranscoding.ffprobePath);
}

/**
 * 使用 ffprobe 分析视频信息
 * @param {string} videoPath - 视频文件路径
 * @returns {Promise<Object>} 视频信息
 */
async function analyzeVideo(videoPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        console.error('❌ FFprobe 分析视频失败:', err.message);
        return reject(err);
      }

      const videoStream = metadata.streams.find(s => s.codec_type === 'video');
      
      if (!videoStream) {
        return reject(new Error('未找到视频流'));
      }

      const info = {
        width: videoStream.width,
        height: videoStream.height,
        duration: metadata.format.duration,
        bitrate: metadata.format.bit_rate,
        codec: videoStream.codec_name,
        fps: videoStream.r_frame_rate ? 
          (() => {
            const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
            return den ? num / den : num;
          })() : 30
      };

      console.log('📊 视频分析结果:', info);
      resolve(info);
    });
  });
}

/**
 * 智能选择适合的分辨率
 * @param {number} videoWidth - 视频宽度
 * @param {number} videoHeight - 视频高度
 * @param {Array} configResolutions - 配置的分辨率列表
 * @returns {Array} 适合的分辨率列表
 */
function selectResolutions(videoWidth, videoHeight, configResolutions) {
  const selectedResolutions = [];

  // 按分辨率从高到低排序
  const sortedResolutions = [...configResolutions].sort((a, b) => b.height - a.height);

  for (const resolution of sortedResolutions) {
    // 只选择小于等于原视频分辨率的版本
    if (resolution.width <= videoWidth && resolution.height <= videoHeight) {
      selectedResolutions.push(resolution);
    } else {
      console.log(`⏭️ 跳过分辨率 ${resolution.width}x${resolution.height} (超过原视频 ${videoWidth}x${videoHeight})`);
    }
  }

  // 如果没有合适的预设分辨率，使用原视频分辨率
  if (selectedResolutions.length === 0) {
    console.log('⚠️ 没有找到合适的预设分辨率，使用原视频分辨率');
    
    // 计算基于像素数和帧率的比特率
    // 公式: (width * height * fps * bitDepth) / compressionRatio
    // 其中 bitDepth ≈ 0.1 bits/pixel, compressionRatio ≈ 1000
    const DEFAULT_FPS = 30;
    const BIT_DEPTH = 0.1;
    const COMPRESSION_RATIO = 1000;
    const calculatedBitrate = Math.floor(
      (videoWidth * videoHeight * DEFAULT_FPS * BIT_DEPTH) / COMPRESSION_RATIO
    );
    
    selectedResolutions.push({
      width: videoWidth,
      height: videoHeight,
      bitrate: Math.min(calculatedBitrate, config.videoTranscoding.dash.maxBitrate)
    });
  }

  console.log(`✅ 选择的分辨率:`, selectedResolutions.map(r => `${r.width}x${r.height}:${r.bitrate}kbps`).join(', '));
  return selectedResolutions;
}

/**
 * 生成输出目录路径
 * @param {number} userId - 用户ID
 * @returns {string} 输出目录路径
 */
function generateOutputPath(userId) {
  const now = new Date();
  const date = now.toISOString().split('T')[0]; // YYYY-MM-DD
  const timestamp = Date.now();

  let outputFormat = config.videoTranscoding.outputFormat;
  
  // 替换变量
  outputFormat = outputFormat
    .replace('{date}', date)
    .replace('{userId}', userId.toString())
    .replace('{timestamp}', timestamp.toString());

  const baseDir = path.join(process.cwd(), config.upload.video.local.uploadDir, 'dash');
  const outputDir = path.join(baseDir, outputFormat);

  // 创建目录
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log(`📁 输出目录: ${outputDir}`);
  return outputDir;
}

/**
 * 转换视频为 DASH 格式
 * @param {string} inputPath - 输入视频路径
 * @param {number} userId - 用户ID
 * @param {Function} progressCallback - 进度回调函数
 * @returns {Promise<Object>} 转码结果
 */
async function convertToDash(inputPath, userId, progressCallback) {
  try {
    if (!config.videoTranscoding.enabled) {
      console.log('⚠️ 视频转码未启用');
      return {
        success: false,
        message: '视频转码未启用'
      };
    }

    console.log('🎬 开始转码视频:', inputPath);

    // 1. 分析视频
    const videoInfo = await analyzeVideo(inputPath);

    // 2. 选择合适的分辨率
    const selectedResolutions = selectResolutions(
      videoInfo.width,
      videoInfo.height,
      config.videoTranscoding.dash.resolutions
    );

    // 3. 生成输出目录
    const outputDir = generateOutputPath(userId);
    const manifestFile = path.join(outputDir, 'manifest.mpd');

    // 4. 构建 FFmpeg 命令
    return new Promise((resolve, reject) => {
      const command = ffmpeg(inputPath);

      // 为每个分辨率添加输出流
      selectedResolutions.forEach((resolution, index) => {
        command
          .outputOptions([
            `-map 0:v:0`,
            `-s:v:${index} ${resolution.width}x${resolution.height}`,
            `-b:v:${index} ${resolution.bitrate}k`,
            `-maxrate:v:${index} ${Math.floor(resolution.bitrate * 1.2)}k`,
            `-bufsize:v:${index} ${Math.floor(resolution.bitrate * 2)}k`
          ]);
      });

      // 添加音频流
      command.outputOptions([
        '-map 0:a:0',
        '-c:a aac',
        '-b:a 128k',
        '-ac 2'
      ]);

      // DASH 输出配置
      command
        .outputOptions([
          '-f dash',
          `-seg_duration ${config.videoTranscoding.dash.segmentDuration}`,
          '-use_template 1',
          '-use_timeline 1',
          '-adaptation_sets "id=0,streams=v id=1,streams=a"',
          '-init_seg_name init-stream$RepresentationID$.$ext$',
          '-media_seg_name chunk-stream$RepresentationID$-$Number%05d$.$ext$'
        ])
        .output(manifestFile);

      // 进度监听
      command.on('progress', (progress) => {
        if (progressCallback && progress.percent) {
          progressCallback(Math.floor(progress.percent));
        }
        if (progress.percent) {
          console.log(`⏳ 转码进度: ${Math.floor(progress.percent)}%`);
        }
      });

      // 错误处理
      command.on('error', (err) => {
        console.error('❌ 视频转码失败:', err.message);
        reject({
          success: false,
          message: `视频转码失败: ${err.message}`
        });
      });

      // 完成处理
      command.on('end', () => {
        console.log('✅ 视频转码完成');

        // 删除原始文件（如果配置启用）
        if (config.videoTranscoding.deleteOriginal && fs.existsSync(inputPath)) {
          try {
            fs.unlinkSync(inputPath);
            console.log('🗑️ 已删除原始视频文件');
          } catch (err) {
            console.warn('⚠️ 删除原始文件失败:', err.message);
          }
        }

        // 生成相对路径的 URL
        const relativePath = path.relative(
          path.join(process.cwd(), config.upload.video.local.uploadDir),
          outputDir
        ).replace(/\\/g, '/');
        
        const baseUrl = config.upload.video.local.baseUrl;
        const videoDir = config.upload.video.local.uploadDir;
        const manifestUrl = `${baseUrl}/${videoDir}/${relativePath}/manifest.mpd`;

        resolve({
          success: true,
          manifestUrl: manifestUrl,
          outputDir: outputDir,
          resolutions: selectedResolutions,
          videoInfo: videoInfo
        });
      });

      // 执行转码
      command.run();
    });

  } catch (error) {
    console.error('❌ 转码过程异常:', error);
    return {
      success: false,
      message: error.message || '转码过程异常'
    };
  }
}

/**
 * 检查 FFmpeg 是否可用
 * @returns {Promise<boolean>}
 */
async function checkFFmpegAvailable() {
  return new Promise((resolve) => {
    try {
      ffmpeg.getAvailableFormats((err) => {
        if (err) {
          console.error('❌ FFmpeg 不可用:', err.message);
          resolve(false);
        } else {
          console.log('✅ FFmpeg 可用');
          resolve(true);
        }
      });
    } catch (error) {
      console.error('❌ FFmpeg 检查失败:', error.message);
      resolve(false);
    }
  });
}

module.exports = {
  analyzeVideo,
  selectResolutions,
  generateOutputPath,
  convertToDash,
  checkFFmpegAvailable
};
