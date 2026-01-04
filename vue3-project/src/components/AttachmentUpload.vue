<template>
  <div class="attachment-upload">
    <!-- 上传区域 -->
    <div 
      v-if="!attachment" 
      class="upload-area"
      :class="{ 'drag-over': isDragOver, 'uploading': isUploading }"
      @click="!isUploading && triggerFileInput()"
      @dragover.prevent="!isUploading && (isDragOver = true)"
      @dragleave.prevent="isDragOver = false"
      @drop.prevent="!isUploading && handleFileDrop($event)"
    >
      <input 
        ref="fileInput" 
        type="file" 
        :accept="acceptTypes"
        @change="handleFileSelect" 
        style="display: none"
        :disabled="isUploading"
      />
      
      <div class="upload-placeholder">
        <SvgIcon 
          :name="isUploading ? 'loading' : 'attachment'" 
          class="upload-icon" 
          :class="{ 'uploading': isUploading }" 
          width="32" 
          height="32" 
        />
        <p class="upload-text">{{ isUploading ? '上传中...' : '添加附件' }}</p>
        <p class="upload-hint">支持 zip, rar, pdf, doc, xls 等格式</p>
        <p class="upload-hint">文件大小不超过 50MB</p>
        <p v-if="!isUploading" class="drag-hint">或拖拽文件到此处</p>
        
        <!-- 上传进度条 -->
        <div v-if="isUploading" class="progress-bar">
          <div class="progress-fill" :style="{ width: uploadProgress + '%' }"></div>
        </div>
        <p v-if="isUploading" class="progress-text">{{ uploadProgress }}%</p>
      </div>
    </div>
    
    <!-- 已上传附件显示 -->
    <div v-else class="attachment-item">
      <div class="attachment-info">
        <div class="file-icon" :class="getFileIconClass(attachment.originalname)">
          <SvgIcon :name="getFileIconName(attachment.originalname)" width="24" height="24" />
        </div>
        <div class="file-details">
          <p class="file-name">{{ attachment.originalname }}</p>
          <p class="file-size">{{ formatFileSize(attachment.size) }}</p>
        </div>
      </div>
      <div class="attachment-actions">
        <button 
          class="action-btn download-btn" 
          @click="handleDownload"
          title="下载"
        >
          <SvgIcon name="download" width="18" height="18" />
        </button>
        <button 
          class="action-btn remove-btn" 
          @click="removeAttachment"
          title="删除"
          :disabled="isUploading"
        >
          <SvgIcon name="delete" width="18" height="18" />
        </button>
      </div>
    </div>
    
    <!-- 错误信息 -->
    <div v-if="error" class="error-message">
      {{ error }}
    </div>
    
    <MessageToast 
      v-if="showToast" 
      :message="toastMessage" 
      :type="toastType" 
      @close="handleToastClose" 
    />
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import SvgIcon from '@/components/SvgIcon.vue'
import MessageToast from '@/components/MessageToast.vue'
import { 
  uploadAttachment, 
  downloadAttachment, 
  validateAttachmentFile,
  formatFileSize as formatSize,
  getFileIconType 
} from '@/api/attachment.js'

const props = defineProps({
  modelValue: {
    type: Object,
    default: null
  }
})

const emit = defineEmits(['update:modelValue', 'error', 'uploaded'])

// 状态
const fileInput = ref(null)
const attachment = ref(props.modelValue)
const error = ref('')
const isDragOver = ref(false)
const isUploading = ref(false)
const uploadProgress = ref(0)

// 监听外部值变化，保持响应式同步
watch(() => props.modelValue, (newValue) => {
  attachment.value = newValue
}, { immediate: false })

// 消息提示
const showToast = ref(false)
const toastMessage = ref('')
const toastType = ref('success')

// 接受的文件类型
const acceptTypes = computed(() => {
  return '.zip,.rar,.7z,.gz,.tar,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv'
})

// 触发文件选择
const triggerFileInput = () => {
  fileInput.value?.click()
}

// 显示消息
const showMessage = (message, type = 'success') => {
  toastMessage.value = message
  toastType.value = type
  showToast.value = true
}

// 关闭消息
const handleToastClose = () => {
  showToast.value = false
}

// 处理文件选择
const handleFileSelect = async (event) => {
  const file = event.target.files[0]
  if (!file) return
  
  await processFile(file)
  
  // 清空文件输入
  if (fileInput.value) {
    fileInput.value.value = ''
  }
}

// 处理文件拖放
const handleFileDrop = async (event) => {
  isDragOver.value = false
  const file = event.dataTransfer.files[0]
  if (!file) return
  
  await processFile(file)
}

// 处理文件
const processFile = async (file) => {
  // 验证文件
  const validation = validateAttachmentFile(file)
  if (!validation.valid) {
    error.value = validation.error
    emit('error', validation.error)
    showMessage(validation.error, 'error')
    return
  }
  
  error.value = ''
  isUploading.value = true
  uploadProgress.value = 0
  
  try {
    // 上传文件
    const result = await uploadAttachment(file, {
      onProgress: (percent) => {
        uploadProgress.value = percent
      }
    })
    
    if (result.success) {
      attachment.value = result.data
      emit('update:modelValue', result.data)
      emit('uploaded', result.data)
      showMessage('上传成功', 'success')
    } else {
      const errorMsg = result.message || '上传失败'
      error.value = errorMsg
      emit('error', errorMsg)
      showMessage(errorMsg, 'error')
    }
  } catch (err) {
    console.error('附件上传失败:', err)
    const errorMsg = err.message || '上传失败，请重试'
    error.value = errorMsg
    emit('error', errorMsg)
    showMessage(errorMsg, 'error')
  } finally {
    isUploading.value = false
    uploadProgress.value = 0
  }
}

