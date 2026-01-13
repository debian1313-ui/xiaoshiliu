<template>
  <div class="queue-management">
    <div class="queue-content">
      <!-- 队列状态 -->
      <div class="status-section">
        <div class="section-header">
          <h3>队列服务状态</h3>
          <button class="refresh-btn" @click="fetchQueueStats" :disabled="loading">
            {{ loading ? '刷新中...' : '刷新' }}
          </button>
        </div>

        <div v-if="!queueEnabled" class="disabled-notice">
          <div class="notice-icon">⚠️</div>
          <div class="notice-content">
            <h4>队列服务未启用</h4>
            <p>请在 .env 文件中设置 QUEUE_ENABLED=true 并配置 Redis 连接信息后重启服务器</p>
          </div>
        </div>

        <div v-else class="queue-stats">
          <div v-for="queue in queues" :key="queue.name" class="queue-card" 
               :class="{ 'active': selectedQueue === queue.name }"
               @click="selectQueue(queue.name)">
            <div class="queue-name">{{ getQueueDisplayName(queue.name) }}</div>
            <div class="queue-metrics">
              <div class="metric">
                <span class="metric-value">{{ queue.waiting || 0 }}</span>
                <span class="metric-label">等待中</span>
              </div>
              <div class="metric">
                <span class="metric-value">{{ queue.active || 0 }}</span>
                <span class="metric-label">处理中</span>
              </div>
              <div class="metric">
                <span class="metric-value">{{ queue.completed || 0 }}</span>
                <span class="metric-label">已完成</span>
              </div>
              <div class="metric failed">
                <span class="metric-value">{{ queue.failed || 0 }}</span>
                <span class="metric-label">失败</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 任务列表 -->
      <div v-if="queueEnabled && selectedQueue" class="jobs-section">
        <div class="section-header">
          <h3>任务列表 - {{ getQueueDisplayName(selectedQueue) }}</h3>
          <div class="header-actions">
            <select v-model="jobStatus" @change="fetchQueueJobs" class="status-select">
              <option value="waiting">等待中</option>
              <option value="active">处理中</option>
              <option value="completed">已完成</option>
              <option value="failed">失败</option>
              <option value="delayed">延迟</option>
            </select>
            <button class="clear-btn" @click="confirmClearQueue">清空队列</button>
          </div>
        </div>

        <div v-if="jobsLoading" class="loading-state">
          <p>加载中...</p>
        </div>

        <div v-else-if="jobs.length === 0" class="empty-state">
          <p>暂无{{ getStatusText(jobStatus) }}的任务</p>
        </div>

        <div v-else class="jobs-list">
          <div v-for="job in jobs" :key="job.id" class="job-item">
            <div class="job-header">
              <span class="job-id">任务 #{{ job.id }}</span>
              <span class="job-name">{{ job.name }}</span>
              <span class="job-time">{{ formatTime(job.timestamp) }}</span>
            </div>
            <div class="job-data">
              <pre>{{ JSON.stringify(job.data, null, 2) }}</pre>
            </div>
            <div v-if="job.failedReason" class="job-error">
              <strong>失败原因:</strong> {{ job.failedReason }}
            </div>
            <div class="job-actions">
              <span class="job-attempts">尝试次数: {{ job.attempts }}</span>
              <button v-if="jobStatus === 'failed'" class="retry-btn" @click="retryJob(job.id)">
                重试
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { adminApi } from '@/api'

const loading = ref(false)
const jobsLoading = ref(false)
const queueEnabled = ref(false)
const queues = ref([])
const selectedQueue = ref('')
const jobs = ref([])
const jobStatus = ref('waiting')

// 队列名称映射
const queueNameMap = {
  'ip-location-update': 'IP属地更新',
  'content-audit': '内容审核',
  'general-task': '通用任务'
}

const getQueueDisplayName = (name) => {
  return queueNameMap[name] || name
}

const getStatusText = (status) => {
  const statusMap = {
    'waiting': '等待中',
    'active': '处理中',
    'completed': '已完成',
    'failed': '失败',
    'delayed': '延迟'
  }
  return statusMap[status] || status
}

// 获取队列统计信息
const fetchQueueStats = async () => {
  loading.value = true
  try {
    const response = await adminApi.getQueueStats()
    if (response && response.success) {
      queueEnabled.value = response.data.enabled
      queues.value = response.data.queues || []
      if (queues.value.length > 0 && !selectedQueue.value) {
        selectedQueue.value = queues.value[0].name
        await fetchQueueJobs()
      }
    }
  } catch (error) {
    console.error('获取队列统计失败:', error)
  } finally {
    loading.value = false
  }
}

// 选择队列
const selectQueue = async (queueName) => {
  selectedQueue.value = queueName
  await fetchQueueJobs()
}

// 获取队列任务列表
const fetchQueueJobs = async () => {
  if (!selectedQueue.value) return
  
  jobsLoading.value = true
  try {
    const response = await adminApi.getQueueJobs(selectedQueue.value, {
      status: jobStatus.value,
      start: 0,
      end: 50
    })
    if (response && response.success) {
      jobs.value = response.data.jobs || []
    }
  } catch (error) {
    console.error('获取队列任务失败:', error)
    jobs.value = []
  } finally {
    jobsLoading.value = false
  }
}

