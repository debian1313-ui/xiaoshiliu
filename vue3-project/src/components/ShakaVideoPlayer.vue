<template>
  <div class="shaka-video-player" :class="{ 'fullscreen': isFullscreen }">
    <div ref="videoContainer" class="video-container" @contextmenu.prevent="showContextMenu">
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
        <!-- PC版：进度条独立显示在上方 -->
        <div class="progress-row pc-only">
          <div class="progress-container" @click="seek" @mouseenter="controlsVisible = true">
            <div class="progress-bar">
              <div class="progress-buffered" :style="{ width: bufferedPercent + '%' }"></div>
              <div class="progress-played" :style="{ width: playedPercent + '%' }"></div>
              <div class="progress-handle" :style="{ left: playedPercent + '%' }"></div>
            </div>
          </div>
        </div>

        <!-- 控制按钮行 -->
        <div class="controls-row">
          <button 
            v-if="showPlayButton"
            @click="togglePlayPause" 
            class="control-btn play-btn"
            :title="isPlaying ? '暂停' : '播放'"
          >
            <SvgIcon :name="isPlaying ? 'pause' : 'play'" width="20" height="20" />
          </button>

          <!-- 移动端：进度条在控制行内 -->
          <div class="progress-container mobile-only" @click="seek" @mouseenter="controlsVisible = true">
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
    
    <!-- 右键菜单 (使用 Teleport 确保不被父容器裁剪) -->
    <Teleport to="body">
      <div 
        v-if="contextMenuVisible" 
        class="shaka-context-menu"
        :style="{ left: contextMenuPosition.x + 'px', top: contextMenuPosition.y + 'px' }"
        @click.stop
      >
        <div class="context-menu-header">视频统计信息</div>
        <div class="context-menu-item">
          <span class="context-menu-label">分辨率:</span>
          <span class="context-menu-value">{{ currentResolution || '未知' }}</span>
        </div>
        <div class="context-menu-item">
          <span class="context-menu-label">当前码率:</span>
          <span class="context-menu-value">{{ currentBitrateDisplay || '未知' }}</span>
        </div>
        <div v-if="estimatedBandwidthDisplay" class="context-menu-item">
          <span class="context-menu-label">网络带宽:</span>
          <span class="context-menu-value">{{ estimatedBandwidthDisplay }}</span>
        </div>
        <div v-if="videoCodec" class="context-menu-item">
          <span class="context-menu-label">视频编码:</span>
          <span class="context-menu-value">{{ videoCodec }}</span>
        </div>
        <div v-if="audioCodec" class="context-menu-item">
          <span class="context-menu-label">音频编码:</span>
          <span class="context-menu-value">{{ audioCodec }}</span>
        </div>
        <div class="context-menu-item">
          <span class="context-menu-label">缓冲进度:</span>
          <span class="context-menu-value">{{ Math.round(bufferedPercent) }}%</span>
        </div>
        <div class="context-menu-item">
          <span class="context-menu-label">播放进度:</span>
          <span class="context-menu-value">{{ formatTime(currentTime) }} / {{ formatTime(duration) }}</span>
        </div>
        <div v-if="decodedFrames > 0" class="context-menu-item">
          <span class="context-menu-label">帧信息:</span>
          <span class="context-menu-value">{{ decodedFrames }} 帧 / {{ droppedFrames }} 丢帧</span>
        </div>
        <div v-if="lastTrackSwitch" class="context-menu-item">
          <span class="context-menu-label">码率切换:</span>
          <span class="context-menu-value">{{ lastTrackSwitch }}</span>
        </div>
      </div>
    </Teleport>
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

// 右键菜单状态
const contextMenuVisible = ref(false)
const contextMenuPosition = ref({ x: 0, y: 0 })

