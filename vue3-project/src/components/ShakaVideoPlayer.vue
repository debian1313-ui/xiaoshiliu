<template>
  <div class="shaka-video-player" :class="{ 'fullscreen': isFullscreen }">
    <div ref="videoContainer" class="video-container">
      <video
        ref="videoElement"
        :poster="posterUrl"
        :autoplay="autoplay"
        :muted="muted"
        :loop="loop"
        playsinline
        class="video-element"
      ></video>
      
      <!-- 始终可见的进度条指示器（在所有模式下显示） -->
      <div class="persistent-progress" @click="seek">
        <div class="persistent-progress-bar" :style="{ width: playedPercent + '%' }"></div>
      </div>
      
      <!-- 自定义控制栏 -->
      <div v-if="showControls" class="custom-controls" :class="{ 'visible': controlsVisible || !isPlaying }">
        <!-- 播放/暂停按钮 -->
        <div class="controls-row">
          <button 
            v-if="showPlayButton"
            @click="togglePlayPause" 
            class="control-btn play-btn"
            :title="isPlaying ? '暂停' : '播放'"
          >
            <SvgIcon :name="isPlaying ? 'pause' : 'play'" width="20" height="20" />
          </button>

          <!-- 进度条 -->
          <div class="progress-container" @click="seek" @mouseenter="controlsVisible = true">
            <div class="progress-bar">
              <div class="progress-buffered" :style="{ width: bufferedPercent + '%' }"></div>
              <div class="progress-played" :style="{ width: playedPercent + '%' }"></div>
              <div class="progress-handle" :style="{ left: playedPercent + '%' }"></div>
            </div>
          </div>

          <!-- 时间显示 -->
          <div class="time-display">
            <span class="current-time">{{ formatTime(currentTime) }}</span>
            <span class="time-separator">/</span>
            <span class="duration">{{ formatTime(duration) }}</span>
          </div>

          <!-- 音量控制 -->
          <div class="volume-control">
            <button @click="toggleMute" class="control-btn volume-btn">
              <SvgIcon :name="isMuted ? 'volume-mute' : 'volume'" width="18" height="18" />
            </button>
            <input 
              type="range" 
              min="0" 
              max="100" 
              v-model="volumeLevel"
              @input="changeVolume"
              class="volume-slider"
            />
          </div>

          <!-- 画质选择 -->
          <div v-if="adaptiveBitrate && qualities.length > 1" class="quality-control">
            <button @click="toggleQualityMenu" class="control-btn quality-btn">
              <span class="quality-text">{{ currentQualityLabel }}</span>
            </button>
            <div v-if="showQualityMenu" class="quality-menu">
              <div 
                v-for="quality in qualities" 
                :key="quality.id"
                @click="selectQuality(quality)"
                class="quality-item"
                :class="{ 'active': quality.id === currentQuality }"
              >
                {{ quality.label }}
              </div>
            </div>
          </div>

          <!-- 全屏按钮 -->
          <button @click="toggleFullscreen" class="control-btn fullscreen-btn">
            <SvgIcon :name="isFullscreen ? 'fullscreen-exit' : 'fullscreen'" width="18" height="18" />
          </button>
        </div>
      </div>

      <!-- 加载指示器 -->
      <div v-if="isLoading" class="loading-indicator">
        <div class="spinner"></div>
        <span>加载中...</span>
      </div>

      <!-- 错误提示 -->
      <div v-if="error" class="error-overlay">
        <SvgIcon name="warning" width="48" height="48" />
        <p>{{ error }}</p>
      </div>
    </div>
  </div>
</template>

<script setup>
/**
 * Shaka Video Player 组件 (混合播放器)
 * 
 * 本地化说明:
 * - 使用动态 import() 加载 shaka-player，确保代码分割和按需加载
 * - 不依赖 shaka-player 的 CSS，完全使用自定义样式
 * - 所有 JS/CSS 资源在构建时会被打包到本地 bundle 中
 * - 需要确保 shaka-player 已在 package.json 中声明并安装
 * 
 * 播放器策略:
 * - DASH 格式视频 (.mpd): 使用 Shaka Player 播放，支持自适应码率
 * - 普通视频格式 (MP4等): 使用原生 HTML5 播放器
 * - Shaka Player 加载失败时: 自动回退到原生播放器
 */