// 重试任务
const retryJob = async (jobId) => {
  try {
    const response = await adminApi.retryJob(selectedQueue.value, jobId)
    if (response && response.success) {
      alert('任务已重新加入队列')
      await fetchQueueJobs()
      await fetchQueueStats()
    } else {
      alert('重试失败: ' + (response?.message || '未知错误'))
    }
  } catch (error) {
    console.error('重试任务失败:', error)
    alert('重试失败')
  }
}

// 确认清空队列
const confirmClearQueue = async () => {
  if (!confirm(`确定要清空队列 "${getQueueDisplayName(selectedQueue.value)}" 吗？此操作不可恢复！`)) {
    return
  }
  
  try {
    const response = await adminApi.clearQueue(selectedQueue.value)
    if (response && response.success) {
      alert('队列已清空')
      await fetchQueueJobs()
      await fetchQueueStats()
    } else {
      alert('清空失败: ' + (response?.message || '未知错误'))
    }
  } catch (error) {
    console.error('清空队列失败:', error)
    alert('清空失败')
  }
}

// 格式化时间
const formatTime = (timestamp) => {
  if (!timestamp) return '-'
  const time = new Date(timestamp)
  return time.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

onMounted(() => {
  fetchQueueStats()
})
</script>

<style scoped>
.queue-management {
  padding: 12px;
  background-color: var(--bg-color-primary);
  min-height: 100%;
}

.queue-content {
  max-width: 1200px;
  margin: 0 auto;
}

.status-section,
.jobs-section {
  background-color: var(--bg-color-primary);
  border-radius: 12px;
  border: 1px solid var(--border-color-primary);
  margin-bottom: 16px;
  overflow: hidden;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color-primary);
}

.section-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-color-primary);
}

.header-actions {
  display: flex;
  gap: 12px;
  align-items: center;
}

.refresh-btn,
.retry-btn,
.clear-btn {
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s;
}

.refresh-btn {
  background-color: var(--primary-color);
  color: white;
}

.refresh-btn:hover {
  opacity: 0.9;
}

.refresh-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.retry-btn {
  background-color: var(--primary-color);
  color: white;
  padding: 4px 12px;
  font-size: 12px;
}

.clear-btn {
  background-color: #ff4d4f;
  color: white;
}

.clear-btn:hover {
  opacity: 0.9;
}

.status-select {
  padding: 8px 12px;
  border: 1px solid var(--border-color-primary);
  border-radius: 6px;
  background-color: var(--bg-color-primary);
  color: var(--text-color-primary);
  font-size: 14px;
}

.disabled-notice {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding: 24px;
  background-color: var(--bg-color-secondary);
}

.notice-icon {
  font-size: 32px;
}

.notice-content h4 {
  margin: 0 0 8px 0;
  color: var(--text-color-primary);
}

.notice-content p {
  margin: 0;
  color: var(--text-color-secondary);
  font-size: 14px;
}

.queue-stats {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
  padding: 20px;
}

.queue-card {
  background-color: var(--bg-color-secondary);
  border: 2px solid transparent;
  border-radius: 10px;
  padding: 16px;
  cursor: pointer;
  transition: all 0.2s;
}

.queue-card:hover {
  border-color: var(--primary-color);
}

.queue-card.active {
  border-color: var(--primary-color);
  background-color: var(--bg-color-primary);
}

.queue-name {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-color-primary);
  margin-bottom: 12px;
}

.queue-metrics {
  display: flex;
  gap: 16px;
}

.metric {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.metric-value {
  font-size: 24px;
  font-weight: 700;
  color: var(--text-color-primary);
}

.metric-label {
  font-size: 12px;
  color: var(--text-color-secondary);
}

.metric.failed .metric-value {
  color: #ff4d4f;
}

.loading-state,
.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48px;
  color: var(--text-color-secondary);
}

.jobs-list {
  padding: 0;
}

.job-item {
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color-primary);
}

.job-item:last-child {
  border-bottom: none;
}

.job-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.job-id {
  font-weight: 600;
  color: var(--primary-color);
}

.job-name {
  background-color: var(--bg-color-secondary);
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  color: var(--text-color-secondary);
}

.job-time {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-color-secondary);
}

.job-data {
  background-color: var(--bg-color-secondary);
  border-radius: 6px;
  padding: 12px;
  margin-bottom: 8px;
  overflow-x: auto;
}

.job-data pre {
  margin: 0;
  font-size: 12px;
  font-family: 'Monaco', 'Menlo', monospace;
  color: var(--text-color-primary);
  white-space: pre-wrap;
  word-break: break-word;
}

.job-error {
  background-color: rgba(255, 77, 79, 0.1);
  border: 1px solid rgba(255, 77, 79, 0.3);
  border-radius: 6px;
  padding: 8px 12px;
  margin-bottom: 8px;
  font-size: 12px;
  color: #ff4d4f;
}

.job-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.job-attempts {
  font-size: 12px;
  color: var(--text-color-secondary);
}
</style>
