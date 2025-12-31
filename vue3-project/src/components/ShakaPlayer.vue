<template>
  <div class="shaka-player-container" ref="containerRef">
    <!-- 视频元素 -->
    <video 
      ref="videoRef"
      :poster="poster"
      @click="togglePlayPause"
      class="shaka-video"
      playsinline
      webkit-playsinline="true"
    ></video>

    <!-- 加载状态 -->
    <div v-if="isLoading" class="loading-overlay">
      <div class="loading-spinner"></div>
      <span class="loading-text">加载中...</span>
    </div>

    <!-- 错误提示 -->
    <div v-if="error" class="error-overlay">
      <SvgIcon name="warning" width="32" height="32" />
      <span class="error-text">{{ error }}</span>
      <button class="retry-btn" @click="retry">重试</button>
    </div>

    <!-- 自定义控制栏 -->
    <div 
      v-if="showControls && !error" 
      class="controls-overlay"
      :class="{ visible: controlsVisible }"
      @mouseenter="showControlsBar"
      @mouseleave="hideControlsBar"
    >
      <!-- 播放/暂停按钮（中心）- 可通过showCenterPlayButton配置是否显示 -->
      <div v-if="showCenterPlayButton && !isPlaying" class="center-controls" @click.stop="togglePlayPause">
        <button class="center-play-btn">
          <SvgIcon name="play" width="48" height="48" />
        </button>
      </div>

      <!-- 底部控制栏 -->
      <div class="bottom-controls">
        <!-- 进度条 -->
        <div class="progress-bar-container" @click="seekTo">
          <div class="progress-bar">
            <div class="progress-buffered" :style="{ width: bufferedPercent + '%' }"></div>
            <div class="progress-played" :style="{ width: playedPercent + '%' }"></div>
          </div>
        </div>

        <div class="controls-row">
          <!-- 左侧控制 -->
          <div class="left-controls">
            <button class="control-btn" @click.stop="togglePlayPause">
              <SvgIcon :name="isPlaying ? 'pause' : 'play'" width="20" height="20" />
            </button>
            <span class="time-display">{{ formatTime(currentTime) }} / {{ formatTime(duration) }}</span>
          </div>

          <!-- 右侧控制 -->
          <div class="right-controls">
            <!-- 音量控制 -->
            <div class="volume-control" @mouseenter="showVolumeSlider = true" @mouseleave="showVolumeSlider = false">
              <button class="control-btn" @click.stop="toggleMute">
                <SvgIcon :name="volumeIcon" width="20" height="20" />
              </button>
              <div class="volume-slider-container" v-show="showVolumeSlider">
                <input 
                  type="range" 
                  class="volume-slider"
                  min="0" 
                  max="1" 
                  step="0.05"
                  v-model="volume"
                  @input="setVolume"
                />
              </div>
            </div>

            <!-- 画质选择 -->
            <div class="quality-control" v-if="qualityLevels.length > 1">
              <button class="control-btn quality-btn" @click.stop="toggleQualityMenu">
                <span class="quality-text">{{ currentQualityLabel }}</span>
              </button>
              <div class="quality-menu" v-show="showQualityMenu">
                <div 
                  class="quality-option"
                  :class="{ active: selectedQuality === 'auto' }"
                  @click.stop="selectQuality('auto')"
                >
                  自动
                </div>
                <div 
                  v-for="quality in qualityLevels" 
                  :key="quality.height"
                  class="quality-option"
                  :class="{ active: selectedQuality === quality.height }"
                  @click.stop="selectQuality(quality.height)"
                >
                  {{ quality.label }}
                </div>
              </div>
            </div>

            <!-- 全屏 -->
            <button class="control-btn" @click.stop="toggleFullscreen">
              <SvgIcon :name="isFullscreen ? 'fullscreen-exit' : 'fullscreen'" width="20" height="20" />
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import SvgIcon from './SvgIcon.vue'