import { ref, onMounted, onBeforeUnmount, watch, computed } from 'vue'
import SvgIcon from './SvgIcon.vue'

// 动态导入 Shaka Player 以避免 SSR 问题和实现代码分割
let shaka = null

const props = defineProps({
  // 视频源 URL (支持 DASH manifest .mpd 或普通视频文件)
  src: {
    type: String,
    required: true
  },
  // 海报图片 URL
  posterUrl: {
    type: String,
    default: ''
  },
  // 是否自动播放
  autoplay: {
    type: Boolean,
    default: import.meta.env.VITE_VIDEO_AUTOPLAY === 'true'
  },
  // 是否显示控制栏
  showControls: {
    type: Boolean,
    default: import.meta.env.VITE_VIDEO_CONTROLS !== 'false'
  },
  // 是否显示播放按钮
  showPlayButton: {
    type: Boolean,
    default: import.meta.env.VITE_VIDEO_SHOW_PLAY_BUTTON !== 'false'
  },
  // 是否静音
  muted: {
    type: Boolean,
    default: import.meta.env.VITE_VIDEO_MUTED === 'true'
  },
  // 是否循环播放
  loop: {
    type: Boolean,
    default: import.meta.env.VITE_VIDEO_LOOP === 'true'
  },
  // 是否启用自适应码率
  adaptiveBitrate: {
    type: Boolean,
    default: import.meta.env.VITE_VIDEO_ADAPTIVE_BITRATE !== 'false'
  }
})

const emit = defineEmits(['play', 'pause', 'ended', 'error', 'loaded'])

// 引用
const videoElement = ref(null)
const videoContainer = ref(null)

// 播放器实例
let player = null

// 状态
const isLoading = ref(true)
const error = ref(null)
const isPlaying = ref(false)
const isMuted = ref(props.muted)
const isFullscreen = ref(false)
const controlsVisible = ref(true)
const showQualityMenu = ref(false)

// 播放状态
const currentTime = ref(0)
const duration = ref(0)
const bufferedPercent = ref(0)
const playedPercent = ref(0)
const volumeLevel = ref((parseFloat(import.meta.env.VITE_VIDEO_DEFAULT_VOLUME) || 0.8) * 100)

// 画质选项
const qualities = ref([])
const currentQuality = ref(null)

// 计算当前画质标签
const currentQualityLabel = computed(() => {
  if (currentQuality.value === -1) return '自动'
  const quality = qualities.value.find(q => q.id === currentQuality.value)
  return quality ? quality.label : '自动'
})

// 控制栏自动隐藏定时器
let controlsTimeout = null

// 全屏状态更新函数引用（用于清理事件监听器）
let fullscreenStateHandler = null
let webkitBeginFullscreenHandler = null
let webkitEndFullscreenHandler = null

// 检查是否是 DASH 格式
const isDashVideo = (url) => {
  return url && url.toLowerCase().endsWith('.mpd')
}

// 初始化播放器
const initPlayer = async () => {
  try {
    // 始终使用 Shaka Player 播放所有视频格式（DASH、MP4等）
    // 动态导入 Shaka Player
    if (!shaka) {
      try {
        const shakaModule = await import('shaka-player')
        shaka = shakaModule.default || shakaModule
      } catch (importError) {
        console.error('Failed to load Shaka Player:', importError)
        console.warn('Falling back to native video player')
        // 回退到原生播放器
        useFallbackPlayer()
        return
      }
    }

    // 检查浏览器支持
    if (!shaka.Player || !shaka.Player.isBrowserSupported()) {
      console.error('浏览器不支持 Shaka Player')
      console.warn('Falling back to native video player')
      useFallbackPlayer()
      return
    }

    // 创建播放器实例
    player = new shaka.Player()
    
    // 附加到视频元素
    await player.attach(videoElement.value)

    // 优化配置以提升DASH播放流畅度
    player.configure({
      streaming: {
        bufferingGoal: 30,           // 缓冲目标（秒）
        rebufferingGoal: 10,          // 重新缓冲目标（秒）- 降低以更快恢复播放
        bufferBehind: 30,             // 保留后面的缓冲（秒）
        retryParameters: {
          timeout: 30000,             // 请求超时（毫秒）
          maxAttempts: 3,             // 最大重试次数
          baseDelay: 1000,            // 基础延迟（毫秒）
          backoffFactor: 2,           // 退避因子
          fuzzFactor: 0.5             // 模糊因子
        }
      },
      abr: {
        enabled: props.adaptiveBitrate,
        defaultBandwidthEstimate: 5000000,  // 默认带宽估计（5Mbps）
        switchInterval: 8,                   // 切换间隔（秒）
        bandwidthUpgradeTarget: 0.85,        // 带宽升级目标
        bandwidthDowngradeTarget: 0.95       // 带宽降级目标
      }
    })

    // 监听错误
    player.addEventListener('error', onPlayerError)

    // 加载视频源
    await player.load(props.src)

    // 加载完成
    isLoading.value = false
    emit('loaded')

    // 获取可用画质（对DASH视频有效）
    const useDash = isDashVideo(props.src)
    if (useDash) {
      loadQualities()
    }

    // 设置初始音量
    videoElement.value.volume = volumeLevel.value / 100

    // 如果是自动播放，尝试播放
    if (props.autoplay) {
      try {
        await videoElement.value.play()
      } catch (err) {
        console.warn('自动播放失败:', err)
      }
    }

  } catch (err) {
    console.error('播放器初始化失败:', err)
    error.value = '视频加载失败: ' + err.message
    isLoading.value = false
    emit('error', err)
  }
}