// 码率和分辨率状态
const currentBitrate = ref(0)
const currentResolution = ref('')
const lastTrackSwitch = ref('')  // 最近一次码率切换详情
const videoCodec = ref('')       // 视频编码格式
const audioCodec = ref('')       // 音频编码格式
const droppedFrames = ref(0)     // 丢帧数
const decodedFrames = ref(0)     // 已解码帧数
const estimatedBandwidth = ref(0) // 估算带宽

// 计算当前码率显示文本
const currentBitrateDisplay = computed(() => {
  if (!currentBitrate.value) return ''
  const kbps = Math.round(currentBitrate.value / 1000)
  if (kbps >= 1000) {
    return `${(kbps / 1000).toFixed(1)} Mbps`
  }
  return `${kbps} kbps`
})

// 计算估算带宽显示文本
const estimatedBandwidthDisplay = computed(() => {
  if (!estimatedBandwidth.value) return ''
  const kbps = Math.round(estimatedBandwidth.value / 1000)
  if (kbps >= 1000) {
    return `${(kbps / 1000).toFixed(1)} Mbps`
  }
  return `${kbps} kbps`
})

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

// ABR重新启用定时器
let reEnableAbrTimer = null

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

    // 优化配置以提升DASH播放流畅度，参数可通过 .env 配置
    // 从环境变量读取配置，提供默认值
    // 调整默认带宽为2.5Mbps以优先选择720p（通常720p码率在1-2Mbps范围）
    const defaultBandwidth = parseInt(import.meta.env.VITE_VIDEO_DEFAULT_BANDWIDTH) || 2500000
    const bufferingGoal = parseInt(import.meta.env.VITE_VIDEO_BUFFERING_GOAL) || 16
    const rebufferingGoal = parseInt(import.meta.env.VITE_VIDEO_REBUFFERING_GOAL) || 5
    const bufferBehind = parseInt(import.meta.env.VITE_VIDEO_BUFFER_BEHIND) || 16
    const switchInterval = parseInt(import.meta.env.VITE_VIDEO_SWITCH_INTERVAL) || 8
    // 更保守的升级目标：避免过早升级导致频繁切换
    const bandwidthUpgradeTarget = parseFloat(import.meta.env.VITE_VIDEO_BANDWIDTH_UPGRADE_TARGET) || 0.95
    // 更低的降级目标：仅在带宽严重不足时才降级，避免频繁降低质量
    const bandwidthDowngradeTarget = parseFloat(import.meta.env.VITE_VIDEO_BANDWIDTH_DOWNGRADE_TARGET) || 0.35
    const debugConfig = import.meta.env.VITE_VIDEO_DEBUG_CONFIG === 'true'
    
    const playerConfig = {
      streaming: {
        bufferingGoal,                // 缓冲目标（秒）
        rebufferingGoal,              // 重新缓冲目标（秒）
        bufferBehind,                 // 保留后面的缓冲（秒）
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
        defaultBandwidthEstimate: defaultBandwidth,    // 默认带宽估计（2.5Mbps优先720p）
        switchInterval,                                 // 切换间隔（秒）- 增加到8秒避免频繁切换
        bandwidthUpgradeTarget,                         // 带宽升级目标 - 降低到0.75更积极升级
        bandwidthDowngradeTarget,                       // 带宽降级目标 - 降低到0.35仅在严重卡顿时降级
        // 使用统一的 restrictions 创建函数
        restrictions: createRestrictions(maxResolutionHeight)
      }
    }
    
    // 如果启用调试，输出配置到控制台
    if (debugConfig) {
      console.log('🎬 Shaka Player 配置:', {
        ...playerConfig,
        adaptiveBitrate: props.adaptiveBitrate,
        maxResolutionHeight: maxResolutionHeight || '不限制',
        strategy: '优先720p（不超过原始视频质量），仅在严重卡顿时降级',
        note: '最大分辨率和码率限制仅在ABR自动模式下生效，用户手动选择画质时不受限制',
        videoSrc: props.src
      })
    }
    
    player.configure(playerConfig)

    // 监听错误
    player.addEventListener('error', onPlayerError)
    
    // 监听码率变化事件
    player.addEventListener('adaptation', onAdaptation)

    // 加载视频源
    await player.load(props.src)

    // 加载完成
    isLoading.value = false
    emit('loaded')

    // 获取可用画质（对DASH视频有效）
    const useDash = isDashVideo(props.src)
    if (useDash) {
      loadQualities()
      
      // 获取原始视频的最高质量限制
      const tracks = player.getVariantTracks()
      if (tracks.length > 0) {
        const maxOriginalHeight = Math.max(...tracks.map(t => t.height))
        const maxOriginalBandwidth = Math.max(...tracks.map(t => t.bandwidth))
        
        // 应用原始视频质量限制到ABR配置
        // 确保自动模式不会选择超过原始视频质量的轨道
        const effectiveMaxHeight = maxResolutionHeight > 0 
          ? Math.min(maxResolutionHeight, maxOriginalHeight)
          : maxOriginalHeight
        
        player.configure({
          abr: {
            restrictions: {
              ...createRestrictions(effectiveMaxHeight),
              maxBandwidth: maxOriginalBandwidth  // 不超过原始最高码率
            }
          }
        })
        
        if (debugConfig) {
          console.log('📊 ABR质量限制已应用:', {
            原始最高分辨率: `${maxOriginalHeight}p`,
            原始最高码率: `${Math.round(maxOriginalBandwidth / 1000)}k`,
            ABR最大分辨率: `${effectiveMaxHeight}p`,
            ABR最大码率: `${Math.round(maxOriginalBandwidth / 1000)}k`
          })
        }
      }
      
      // 尝试选择默认轨道（优先720p，但不超过原始质量）
      selectDefaultBitrateTrack()
    }
    
    // 更新初始码率信息
    updateBitrateInfo()

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
  const newTime = duration.value * percent
  
  // 验证新时间是有效的有限数值
  if (isFinite(newTime) && newTime >= 0) {
    videoElement.value.currentTime = newTime
  }
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

