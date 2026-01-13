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
        <p>• 所有违禁词通用适用于用户名、评论、个人简介等内容</p>
      </div>
    </div>

    <!-- 分类管理区域 -->
    <div class="category-section">
      <div class="category-header">
        <h4>📁 违禁词分类</h4>
        <button class="btn btn-sm btn-primary" @click="showCategoryModal = true">
          <span>+</span> 新建分类
        </button>
      </div>
      <div class="category-list">
        <div 
          class="category-item" 
          :class="{ active: filterCategory === 'all' }"
          @click="filterCategory = 'all'"
        >
          <span class="category-name">全部</span>
          <span class="category-count">{{ totalWordCount }}</span>
        </div>
        <div 
          class="category-item" 
          :class="{ active: filterCategory === 'null' }"
          @click="filterCategory = 'null'"
        >
          <span class="category-name">未分类</span>
          <span class="category-count">{{ uncategorizedCount }}</span>
        </div>
        <div 
          v-for="cat in categories" 
          :key="cat.id" 
          class="category-item"
          :class="{ active: filterCategory === cat.id }"
          @click="filterCategory = cat.id"
        >
          <span class="category-name">{{ cat.name }}</span>
          <span class="category-count">{{ cat.word_count }}</span>
          <div class="category-actions">
            <button class="action-btn edit" @click.stop="editCategory(cat)" title="编辑">✏️</button>
            <button class="action-btn delete" @click.stop="confirmDeleteCategory(cat)" title="删除">🗑️</button>
          </div>
        </div>
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
        <select v-model="exportCategory" class="export-select">
          <option value="">选择导出分类</option>
          <option value="all">全部</option>
          <option value="null">未分类</option>
          <option v-for="cat in categories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
        </select>
        <button class="btn btn-outline" @click="handleExport" :disabled="!exportCategory">
          <span class="btn-icon">📤</span> 导出
        </button>
      </div>
    </div>

    <CrudTable 
      ref="crudTableRef"
      title="违禁词管理" 
      entity-name="违禁词" 
      api-endpoint="/admin/banned-words" 
      :columns="columns" 
      :form-fields="formFields" 
      :search-fields="searchFields"
      :extra-params="extraParams"
    />

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
            <label>分类</label>
            <select v-model="newWord.category_id">
              <option :value="null">未分类</option>
              <option v-for="cat in categories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
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
      <div class="modal-content import-modal" @click.stop>
        <div class="modal-header">
          <h3>批量导入违禁词</h3>
          <button class="close-btn" @click="showImportModal = false">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>分类</label>
            <select v-model="importData.category_id">
              <option :value="null">未分类</option>
              <option v-for="cat in categories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
            </select>
          </div>
          <div class="form-group">
            <label>导入方式</label>
            <div class="import-tabs">
              <button 
                class="tab-btn" 
                :class="{ active: importData.mode === 'text' }"
                @click="importData.mode = 'text'"
              >手动输入</button>
              <button 
                class="tab-btn" 
                :class="{ active: importData.mode === 'file' }"
                @click="importData.mode = 'file'"
              >TXT文件导入</button>
            </div>
          </div>
          <!-- 手动输入模式 -->
          <div v-if="importData.mode === 'text'" class="form-group">
            <label>违禁词列表（每行一个）</label>
            <textarea v-model="importData.text" rows="10" placeholder="每行输入一个违禁词&#10;支持 * 和 ? 通配符&#10;例如:&#10;敏感词1&#10;敏感*词&#10;test?word"></textarea>
          </div>
          <!-- 文件导入模式 -->
          <div v-if="importData.mode === 'file'" class="form-group">
            <label>选择TXT文件</label>
            <div class="file-upload-area">
              <input 
                type="file" 
                ref="fileInput"
                accept=".txt"
                @change="handleFileSelect"
                class="file-input"
              />
              <div v-if="!importData.fileName" class="file-placeholder">
                <span class="file-icon">📄</span>
                <span>点击或拖拽TXT文件到此处</span>
                <span class="file-hint">每行一个违禁词</span>
              </div>
              <div v-else class="file-selected">
                <span class="file-icon">✅</span>
                <span>{{ importData.fileName }}</span>
                <span class="file-count">{{ importData.wordCount }} 个词</span>
                <button class="clear-file-btn" @click="clearFile">×</button>
              </div>
            </div>
          </div>
          <div class="form-group checkbox-group">
            <label class="checkbox-label">
              <input type="checkbox" v-model="importData.isRegex" />
              <span>全部设为正则模式</span>
            </label>
            <span class="hint">启用后，所有导入的词条都将使用通配符匹配</span>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" @click="showImportModal = false">取消</button>
          <button class="btn btn-primary" @click="handleImport">导入</button>
        </div>
      </div>
    </div>

    <!-- 分类管理弹窗 -->
    <div v-if="showCategoryModal" class="modal-overlay" @click="showCategoryModal = false">
      <div class="modal-content" @click.stop>
        <div class="modal-header">
          <h3>{{ editingCategory ? '编辑分类' : '新建分类' }}</h3>
          <button class="close-btn" @click="closeCategoryModal">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>分类名称</label>
            <input type="text" v-model="categoryForm.name" placeholder="输入分类名称" />
          </div>
          <div class="form-group">
            <label>描述（可选）</label>
            <input type="text" v-model="categoryForm.description" placeholder="输入分类描述" />
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" @click="closeCategoryModal">取消</button>
          <button class="btn btn-primary" @click="handleSaveCategory">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
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
const showCategoryModal = ref(false)

