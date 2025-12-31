<template>
  <div class="system-settings">
    <div class="settings-container">
      <!-- 视频转码设置卡片 -->
      <div class="settings-card">
        <div class="card-header">
          <div class="card-title">
            <SvgIcon name="video" class="title-icon" />
            <span>视频转码设置</span>
          </div>
          <div class="ffmpeg-status" :class="{ available: ffmpegAvailable }">
            <SvgIcon :name="ffmpegAvailable ? 'tick' : 'close'" class="status-icon" />
            <span>FFmpeg {{ ffmpegAvailable ? '可用' : '不可用' }}</span>
          </div>
        </div>

        <!-- FFmpeg 路径信息 -->
        <div class="ffmpeg-path-info">
          <div class="path-item">
            <span class="path-label">FFmpeg 路径:</span>
            <span class="path-value">{{ ffmpegConfig.ffmpegPath || '(系统 PATH)' }}</span>
          </div>
          <div class="path-item">
            <span class="path-label">FFprobe 路径:</span>
            <span class="path-value">{{ ffmpegConfig.ffprobePath || '(系统 PATH)' }}</span>
          </div>
          <div class="path-hint">
            提示: 可在 .env 文件中配置 FFMPEG_PATH 和 FFPROBE_PATH 指定二进制文件路径
          </div>
        </div>

        <div class="card-body">
          <!-- 转码开关 -->
          <div class="setting-item">
            <div class="setting-info">
              <div class="setting-label">启用视频转码</div>
              <div class="setting-description">
                开启后，上传的视频将自动转码为DASH格式，支持自适应码率播放
              </div>
            </div>
            <div class="setting-control">
              <label class="switch">
                <input 
                  type="checkbox" 
                  v-model="settings.video_transcode_enabled"
                  @change="handleSettingChange('video_transcode_enabled', settings.video_transcode_enabled)"
                  :disabled="!ffmpegAvailable"
                />
                <span class="slider"></span>
              </label>
            </div>
          </div>

          <!-- 码率设置 -->
          <div class="setting-item" :class="{ disabled: !settings.video_transcode_enabled }">
            <div class="setting-info">
              <div class="setting-label">最小码率 (kbps)</div>
              <div class="setting-description">
                视频转码的最低码率，用于低带宽网络环境
              </div>
            </div>
            <div class="setting-control">
              <input 
                type="number" 
                class="input-field"
                v-model.number="settings.video_transcode_min_bitrate"
                :disabled="!settings.video_transcode_enabled"
                min="100"
                max="10000"
                step="100"
                @change="handleSettingChange('video_transcode_min_bitrate', settings.video_transcode_min_bitrate)"
              />
            </div>
          </div>

          <div class="setting-item" :class="{ disabled: !settings.video_transcode_enabled }">
            <div class="setting-info">
              <div class="setting-label">最大码率 (kbps)</div>
              <div class="setting-description">
                视频转码的最高码率，用于高带宽网络环境
              </div>
            </div>
            <div class="setting-control">
              <input 
                type="number" 
                class="input-field"
                v-model.number="settings.video_transcode_max_bitrate"
                :disabled="!settings.video_transcode_enabled"
                min="500"
                max="20000"
                step="100"
                @change="handleSettingChange('video_transcode_max_bitrate', settings.video_transcode_max_bitrate)"
              />
            </div>
          </div>

          <!-- 转码格式 -->
          <div class="setting-item" :class="{ disabled: !settings.video_transcode_enabled }">
            <div class="setting-info">
              <div class="setting-label">转码格式</div>
              <div class="setting-description">
                选择视频流媒体格式
              </div>
            </div>
            <div class="setting-control">
              <select 
                class="select-field"
                v-model="settings.video_transcode_format"
                :disabled="!settings.video_transcode_enabled"
                @change="handleSettingChange('video_transcode_format', settings.video_transcode_format)"
              >
                <option value="dash">DASH (推荐)</option>
                <option value="hls">HLS</option>
              </select>
            </div>
          </div>

          <!-- 输出目录模式 -->
          <div class="setting-item" :class="{ disabled: !settings.video_transcode_enabled }">
            <div class="setting-info">
              <div class="setting-label">输出目录组织方式</div>
              <div class="setting-description">
                选择转码后视频的存储目录结构
              </div>
            </div>
            <div class="setting-control">
              <select 
                class="select-field"
                v-model="settings.video_transcode_output_dir_mode"
                :disabled="!settings.video_transcode_enabled"
                @change="handleSettingChange('video_transcode_output_dir_mode', settings.video_transcode_output_dir_mode)"
              >
                <option value="datetime">按日期时间 (YYYY/MM/DD/HH)</option>
                <option value="date">按日期 (YYYY/MM/DD)</option>
                <option value="flat">不分目录</option>
              </select>
            </div>
          </div>

          <!-- 保留原文件 -->
          <div class="setting-item" :class="{ disabled: !settings.video_transcode_enabled }">
            <div class="setting-info">
              <div class="setting-label">保留原始视频文件</div>
              <div class="setting-description">
                转码完成后是否保留原始上传的视频文件
              </div>
            </div>
            <div class="setting-control">
              <label class="switch">
                <input 
                  type="checkbox" 
                  v-model="settings.video_transcode_retain_original"
                  @change="handleSettingChange('video_transcode_retain_original', settings.video_transcode_retain_original)"
                  :disabled="!settings.video_transcode_enabled"
                />
                <span class="slider"></span>
              </label>
            </div>
          </div>

          <!-- 最大并发任务数 -->
          <div class="setting-item" :class="{ disabled: !settings.video_transcode_enabled }">
            <div class="setting-info">
              <div class="setting-label">最大并发转码任务</div>
              <div class="setting-description">
                同时进行转码的最大任务数量 (1-10)
              </div>
            </div>
            <div class="setting-control">
              <input 
                type="number" 
                class="input-field"
                v-model.number="settings.video_transcode_max_concurrent"
                :disabled="!settings.video_transcode_enabled"
                min="1"
                max="10"
                step="1"
                @change="handleSettingChange('video_transcode_max_concurrent', settings.video_transcode_max_concurrent)"
              />
            </div>
          </div>
        </div>

        <!-- 播放器UI设置分组 -->
        <div class="settings-group">
          <div class="group-title">
            <SvgIcon name="video" />
            <span>播放器UI设置</span>
          </div>

          <!-- 显示中心播放按钮 -->
          <div class="setting-item">
            <div class="setting-info">
              <div class="setting-label">显示中心播放按钮</div>
              <div class="setting-description">
                是否在视频播放器中心显示播放按钮（Shaka官方实践建议关闭）
              </div>
            </div>
            <div class="setting-control">
              <label class="toggle-switch">
                <input 
                  type="checkbox"
                  v-model="settings.video_player_show_center_play_button"
                  @change="handleSettingChange('video_player_show_center_play_button', settings.video_player_show_center_play_button)"
                />
                <span class="slider"></span>
              </label>
            </div>
          </div>

          <!-- 自动播放 -->
          <div class="setting-item">
            <div class="setting-info">
              <div class="setting-label">自动播放</div>
              <div class="setting-description">
                视频加载后是否自动播放（部分浏览器可能限制）
              </div>
            </div>
            <div class="setting-control">
              <label class="toggle-switch">
                <input 
                  type="checkbox"
                  v-model="settings.video_player_autoplay"
                  @change="handleSettingChange('video_player_autoplay', settings.video_player_autoplay)"
                />
                <span class="slider"></span>
              </label>
            </div>
          </div>

          <!-- 循环播放 -->
          <div class="setting-item">
            <div class="setting-info">
              <div class="setting-label">循环播放</div>
              <div class="setting-description">
                视频播放完成后是否自动重新播放
              </div>
            </div>
            <div class="setting-control">
              <label class="toggle-switch">
                <input 
                  type="checkbox"
                  v-model="settings.video_player_loop"
                  @change="handleSettingChange('video_player_loop', settings.video_player_loop)"
                />
                <span class="slider"></span>
              </label>
            </div>
          </div>

          <!-- 显示控制栏 -->
          <div class="setting-item">
            <div class="setting-info">
              <div class="setting-label">显示控制栏</div>
              <div class="setting-description">
                是否显示视频播放器底部控制栏
              </div>
            </div>
            <div class="setting-control">
              <label class="toggle-switch">
                <input 
                  type="checkbox"
                  v-model="settings.video_player_show_controls"
                  @change="handleSettingChange('video_player_show_controls', settings.video_player_show_controls)"
                />
                <span class="slider"></span>
              </label>
            </div>
          </div>
        </div>

        <!-- 码率预览 -->
        <div class="bitrate-preview" v-if="settings.video_transcode_enabled">
          <div class="preview-title">质量等级预览</div>
          <div class="quality-levels">
            <div class="quality-item" v-for="quality in qualityLevels" :key="quality.label">
              <span class="quality-label">{{ quality.label }}</span>
              <span class="quality-bitrate">{{ quality.bitrate }} kbps</span>
            </div>
          </div>
        </div>

        <!-- 转码队列状态 -->
        <div class="queue-status" v-if="settings.video_transcode_enabled && queueStatus">
          <div class="queue-header">
            <div class="preview-title">转码队列状态</div>
            <button class="refresh-btn" @click="refreshQueueStatus" :disabled="refreshingQueue">
              <SvgIcon name="refresh" class="refresh-icon" :class="{ spinning: refreshingQueue }" />
            </button>
          </div>
          <div class="queue-stats">
            <div class="queue-stat">
              <span class="stat-value">{{ queueStatus.pending }}</span>
              <span class="stat-label">等待中</span>
            </div>
            <div class="queue-stat active">
              <span class="stat-value">{{ queueStatus.active }}</span>
              <span class="stat-label">进行中</span>
            </div>
            <div class="queue-stat completed">
              <span class="stat-value">{{ queueStatus.completed }}</span>
              <span class="stat-label">已完成</span>
            </div>
          </div>
          
          <!-- 活动任务列表 -->
          <div class="active-jobs" v-if="queueStatus.jobs?.active?.length > 0">
            <div class="jobs-title">正在转码</div>
            <div class="job-item" v-for="job in queueStatus.jobs.active" :key="job.taskId">
              <span class="job-name">{{ job.fileName }}</span>
              <div class="job-progress">
                <div class="progress-bar">
                  <div class="progress-fill" :style="{ width: job.progress + '%' }"></div>
                </div>
                <span class="progress-text">{{ job.progress }}%</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 保存按钮 -->
      <div class="actions">
        <button class="save-btn" @click="saveAllSettings" :disabled="!hasChanges || saving">
          <SvgIcon v-if="saving" name="loading" class="loading-icon" />
          <span>{{ saving ? '保存中...' : '保存设置' }}</span>
        </button>
      </div>
    </div>

    <MessageToast v-if="showToast" :message="toastMessage" :type="toastType" @close="showToast = false" />
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import SvgIcon from '@/components/SvgIcon.vue'
import MessageToast from '@/components/MessageToast.vue'
import { settingsApi } from '@/api/settings.js'

