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
          <div class="progress-container" @click="seek">
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
import { ref, onMounted, onBeforeUnmount, watch, computed } from 'vue'
import shaka from 'shaka-player/dist/shaka-player.ui.js'
import 'shaka-player/dist/controls.css'
import SvgIcon from './SvgIcon.vue'

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

// 初始化播放器
const initPlayer = async () => {
  try {
    // 检查浏览器支持
    if (!shaka.Player.isBrowserSupported()) {
      error.value = '您的浏览器不支持视频播放'
      console.error('浏览器不支持 Shaka Player')
      return
    }

    // 创建播放器实例
    player = new shaka.Player(videoElement.value)

    // 配置播放器
    player.configure({
      streaming: {
        bufferingGoal: 30,
        rebufferingGoal: 15,
        bufferBehind: 30
      },
      abr: {
        enabled: props.adaptiveBitrate
      }
    })

    // 监听错误
    player.addEventListener('error', onPlayerError)

    // 加载视频源
    await player.load(props.src)

    // 加载完成
    isLoading.value = false
    emit('loaded')

    // 获取可用画质
    loadQualities()

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
  if (!document.fullscreenElement) {
    try {
      await videoContainer.value.requestFullscreen()
    } catch (err) {
      console.error('全屏请求失败:', err)
    }
  } else {
    await document.exitFullscreen()
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

  // 全屏状态监听
  document.addEventListener('fullscreenchange', () => {
    isFullscreen.value = !!document.fullscreenElement
  })

  // 鼠标移动显示控制栏
  videoContainer.value.addEventListener('mousemove', showControls)
  videoContainer.value.addEventListener('touchstart', showControls)
}

// 监听 src 变化
watch(() => props.src, (newSrc) => {
  if (newSrc && player) {
    isLoading.value = true
    error.value = null
    player.load(newSrc).then(() => {
      isLoading.value = false
      loadQualities()
    }).catch((err) => {
      console.error('视频加载失败:', err)
      error.value = '视频加载失败'
      isLoading.value = false
    })
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
}

.video-container {
  width: 100%;
  height: 100%;
  position: relative;
}

.video-element {
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #000;
}

/* 自定义控制栏 */
.custom-controls {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.8), transparent);
  padding: 12px;
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
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.2s ease;
}

.control-btn:hover {
  transform: scale(1.1);
}

/* 进度条 */
.progress-container {
  flex: 1;
  cursor: pointer;
  padding: 8px 0;
}

.progress-bar {
  height: 4px;
  background: rgba(255, 255, 255, 0.3);
  border-radius: 2px;
  position: relative;
  overflow: visible;
}

.progress-buffered {
  position: absolute;
  height: 100%;
  background: rgba(255, 255, 255, 0.5);
  border-radius: 2px;
  transition: width 0.2s ease;
}

.progress-played {
  position: absolute;
  height: 100%;
  background: var(--primary-color, #ff2442);
  border-radius: 2px;
  transition: width 0.1s linear;
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
  transition: left 0.1s linear;
}

/* 时间显示 */
.time-display {
  color: white;
  font-size: 12px;
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 4px;
}

/* 音量控制 */
.volume-control {
  display: flex;
  align-items: center;
  gap: 8px;
}

.volume-slider {
  width: 60px;
  height: 4px;
  -webkit-appearance: none;
  appearance: none;
  background: rgba(255, 255, 255, 0.3);
  border-radius: 2px;
  outline: none;
}

.volume-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 12px;
  height: 12px;
  background: white;
  border-radius: 50%;
  cursor: pointer;
}

.volume-slider::-moz-range-thumb {
  width: 12px;
  height: 12px;
  background: white;
  border-radius: 50%;
  cursor: pointer;
  border: none;
}

/* 画质控制 */
.quality-control {
  position: relative;
}

.quality-text {
  color: white;
  font-size: 12px;
  font-weight: 500;
}

.quality-menu {
  position: absolute;
  bottom: 100%;
  right: 0;
  background: rgba(28, 28, 28, 0.95);
  border-radius: 4px;
  padding: 4px;
  margin-bottom: 8px;
  min-width: 80px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.quality-item {
  padding: 8px 12px;
  color: white;
  cursor: pointer;
  font-size: 13px;
  border-radius: 2px;
  transition: background 0.2s ease;
}

.quality-item:hover {
  background: rgba(255, 255, 255, 0.1);
}

.quality-item.active {
  background: var(--primary-color, #ff2442);
  font-weight: 500;
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
  gap: 12px;
  color: white;
  z-index: 20;
}

.spinner {
  width: 40px;
  height: 40px;
  border: 3px solid rgba(255, 255, 255, 0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 1s linear infinite;
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
  gap: 12px;
  color: white;
  text-align: center;
  padding: 20px;
  z-index: 20;
}

.error-overlay p {
  margin: 0;
  font-size: 14px;
}

/* 全屏模式 */
.fullscreen {
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
