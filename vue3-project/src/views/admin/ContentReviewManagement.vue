<template>
  <div class="content-review-page">
    <!-- AI自动审核开关 -->
    <div class="ai-auto-review-toggle">
      <label class="toggle-label">
        <span class="toggle-text">AI自动审核</span>
        <div class="toggle-switch" :class="{ active: aiAutoReview }" @click="toggleAiAutoReview">
          <div class="toggle-slider"></div>
        </div>
        <span class="toggle-hint">{{ aiAutoReview ? '开启：由AI自动决定通过或拒绝' : '关闭：需人工审核' }}</span>
      </label>
    </div>
    
    <CrudTable title="审核管理" entity-name="内容审核" api-endpoint="/admin/content-review" :columns="columns" :form-fields="formFields"
      :search-fields="searchFields" :custom-actions="customActions" @custom-action="handleCustomAction" />

    <!-- 消息提示 -->
    <MessageToast v-if="showToast" :message="toastMessage" :type="toastType" @close="handleToastClose" />

    <!-- 删除确认弹窗 -->
    <ConfirmDialog v-model:visible="showDeleteModal" title="确认删除"
      :message="`确定要删除此审核记录吗？此操作不可撤销。`" type="warning"
      confirm-text="删除" cancel-text="取消" @confirm="handleConfirmDelete" @cancel="showDeleteModal = false" />

    <!-- JSON详情弹窗 -->
    <div v-if="showJsonModal" class="modal-overlay" @click="showJsonModal = false">
      <div class="json-modal" @click.stop>
        <div class="modal-header">
          <h3>审核结果详情 (audit_result)</h3>
          <button class="close-btn" @click="showJsonModal = false">&times;</button>
        </div>
        <div class="modal-body">
          <pre class="json-content">{{ formatJson(selectedAuditResult) }}</pre>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" @click="copyToClipboard">复制JSON</button>
          <button class="btn btn-primary" @click="showJsonModal = false">关闭</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, onMounted } from 'vue'
import CrudTable from './components/CrudTable.vue'
import MessageToast from '@/components/MessageToast.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { apiConfig } from '@/config/api'

// 声明组件事件
const emit = defineEmits(['closeFilter'])

// AI自动审核开关状态
const aiAutoReview = ref(false)

// 初始化时从localStorage读取开关状态
onMounted(() => {
  const saved = localStorage.getItem('ai_auto_review')
  aiAutoReview.value = saved === 'true'
})

// 切换AI自动审核开关
const toggleAiAutoReview = async () => {
  const newValue = !aiAutoReview.value
  aiAutoReview.value = newValue
  localStorage.setItem('ai_auto_review', newValue.toString())
  
  // 调用后端API更新设置
  try {
    await fetch(`${apiConfig.baseURL}/admin/content-review/settings`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({ ai_auto_review: newValue })
    })
    showMessage(newValue ? 'AI自动审核已开启' : 'AI自动审核已关闭')
  } catch (error) {
    console.error('更新设置失败:', error)
  }
}

// 消息提示状态
const showToast = ref(false)
const toastMessage = ref('')
const toastType = ref('success')

// 删除确认弹窗状态
const showDeleteModal = ref(false)
const selectedItem = ref(null)

// JSON详情弹窗状态
const showJsonModal = ref(false)
const selectedAuditResult = ref(null)

// 消息提示方法
const showMessage = (message, type = 'success') => {
  toastMessage.value = message
  toastType.value = type
  showToast.value = true
}

const handleToastClose = () => {
  showToast.value = false
}

// 格式化JSON
const formatJson = (obj) => {
  if (!obj) return '无数据'
  try {
    return JSON.stringify(obj, null, 2)
  } catch (e) {
    return String(obj)
  }
}

// 复制到剪贴板
const copyToClipboard = async () => {
  try {
    const text = formatJson(selectedAuditResult.value)
    await navigator.clipboard.writeText(text)
    showMessage('已复制到剪贴板')
  } catch (error) {
    console.error('复制失败:', error)
    showMessage('复制失败', 'error')
  }
}