// 响应式数据
const settings = reactive({
  video_transcode_enabled: false,
  video_transcode_min_bitrate: 500,
  video_transcode_max_bitrate: 2500,
  video_transcode_format: 'dash',
  video_transcode_output_dir_mode: 'datetime',
  video_transcode_retain_original: true,
  video_transcode_max_concurrent: 2,
  // 播放器UI设置
  video_player_show_center_play_button: false,
  video_player_autoplay: false,
  video_player_loop: false,
  video_player_show_controls: true
})

const originalSettings = ref({})
const ffmpegAvailable = ref(false)
const ffmpegConfig = ref({ ffmpegPath: '', ffprobePath: '' })
const queueStatus = ref(null)
const loading = ref(true)
const saving = ref(false)
const refreshingQueue = ref(false)
const showToast = ref(false)
const toastMessage = ref('')
const toastType = ref('success')
let queueRefreshInterval = null

// 计算是否有未保存的更改
const hasChanges = computed(() => {
  return JSON.stringify(settings) !== JSON.stringify(originalSettings.value)
})

// 计算质量等级预览
const qualityLevels = computed(() => {
  const min = settings.video_transcode_min_bitrate || 500
  const max = settings.video_transcode_max_bitrate || 2500
  
  const levels = [
    { label: '360p', height: 360 },
    { label: '480p', height: 480 },
    { label: '720p', height: 720 },
    { label: '1080p', height: 1080 }
  ]
  
  const step = (max - min) / (levels.length - 1)
  
  return levels.map((level, index) => ({
    ...level,
    bitrate: Math.round(min + step * index)
  }))
})