// 使用原生 HTML5 播放器作为回退
const useFallbackPlayer = () => {
  console.log('使用原生 HTML5 视频播放器')
  
  // 设置视频源
  videoElement.value.src = props.src
  
  // 使用自定义控制栏，不使用原生controls属性
  videoElement.value.controls = false
  
  // 设置初始音量
  videoElement.value.volume = volumeLevel.value / 100
  
  // 加载完成
  isLoading.value = false
  emit('loaded')
  
  // 如果是自动播放，尝试播放
  if (props.autoplay) {
    videoElement.value.play().catch(err => {
      console.warn('自动播放失败:', err)
    })
  }
}

// 加载可用画质选项
const loadQualities = () => {
  if (!player) return

  const tracks = player.getVariantTracks()
  const uniqueHeights = new Set()
  const qualityOptions = []

  // 添加自动选项
  qualityOptions.push({ id: -1, label: '自动', height: 0 })

  tracks.forEach(track => {
    if (!uniqueHeights.has(track.height)) {
      uniqueHeights.add(track.height)
      qualityOptions.push({
        id: track.id,
        label: `${track.height}p`,
        height: track.height,
        bandwidth: track.bandwidth
      })
    }
  })

  // 按分辨率降序排序
  qualityOptions.sort((a, b) => b.height - a.height)
  qualities.value = qualityOptions

  // 默认选择自动
  currentQuality.value = -1
}

// 播放/暂停切换
const togglePlayPause = () => {
  if (isPlaying.value) {
    videoElement.value.pause()
  } else {
    videoElement.value.play()
  }
}

// 跳转到指定位置
const seek = (event) => {
  if (!videoElement.value || !duration.value) return
  
  const rect = event.currentTarget.getBoundingClientRect()
  const percent = (event.clientX - rect.left) / rect.width
  videoElement.value.currentTime = duration.value * percent
}

// 切换静音
const toggleMute = () => {
  isMuted.value = !isMuted.value
  videoElement.value.muted = isMuted.value
}

// 改变音量
const changeVolume = () => {
  videoElement.value.volume = volumeLevel.value / 100
  if (volumeLevel.value > 0) {
    isMuted.value = false
    videoElement.value.muted = false
  }
}

// 切换画质菜单
const toggleQualityMenu = () => {
  showQualityMenu.value = !showQualityMenu.value
}

// 选择画质
const selectQuality = (quality) => {
  if (!player) return

  if (quality.id === -1) {
    // 自动模式
    player.configure({ abr: { enabled: true } })
  } else {
    // 手动选择画质
    player.configure({ abr: { enabled: false } })
    const tracks = player.getVariantTracks()
    const selectedTrack = tracks.find(t => t.id === quality.id)
    if (selectedTrack) {
      player.selectVariantTrack(selectedTrack, true)
    }
  }

  currentQuality.value = quality.id
  showQualityMenu.value = false
}