// 移除附件
const removeAttachment = () => {
  attachment.value = null
  error.value = ''
  emit('update:modelValue', null)
}

// 下载附件
const handleDownload = () => {
  if (attachment.value && attachment.value.filename) {
    const originalName = attachment.value.originalname || attachment.value.filename
    downloadAttachment(attachment.value.filename, originalName)
  }
}

// 格式化文件大小
const formatFileSize = (bytes) => {
  return formatSize(bytes)
}

// 获取文件图标名称
const getFileIconName = (filename) => {
  const iconType = getFileIconType(filename)
  const iconMap = {
    'archive': 'folder',
    'pdf': 'file',
    'word': 'file',
    'excel': 'file',
    'powerpoint': 'file',
    'text': 'file',
    'spreadsheet': 'file',
    'file': 'file'
  }
  return iconMap[iconType] || 'file'
}

// 获取文件图标类名
const getFileIconClass = (filename) => {
  const iconType = getFileIconType(filename)
  return `icon-${iconType}`
}

// 获取附件数据
const getAttachmentData = () => {
  return attachment.value
}

// 重置组件
const reset = () => {
  attachment.value = null
  error.value = ''
  isUploading.value = false
  uploadProgress.value = 0
  if (fileInput.value) {
    fileInput.value.value = ''
  }
}

// 设置附件数据（用于编辑模式）
const setAttachment = (data) => {
  attachment.value = data
}

// 暴露方法给父组件
defineExpose({
  getAttachmentData,
  reset,
  setAttachment,
  isUploading
})
</script>

<style scoped>
.attachment-upload {
  width: 100%;
}

.upload-area {
  border: 2px dashed var(--border-color-primary);
  border-radius: 12px;
  padding: 24px;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s ease;
  background: var(--bg-color-primary);
}

.upload-area:hover,
.upload-area.drag-over {
  border-color: var(--primary-color);
  background: var(--bg-color-secondary);
}

.upload-area.uploading {
  border-color: var(--primary-color);
  cursor: not-allowed;
  opacity: 0.8;
}

.upload-placeholder {
  color: var(--text-color-secondary);
}

.upload-icon {
  margin-bottom: 8px;
  color: var(--text-color-secondary);
}

.upload-icon.uploading {
  animation: spin 1s linear infinite;
  color: var(--primary-color);
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.upload-text {
  font-size: 14px;
  font-weight: 500;
  margin: 8px 0;
  color: var(--text-color-primary);
}

.upload-hint {
  font-size: 12px;
  color: var(--text-color-secondary);
  margin: 4px 0;
}

.drag-hint {
  font-size: 12px;
  color: var(--text-color-tertiary);
  margin-top: 8px;
}

/* 进度条 */
.progress-bar {
  width: 80%;
  max-width: 200px;
  height: 6px;
  background: var(--border-color-primary);
  border-radius: 3px;
  margin: 12px auto 0;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--primary-color);
  border-radius: 3px;
  transition: width 0.2s ease;
}

.progress-text {
  font-size: 12px;
  color: var(--primary-color);
  margin-top: 4px;
}

/* 附件项 */
.attachment-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: var(--bg-color-secondary);
  border: 1px solid var(--border-color-primary);
  border-radius: 12px;
  transition: all 0.2s ease;
}

.attachment-item:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.attachment-info {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
}

.file-icon {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: var(--bg-color-tertiary);
  color: var(--text-color-secondary);
}

/* 不同文件类型的图标颜色 */
.file-icon.icon-archive {
  background: #fef3cd;
  color: #856404;
}

.file-icon.icon-pdf {
  background: #f8d7da;
  color: #721c24;
}

.file-icon.icon-word {
  background: #cce5ff;
  color: #004085;
}

.file-icon.icon-excel {
  background: #d4edda;
  color: #155724;
}

.file-icon.icon-powerpoint {
  background: #ffe5d0;
  color: #c64600;
}

.file-icon.icon-text {
  background: var(--bg-color-tertiary);
  color: var(--text-color-secondary);
}

.file-details {
  flex: 1;
  min-width: 0;
}

.file-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-color-primary);
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.file-size {
  font-size: 12px;
  color: var(--text-color-secondary);
  margin: 4px 0 0;
}

.attachment-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.action-btn {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
  background: var(--bg-color-primary);
  color: var(--text-color-secondary);
}

.action-btn:hover:not(:disabled) {
  color: var(--text-color-primary);
  background: var(--bg-color-tertiary);
}

.download-btn:hover:not(:disabled) {
  color: var(--primary-color);
}

.remove-btn:hover:not(:disabled) {
  color: var(--error-color, #dc3545);
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 错误信息 */
.error-message {
  color: var(--error-color, #dc3545);
  font-size: 12px;
  margin-top: 8px;
  padding: 8px 12px;
  background: var(--error-bg, #f8d7da);
  border-radius: 6px;
}

/* 响应式 */
@media (max-width: 480px) {
  .upload-area {
    padding: 16px;
  }
  
  .attachment-item {
    padding: 10px 12px;
  }
  
  .file-icon {
    width: 36px;
    height: 36px;
  }
  
  .file-name {
    font-size: 13px;
  }
}
</style>