// 初始化加载设置
onMounted(async () => {
  await loadSettings()
  // 启动队列状态定时刷新
  startQueueRefresh()
})

onUnmounted(() => {
  // 清理定时器
  if (queueRefreshInterval) {
    clearInterval(queueRefreshInterval)
  }
})

// 启动队列状态定时刷新
function startQueueRefresh() {
  if (queueRefreshInterval) {
    clearInterval(queueRefreshInterval)
  }
  // 每5秒刷新一次队列状态
  queueRefreshInterval = setInterval(() => {
    if (settings.video_transcode_enabled) {
      refreshQueueStatus(true) // 静默刷新
    }
  }, 5000)
}

// 刷新队列状态
async function refreshQueueStatus(silent = false) {
  if (!silent) {
    refreshingQueue.value = true
  }
  try {
    const result = await settingsApi.getVideoStatus()
    if (result.success && result.data.queueStatus) {
      queueStatus.value = result.data.queueStatus
    }
  } catch (error) {
    if (!silent) {
      console.error('刷新队列状态失败:', error)
    }
  } finally {
    if (!silent) {
      refreshingQueue.value = false
    }
  }
}

// 加载设置
async function loadSettings() {
  loading.value = true
  try {
    const result = await settingsApi.getVideoStatus()
    
    if (result.success) {
      const videoSettings = result.data.settings || {}
      
      settings.video_transcode_enabled = videoSettings.video_transcode_enabled === 'true'
      settings.video_transcode_min_bitrate = parseInt(videoSettings.video_transcode_min_bitrate) || 500
      settings.video_transcode_max_bitrate = parseInt(videoSettings.video_transcode_max_bitrate) || 2500
      settings.video_transcode_format = videoSettings.video_transcode_format || 'dash'
      settings.video_transcode_output_dir_mode = videoSettings.video_transcode_output_dir_mode || 'datetime'
      settings.video_transcode_retain_original = videoSettings.video_transcode_retain_original !== 'false'
      settings.video_transcode_max_concurrent = parseInt(videoSettings.video_transcode_max_concurrent) || 2
      
      // 播放器UI设置
      settings.video_player_show_center_play_button = videoSettings.video_player_show_center_play_button === 'true'
      settings.video_player_autoplay = videoSettings.video_player_autoplay === 'true'
      settings.video_player_loop = videoSettings.video_player_loop === 'true'
      settings.video_player_show_controls = videoSettings.video_player_show_controls !== 'false'
      
      ffmpegAvailable.value = result.data.ffmpegAvailable || false
      ffmpegConfig.value = result.data.ffmpegConfig || { ffmpegPath: '', ffprobePath: '' }
      queueStatus.value = result.data.queueStatus || null
      
      // 保存原始设置
      originalSettings.value = { ...settings }
    } else {
      showMessage(result.message || '加载设置失败', 'error')
    }
  } catch (error) {
    console.error('加载设置失败:', error)
    showMessage('加载设置失败', 'error')
  } finally {
    loading.value = false
  }
}

