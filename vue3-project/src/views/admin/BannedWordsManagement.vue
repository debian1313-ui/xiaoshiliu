<template>
  <div class="banned-words-page">
    <!-- 功能说明 -->
    <div class="feature-info">
      <div class="info-header">
        <span class="info-icon">ℹ️</span>
        <span class="info-text">本地违禁词管理</span>
      </div>
      <div class="info-content">
        <p>• 支持通配符：<code>*</code> 匹配任意字符，<code>?</code> 匹配单个字符</p>
        <p>• 包含通配符的词条会自动设为正则模式</p>
        <p>• 触发违禁词后将直接拒绝，不发送AI审核</p>
      </div>
    </div>

    <!-- 操作区域 -->
    <div class="action-bar">
      <div class="action-left">
        <button class="btn btn-primary" @click="showAddModal = true">
          <span class="btn-icon">+</span> 添加违禁词
        </button>
        <button class="btn btn-secondary" @click="showImportModal = true">
          <span class="btn-icon">📥</span> 批量导入
        </button>
      </div>
      <div class="action-right">
        <select v-model="exportType" class="export-select">
          <option value="">选择导出类型</option>
          <option value="1">用户名/昵称</option>
          <option value="2">评论内容</option>
          <option value="3">个人简介</option>
        </select>
        <button class="btn btn-outline" @click="handleExport" :disabled="!exportType">
          <span class="btn-icon">📤</span> 导出
        </button>
      </div>
    </div>

    <CrudTable title="违禁词管理" entity-name="违禁词" api-endpoint="/admin/banned-words" 
      :columns="columns" :form-fields="formFields" :search-fields="searchFields" />

    <!-- 消息提示 -->
    <MessageToast v-if="showToast" :message="toastMessage" :type="toastType" @close="handleToastClose" />

    <!-- 添加违禁词弹窗 -->
    <div v-if="showAddModal" class="modal-overlay" @click="showAddModal = false">
      <div class="modal-content" @click.stop>
        <div class="modal-header">
          <h3>添加违禁词</h3>
          <button class="close-btn" @click="showAddModal = false">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>违禁词</label>
            <input type="text" v-model="newWord.word" placeholder="输入违禁词，支持 * 和 ? 通配符" />
          </div>
          <div class="form-group">
            <label>类型</label>
            <select v-model="newWord.type">
              <option :value="1">用户名/昵称</option>
              <option :value="2">评论内容</option>
              <option :value="3">个人简介</option>
            </select>
          </div>
          <div class="form-group checkbox-group">
            <label>
              <input type="checkbox" v-model="newWord.is_regex" />
              正则模式
            </label>
            <span class="hint">包含通配符时自动启用</span>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" @click="showAddModal = false">取消</button>
          <button class="btn btn-primary" @click="handleAddWord">添加</button>
        </div>
      </div>
    </div>

    <!-- 批量导入弹窗 -->
    <div v-if="showImportModal" class="modal-overlay" @click="showImportModal = false">
      <div class="modal-content" @click.stop>
        <div class="modal-header">
          <h3>批量导入违禁词</h3>
          <button class="close-btn" @click="showImportModal = false">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>类型</label>
            <select v-model="importData.type">
              <option :value="1">用户名/昵称</option>
              <option :value="2">评论内容</option>
              <option :value="3">个人简介</option>
            </select>
          </div>
          <div class="form-group">
            <label>违禁词列表（每行一个）</label>
            <textarea v-model="importData.text" rows="10" placeholder="每行输入一个违禁词&#10;支持 * 和 ? 通配符&#10;例如:&#10;敏感词1&#10;敏感*词&#10;test?word"></textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" @click="showImportModal = false">取消</button>
          <button class="btn btn-primary" @click="handleImport">导入</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import CrudTable from './components/CrudTable.vue'
import MessageToast from '@/components/MessageToast.vue'
import { apiConfig } from '@/config/api'

// 消息提示状态
const showToast = ref(false)
const toastMessage = ref('')
const toastType = ref('success')

// 弹窗状态
const showAddModal = ref(false)
const showImportModal = ref(false)