// 分类相关
const categories = ref([])
const filterCategory = ref('all')
const exportCategory = ref('')
const editingCategory = ref(null)
const categoryForm = ref({ name: '', description: '' })
const totalWordCount = ref(0)
const uncategorizedCount = ref(0)

// 文件输入引用
const fileInput = ref(null)
const crudTableRef = ref(null)

// 新增违禁词表单
const newWord = ref({
  word: '',
  category_id: null,
  is_regex: false
})

// 批量导入数据
const importData = ref({
  category_id: null,
  text: '',
  mode: 'text',
  fileName: '',
  wordCount: 0,
  fileWords: [],
  isRegex: false
})

// 额外的查询参数（用于分类筛选）
const extraParams = computed(() => {
  if (filterCategory.value === 'all') return {}
  return { category_id: filterCategory.value }
})

// 监听违禁词内容，自动设置正则模式
watch(() => newWord.value.word, (val) => {
  if (val && (val.includes('*') || val.includes('?'))) {
    newWord.value.is_regex = true
  }
})

// 监听分类筛选变化
watch(filterCategory, () => {
  // 刷新表格
  if (crudTableRef.value && crudTableRef.value.refresh) {
    crudTableRef.value.refresh()
  }
})

// 获取分类列表
const fetchCategories = async () => {
  try {
    const response = await fetch(`${apiConfig.baseURL}/admin/banned-word-categories`, {
      headers: getAuthHeaders()
    })
    const result = await response.json()
    if (result.code === 200) {
      categories.value = result.data || []
    }
  } catch (error) {
    console.error('获取分类列表失败:', error)
  }
}

// 获取统计信息
const fetchStats = async () => {
  try {
    // 获取未分类数量
    const response = await fetch(`${apiConfig.baseURL}/admin/banned-words?category_id=null&limit=1`, {
      headers: getAuthHeaders()
    })
    const result = await response.json()
    if (result.code === 200) {
      uncategorizedCount.value = result.data.pagination?.total || 0
      // 计算总数：分类词条数 + 未分类词条数
      const categorizedCount = categories.value.reduce((sum, c) => sum + (c.word_count || 0), 0)
      totalWordCount.value = categorizedCount + uncategorizedCount.value
    }
  } catch (error) {
    console.error('获取统计失败:', error)
  }
}

// 初始化
onMounted(async () => {
  await fetchCategories()
  await fetchStats()
})