// 处理单个设置变更
function handleSettingChange(key, value) {
  // 验证码率设置
  if (key === 'video_transcode_min_bitrate') {
    if (value >= settings.video_transcode_max_bitrate) {
      settings.video_transcode_min_bitrate = settings.video_transcode_max_bitrate - 100
      showMessage('最小码率必须小于最大码率', 'warning')
    }
  }
  
  if (key === 'video_transcode_max_bitrate') {
    if (value <= settings.video_transcode_min_bitrate) {
      settings.video_transcode_max_bitrate = settings.video_transcode_min_bitrate + 100
      showMessage('最大码率必须大于最小码率', 'warning')
    }
  }
  
  if (key === 'video_transcode_max_concurrent') {
    if (value < 1) {
      settings.video_transcode_max_concurrent = 1
    } else if (value > 10) {
      settings.video_transcode_max_concurrent = 10
    }
  }
}

// 保存所有设置
async function saveAllSettings() {
  saving.value = true
  
  try {
    const settingsToSave = {
      video_transcode_enabled: String(settings.video_transcode_enabled),
      video_transcode_min_bitrate: String(settings.video_transcode_min_bitrate),
      video_transcode_max_bitrate: String(settings.video_transcode_max_bitrate),
      video_transcode_format: settings.video_transcode_format,
      video_transcode_output_dir_mode: settings.video_transcode_output_dir_mode,
      video_transcode_retain_original: String(settings.video_transcode_retain_original),
      video_transcode_max_concurrent: String(settings.video_transcode_max_concurrent),
      // 播放器UI设置
      video_player_show_center_play_button: String(settings.video_player_show_center_play_button),
      video_player_autoplay: String(settings.video_player_autoplay),
      video_player_loop: String(settings.video_player_loop),
      video_player_show_controls: String(settings.video_player_show_controls)
    }
    
    const result = await settingsApi.updateSettings(settingsToSave)
    
    if (result.success) {
      originalSettings.value = { ...settings }
      showMessage('设置保存成功', 'success')
    } else {
      showMessage(result.message || '保存设置失败', 'error')
    }
  } catch (error) {
    console.error('保存设置失败:', error)
    showMessage('保存设置失败', 'error')
  } finally {
    saving.value = false
  }
}