const props = defineProps({
  // 视频源URL（支持DASH MPD、HLS、普通MP4）
  src: {
    type: String,
    required: true
  },
  // 封面图
  poster: {
    type: String,
    default: ''
  },
  // 是否自动播放
  autoplay: {
    type: Boolean,
    default: false
  },
  // 是否循环
  loop: {
    type: Boolean,
    default: false
  },
  // 是否显示控制栏
  showControls: {
    type: Boolean,
    default: true
  },
  // 是否显示中心播放按钮（默认不显示，遵循Shaka官方实践）
  showCenterPlayButton: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['play', 'pause', 'ended', 'error', 'timeupdate', 'qualitychange'])

// DOM引用
const containerRef = ref(null)
const videoRef = ref(null)

// Shaka Player实例
let player = null
let shakaLoaded = false

// 播放状态
const isLoading = ref(true)
const isPlaying = ref(false)
const error = ref(null)
const currentTime = ref(0)
const duration = ref(0)
const buffered = ref(0)
const volume = ref(1)
const isMuted = ref(false)
const isFullscreen = ref(false)

// 控制栏状态
const controlsVisible = ref(true)
const showVolumeSlider = ref(false)
const showQualityMenu = ref(false)
let controlsTimer = null

// 画质相关
const qualityLevels = ref([])
const selectedQuality = ref('auto')
const currentQuality = ref(null)

// 计算属性
const playedPercent = computed(() => {
  if (!duration.value) return 0
  return (currentTime.value / duration.value) * 100
})

const bufferedPercent = computed(() => {
  if (!duration.value) return 0
  return (buffered.value / duration.value) * 100
})

const volumeIcon = computed(() => {
  if (isMuted.value || volume.value === 0) return 'volume-mute'
  if (volume.value < 0.5) return 'volume-low'
  return 'volume-high'
})

const currentQualityLabel = computed(() => {
  if (selectedQuality.value === 'auto') {
    return currentQuality.value ? `自动(${currentQuality.value}p)` : '自动'
  }
  return `${selectedQuality.value}p`
})

// 加载Shaka Player库
async function loadShakaPlayer() {
  if (shakaLoaded) return true
  
  return new Promise((resolve, reject) => {
    // 检查是否已加载
    if (window.shaka) {
      shakaLoaded = true
      resolve(true)
      return
    }
    
    // 加载CSS
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = '/libs/shaka-player/controls.min.css'
    document.head.appendChild(link)
    
    // 加载JS
    const script = document.createElement('script')
    script.src = '/libs/shaka-player/shaka-player.compiled.min.js'
    script.onload = () => {
      shakaLoaded = true
      resolve(true)
    }
    script.onerror = () => {
      reject(new Error('加载Shaka Player失败'))
    }
    document.head.appendChild(script)
  })
}

// 初始化播放器
async function initPlayer() {
  if (!videoRef.value) return

  try {
    isLoading.value = true
    error.value = null

    // 加载Shaka Player
    await loadShakaPlayer()

    // 检查浏览器支持
    const shaka = window.shaka
    if (!shaka) {
      throw new Error('Shaka Player 加载失败')
    }
    shaka.polyfill.installAll()

    if (!shaka.Player.isBrowserSupported()) {
      throw new Error('浏览器不支持Shaka Player')
    }

    // 创建播放器实例
    player = new shaka.Player()
    await player.attach(videoRef.value)

    // 配置播放器
    player.configure({
      streaming: {
        bufferingGoal: 30,
        rebufferingGoal: 2,
        bufferBehind: 30
      },
      abr: {
        enabled: true,
        defaultBandwidthEstimate: 1000000
      }
    })

    // 监听事件
    player.addEventListener('error', onPlayerError)
    player.addEventListener('adaptation', onAdaptation)

    // 加载视频源
    await loadSource(props.src)

    // 设置视频事件
    setupVideoEvents()

  } catch (err) {
    console.error('初始化Shaka Player失败:', err)
    error.value = err.message || '播放器初始化失败'
    isLoading.value = false
  }
}

// 加载视频源
async function loadSource(src) {
  if (!player || !src) return

  try {
    isLoading.value = true
    error.value = null

    await player.load(src)

    // 获取画质选项
    updateQualityLevels()

    isLoading.value = false

    if (props.autoplay) {
      try {
        await videoRef.value.play()
      } catch (e) {
        console.log('自动播放失败:', e.message)
      }
    }
  } catch (err) {
    console.error('加载视频失败:', err)
    error.value = '视频加载失败'
    isLoading.value = false
  }
}

// 更新画质选项
function updateQualityLevels() {
  if (!player) return

  const tracks = player.getVariantTracks()
  const heights = [...new Set(tracks.map(t => t.height))].sort((a, b) => b - a)
  
  qualityLevels.value = heights.map(h => ({
    height: h,
    label: `${h}p`
  }))
}

// 设置视频事件监听
function setupVideoEvents() {
  const video = videoRef.value
  if (!video) return

  video.addEventListener('play', () => {
    isPlaying.value = true
    emit('play')
  })

  video.addEventListener('pause', () => {
    isPlaying.value = false
    emit('pause')
  })

  video.addEventListener('ended', () => {
    isPlaying.value = false
    if (props.loop) {
      video.currentTime = 0
      video.play()
    }
    emit('ended')
  })

  video.addEventListener('timeupdate', () => {
    currentTime.value = video.currentTime
    emit('timeupdate', { currentTime: video.currentTime, duration: video.duration })
  })

  video.addEventListener('durationchange', () => {
    duration.value = video.duration
  })

  video.addEventListener('progress', () => {
    if (video.buffered.length > 0) {
      buffered.value = video.buffered.end(video.buffered.length - 1)
    }
  })

  video.addEventListener('volumechange', () => {
    volume.value = video.volume
    isMuted.value = video.muted
  })

  video.addEventListener('waiting', () => {
    isLoading.value = true
  })

  video.addEventListener('canplay', () => {
    isLoading.value = false
  })
}

// 播放器错误处理
function onPlayerError(event) {
  const detail = event.detail
  console.error('Shaka Player错误:', detail)
  error.value = '视频播放出错'
  emit('error', detail)
}

// 自适应码率变化
function onAdaptation() {
  const tracks = player.getVariantTracks()
  const activeTrack = tracks.find(t => t.active)
  if (activeTrack) {
    currentQuality.value = activeTrack.height
    emit('qualitychange', { height: activeTrack.height, label: `${activeTrack.height}p` })
  }
}

// 播放/暂停切换
function togglePlayPause() {
  if (!videoRef.value) return
  
  if (isPlaying.value) {
    videoRef.value.pause()
  } else {
    videoRef.value.play()
  }
}

// 静音切换
function toggleMute() {
  if (!videoRef.value) return
  videoRef.value.muted = !videoRef.value.muted
}

// 设置音量
function setVolume() {
  if (!videoRef.value) return
  videoRef.value.volume = volume.value
  if (volume.value > 0 && videoRef.value.muted) {
    videoRef.value.muted = false
  }
}

// 跳转
function seekTo(event) {
  if (!videoRef.value || !duration.value) return
  const rect = event.currentTarget.getBoundingClientRect()
  const percent = (event.clientX - rect.left) / rect.width
  videoRef.value.currentTime = percent * duration.value
}

// 画质选择
function selectQuality(height) {
  selectedQuality.value = height
  showQualityMenu.value = false

  if (!player) return

  if (height === 'auto') {
    player.configure('abr.enabled', true)
  } else {
    player.configure('abr.enabled', false)
    const tracks = player.getVariantTracks()
    const targetTrack = tracks.find(t => t.height === height)
    if (targetTrack) {
      player.selectVariantTrack(targetTrack, true)
    }
  }
}

function toggleQualityMenu() {
  showQualityMenu.value = !showQualityMenu.value
}

// 全屏切换
function toggleFullscreen() {
  if (!containerRef.value) return

  if (document.fullscreenElement) {
    document.exitFullscreen()
    isFullscreen.value = false
  } else {
    containerRef.value.requestFullscreen()
    isFullscreen.value = true
  }
}

// 控制栏显示/隐藏
function showControlsBar() {
  controlsVisible.value = true
  resetControlsTimer()
}

function hideControlsBar() {
  resetControlsTimer()
}

function resetControlsTimer() {
  if (controlsTimer) {
    clearTimeout(controlsTimer)
  }
  controlsTimer = setTimeout(() => {
    if (isPlaying.value) {
      controlsVisible.value = false
    }
  }, 3000)
}

// 时间格式化
function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

// 重试
function retry() {
  initPlayer()
}

// 监听src变化
watch(() => props.src, (newSrc) => {
  if (newSrc && player) {
    loadSource(newSrc)
  }
})

// 监听全屏变化
function onFullscreenChange() {
  isFullscreen.value = !!document.fullscreenElement
}

// 生命周期
onMounted(() => {
  initPlayer()
  document.addEventListener('fullscreenchange', onFullscreenChange)
})

onUnmounted(() => {
  if (controlsTimer) {
    clearTimeout(controlsTimer)
  }
  if (player) {
    player.destroy()
    player = null
  }
  document.removeEventListener('fullscreenchange', onFullscreenChange)
})

// 暴露方法
defineExpose({
  play: () => videoRef.value?.play(),
  pause: () => videoRef.value?.pause(),
  seek: (time) => { if (videoRef.value) videoRef.value.currentTime = time },
  getPlayer: () => player,
  getCurrentTime: () => currentTime.value,
  getDuration: () => duration.value
})
</script>

<style scoped>
.shaka-player-container {
  position: relative;
  width: 100%;
  height: 100%;
  background: #000;
  overflow: hidden;
  border-radius: inherit;
}

.shaka-video {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

/* 加载状态 */
.loading-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
  gap: 12px;
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid rgba(255, 255, 255, 0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

.loading-text {
  color: white;
  font-size: 14px;
}

/* 错误状态 */
.error-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.8);
  gap: 12px;
  color: white;
}

.error-text {
  font-size: 14px;
}

.retry-btn {
  padding: 8px 20px;
  background: var(--primary-color, #007aff);
  color: white;
  border: none;
  border-radius: 20px;
  cursor: pointer;
  font-size: 14px;
}

.retry-btn:hover {
  opacity: 0.9;
}

/* 控制栏 */
.controls-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  opacity: 0;
  transition: opacity 0.3s ease;
  pointer-events: none;
}

.controls-overlay.visible {
  opacity: 1;
  pointer-events: auto;
}

.shaka-player-container:hover .controls-overlay {
  opacity: 1;
  pointer-events: auto;
}

/* 中心播放按钮 */
.center-controls {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
}

.center-play-btn {
  width: 64px;
  height: 64px;
  background: rgba(0, 0, 0, 0.6);
  border: none;
  border-radius: 50%;
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.center-play-btn:hover {
  background: rgba(0, 0, 0, 0.8);
  transform: scale(1.1);
}

/* 底部控制栏 - 透明背景，3秒淡出 */
.bottom-controls {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 16px;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.4));
  transition: opacity 0.3s ease;
}

