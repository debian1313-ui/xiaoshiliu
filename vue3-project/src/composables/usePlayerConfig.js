import { ref, reactive, readonly } from 'vue'
import { settingsApi } from '@/api/settings.js'

// 单例状态
const playerConfig = reactive({
  autoplay: true,
  loop: false,
  muted: false,
  default_volume: 0.5,
  show_controls: true,
  buffering_goal: 30,
  rebuffering_goal: 2,
  buffer_behind: 30,
  abr_enabled: true,
  abr_default_bandwidth: 1000000,
  prefer_mpd: true
})

const isLoaded = ref(false)
const isLoading = ref(false)

/**
 * 播放器配置管理 composable
 * 用于获取后端配置的播放器参数
 */
export function usePlayerConfig() {
  /**
   * 加载播放器配置
   * @param {boolean} force - 是否强制重新加载
   */
  async function loadConfig(force = false) {
    // 如果已加载且不强制刷新，直接返回
    if (isLoaded.value && !force) {
      return playerConfig
    }

    // 防止重复加载
    if (isLoading.value) {
      return playerConfig
    }

    isLoading.value = true

    try {
      const result = await settingsApi.getPlayerConfig()
      
      if (result.success && result.data) {
        const config = result.data
        
        playerConfig.autoplay = config.autoplay ?? false
        playerConfig.loop = config.loop ?? false
        playerConfig.muted = config.muted ?? false
        playerConfig.default_volume = config.default_volume ?? 0.5
        playerConfig.show_controls = config.show_controls ?? true
        playerConfig.buffering_goal = config.buffering_goal ?? 30
        playerConfig.rebuffering_goal = config.rebuffering_goal ?? 2
        playerConfig.buffer_behind = config.buffer_behind ?? 30
        playerConfig.abr_enabled = config.abr_enabled ?? true
        playerConfig.abr_default_bandwidth = config.abr_default_bandwidth ?? 1000000
        playerConfig.prefer_mpd = config.prefer_mpd ?? true
        
        isLoaded.value = true
      }
    } catch (error) {
      console.error('加载播放器配置失败:', error)
      // 使用默认配置
    } finally {
      isLoading.value = false
    }

    return playerConfig
  }

  /**
   * 获取 Shaka Player 配置对象
   * 用于传递给 player.configure()
   */
  function getShakaConfig() {
    return {
      streaming: {
        bufferingGoal: playerConfig.buffering_goal,
        rebufferingGoal: playerConfig.rebuffering_goal,
        bufferBehind: playerConfig.buffer_behind,
        // 在Safari上使用原生HLS播放器
        useNativeHlsOnSafari: true,
        // 重试配置
        retryParameters: {
          maxAttempts: 3,
          baseDelay: 1000,
          backoffFactor: 2,
          fuzzFactor: 0.5
        }
      },
      abr: {
        enabled: playerConfig.abr_enabled,
        defaultBandwidthEstimate: playerConfig.abr_default_bandwidth
      },
      manifest: {
        retryParameters: {
          maxAttempts: 3,
          baseDelay: 1000,
          backoffFactor: 2,
          fuzzFactor: 0.5
        }
      }
    }
  }

  return {
    config: readonly(playerConfig),
    isLoaded: readonly(isLoaded),
    isLoading: readonly(isLoading),
    loadConfig,
    getShakaConfig
  }
}

export default usePlayerConfig