// 显示消息
function showMessage(message, type = 'success') {
  toastMessage.value = message
  toastType.value = type
  showToast.value = true
}
</script>

<style scoped>
.system-settings {
  padding: 24px;
  max-width: 800px;
  margin: 0 auto;
}

.settings-container {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.settings-card {
  background: var(--bg-color-primary);
  border-radius: 12px;
  border: 1px solid var(--border-color-primary);
  overflow: hidden;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 24px;
  border-bottom: 1px solid var(--border-color-primary);
  background: var(--bg-color-secondary);
}

.card-title {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 18px;
  font-weight: 600;
  color: var(--text-color-primary);
}

.title-icon {
  width: 24px;
  height: 24px;
  color: var(--primary-color);
}

.ffmpeg-status {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 20px;
  font-size: 12px;
  background: var(--danger-bg);
  color: var(--danger-color);
}

.ffmpeg-status.available {
  background: var(--success-bg);
  color: var(--success-color);
}

/* FFmpeg 路径信息 */
.ffmpeg-path-info {
  padding: 16px 24px;
  background: var(--bg-color-secondary);
  border-bottom: 1px solid var(--border-color-primary);
}

.path-item {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 12px;
}

.path-item:last-of-type {
  margin-bottom: 0;
}

.path-label {
  color: var(--text-color-secondary);
  min-width: 100px;
}

.path-value {
  color: var(--text-color-primary);
  font-family: monospace;
  background: var(--bg-color-primary);
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
}

.path-hint {
  margin-top: 12px;
  padding: 8px 12px;
  background: var(--bg-color-primary);
  border-radius: 6px;
  font-size: 11px;
  color: var(--text-color-tertiary);
  border-left: 3px solid var(--primary-color);
}

.status-icon {
  width: 14px;
  height: 14px;
}

.card-body {
  padding: 24px;
}

.setting-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 0;
  border-bottom: 1px solid var(--border-color-secondary);
}

.setting-item:last-child {
  border-bottom: none;
}

.setting-item.disabled {
  opacity: 0.5;
  pointer-events: none;
}

.setting-info {
  flex: 1;
  margin-right: 24px;
}

.setting-label {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-color-primary);
  margin-bottom: 4px;
}

.setting-description {
  font-size: 12px;
  color: var(--text-color-secondary);
}

.setting-control {
  flex-shrink: 0;
}

/* Switch 开关样式 */
.switch {
  position: relative;
  display: inline-block;
  width: 48px;
  height: 24px;
}

.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: var(--border-color-primary);
  transition: 0.3s;
  border-radius: 24px;
}

.slider:before {
  position: absolute;
  content: "";
  height: 18px;
  width: 18px;
  left: 3px;
  bottom: 3px;
  background-color: white;
  transition: 0.3s;
  border-radius: 50%;
}

input:checked + .slider {
  background-color: var(--primary-color);
}

input:checked + .slider:before {
  transform: translateX(24px);
}