// 切换全屏
const toggleFullscreen = async () => {
  try {
    // 检查当前是否处于全屏状态
    const isCurrentlyFullscreen = 
      document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.mozFullScreenElement ||
      document.msFullscreenElement
    
    if (!isCurrentlyFullscreen) {
      // 进入全屏 - 支持多种浏览器 API
      const element = videoContainer.value
      
      if (element.requestFullscreen) {
        await element.requestFullscreen()
      } else if (element.webkitRequestFullscreen) {
        // iOS Safari 和旧版 Safari
        await element.webkitRequestFullscreen()
      } else if (element.mozRequestFullScreen) {
        // Firefox
        await element.mozRequestFullScreen()
      } else if (element.msRequestFullscreen) {
        // IE11
        await element.msRequestFullscreen()
      } else if (videoElement.value?.webkitEnterFullscreen) {
        // iOS Safari 视频元素专用 (容器不支持时的回退方案)
        videoElement.value.webkitEnterFullscreen()
      } else {
        console.warn('浏览器不支持全屏功能')
      }
    } else {
      // 退出全屏 - 支持多种浏览器 API
      if (document.exitFullscreen) {
        await document.exitFullscreen()
      } else if (document.webkitExitFullscreen) {
        await document.webkitExitFullscreen()
      } else if (document.mozCancelFullScreen) {
        await document.mozCancelFullScreen()
      } else if (document.msExitFullscreen) {
        await document.msExitFullscreen()
      } else if (videoElement.value?.webkitExitFullscreen) {
        videoElement.value.webkitExitFullscreen()
      }
    }
  } catch (err) {
    console.error('全屏切换失败:', err)
  }
}