// 处理文件选择
const handleFileSelect = (event) => {
  const file = event.target.files[0]
  if (!file) return
  
  if (!file.name.endsWith('.txt') && file.type !== 'text/plain') {
    showMessage('请选择TXT文件', 'error')
    return
  }
  
  const maxSize = 2 * 1024 * 1024
  if (file.size > maxSize) {
    showMessage('文件过大，请选择小于2MB的文件', 'error')
    return
  }
  
  const reader = new FileReader()
  reader.onload = (e) => {
    const content = e.target.result
    const words = content.split(/\r?\n/).filter(w => w.trim()).map(w => w.trim())
    importData.value.fileName = file.name
    importData.value.wordCount = words.length
    importData.value.fileWords = words
  }
  reader.onerror = () => {
    showMessage('文件读取失败', 'error')
  }
  reader.readAsText(file, 'UTF-8')
}

// 清除文件
const clearFile = () => {
  importData.value.fileName = ''
  importData.value.wordCount = 0
  importData.value.fileWords = []
  if (fileInput.value) {
    fileInput.value.value = ''
  }
}

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
  const headers = { 'Content-Type': 'application/json' }
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
      newWord.value = { word: '', category_id: null, is_regex: false }
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
  let words = []
  if (importData.value.mode === 'file') {
    words = importData.value.fileWords
  } else {
    words = importData.value.text.split('\n').filter(w => w.trim())
  }
  
  if (words.length === 0) {
    showMessage('请输入或选择违禁词文件', 'error')
    return
  }

  try {
    const response = await fetch(`${apiConfig.baseURL}/admin/banned-words/import`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        category_id: importData.value.category_id,
        words: words,
        isRegex: importData.value.isRegex
      })
    })
    const result = await response.json()
    if (result.code === 200) {
      showMessage(`成功导入 ${result.data.count} 个违禁词`)
      showImportModal.value = false
      importData.value = { category_id: null, text: '', mode: 'text', fileName: '', wordCount: 0, fileWords: [], isRegex: false }
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
  if (!exportCategory.value) {
    showMessage('请选择导出分类', 'error')
    return
  }

  try {
    const response = await fetch(`${apiConfig.baseURL}/admin/banned-words/export?category_id=${exportCategory.value}`, {
      method: 'GET',
      headers: getAuthHeaders()
    })
    const result = await response.json()
    if (result.code === 200) {
      const content = result.data.words.join('\n')
      const blob = new Blob([content], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `banned_words_${Date.now()}.txt`
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

// 分类管理
const editCategory = (cat) => {
  editingCategory.value = cat
  categoryForm.value = { name: cat.name, description: cat.description || '' }
  showCategoryModal.value = true
}

const closeCategoryModal = () => {
  showCategoryModal.value = false
  editingCategory.value = null
  categoryForm.value = { name: '', description: '' }
}

const handleSaveCategory = async () => {
  if (!categoryForm.value.name.trim()) {
    showMessage('请输入分类名称', 'error')
    return
  }

  try {
    const url = editingCategory.value 
      ? `${apiConfig.baseURL}/admin/banned-word-categories/${editingCategory.value.id}`
      : `${apiConfig.baseURL}/admin/banned-word-categories`
    
    const response = await fetch(url, {
      method: editingCategory.value ? 'PUT' : 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(categoryForm.value)
    })
    const result = await response.json()
    if (result.code === 200) {
      showMessage(editingCategory.value ? '更新成功' : '创建成功')
      closeCategoryModal()
      await fetchCategories()
      await fetchStats()
    } else {
      showMessage((editingCategory.value ? '更新' : '创建') + '失败: ' + result.message, 'error')
    }
  } catch (error) {
    console.error('保存分类失败:', error)
    showMessage('保存失败', 'error')
  }
}

const confirmDeleteCategory = async (cat) => {
  if (!confirm(`确定删除分类 "${cat.name}" 吗？该分类下的违禁词将变为"未分类"。`)) {
    return
  }

  try {
    const response = await fetch(`${apiConfig.baseURL}/admin/banned-word-categories/${cat.id}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    })
    const result = await response.json()
    if (result.code === 200) {
      showMessage('删除成功')
      await fetchCategories()
      await fetchStats()
      if (filterCategory.value === cat.id) {
        filterCategory.value = 'all'
      }
    } else {
      showMessage('删除失败: ' + result.message, 'error')
    }
  } catch (error) {
    console.error('删除分类失败:', error)
    showMessage('删除失败', 'error')
  }
}

// 表格列定义
const columns = [
  { key: 'id', label: 'ID', sortable: true },
  { key: 'word', label: '违禁词', sortable: false },
  {
    key: 'category',
    label: '分类',
    sortable: false,
    formatter: (value) => value?.name || '未分类'
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
    key: 'category_id',
    label: '分类',
    type: 'select',
    required: false,
    options: [
      { value: null, label: '未分类' },
      ...categories.value.map(c => ({ value: c.id, label: c.name }))
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
const searchFields = computed(() => [
  { key: 'word', label: '违禁词', placeholder: '搜索违禁词' },
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
])
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

/* 分类管理区域 */
.category-section {
  margin: 0 24px 16px;
  padding: 16px;
  background: var(--bg-color-secondary);
  border-radius: 8px;
}

.category-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.category-header h4 {
  margin: 0;
  font-size: 14px;
  color: var(--text-color-primary);
}

.btn-sm {
  padding: 4px 10px;
  font-size: 12px;
}

.category-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.category-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: var(--bg-color-primary);
  border: 1px solid var(--border-color-primary);
  border-radius: 20px;
  cursor: pointer;
  transition: all 0.2s;
  font-size: 13px;
}

.category-item:hover {
  border-color: var(--primary-color);
}

.category-item.active {
  background: var(--primary-color);
  border-color: var(--primary-color);
  color: white;
}

.category-item.active .category-count {
  background: rgba(255,255,255,0.2);
  color: white;
}

.category-name {
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.category-count {
  background: var(--bg-color-tertiary);
  padding: 2px 6px;
  border-radius: 10px;
  font-size: 11px;
  color: var(--text-color-secondary);
}

.category-actions {
  display: flex;
  gap: 4px;
  margin-left: 4px;
}

.action-btn {
  background: none;
  border: none;
  padding: 2px;
  cursor: pointer;
  font-size: 12px;
  opacity: 0.6;
  transition: opacity 0.2s;
}

.action-btn:hover {
  opacity: 1;
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

/* Import modal styles */
.import-modal {
  max-width: 550px;
}

.import-tabs {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.tab-btn {
  flex: 1;
  padding: 10px 16px;
  border: 1px solid var(--border-color-primary);
  background: var(--bg-color-primary);
  color: var(--text-color-primary);
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s;
}

.tab-btn:hover {
  background: var(--bg-color-secondary);
}

.tab-btn.active {
  background: var(--primary-color);
  color: white;
  border-color: var(--primary-color);
}

.file-upload-area {
  position: relative;
  border: 2px dashed var(--border-color-primary);
  border-radius: 8px;
  padding: 24px;
  text-align: center;
  transition: all 0.2s;
  margin-top: 8px;
}

.file-upload-area:hover {
  border-color: var(--primary-color);
  background: rgba(var(--primary-color-rgb), 0.05);
}

.file-input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

.file-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: var(--text-color-secondary);
}

.file-icon {
  font-size: 32px;
}

.file-hint {
  font-size: 12px;
  color: var(--text-color-tertiary);
}

.file-selected {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-color-primary);
}

.file-count {
  padding: 2px 8px;
  background: var(--primary-color);
  color: white;
  border-radius: 4px;
  font-size: 12px;
}

.clear-file-btn {
  background: none;
  border: none;
  color: var(--text-color-secondary);
  font-size: 18px;
  cursor: pointer;
  padding: 0 4px;
}

.clear-file-btn:hover {
  color: #e74c3c;
}

.checkbox-label {
  display: flex !important;
  align-items: center;
  gap: 8px;
  margin-bottom: 0 !important;
}

.checkbox-label input[type="checkbox"] {
  width: auto;
  margin: 0;
}

/* Status styles */
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