// 处理删除确认
const handleConfirmDelete = async () => {
  try {
    const response = await fetch(`${apiConfig.baseURL}/admin/content-review/${selectedItem.value.id}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    })
    const result = await response.json()
    if (result.code === 200) {
      showMessage('删除成功')
      // 刷新页面数据
      location.reload()
    } else {
      showMessage('删除失败: ' + result.message, 'error')
    }
  } catch (error) {
    console.error('删除失败:', error)
    showMessage('删除失败', 'error')
  } finally {
    showDeleteModal.value = false
    selectedItem.value = null
  }
}

// 获取认证头
const getAuthHeaders = () => {
  const headers = {
    'Content-Type': 'application/json'
  }

  const token = localStorage.getItem('admin_token')
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  return headers
}

// 表格列定义
const columns = [
  { key: 'id', label: 'ID', sortable: true },
  { key: 'user_display_id', label: '用户汐社号', type: 'user-link', sortable: false },
  { key: 'nickname', label: '用户昵称', sortable: false },
  {
    key: 'type',
    label: '审核类型',
    type: 'status',
    sortable: false,
    statusMap: {
      3: { text: '评论审核', class: 'type-comment' },
      4: { text: '昵称审核', class: 'type-nickname' },
      5: { text: '简介审核', class: 'type-bio' }
    }
  },
  { key: 'content', label: '审核内容', type: 'content', sortable: false },
  { key: 'risk_level', label: '风险等级', type: 'status', sortable: false, statusMap: {
    'low': { text: '低风险', class: 'risk-low' },
    'medium': { text: '中风险', class: 'risk-medium' },
    'high': { text: '高风险', class: 'risk-high' }
  }},
  { key: 'reason', label: '审核原因', type: 'text', sortable: false },
  {
    key: 'status',
    label: '审核状态',
    type: 'status',
    sortable: true,
    statusMap: {
      0: { text: '待审核', class: 'status-pending' },
      1: { text: '已通过', class: 'status-approved' },
      2: { text: '已拒绝', class: 'status-rejected' }
    }
  },
  { key: 'created_at', label: '创建时间', type: 'date', sortable: true },
  { key: 'audit_time', label: '审核时间', type: 'date', sortable: true }
]

// 表单字段定义
const formFields = computed(() => [
  { key: 'user_id', label: '用户ID', type: 'number', required: true, placeholder: '请输入用户ID' },
  {
    key: 'type',
    label: '审核类型',
    type: 'select',
    required: true,
    options: [
      { value: 3, label: '评论审核' },
      { value: 4, label: '昵称审核' },
      { value: 5, label: '简介审核' }
    ]
  },
  { key: 'content', label: '审核内容', type: 'textarea', required: true, placeholder: '请输入审核相关内容' },
  {
    key: 'status',
    label: '审核状态',
    type: 'select',
    required: false,
    options: [
      { value: 0, label: '待审核' },
      { value: 1, label: '已通过' },
      { value: 2, label: '已拒绝' }
    ]
  }
])

// 搜索字段定义
const searchFields = [
  { key: 'user_display_id', label: '用户汐社号', placeholder: '搜索用户汐社号' },
  {
    key: 'type',
    label: '审核类型',
    type: 'select',
    placeholder: '选择审核类型',
    options: [
      { value: '', label: '全部类型' },
      { value: '3', label: '评论审核' },
      { value: '4', label: '昵称审核' },
      { value: '5', label: '简介审核' }
    ]
  },
  {
    key: 'status',
    label: '审核状态',
    type: 'select',
    placeholder: '选择审核状态',
    options: [
      { value: '', label: '全部状态' },
      { value: '0', label: '待审核' },
      { value: '1', label: '已通过' },
      { value: '2', label: '已拒绝' }
    ]
  }
]

// 自定义操作按钮
const customActions = [
  { key: 'detail', icon: 'info', title: '查看详情', class: 'btn-info' },
  { key: 'retry', icon: 'refresh', title: '重试AI审核', class: 'btn-primary' },
  { key: 'approve', icon: 'passed', title: '审核通过', class: 'btn-success' },
  { key: 'reject', icon: 'unpassed', title: '拒绝', class: 'btn-danger' },
  { key: 'delete', icon: 'delete', title: '删除', class: 'btn-outline' }
]

// 处理自定义操作
const handleCustomAction = async ({ action, item }) => {
  try {
    if (action === 'detail') {
      // 获取详情并显示audit_result
      try {
        const response = await fetch(`${apiConfig.baseURL}/admin/content-review/${item.id}`, {
          method: 'GET',
          headers: getAuthHeaders()
        })
        const result = await response.json()
        if (result.code === 200 && result.data) {
          selectedAuditResult.value = result.data.audit_result || { message: '无审核结果数据' }
          showJsonModal.value = true
        } else {
          showMessage('获取详情失败: ' + result.message, 'error')
        }
      } catch (e) {
        console.error('获取详情失败:', e)
        showMessage('获取详情失败', 'error')
      }
    } else if (action === 'retry') {
      // 重试AI审核（仅待审核状态可用）
      if (item.status !== 0) {
        showMessage('只有待审核状态的记录可以重试', 'error')
        return
      }
      const response = await fetch(`${apiConfig.baseURL}/admin/content-review/${item.id}/retry`, {
        method: 'PUT',
        headers: getAuthHeaders()
      })
      const result = await response.json()
      if (result.code === 200) {
        showMessage(`${result.message}（第${result.data.retry_count}次重试）`)
        // 刷新页面数据
        location.reload()
      } else {
        showMessage('重试失败: ' + result.message, 'error')
      }
    } else if (action === 'approve') {
      // 审核通过
      const response = await fetch(`${apiConfig.baseURL}/admin/content-review/${item.id}/approve`, {
        method: 'PUT',
        headers: getAuthHeaders()
      })
      const result = await response.json()
      if (result.code === 200) {
        showMessage('审核通过成功')
        // 刷新页面数据
        location.reload()
      } else {
        showMessage('审核通过失败: ' + result.message, 'error')
      }
    } else if (action === 'reject') {
      // 拒绝
      const response = await fetch(`${apiConfig.baseURL}/admin/content-review/${item.id}/reject`, {
        method: 'PUT',
        headers: getAuthHeaders()
      })
      const result = await response.json()
      if (result.code === 200) {
        showMessage('拒绝成功')
        // 刷新页面数据
        location.reload()
      } else {
        showMessage('拒绝失败: ' + result.message, 'error')
      }
    } else if (action === 'delete') {
      // 显示删除确认弹窗
      selectedItem.value = item
      showDeleteModal.value = true
    }
  } catch (error) {
    console.error('操作失败:', error)
    showMessage('操作失败', 'error')
  }
}
</script>

<style scoped>
/* 状态样式 */
:deep(.status-pending) {
  color: #f39c12;
}

:deep(.status-approved) {
  color: #4caf50;
}

:deep(.status-rejected) {
  color: #e74c3c;
}

/* 类型样式 */
:deep(.type-comment) {
  color: #1abc9c;
}

:deep(.type-nickname) {
  color: #e67e22;
}

/* 风险等级样式 */
:deep(.risk-low) {
  color: #4caf50;
}

:deep(.risk-medium) {
  color: #f39c12;
}

:deep(.risk-high) {
  color: #e74c3c;
}

/* AI自动审核开关样式 */
.content-review-page {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.ai-auto-review-toggle {
  padding: 16px 24px;
  background: var(--bg-color-primary);
  border-bottom: 1px solid var(--border-color-primary);
}

.toggle-label {
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  user-select: none;
}

.toggle-text {
  font-weight: 600;
  color: var(--text-color-primary);
}

.toggle-switch {
  position: relative;
  width: 48px;
  height: 24px;
  background: var(--border-color-primary);
  border-radius: 12px;
  transition: background 0.3s ease;
}

.toggle-switch.active {
  background: var(--primary-color);
}

.toggle-slider {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 20px;
  height: 20px;
  background: white;
  border-radius: 50%;
  transition: transform 0.3s ease;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.toggle-switch.active .toggle-slider {
  transform: translateX(24px);
}

.toggle-hint {
  font-size: 13px;
  color: var(--text-color-secondary);
}

/* 简介审核类型样式 */
:deep(.type-bio) {
  color: #9b59b6;
}

/* JSON弹窗样式 */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.json-modal {
  background: var(--bg-color-primary);
  border-radius: 12px;
  width: 90%;
  max-width: 700px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color-primary);
}

.modal-header h3 {
  margin: 0;
  font-size: 16px;
  color: var(--text-color-primary);
}

.close-btn {
  background: none;
  border: none;
  font-size: 24px;
  color: var(--text-color-secondary);
  cursor: pointer;
  padding: 0;
  line-height: 1;
}

.close-btn:hover {
  color: var(--text-color-primary);
}

.modal-body {
  flex: 1;
  padding: 20px;
  overflow: auto;
}

.json-content {
  margin: 0;
  padding: 16px;
  background: var(--bg-color-secondary);
  border-radius: 8px;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-color-primary);
  white-space: pre-wrap;
  word-break: break-all;
  overflow-x: auto;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid var(--border-color-primary);
}

.btn {
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
  border: none;
  transition: all 0.2s ease;
}

.btn-primary {
  background: var(--primary-color);
  color: white;
}

.btn-primary:hover {
  opacity: 0.9;
}

.btn-secondary {
  background: var(--bg-color-secondary);
  color: var(--text-color-primary);
  border: 1px solid var(--border-color-primary);
}

.btn-secondary:hover {
  background: var(--bg-color-tertiary);
}

.btn-info {
  background: #17a2b8;
  color: white;
}

.btn-info:hover {
  background: #138496;
}
</style>