input:disabled + .slider {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 输入框样式 */
.input-field {
  width: 120px;
  padding: 8px 12px;
  border: 1px solid var(--border-color-primary);
  border-radius: 8px;
  font-size: 14px;
  color: var(--text-color-primary);
  background: var(--bg-color-primary);
  transition: border-color 0.3s;
}

.input-field:focus {
  outline: none;
  border-color: var(--primary-color);
}

.input-field:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 选择框样式 */
.select-field {
  width: 140px;
  padding: 8px 12px;
  border: 1px solid var(--border-color-primary);
  border-radius: 8px;
  font-size: 14px;
  color: var(--text-color-primary);
  background: var(--bg-color-primary);
  cursor: pointer;
  transition: border-color 0.3s;
}

.select-field:focus {
  outline: none;
  border-color: var(--primary-color);
}

.select-field:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 码率预览 */
.bitrate-preview {
  padding: 16px 24px 24px;
  background: var(--bg-color-secondary);
  border-top: 1px solid var(--border-color-primary);
}

.preview-title {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-color-secondary);
  margin-bottom: 12px;
}

.quality-levels {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}

.quality-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 16px;
  background: var(--bg-color-primary);
  border-radius: 8px;
  border: 1px solid var(--border-color-primary);
  min-width: 80px;
}

.quality-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-color-primary);
}

.quality-bitrate {
  font-size: 12px;
  color: var(--text-color-secondary);
  margin-top: 4px;
}

/* 保存按钮 */
.actions {
  display: flex;
  justify-content: flex-end;
}

.save-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 24px;
  background: var(--primary-color);
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.3s;
}

.save-btn:hover:not(:disabled) {
  opacity: 0.9;
}

.save-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.loading-icon {
  width: 16px;
  height: 16px;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* 响应式 */
@media (max-width: 768px) {
  .system-settings {
    padding: 16px;
  }

  .setting-item {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }

  .setting-info {
    margin-right: 0;
  }

  .card-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }

  .quality-levels {
    justify-content: center;
  }

  .select-field {
    width: 100%;
  }
}

/* 转码队列状态样式 */
.queue-status {
  padding: 16px 24px 24px;
  background: var(--bg-color-secondary);
  border-top: 1px solid var(--border-color-primary);
}

.queue-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.refresh-btn {
  background: none;
  border: none;
  padding: 6px;
  cursor: pointer;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s;
}

.refresh-btn:hover:not(:disabled) {
  background: var(--bg-color-primary);
}

.refresh-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.refresh-icon {
  width: 16px;
  height: 16px;
  color: var(--text-color-secondary);
}

.refresh-icon.spinning {
  animation: spin 1s linear infinite;
}

.queue-stats {
  display: flex;
  gap: 16px;
  margin-bottom: 16px;
}

.queue-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 20px;
  background: var(--bg-color-primary);
  border-radius: 8px;
  border: 1px solid var(--border-color-primary);
  min-width: 80px;
}

.queue-stat.active {
  border-color: var(--primary-color);
  background: rgba(var(--primary-color-rgb), 0.1);
}

.queue-stat.completed {
  border-color: var(--success-color);
  background: rgba(var(--success-color-rgb), 0.1);
}

.stat-value {
  font-size: 24px;
  font-weight: 700;
  color: var(--text-color-primary);
}

.stat-label {
  font-size: 12px;
  color: var(--text-color-secondary);
  margin-top: 4px;
}

.active-jobs {
  margin-top: 16px;
}

.jobs-title {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-color-secondary);
  margin-bottom: 12px;
}

.job-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  background: var(--bg-color-primary);
  border-radius: 6px;
  margin-bottom: 8px;
}

.job-item:last-child {
  margin-bottom: 0;
}

.job-name {
  font-size: 13px;
  color: var(--text-color-primary);
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.job-progress {
  display: flex;
  align-items: center;
  gap: 10px;
}

.job-progress .progress-bar {
  width: 100px;
  height: 6px;
  background: var(--border-color-primary);
  border-radius: 3px;
  overflow: hidden;
}

.job-progress .progress-fill {
  height: 100%;
  background: var(--primary-color);
  border-radius: 3px;
  transition: width 0.3s ease;
}

.progress-text {
  font-size: 12px;
  color: var(--text-color-secondary);
  min-width: 40px;
  text-align: right;
}
</style>