/* 进度条 */
.progress-bar-container {
  width: 100%;
  height: 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  padding: 6px 0;
}

.progress-bar {
  width: 100%;
  height: 4px;
  background: rgba(255, 255, 255, 0.3);
  border-radius: 2px;
  position: relative;
  overflow: hidden;
}

.progress-bar:hover {
  height: 6px;
}

.progress-buffered {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  background: rgba(255, 255, 255, 0.5);
}

.progress-played {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  background: var(--primary-color, #007aff);
}

/* 控制行 */
.controls-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 8px;
}

.left-controls,
.right-controls {
  display: flex;
  align-items: center;
  gap: 12px;
}

.control-btn {
  background: none;
  border: none;
  color: white;
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: opacity 0.2s;
}

.control-btn:hover {
  opacity: 0.8;
}

.time-display {
  color: white;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

/* 音量控制 */
.volume-control {
  position: relative;
  display: flex;
  align-items: center;
}

.volume-slider-container {
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  padding: 10px;
  background: rgba(0, 0, 0, 0.8);
  border-radius: 8px;
  margin-bottom: 8px;
}

.volume-slider {
  width: 80px;
  height: 4px;
  -webkit-appearance: none;
  background: rgba(255, 255, 255, 0.3);
  border-radius: 2px;
  outline: none;
}

.volume-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 14px;
  height: 14px;
  background: white;
  border-radius: 50%;
  cursor: pointer;
}

/* 画质选择 */
.quality-control {
  position: relative;
}

.quality-btn {
  min-width: 60px;
}

.quality-text {
  font-size: 12px;
  font-weight: 500;
}

.quality-menu {
  position: absolute;
  bottom: 100%;
  right: 0;
  background: rgba(0, 0, 0, 0.9);
  border-radius: 8px;
  padding: 8px 0;
  margin-bottom: 8px;
  min-width: 100px;
}

.quality-option {
  padding: 8px 16px;
  color: white;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.2s;
}

.quality-option:hover {
  background: rgba(255, 255, 255, 0.1);
}

.quality-option.active {
  color: var(--primary-color, #007aff);
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* 响应式 */
@media (max-width: 768px) {
  .bottom-controls {
    padding: 12px;
  }

  .center-play-btn {
    width: 48px;
    height: 48px;
  }

  .center-play-btn svg {
    width: 32px;
    height: 32px;
  }

  .controls-row {
    gap: 8px;
  }

  .left-controls,
  .right-controls {
    gap: 8px;
  }

  .time-display {
    font-size: 12px;
  }
}
</style>