// 格式化时间
const formatTime = (seconds) => {
  if (!seconds || isNaN(seconds)) return '00:00'
  
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`
}

// 显示控制栏
const showControls = () => {
  controlsVisible.value = true
  
  // 清除之前的定时器
  if (controlsTimeout) {
    clearTimeout(controlsTimeout)
  }

  // 如果正在播放，3秒后自动隐藏
  if (isPlaying.value) {
    controlsTimeout = setTimeout(() => {
      controlsVisible.value = false
    }, 3000)
  }
}

// 播放器错误处理
const onPlayerError = (event) => {
  console.error('播放器错误:', event)
  error.value = '播放出错: ' + event.detail.message
  emit('error', event.detail)
}

// 视频事件监听
const setupVideoListeners = () => {
  if (!videoElement.value) return

  videoElement.value.addEventListener('play', () => {
    isPlaying.value = true
    emit('play')
  })

  videoElement.value.addEventListener('pause', () => {
    isPlaying.value = false
    emit('pause')
  })

  videoElement.value.addEventListener('ended', () => {
    isPlaying.value = false
    emit('ended')
  })

  videoElement.value.addEventListener('timeupdate', () => {
    currentTime.value = videoElement.value.currentTime
    duration.value = videoElement.value.duration
    playedPercent.value = (currentTime.value / duration.value) * 100 || 0
  })

  videoElement.value.addEventListener('progress', () => {
    if (videoElement.value.buffered.length > 0) {
      const bufferedEnd = videoElement.value.buffered.end(videoElement.value.buffered.length - 1)
      bufferedPercent.value = (bufferedEnd / duration.value) * 100 || 0
    }
  })

  videoElement.value.addEventListener('waiting', () => {
    isLoading.value = true
  })

  videoElement.value.addEventListener('canplay', () => {
    isLoading.value = false
  })

  // 全屏状态监听 - 支持多种浏览器
  fullscreenStateHandler = () => {
    isFullscreen.value = !!(
      document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.mozFullScreenElement ||
      document.msFullscreenElement
    )
  }
  
  document.addEventListener('fullscreenchange', fullscreenStateHandler)
  document.addEventListener('webkitfullscreenchange', fullscreenStateHandler)
  document.addEventListener('mozfullscreenchange', fullscreenStateHandler)
  document.addEventListener('MSFullscreenChange', fullscreenStateHandler)
  
  // iOS Safari 特殊处理
  if (videoElement.value) {
    webkitBeginFullscreenHandler = () => {
      isFullscreen.value = true
    }
    webkitEndFullscreenHandler = () => {
      isFullscreen.value = false
    }
    
    videoElement.value.addEventListener('webkitbeginfullscreen', webkitBeginFullscreenHandler)
    videoElement.value.addEventListener('webkitendfullscreen', webkitEndFullscreenHandler)
  }

  // 鼠标移动显示控制栏
  videoContainer.value.addEventListener('mousemove', showControls)
  videoContainer.value.addEventListener('touchstart', showControls)
}

// 监听 src 变化
watch(() => props.src, (newSrc) => {
  if (!newSrc) return
  
  isLoading.value = true
  error.value = null
  
  if (player && isDashVideo(newSrc)) {
    // 如果有 Shaka Player 实例且是 DASH 视频，使用它加载
    player.load(newSrc).then(() => {
      isLoading.value = false
      loadQualities()
    }).catch((err) => {
      console.error('视频加载失败:', err)
      error.value = '视频加载失败'
      isLoading.value = false
    })
  } else {
    // 否则使用原生播放器
    videoElement.value.src = newSrc
    isLoading.value = false
  }
})

// 组件挂载
onMounted(() => {
  setupVideoListeners()
  if (props.src) {
    initPlayer()
  }
})

// 组件卸载
onBeforeUnmount(() => {
  if (controlsTimeout) {
    clearTimeout(controlsTimeout)
  }
  if (player) {
    player.destroy()
  }
  
  // 清理全屏事件监听器
  if (fullscreenStateHandler) {
    document.removeEventListener('fullscreenchange', fullscreenStateHandler)
    document.removeEventListener('webkitfullscreenchange', fullscreenStateHandler)
    document.removeEventListener('mozfullscreenchange', fullscreenStateHandler)
    document.removeEventListener('MSFullscreenChange', fullscreenStateHandler)
  }
  
  // 清理 iOS Safari 特殊事件监听器
  if (videoElement.value) {
    if (webkitBeginFullscreenHandler) {
      videoElement.value.removeEventListener('webkitbeginfullscreen', webkitBeginFullscreenHandler)
    }
    if (webkitEndFullscreenHandler) {
      videoElement.value.removeEventListener('webkitendfullscreen', webkitEndFullscreenHandler)
    }
  }
})

// 暴露方法
defineExpose({
  play: () => videoElement.value?.play(),
  pause: () => videoElement.value?.pause(),
  seek: (time) => { if (videoElement.value) videoElement.value.currentTime = time }
})
</script>

<style scoped>
.shaka-video-player {
  width: 100%;
  height: 100%;
  position: relative;
  background: #000;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 2px 8px var(--shadow-color);
}

.video-container {
  width: 100%;
  height: 100%;
  position: relative;
  border-radius: 8px;
  overflow: hidden;
}

.video-element {
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #000;
}

/* 始终可见的进度条指示器 */
.persistent-progress {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 4px;  /* 增加默认高度，从3px到4px，确保在Windows PC上更容易看到 */
  background: rgba(255, 255, 255, 0.25);  /* 增加背景透明度，从0.2到0.25 */
  cursor: pointer;
  z-index: 5;
  transition: height 0.2s ease;
}

.persistent-progress:hover {
  height: 6px;  /* hover时增加到6px */
}

.persistent-progress-bar {
  height: 100%;
  background: var(--primary-color);
  box-shadow: 0 0 4px rgba(255, 36, 66, 0.8);  /* 增强阴影效果，提高可见性 */
  transition: width 0.1s linear;
}

/* 自定义控制栏 */
.custom-controls {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.85) 0%, rgba(0, 0, 0, 0.6) 50%, transparent 100%);
  padding: 20px 16px 12px;
  opacity: 0;
  transition: opacity 0.3s ease;
  z-index: 10;
}

.custom-controls.visible {
  opacity: 1;
}

.controls-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.control-btn {
  background: transparent;
  border: none;
  color: white;
  cursor: pointer;
  padding: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  border-radius: 4px;
}

.control-btn:hover {
  transform: scale(1.15);
  background: rgba(255, 255, 255, 0.1);
}

.control-btn:active {
  transform: scale(1.05);
}

/* 进度条 */
.progress-container {
  flex: 1;
  cursor: pointer;
  padding: 10px 0;
  margin: 0 4px;
}

.progress-container:hover .progress-bar {
  height: 6px;
}

.progress-container:hover .progress-handle {
  width: 14px;
  height: 14px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
}

.progress-bar {
  height: 4px;
  background: rgba(255, 255, 255, 0.3);
  border-radius: 3px;
  position: relative;
  overflow: visible;
  transition: height 0.2s ease;
}

.progress-buffered {
  position: absolute;
  height: 100%;
  background: rgba(255, 255, 255, 0.4);
  border-radius: 3px;
  transition: width 0.2s ease;
}

.progress-played {
  position: absolute;
  height: 100%;
  background: var(--primary-color);
  border-radius: 3px;
  transition: width 0.1s linear;
  box-shadow: 0 0 4px rgba(255, 36, 66, 0.4);
}

.progress-handle {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 12px;
  height: 12px;
  background: white;
  border-radius: 50%;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
  transition: all 0.2s ease;
  border: 2px solid var(--primary-color);
}

/* 时间显示 */
.time-display {
  color: white;
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 4px;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
  min-width: 90px;
  justify-content: center;
}

/* 音量控制 */
.volume-control {
  display: flex;
  align-items: center;
  gap: 8px;
}

.volume-slider {
  width: 70px;
  height: 4px;
  -webkit-appearance: none;
  appearance: none;
  background: rgba(255, 255, 255, 0.3);
  border-radius: 3px;
  outline: none;
  transition: all 0.2s ease;
}

.volume-slider:hover {
  height: 5px;
}

.volume-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 12px;
  height: 12px;
  background: white;
  border-radius: 50%;
  cursor: pointer;
  border: 2px solid var(--primary-color);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  transition: all 0.2s ease;
}

.volume-slider::-webkit-slider-thumb:hover {
  transform: scale(1.2);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
}

.volume-slider::-moz-range-thumb {
  width: 12px;
  height: 12px;
  background: white;
  border-radius: 50%;
  cursor: pointer;
  border: 2px solid var(--primary-color);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  transition: all 0.2s ease;
}

.volume-slider::-moz-range-thumb:hover {
  transform: scale(1.2);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
}

/* 画质控制 */
.quality-control {
  position: relative;
}

.quality-text {
  color: white;
  font-size: 13px;
  font-weight: 600;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
  min-width: 45px;
  text-align: center;
}

.quality-menu {
  position: absolute;
  bottom: 100%;
  right: 0;
  background: rgba(18, 18, 18, 0.98);
  border-radius: 8px;
  padding: 6px;
  margin-bottom: 12px;
  min-width: 100px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5), 0 0 1px rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(10px);
  animation: fadeInUp 0.2s ease;
}

@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.quality-menu::before {
  content: '';
  position: absolute;
  bottom: -6px;
  right: 20px;
  width: 12px;
  height: 12px;
  background: rgba(18, 18, 18, 0.98);
  transform: rotate(45deg);
  border-radius: 2px;
}

.quality-item {
  padding: 10px 16px;
  color: white;
  cursor: pointer;
  font-size: 14px;
  border-radius: 6px;
  transition: all 0.2s ease;
  font-weight: 500;
  text-align: center;
}

.quality-item:hover {
  background: rgba(255, 255, 255, 0.12);
  transform: translateX(-2px);
}

.quality-item.active {
  background: var(--primary-color);
  font-weight: 600;
  box-shadow: 0 2px 8px rgba(255, 36, 66, 0.4);
}

/* 加载指示器 */
.loading-indicator {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  color: white;
  z-index: 20;
  background: rgba(0, 0, 0, 0.6);
  padding: 30px 40px;
  border-radius: 12px;
  backdrop-filter: blur(5px);
}

.loading-indicator span {
  font-size: 15px;
  font-weight: 500;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
}

.spinner {
  width: 48px;
  height: 48px;
  border: 4px solid rgba(255, 255, 255, 0.2);
  border-top-color: var(--primary-color);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  box-shadow: 0 0 10px rgba(255, 36, 66, 0.3);
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* 错误提示 */
.error-overlay {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  color: white;
  text-align: center;
  padding: 32px 40px;
  z-index: 20;
  background: rgba(0, 0, 0, 0.8);
  border-radius: 12px;
  backdrop-filter: blur(5px);
  max-width: 80%;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.error-overlay p {
  margin: 0;
  font-size: 15px;
  font-weight: 500;
  line-height: 1.5;
  color: #ffcccc;
}

/* 全屏模式 */
.fullscreen {
  border-radius: 0;
  box-shadow: none;
}

.fullscreen .video-container {
  border-radius: 0;
}

.fullscreen .video-element {
  object-fit: contain;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .volume-control {
    display: none;
  }

  .time-display {
    font-size: 11px;
  }

  .custom-controls {
    padding: 8px;
  }

  .controls-row {
    gap: 8px;
  }
}
</style>