// 导出类型
const exportType = ref('')

// 新增违禁词表单
const newWord = ref({
  word: '',
  type: 1,
  is_regex: false
})

// 批量导入数据
const importData = ref({
  type: 1,
  text: ''
})

// 监听违禁词内容，自动设置正则模式
watch(() => newWord.value.word, (val) => {
  if (val && (val.includes('*') || val.includes('?'))) {
    newWord.value.is_regex = true
  }
})

// 消息提示方法
const showMessage = (message, type = 'success') => {
  toastMessage.value = message
  toastType.value = type
  showToast.value = true
}

const handleToastClose = () => {
  showToast.value = false
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

// 添加违禁词
const handleAddWord = async () => {
  if (!newWord.value.word.trim()) {
    showMessage('请输入违禁词', 'error')
    return
  }

  try {
    const response = await fetch(`${apiConfig.baseURL}/admin/banned-words`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(newWord.value)
    })
    const result = await response.json()
    if (result.code === 200) {
      showMessage('添加成功')
      showAddModal.value = false
      newWord.value = { word: '', type: 1, is_regex: false }
      location.reload()
    } else {
      showMessage('添加失败: ' + result.message, 'error')
    }
  } catch (error) {
    console.error('添加失败:', error)
    showMessage('添加失败', 'error')
  }
}

// 批量导入
const handleImport = async () => {
  const words = importData.value.text.split('\n').filter(w => w.trim())
  if (words.length === 0) {
    showMessage('请输入违禁词', 'error')
    return
  }

  try {
    const response = await fetch(`${apiConfig.baseURL}/admin/banned-words/import`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        type: importData.value.type,
        words: words
      })
    })
    const result = await response.json()
    if (result.code === 200) {
      showMessage(`成功导入 ${result.data.count} 个违禁词`)
      showImportModal.value = false
      importData.value = { type: 1, text: '' }
      location.reload()
    } else {
      showMessage('导入失败: ' + result.message, 'error')
    }
  } catch (error) {
    console.error('导入失败:', error)
    showMessage('导入失败', 'error')
  }
}