// 获取最大分辨率配置
const maxResolutionHeight = parseInt(import.meta.env.VITE_VIDEO_MAX_RESOLUTION_HEIGHT) || 0

// 创建 restrictions 配置对象
const createRestrictions = (maxHeight) => ({
  minBandwidth: 0,
  maxBandwidth: Infinity,
  maxHeight: maxHeight || Infinity,
  minHeight: 0,
  maxWidth: Infinity,
  minWidth: 0
})

// 选择画质
const selectQuality = (quality) => {
  if (!player) return

  if (quality.id === -1) {
    // 自动模式 - 应用最大分辨率限制
    player.configure({ 
      abr: { 
        enabled: true,
        restrictions: createRestrictions(maxResolutionHeight)
      } 
    })
    console.log('选择画质: 自动模式')
  } else {
    // 手动选择画质 - 不应用分辨率限制，用户可以选择任何分辨率
    player.configure({ 
      abr: { 
        enabled: false,
        restrictions: createRestrictions(Infinity)
      } 
    })
    const tracks = player.getVariantTracks()
    const selectedTrack = tracks.find(t => t.id === quality.id)
    if (selectedTrack) {
      player.selectVariantTrack(selectedTrack, true)
      // 输出选择的分辨率和码率到控制台
      const resolution = `${selectedTrack.width}x${selectedTrack.height}`
      const bitrate = Math.round(selectedTrack.bandwidth / 1000)
      console.log(`选择画质: ${quality.label} (${resolution}) 码率: ${bitrate}k`)
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

// 码率变化事件处理
const onAdaptation = (event) => {
  // 记录码率切换详情
  const oldTrack = event?.oldTrack
  const newTrack = event?.newTrack
  
  if (newTrack) {
    const newBandwidth = newTrack.bandwidth || 0
    const newKbps = Math.round(newBandwidth / 1000)
    const newRes = newTrack.width && newTrack.height ? `${newTrack.width}x${newTrack.height}` : ''
    
    if (oldTrack && oldTrack.bandwidth) {
      const oldKbps = Math.round(oldTrack.bandwidth / 1000)
      const direction = newKbps > oldKbps ? '↑' : '↓'
      lastTrackSwitch.value = `${oldKbps}k ${direction} ${newKbps}k`
    } else {
      lastTrackSwitch.value = `→ ${newKbps}k ${newRes}`
    }
    
    console.log('码率切换:', lastTrackSwitch.value, newRes)
  }
  
  updateBitrateInfo()
}

// 更新码率信息
const updateBitrateInfo = () => {
  if (!player) return
  
  try {
    const stats = player.getStats()
    if (stats) {
      currentBitrate.value = stats.streamBandwidth || 0
      estimatedBandwidth.value = stats.estimatedBandwidth || 0
      droppedFrames.value = stats.droppedFrames || 0
      decodedFrames.value = stats.decodedFrames || 0
    }
    
    // 获取当前播放的轨道信息
    const tracks = player.getVariantTracks()
    const activeTrack = tracks.find(track => track.active)
    if (activeTrack) {
      currentResolution.value = `${activeTrack.width}x${activeTrack.height}`
      // 如果没有从stats获取到码率，使用轨道的带宽
      if (!currentBitrate.value && activeTrack.bandwidth) {
        currentBitrate.value = activeTrack.bandwidth
      }
      // 获取视频编码信息
      if (activeTrack.videoCodec) {
        videoCodec.value = activeTrack.videoCodec
      }
      if (activeTrack.audioCodec) {
        audioCodec.value = activeTrack.audioCodec
      }
    }
  } catch (err) {
    console.warn('获取码率信息失败:', err)
  }
}

// 选择默认码率轨道（优先选择720p，但不超过原始视频最高码率）
const selectDefaultBitrateTrack = () => {
  if (!player) return
  
  try {
    const tracks = player.getVariantTracks()
    if (tracks.length === 0) return
    
    // 找到原始视频的最高分辨率和最高码率（代表源视频质量）
    const maxOriginalHeight = Math.max(...tracks.map(t => t.height))
    const maxOriginalBandwidth = Math.max(...tracks.map(t => t.bandwidth))
    
    console.log(`📹 原始视频最高质量: ${maxOriginalHeight}p, 最高码率: ${Math.round(maxOriginalBandwidth / 1000)}k`)
    
    // 默认目标高度常量
    const DEFAULT_TARGET_HEIGHT = 720
    
    // 确定目标分辨率
    // 如果ABR已禁用且设置了VITE_VIDEO_MAX_RESOLUTION_HEIGHT，使用该配置作为固定分辨率
    // 否则优先720p，但不超过原始最高分辨率
    let targetHeight
    if (!props.adaptiveBitrate) {
      // ABR禁用模式
      if (maxResolutionHeight > 0) {
        // 使用VITE_VIDEO_MAX_RESOLUTION_HEIGHT作为固定分辨率
        targetHeight = Math.min(maxResolutionHeight, maxOriginalHeight)
        console.log(`🔒 ABR已禁用，使用固定分辨率: ${targetHeight}p（配置值: ${maxResolutionHeight}p）`)
      } else {
        // 未设置最大分辨率限制，使用默认720p
        targetHeight = Math.min(DEFAULT_TARGET_HEIGHT, maxOriginalHeight)
        console.log(`🔒 ABR已禁用，使用默认固定分辨率: ${targetHeight}p`)
      }
    } else {
      // ABR启用模式：优先720p作为默认起始分辨率
      targetHeight = Math.min(DEFAULT_TARGET_HEIGHT, maxOriginalHeight)
    }
    
    // 优先查找目标分辨率的轨道
    let defaultTrack = tracks.find(track => track.height === targetHeight)
    
    // 如果没有找到目标分辨率，则选择最接近且不超过目标的分辨率
    if (!defaultTrack) {
      // 过滤出不超过目标高度的轨道
      const validTracks = tracks.filter(track => track.height <= targetHeight)
      
      if (validTracks.length > 0) {
        // 在有效轨道中选择最接近目标的
        const sortedTracks = [...validTracks].sort((a, b) => {
          const diffA = Math.abs(a.height - targetHeight)
          const diffB = Math.abs(b.height - targetHeight)
          return diffA - diffB
        })
        defaultTrack = sortedTracks[0]
      } else {
        // 如果所有轨道都超过目标，选择最低的（不应该发生，但作为保险）
        defaultTrack = tracks.reduce((min, track) => 
          track.height < min.height ? track : min
        , tracks[0])
      }
    }
    
    // 如果找到了合适的轨道且不是当前轨道，则切换
    if (defaultTrack && !defaultTrack.active) {
      // 暂时禁用ABR，选择默认轨道
      player.configure({ abr: { enabled: false } })
      player.selectVariantTrack(defaultTrack, true)
      
      const resolution = `${defaultTrack.width}x${defaultTrack.height}`
      const bitrate = Math.round(defaultTrack.bandwidth / 1000)
      const note = defaultTrack.height < maxOriginalHeight ? `（原始最高${maxOriginalHeight}p）` : ''
      console.log(`✅ 已选择默认轨道: ${defaultTrack.height}p (${resolution}) 码率: ${bitrate}k ${note}`)
      
      // 如果ABR已启用，延迟重新启用ABR
      if (props.adaptiveBitrate) {
        const abrMessage = targetHeight === DEFAULT_TARGET_HEIGHT && maxOriginalHeight >= DEFAULT_TARGET_HEIGHT
          ? `🎯 ABR已启用: 优先保持${DEFAULT_TARGET_HEIGHT}p，仅在严重卡顿时降级`
          : `🎯 ABR已启用: 优先保持${targetHeight}p（原始最高${maxOriginalHeight}p），仅在严重卡顿时降级`
        
        // 延迟重新启用ABR，确保默认轨道有足够时间证明其稳定性
        // 如果默认轨道播放流畅且缓冲充足，就不需要频繁切换
        // 注意：以下是可调整的常量，不同视频长度可能需要不同值：
        // - 短视频（< 30秒）：沉淀期 5-10秒，缓冲阈值 3-5秒
        // - 中等视频（30秒 - 5分钟）：沉淀期 10-15秒，缓冲阈值 5-8秒
        // - 长视频（> 5分钟）：沉淀期 15-20秒，缓冲阈值 8-12秒
        const settlingPeriod = 15000  // 15秒沉淀期，让默认轨道充分缓冲
        const bufferThreshold = 8      // 8秒缓冲阈值，只有缓冲充足时才启用ABR
        
        // 清除之前的定时器（如果有）
        if (reEnableAbrTimer) {
          clearTimeout(reEnableAbrTimer)
        }
        
        reEnableAbrTimer = setTimeout(() => {
          if (player && props.adaptiveBitrate) {
            // 检查缓冲状态：只有在缓冲健康时才重新启用ABR
            const buffered = videoElement.value?.buffered
            const currentTime = videoElement.value?.currentTime || 0
            let bufferedAhead = 0
            
            if (buffered && buffered.length > 0) {
              for (let i = 0; i < buffered.length; i++) {
                if (buffered.start(i) <= currentTime && buffered.end(i) > currentTime) {
                  bufferedAhead = buffered.end(i) - currentTime
                  break
                }
              }
            }
            
            // 只有当前向缓冲超过阈值时才重新启用ABR
            // 这表明当前码率下网络状况良好，可以考虑升级
            if (bufferedAhead > bufferThreshold) {
              player.configure({ abr: { enabled: true } })
              console.log(abrMessage)
              console.log(`✅ 缓冲充足 (${bufferedAhead.toFixed(1)}秒)，ABR已重新启用`)
            } else {
              console.log(`⏸️ 缓冲不足 (${bufferedAhead.toFixed(1)}秒)，暂不启用ABR以保持稳定`)
            }
          }
        }, settlingPeriod)
      } else {
        // ABR已禁用，保持固定分辨率
        console.log(`🔒 ABR保持禁用状态，固定使用 ${defaultTrack.height}p`)
      }
    }
  } catch (err) {
    console.warn('选择默认码率轨道失败:', err)
  }
}

// 右键菜单相关
const showContextMenu = (event) => {
  event.preventDefault()
  event.stopPropagation()
  
  // 更新码率信息
  updateBitrateInfo()
  
  // 使用屏幕坐标 (因为菜单使用 position: fixed)
  let x = event.clientX
  let y = event.clientY
  
  // 限制菜单在窗口内
  const menuWidth = 250
  const menuHeight = 350
  
  // 确保菜单不会超出右边界
  if (x + menuWidth > window.innerWidth) {
    x = window.innerWidth - menuWidth - 10
  }
  // 确保菜单不会超出底部
  if (y + menuHeight > window.innerHeight) {
    y = window.innerHeight - menuHeight - 10
  }
  
  // 确保菜单不会超出顶部或左侧
  y = Math.max(10, y)
  x = Math.max(10, x)
  
  contextMenuPosition.value = { x, y }
  contextMenuVisible.value = true
  
  // 点击其他地方关闭菜单 (使用 setTimeout 确保不会立即触发)
  setTimeout(() => {
    document.addEventListener('click', hideContextMenu)
    document.addEventListener('contextmenu', hideContextMenuOnRightClick)
  }, 0)
}

const hideContextMenuOnRightClick = (event) => {
  // 如果右键点击在菜单外，关闭菜单但不阻止新菜单显示
  hideContextMenu()
}

const hideContextMenu = () => {
  contextMenuVisible.value = false
  document.removeEventListener('click', hideContextMenu)
  document.removeEventListener('contextmenu', hideContextMenuOnRightClick)
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

  // 上次更新码率的时间戳
  let lastBitrateUpdateTime = 0

  videoElement.value.addEventListener('timeupdate', () => {
    currentTime.value = videoElement.value.currentTime
    duration.value = videoElement.value.duration
    playedPercent.value = (currentTime.value / duration.value) * 100 || 0
    
    // 定期更新码率信息 - 每5秒更新一次，避免频繁更新
    const now = Date.now()
    if (now - lastBitrateUpdateTime >= 5000) {
      updateBitrateInfo()
      lastBitrateUpdateTime = now
    }
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
  
  if (player) {
    // 如果有 Shaka Player 实例，使用它加载所有视频格式
    player.load(newSrc).then(() => {
      isLoading.value = false
      // 检查是否是 DASH 视频以加载画质选项
      if (isDashVideo(newSrc)) {
        loadQualities()
        
        // 获取原始视频的最高质量限制
        const tracks = player.getVariantTracks()
        if (tracks.length > 0) {
          const maxOriginalHeight = Math.max(...tracks.map(t => t.height))
          const maxOriginalBandwidth = Math.max(...tracks.map(t => t.bandwidth))
          
          // 应用原始视频质量限制到ABR配置
          const effectiveMaxHeight = maxResolutionHeight > 0 
            ? Math.min(maxResolutionHeight, maxOriginalHeight)
            : maxOriginalHeight
          
          player.configure({
            abr: {
              restrictions: {
                ...createRestrictions(effectiveMaxHeight),
                maxBandwidth: maxOriginalBandwidth  // 不超过原始最高码率
              }
            }
          })
        }
        
        // 尝试选择默认轨道（优先720p，但不超过原始质量）
        selectDefaultBitrateTrack()
      }
      // 更新码率信息
      updateBitrateInfo()
    }).catch((err) => {
      console.error('视频加载失败:', err)
      error.value = '视频加载失败'
      isLoading.value = false
    })
  } else {
    // 如果没有 Shaka Player 实例，重新初始化
    initPlayer()
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
  if (reEnableAbrTimer) {
    clearTimeout(reEnableAbrTimer)
  }
  if (player) {
    // 移除adaptation事件监听器
    player.removeEventListener('adaptation', onAdaptation)
    player.destroy()
  }
  
  // 清理右键菜单事件监听器
  document.removeEventListener('click', hideContextMenu)
  document.removeEventListener('contextmenu', hideContextMenu)
  
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
  seek: (time) => { 
    if (videoElement.value && isFinite(time) && time >= 0) {
      videoElement.value.currentTime = time
    }
  }
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

/* 隐藏原生视频控制栏（特别是Windows Chrome的默认进度条） */
.video-element::-webkit-media-controls {
  display: none !important;
}

.video-element::-webkit-media-controls-enclosure {
  display: none !important;
}

.video-element::-webkit-media-controls-panel {
  display: none !important;
}

/* 自定义控制栏 */
.custom-controls {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.85) 0%, rgba(0, 0, 0, 0.6) 50%, transparent 100%);
  padding: 30px 16px 16px;
  opacity: 0;
  transition: opacity 0.3s ease;
  z-index: 10;
}

.custom-controls.visible {
  opacity: 1;
}

/* 鼠标悬停在视频容器上时显示控制栏 */
.video-container:hover .custom-controls {
  opacity: 1;
}

/* PC版和移动版显示控制 */
.pc-only {
  display: flex;
}

.mobile-only {
  display: none;
}

/* 进度条行（PC版独立显示在上方） */
.progress-row {
  width: 100%;
  margin-bottom: 8px;
}

/* 移动端controls-row中的进度条需要flex:1 */
.controls-row .progress-container {
  display: none; /* PC端默认不显示controls-row中的进度条 */
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
  width: 100%;
  cursor: pointer;
  padding: 8px 0;
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

/* 响应式设计 - 移动端恢复单行布局 */
@media (max-width: 768px) {
  /* 移动端：隐藏独立的进度条行，使用controls-row中的进度条 */
  .pc-only {
    display: none !important;
  }
  
  .mobile-only {
    display: block;
  }
  
  /* 移动端controls-row中显示进度条 */
  .controls-row .progress-container {
    display: block;
    flex: 1;
    padding: 10px 0;
    margin: 0 4px;
  }
  
  .custom-controls {
    padding: 8px;
  }
  
  .controls-row {
    gap: 8px;
  }

  .volume-control {
    display: none;
  }

  .time-display {
    font-size: 11px;
  }
}
</style>

<!-- 非scoped样式用于Teleport到body的右键菜单 -->
<style>
/* 右键菜单样式 (Teleport到body，不能使用scoped) */
.shaka-context-menu {
  position: fixed;
  background: rgba(24, 24, 24, 0.98);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  padding: 12px 0;
  min-width: 240px;
  max-height: 400px;
  overflow-y: auto;
  z-index: 99999;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(12px);
  animation: shakaContextMenuFadeIn 0.15s ease-out;
}

@keyframes shakaContextMenuFadeIn {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.shaka-context-menu .context-menu-header {
  color: rgba(255, 255, 255, 0.6);
  font-size: 12px;
  font-weight: 600;
  padding: 6px 16px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.shaka-context-menu .context-menu-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 16px;
  color: white;
  font-size: 13px;
}

.shaka-context-menu .context-menu-item:hover {
  background: rgba(255, 255, 255, 0.08);
}

.shaka-context-menu .context-menu-label {
  color: rgba(255, 255, 255, 0.7);
}

.shaka-context-menu .context-menu-value {
  color: #4ade80;
  font-weight: 500;
  font-family: monospace;
}
</style>