// 导出违禁词
const handleExport = async () => {
  if (!exportType.value) {
    showMessage('请选择导出类型', 'error')
    return
  }

  try {
    const response = await fetch(`${apiConfig.baseURL}/admin/banned-words/export/${exportType.value}`, {
      method: 'GET',
      headers: getAuthHeaders()
    })
    const result = await response.json()
    if (result.code === 200) {
      // 创建下载
      const content = result.data.words.join('\n')
      const blob = new Blob([content], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const typeNames = { '1': 'username', '2': 'comment', '3': 'bio' }
      a.download = `banned_words_${typeNames[exportType.value] || 'all'}_${Date.now()}.txt`
      a.click()
      URL.revokeObjectURL(url)
      showMessage(`成功导出 ${result.data.count} 个违禁词`)
    } else {
      showMessage('导出失败: ' + result.message, 'error')
    }
  } catch (error) {
    console.error('导出失败:', error)
    showMessage('导出失败', 'error')
  }
}

// 表格列定义
const columns = [
  { key: 'id', label: 'ID', sortable: true },
  { key: 'word', label: '违禁词', sortable: false },
  {
    key: 'type',
    label: '类型',
    type: 'status',
    sortable: true,
    statusMap: {
      1: { text: '用户名/昵称', class: 'type-username' },
      2: { text: '评论内容', class: 'type-comment' },
      3: { text: '个人简介', class: 'type-bio' }
    }
  },
  {
    key: 'is_regex',
    label: '正则模式',
    type: 'status',
    sortable: false,
    statusMap: {
      true: { text: '是', class: 'status-yes' },
      false: { text: '否', class: 'status-no' }
    }
  },
  {
    key: 'enabled',
    label: '状态',
    type: 'status',
    sortable: true,
    statusMap: {
      true: { text: '启用', class: 'status-enabled' },
      false: { text: '禁用', class: 'status-disabled' }
    }
  },
  { key: 'created_at', label: '创建时间', type: 'date', sortable: true }
]

// 表单字段定义
const formFields = computed(() => [
  { key: 'word', label: '违禁词', type: 'text', required: true, placeholder: '输入违禁词，支持 * 和 ? 通配符' },
  {
    key: 'type',
    label: '类型',
    type: 'select',
    required: true,
    options: [
      { value: 1, label: '用户名/昵称' },
      { value: 2, label: '评论内容' },
      { value: 3, label: '个人简介' }
    ]
  },
  {
    key: 'is_regex',
    label: '正则模式',
    type: 'select',
    required: false,
    options: [
      { value: false, label: '否' },
      { value: true, label: '是' }
    ]
  },
  {
    key: 'enabled',
    label: '状态',
    type: 'select',
    required: false,
    options: [
      { value: true, label: '启用' },
      { value: false, label: '禁用' }
    ]
  }
])

// 搜索字段定义
const searchFields = [
  { key: 'word', label: '违禁词', placeholder: '搜索违禁词' },
  {
    key: 'type',
    label: '类型',
    type: 'select',
    placeholder: '选择类型',
    options: [
      { value: '', label: '全部类型' },
      { value: '1', label: '用户名/昵称' },
      { value: '2', label: '评论内容' },
      { value: '3', label: '个人简介' }
    ]
  },
  {
    key: 'enabled',
    label: '状态',
    type: 'select',
    placeholder: '选择状态',
    options: [
      { value: '', label: '全部状态' },
      { value: 'true', label: '启用' },
      { value: 'false', label: '禁用' }
    ]
  }
]
</script>

<style scoped>
.banned-words-page {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.feature-info {
  margin: 16px 24px;
  padding: 16px;
  background: var(--bg-color-secondary);
  border-radius: 8px;
  border-left: 4px solid var(--primary-color);
}

.info-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.info-icon {
  font-size: 16px;
}

.info-text {
  font-weight: 600;
  color: var(--text-color-primary);
}

.info-content {
  font-size: 13px;
  color: var(--text-color-secondary);
}

.info-content p {
  margin: 4px 0;
}

.info-content code {
  background: var(--bg-color-tertiary);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: 'Monaco', 'Menlo', monospace;
}

.action-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 24px 16px;
}

.action-left, .action-right {
  display: flex;
  gap: 12px;
  align-items: center;
}

.btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
  border: none;
  transition: all 0.2s ease;
}

.btn-icon {
  font-size: 14px;
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

.btn-outline {
  background: transparent;
  color: var(--text-color-primary);
  border: 1px solid var(--border-color-primary);
}

.btn-outline:hover:not(:disabled) {
  background: var(--bg-color-secondary);
}

.btn-outline:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.export-select {
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px solid var(--border-color-primary);
  background: var(--bg-color-primary);
  color: var(--text-color-primary);
  font-size: 14px;
}

/* Modal styles */
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

.modal-content {
  background: var(--bg-color-primary);
  border-radius: 12px;
  width: 90%;
  max-width: 500px;
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
  padding: 20px;
}

.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  margin-bottom: 6px;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-color-primary);
}

.form-group input[type="text"],
.form-group select,
.form-group textarea {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border-color-primary);
  border-radius: 6px;
  background: var(--bg-color-primary);
  color: var(--text-color-primary);
  font-size: 14px;
  box-sizing: border-box;
}

.form-group textarea {
  resize: vertical;
  font-family: inherit;
}

.checkbox-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.checkbox-group label {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 0;
  cursor: pointer;
}

.checkbox-group .hint {
  font-size: 12px;
  color: var(--text-color-tertiary);
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid var(--border-color-primary);
}

/* Status styles */
:deep(.type-username) {
  color: #e67e22;
}

:deep(.type-comment) {
  color: #1abc9c;
}

:deep(.type-bio) {
  color: #9b59b6;
}

:deep(.status-yes) {
  color: #4caf50;
}

:deep(.status-no) {
  color: #95a5a6;
}

:deep(.status-enabled) {
  color: #4caf50;
}

:deep(.status-disabled) {
  color: #e74c3c;
}
</style>
