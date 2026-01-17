<template>
  <div class="batch-upload-management">
    <div class="batch-upload-header">
      <h2>批量上传笔记</h2>
      <p class="description">从服务器 /uploads/plsc 目录读取文件批量创建笔记</p>
    </div>

    <div class="batch-upload-form">
      <div class="form-section">
        <label class="form-label">作者ID <span class="required">*</span></label>
        <input v-model.number="formData.user_id" type="number" class="form-input"
          placeholder="请输入用户ID" />
      </div>

      <div class="form-section">
        <label class="form-label">笔记类型 <span class="required">*</span></label>
        <div class="type-selector">
          <button :class="['type-btn', { active: formData.type === 1 }]" @click="selectType(1)">
            <SvgIcon name="post" width="20" height="20" />
            图文笔记
          </button>
          <button :class="['type-btn', { active: formData.type === 2 }]" @click="selectType(2)">
            <SvgIcon name="video" width="20" height="20" />
            视频笔记
          </button>
        </div>
      </div>

      <div class="form-section" v-if="formData.type === 1">
        <label class="form-label">每条笔记图片数量</label>
        <input v-model.number="formData.images_per_note" type="number" class="form-input" min="1"
          placeholder="默认4张图片为一条笔记" />
        <p class="form-hint">设置每条笔记包含多少张图片（不限制数量）</p>
      </div>

      <div class="form-section">
        <label class="form-label">标签（可选，将应用到所有笔记）</label>
        <TagSelector v-model="formData.tags" :max-tags="10" />
      </div>

      <div class="form-section">
        <label class="form-label checkbox-label">
          <input type="checkbox" v-model="formData.is_draft" />
          保存为草稿
        </label>
      </div>

      <!-- Server files section -->
      <div class="form-section">
        <div class="server-files-header">
          <label class="form-label">服务器文件 (/uploads/plsc)</label>
          <div class="header-buttons">
            <button class="btn btn-small" @click="fetchServerFiles" :disabled="isLoading">
              {{ isLoading ? '加载中...' : '刷新列表' }}
            </button>
            <button v-if="selectedFiles.length > 0" class="btn btn-small btn-primary" @click="generateNotes">
              生成笔记预览
            </button>
          </div>
        </div>

        <div v-if="isLoading" class="loading-state">
          <SvgIcon name="loading" width="24" height="24" class="loading-icon" />
          <span>正在加载文件列表...</span>
        </div>

        <div v-else-if="currentFiles.length === 0" class="empty-state">
          <SvgIcon name="post" width="40" height="40" />
          <p>{{ formData.type === 1 ? '目录中没有图片文件' : '目录中没有视频文件' }}</p>
          <p class="hint">请将文件上传到服务器的 /uploads/plsc 目录</p>
        </div>

        <div v-else class="file-list">
          <div class="file-list-header">
            <label class="checkbox-label">
              <input type="checkbox" :checked="allSelected" @change="toggleSelectAll" />
              全选 ({{ selectedFiles.length }}/{{ currentFiles.length }})
            </label>
            <span class="file-count">
              {{ formData.type === 1 
                ? `将创建 ${Math.ceil(selectedFiles.length / (formData.images_per_note || 4))} 条笔记` 
                : `将创建 ${selectedFiles.length} 条笔记` }}
            </span>
          </div>
          <div class="file-grid">
            <div v-for="file in currentFiles" :key="file.path" 
              :class="['file-item', { selected: isSelected(file) }]"
              @click="toggleSelect(file)">
              <div class="file-preview">
                <img v-if="formData.type === 1" :src="getFileUrl(file)" :alt="file.name" />
                <template v-else>
                  <img v-if="getVideoThumbnail(file)" :src="getVideoThumbnail(file)" :alt="file.name" class="video-thumbnail-img" />
                  <div v-else class="video-placeholder">
                    <SvgIcon name="video" width="32" height="32" />
                  </div>
                </template>
              </div>
              <div class="file-info">
                <span class="file-name">{{ file.name }}</span>
                <span class="file-size">{{ formatFileSize(file.size) }}</span>
              </div>
              <div class="file-checkbox">
                <input type="checkbox" :checked="isSelected(file)" @click.stop />
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Notes preview section -->
      <div v-if="notePreviews.length > 0" class="form-section notes-preview-section">
        <div class="notes-preview-header">
          <label class="form-label">笔记预览 ({{ notePreviews.length }}条)</label>
          <div class="import-txt-wrapper">
            <input type="file" ref="txtFileInput" accept=".txt" @change="handleTxtImport" style="display: none" />
            <button class="btn btn-small" @click="$refs.txtFileInput.click()">
              导入TXT文件
            </button>
            <span class="import-hint">（第1行标题，第2行内容，以此类推）</span>
          </div>
        </div>
        <div class="notes-list">
          <div v-for="(note, index) in notePreviews" :key="index" class="note-preview-item">
            <div class="note-header">
              <span class="note-number">笔记 {{ index + 1 }}</span>
              <span class="note-files-count">{{ note.files.length }} 个文件</span>
            </div>
            <div class="note-fields">
              <div class="note-field">
                <label>标题</label>
                <input v-model="note.title" type="text" class="form-input" :placeholder="`笔记${index + 1}的标题（留空不显示）`" />
              </div>
              <div class="note-field">
                <label>内容</label>
                <textarea v-model="note.content" class="form-textarea" :placeholder="`笔记${index + 1}的内容（留空不显示）`" rows="2"></textarea>
              </div>
            </div>
            <div class="note-files-preview">
              <div v-for="file in note.files" :key="file.path" class="note-file-thumb">
                <img v-if="formData.type === 1" :src="getFileUrl(file)" :alt="file.name" />
                <template v-else>
                  <img v-if="getVideoThumbnail(file)" :src="getVideoThumbnail(file)" :alt="file.name" class="video-thumbnail-img" />
                  <div v-else class="video-thumb">
                    <SvgIcon name="video" width="20" height="20" />
                  </div>
                </template>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="form-actions">
        <button class="btn btn-outline" @click="resetForm" :disabled="isSubmitting">
          重置
        </button>
        <button class="btn btn-primary" @click="handleBatchCreate" :disabled="!canSubmit || isSubmitting">
          {{ getSubmitButtonText() }}
        </button>
      </div>

      <!-- Progress indicator -->
      <div v-if="isSubmitting" class="upload-progress">
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: progressPercent + '%' }"></div>
        </div>
        <p class="progress-text">{{ progressText }}</p>
      </div>
    </div>

    <div v-if="uploadHistory.length > 0" class="upload-history">
      <h3>创建历史</h3>
      <div class="history-list">
        <div v-for="(item, index) in uploadHistory" :key="index" class="history-item"
          :class="{ success: item.success, error: !item.success }">
          <span class="history-type">{{ item.type === 1 ? '图文' : '视频' }}</span>
          <span class="history-count">{{ item.count }}条笔记</span>
          <span class="history-status">{{ item.success ? '成功' : '失败' }}</span>
          <span class="history-time">{{ formatTime(item.time) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, reactive, onMounted, watch } from 'vue'
import SvgIcon from '@/components/SvgIcon.vue'
import TagSelector from '@/components/TagSelector.vue'
import messageManager from '@/utils/messageManager'
import apiConfig from '@/config/api.js'
import { generateVideoThumbnail, blobToFile, generateThumbnailFilename } from '@/utils/videoThumbnail.js'

const formData = reactive({
  user_id: null,
  type: 1,
  images_per_note: 4,
  tags: [],
  is_draft: false
})

const serverImages = ref([])
const serverVideos = ref([])
const selectedFiles = ref([])
const notePreviews = ref([])
const isLoading = ref(false)
const isSubmitting = ref(false)
const uploadHistory = ref([])
const progressText = ref('')
const progressPercent = ref(0)
const videoThumbnails = ref({}) // Store video thumbnail URLs keyed by file path

// Current files based on type
const currentFiles = computed(() => {
  return formData.type === 1 ? serverImages.value : serverVideos.value
})

// Check if all files are selected
const allSelected = computed(() => {
  return currentFiles.value.length > 0 && selectedFiles.value.length === currentFiles.value.length
})

// Check if form can be submitted
const canSubmit = computed(() => {
  return formData.user_id && notePreviews.value.length > 0
})

// Get auth headers
const getAuthHeaders = () => {
  const headers = {
    'Content-Type': 'application/json'
  }
  const adminToken = localStorage.getItem('admin_token')
  if (adminToken) {
    headers.Authorization = `Bearer ${adminToken}`
  }
  return headers
}

// Get static file URL for preview (without /api prefix)
const getStaticFileUrl = (file) => {
  // Static files are served directly, not through /api
  return file.path
}

// Get file URL for preview
const getFileUrl = (file) => {
  return getStaticFileUrl(file)
}

// Format file size
const formatFileSize = (bytes) => {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

// Format time
const formatTime = (time) => {
  return new Date(time).toLocaleString('zh-CN')
}

// Select type and clear selection
const selectType = (type) => {
  formData.type = type
  selectedFiles.value = []
  notePreviews.value = []
}

// Check if file is selected
const isSelected = (file) => {
  return selectedFiles.value.some(f => f.path === file.path)
}

// Toggle file selection
const toggleSelect = (file) => {
  const index = selectedFiles.value.findIndex(f => f.path === file.path)
  if (index >= 0) {
    selectedFiles.value.splice(index, 1)
  } else {
    selectedFiles.value.push(file)
  }
  // Clear note previews when selection changes
  notePreviews.value = []
}

// Toggle select all
const toggleSelectAll = () => {
  if (allSelected.value) {
    selectedFiles.value = []
  } else {
    selectedFiles.value = [...currentFiles.value]
  }
  // Clear note previews when selection changes
  notePreviews.value = []
}

// Generate note previews from selected files
const generateNotes = () => {
  const files = [...selectedFiles.value]
  const notes = []
  
  if (formData.type === 1) {
    // Image notes - group by images_per_note
    const perNote = formData.images_per_note || 4
    for (let i = 0; i < files.length; i += perNote) {
      const noteFiles = files.slice(i, i + perNote)
      notes.push({
        title: '',
        content: '',
        files: noteFiles
      })
    }
  } else {
    // Video notes - one video per note
    for (const file of files) {
      notes.push({
        title: '',
        content: '',
        files: [file]
      })
    }
  }
  
  notePreviews.value = notes
}

// Handle TXT file import for titles and content
const txtFileInput = ref(null)
const handleTxtImport = (event) => {
  const file = event.target.files[0]
  if (!file) return
  
  const reader = new FileReader()
  reader.onload = (e) => {
    try {
      const text = e.target.result
      const lines = text.split(/\r?\n/).filter(line => line.trim() !== '')
      
      // Parse lines: odd lines (1, 3, 5...) are titles, even lines (2, 4, 6...) are content
      // Line 1 = Title for note 1, Line 2 = Content for note 1
      // Line 3 = Title for note 2, Line 4 = Content for note 2, etc.
      for (let i = 0; i < notePreviews.value.length; i++) {
        const titleIndex = i * 2
        const contentIndex = i * 2 + 1
        
        if (titleIndex < lines.length) {
          notePreviews.value[i].title = lines[titleIndex].trim()
        }
        if (contentIndex < lines.length) {
          notePreviews.value[i].content = lines[contentIndex].trim()
        }
      }
      
      messageManager.success(`已导入 ${Math.min(Math.ceil(lines.length / 2), notePreviews.value.length)} 条笔记的标题和内容`)
    } catch (error) {
      console.error('解析TXT文件失败:', error)
      messageManager.error('解析TXT文件失败，请检查文件格式')
    }
  }
  
  reader.onerror = () => {
    messageManager.error('读取文件失败')
  }
  
  reader.readAsText(file, 'UTF-8')
  
  // Reset file input so the same file can be selected again
  event.target.value = ''
}

// Fetch server files
const fetchServerFiles = async () => {
  isLoading.value = true
  try {
    const response = await fetch(`${apiConfig.baseURL}/admin/batch-upload/files`, {
      headers: getAuthHeaders()
    })
    const result = await response.json()
    
    if (result.code === 200) {
      serverImages.value = result.data.images || []
      serverVideos.value = result.data.videos || []
      selectedFiles.value = []
      notePreviews.value = []
      
      // Generate thumbnails for video files
      if (result.data.videos && result.data.videos.length > 0) {
        generateVideoThumbnails(result.data.videos)
      }
    } else {
      messageManager.error(result.message || '获取文件列表失败')
    }
  } catch (error) {
    console.error('获取文件列表失败:', error)
    messageManager.error('获取文件列表失败')
  } finally {
    isLoading.value = false
  }
}

// Generate thumbnails for video files (for UI preview)
const generateVideoThumbnails = async (videos) => {
  // Process videos in parallel batches for better performance
  const batchSize = 3 // Process 3 videos at a time to avoid overwhelming the browser
  
  const generateSingleThumbnail = async (video) => {
    try {
      // Fetch video file to generate thumbnail
      const response = await fetch(video.path)
      if (!response.ok) return
      
      const blob = await response.blob()
      const videoFile = new File([blob], video.name, { type: blob.type })
      
      const result = await generateVideoThumbnail(videoFile, {
        useOriginalSize: false,
        width: 160,
        height: 120,
        quality: 0.7,
        seekTime: 1
      })
      
      if (result.success && result.dataUrl) {
        videoThumbnails.value[video.path] = result.dataUrl
      }
    } catch (error) {
      console.warn(`生成视频预览失败 [${video.name}]:`, error.message || error)
    }
  }
  
  // Process in batches
  for (let i = 0; i < videos.length; i += batchSize) {
    const batch = videos.slice(i, i + batchSize)
    await Promise.all(batch.map(generateSingleThumbnail))
  }
}

// Get video thumbnail URL for preview
const getVideoThumbnail = (file) => {
  return videoThumbnails.value[file.path] || null
}

// Get submit button text
const getSubmitButtonText = () => {
  if (isSubmitting.value) {
    return '创建中...'
  }
  
  if (notePreviews.value.length === 0) {
    return '请先生成笔记预览'
  }
  
  return `创建 ${notePreviews.value.length} 条笔记`
}

// Reset form
const resetForm = () => {
  formData.user_id = null
  formData.type = 1
  formData.images_per_note = 4
  formData.tags = []
  formData.is_draft = false
  selectedFiles.value = []
  notePreviews.value = []
}

// Generate thumbnail from video blob
const generateThumbnailFromBlob = async (videoBlob, filename) => {
  try {
    // Create a File object from the blob for the thumbnail generator
    // Note: generateVideoThumbnail uses URL.createObjectURL which accepts both File and Blob
    const videoFile = new File([videoBlob], filename, { type: videoBlob.type })
    
    const result = await generateVideoThumbnail(videoFile, {
      useOriginalSize: false,
      width: 640,
      height: 360,
      quality: 0.8,
      seekTime: 1
    })
    
    if (result.success && result.blob) {
      const thumbnailFilename = generateThumbnailFilename(filename)
      return blobToFile(result.blob, thumbnailFilename)
    }
    
    console.warn(`视频封面生成失败 [${filename}]:`, result.error || '未知错误')
    return null
  } catch (error) {
    console.error(`生成视频封面异常 [${filename}]:`, error.message || error)
    return null
  }
}

// Upload a single file and get URL
const uploadFile = async (file, isVideo = false) => {
  // Validate file path to prevent path traversal
  if (!file.path || !file.path.startsWith('/uploads/plsc/')) {
    throw new Error('无效的文件路径')
  }
  
  const formDataUpload = new FormData()
  
  // Fetch file via HTTP from server static path (not /api)
  const fileUrl = file.path
  const response = await fetch(fileUrl)
  
  if (!response.ok) {
    throw new Error(`文件获取失败: ${response.status}`)
  }
  
  const blob = await response.blob()
  formDataUpload.append('file', blob, file.name)
  
  // For video files, generate and include thumbnail
  if (isVideo) {
    const thumbnailFile = await generateThumbnailFromBlob(blob, file.name)
    if (thumbnailFile) {
      formDataUpload.append('thumbnail', thumbnailFile, thumbnailFile.name)
      console.log('视频封面已生成并添加到上传请求')
    }
  }
  
  const adminToken = localStorage.getItem('admin_token')
  const uploadEndpoint = isVideo ? '/upload/video' : '/upload/single'
  
  const uploadResponse = await fetch(`${apiConfig.baseURL}${uploadEndpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + adminToken
    },
    body: formDataUpload
  })
  
  const result = await uploadResponse.json()
  if (result.code === 200) {
    return isVideo ? { url: result.data.url, coverUrl: result.data.coverUrl || '' } : result.data.url
  }
  throw new Error(result.message || '文件上传失败')
}

// Handle batch create
const handleBatchCreate = async () => {
  if (!canSubmit.value || isSubmitting.value) return

  isSubmitting.value = true
  progressPercent.value = 0
  
  const totalNotes = notePreviews.value.length
  let successCount = 0
  let failCount = 0

  try {
    for (let i = 0; i < notePreviews.value.length; i++) {
      const note = notePreviews.value[i]
      progressText.value = `正在创建笔记 ${i + 1}/${totalNotes}...`
      
      try {
        // Upload files first
        const uploadedUrls = []
        let videoUrl = null
        let coverUrl = null
        
        for (const file of note.files) {
          if (formData.type === 1) {
            const url = await uploadFile(file, false)
            uploadedUrls.push(url)
          } else {
            const result = await uploadFile(file, true)
            videoUrl = result.url
            coverUrl = result.coverUrl
          }
        }
        
        // Create note via admin API
        const postData = {
          user_id: formData.user_id,
          type: formData.type,
          title: note.title || '',
          content: note.content || '',
          tags: formData.tags,
          is_draft: formData.is_draft
        }
        
        if (formData.type === 1) {
          postData.images = uploadedUrls
        } else {
          postData.video_url = videoUrl
          postData.cover_url = coverUrl
        }
        
        const response = await fetch(`${apiConfig.baseURL}/admin/posts`, {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify(postData)
        })
        
        const result = await response.json()
        if (result.code === 200) {
          successCount++
        } else {
          failCount++
          console.error(`笔记 ${i + 1} 创建失败:`, result.message)
        }
        
        // Update progress after each note is processed
        progressPercent.value = Math.round(((i + 1) / totalNotes) * 100)
      } catch (error) {
        failCount++
        console.error(`笔记 ${i + 1} 创建失败:`, error)
        progressPercent.value = Math.round(((i + 1) / totalNotes) * 100)
      }
    }
    
    if (failCount === 0) {
      messageManager.success(`成功创建 ${successCount} 条笔记`)
    } else {
      messageManager.warning(`成功 ${successCount} 条，失败 ${failCount} 条`)
    }
    
    // Add to history
    uploadHistory.value.unshift({
      type: formData.type,
      count: successCount,
      success: failCount === 0,
      time: new Date()
    })

    // Reset selection and refresh file list
    selectedFiles.value = []
    notePreviews.value = []
    await fetchServerFiles()
    
  } catch (error) {
    console.error('批量创建失败:', error)
    messageManager.error(error.message || '批量创建失败')

    uploadHistory.value.unshift({
      type: formData.type,
      count: 0,
      success: false,
      time: new Date()
    })
  } finally {
    isSubmitting.value = false
    progressText.value = ''
  }
}

// Fetch files on mount
onMounted(() => {
  fetchServerFiles()
})

// Watch type change to clear selection
watch(() => formData.type, () => {
  selectedFiles.value = []
  notePreviews.value = []
})
</script>

<style scoped>
.batch-upload-management {
  padding: 20px 30px;
  max-width: 1000px;
  margin: 0 auto;
}

.batch-upload-header {
  margin-bottom: 30px;
}

.batch-upload-header h2 {
  margin: 0 0 8px 0;
  font-size: 24px;
  color: var(--text-color-primary);
}

.batch-upload-header .description {
  margin: 0;
  color: var(--text-color-secondary);
  font-size: 14px;
}

.batch-upload-form {
  background: var(--bg-color-primary);
  border-radius: 8px;
  padding: 24px;
  border: 1px solid var(--border-color-primary);
}

.form-section {
  margin-bottom: 24px;
}

.form-section:last-child {
  margin-bottom: 0;
}

.form-label {
  display: block;
  margin-bottom: 8px;
  font-weight: 500;
  color: var(--text-color-primary);
  font-size: 14px;
}

.form-label .required {
  color: var(--primary-color);
}

.form-input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border-color-primary);
  border-radius: 8px;
  font-size: 14px;
  box-sizing: border-box;
  background-color: var(--bg-color-primary);
  color: var(--text-color-primary);
  transition: border-color 0.2s ease;
}

.form-input:focus {
  outline: none;
  border-color: var(--primary-color);
}

.form-textarea {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border-color-primary);
  border-radius: 8px;
  font-size: 14px;
  box-sizing: border-box;
  background-color: var(--bg-color-primary);
  color: var(--text-color-primary);
  transition: border-color 0.2s ease;
  resize: vertical;
  min-height: 60px;
}

.form-textarea:focus {
  outline: none;
  border-color: var(--primary-color);
}

.form-hint {
  margin: 8px 0 0 0;
  font-size: 12px;
  color: var(--text-color-tertiary);
}

.type-selector {
  display: flex;
  gap: 12px;
}

.type-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 16px;
  border: 1px solid var(--border-color-primary);
  border-radius: 8px;
  background: var(--bg-color-primary);
  color: var(--text-color-secondary);
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.type-btn:hover {
  border-color: var(--primary-color);
  color: var(--primary-color);
}

.type-btn.active {
  border-color: var(--primary-color);
  background: var(--primary-color);
  color: white;
}

.checkbox-label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-weight: normal;
}

.checkbox-label input[type="checkbox"] {
  width: 16px;
  height: 16px;
  accent-color: var(--primary-color);
}

/* Server files section */
.server-files-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.server-files-header .form-label {
  margin-bottom: 0;
}

.header-buttons {
  display: flex;
  gap: 8px;
}

.btn-small {
  padding: 6px 12px;
  font-size: 12px;
}

.loading-state,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  color: var(--text-color-secondary);
  background: var(--bg-color-secondary);
  border-radius: 8px;
}

.loading-icon {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.empty-state p {
  margin: 10px 0 0 0;
}

.empty-state .hint {
  font-size: 12px;
  color: var(--text-color-tertiary);
}

/* File list */
.file-list {
  border: 1px solid var(--border-color-primary);
  border-radius: 8px;
  overflow: hidden;
}

.file-list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: var(--bg-color-secondary);
  border-bottom: 1px solid var(--border-color-primary);
}

.file-count {
  font-size: 14px;
  color: var(--text-color-secondary);
}

.file-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 12px;
  padding: 16px;
  max-height: 300px;
  overflow-y: auto;
}

.file-item {
  position: relative;
  border: 2px solid var(--border-color-primary);
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  transition: all 0.2s ease;
}

.file-item:hover {
  border-color: var(--primary-color);
}

.file-item.selected {
  border-color: var(--primary-color);
  background: var(--bg-color-secondary);
}

.file-preview {
  width: 100%;
  aspect-ratio: 1;
  overflow: hidden;
  background: var(--bg-color-secondary);
}

.file-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.video-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-color-tertiary);
}

.video-thumbnail-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.file-info {
  padding: 8px;
  background: var(--bg-color-primary);
}

.file-name {
  display: block;
  font-size: 11px;
  color: var(--text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-size {
  display: block;
  font-size: 10px;
  color: var(--text-color-tertiary);
  margin-top: 2px;
}

.file-checkbox {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 18px;
  height: 18px;
  background: white;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.file-checkbox input {
  width: 14px;
  height: 14px;
  accent-color: var(--primary-color);
}

/* Notes preview section */
.notes-preview-section {
  margin-top: 24px;
  padding-top: 24px;
  border-top: 1px solid var(--border-color-primary);
}

.notes-preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  flex-wrap: wrap;
  gap: 8px;
}

.notes-preview-header .form-label {
  margin-bottom: 0;
}

.import-txt-wrapper {
  display: flex;
  align-items: center;
  gap: 8px;
}

.import-hint {
  font-size: 12px;
  color: var(--text-color-tertiary);
}

.notes-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.note-preview-item {
  border: 1px solid var(--border-color-primary);
  border-radius: 8px;
  padding: 16px;
  background: var(--bg-color-secondary);
}

.note-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.note-number {
  font-weight: 600;
  color: var(--primary-color);
}

.note-files-count {
  font-size: 12px;
  color: var(--text-color-tertiary);
}

.note-fields {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 12px;
}

.note-field label {
  display: block;
  font-size: 12px;
  color: var(--text-color-secondary);
  margin-bottom: 4px;
}

.note-files-preview {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.note-file-thumb {
  width: 48px;
  height: 48px;
  border-radius: 4px;
  overflow: hidden;
  background: var(--bg-color-tertiary);
}

.note-file-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.video-thumb {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-color-tertiary);
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 24px;
  padding-top: 24px;
  border-top: 1px solid var(--border-color-primary);
}

.btn {
  padding: 10px 24px;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: all 0.2s ease;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  background-color: var(--primary-color);
  color: white;
}

.btn-primary:hover:not(:disabled) {
  opacity: 0.9;
}

.btn-outline {
  background-color: transparent;
  color: var(--text-color-secondary);
  border: 1px solid var(--border-color-primary);
}

.btn-outline:hover:not(:disabled) {
  background-color: var(--bg-color-secondary);
}

/* Upload Progress */
.upload-progress {
  margin-top: 20px;
  padding: 16px;
  background: var(--bg-color-secondary);
  border-radius: 8px;
}

.progress-bar {
  height: 8px;
  background: var(--bg-color-tertiary);
  border-radius: 4px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--primary-color);
  border-radius: 4px;
  transition: width 0.3s ease;
}

.progress-text {
  margin: 8px 0 0 0;
  font-size: 14px;
  color: var(--text-color-secondary);
  text-align: center;
}

/* Upload History */
.upload-history {
  margin-top: 30px;
  background: var(--bg-color-primary);
  border-radius: 8px;
  padding: 24px;
  border: 1px solid var(--border-color-primary);
}

.upload-history h3 {
  margin: 0 0 16px 0;
  font-size: 16px;
  color: var(--text-color-primary);
}

.history-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.history-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--bg-color-secondary);
  border-radius: 8px;
  font-size: 14px;
}

.history-item.success {
  border-left: 3px solid #67c23a;
}

.history-item.error {
  border-left: 3px solid #f56c6c;
}

.history-type {
  padding: 2px 8px;
  background: var(--bg-color-tertiary);
  border-radius: 4px;
  font-size: 12px;
  color: var(--text-color-secondary);
}

.history-count {
  flex: 1;
  color: var(--text-color-primary);
}

.history-status {
  color: var(--text-color-secondary);
}

.history-time {
  color: var(--text-color-tertiary);
  font-size: 12px;
}

@media (max-width: 640px) {
  .batch-upload-management {
    padding: 16px;
  }

  .batch-upload-form {
    padding: 16px;
  }

  .type-selector {
    flex-direction: column;
  }

  .form-actions {
    flex-direction: column;
  }

  .form-actions .btn {
    width: 100%;
  }

  .file-grid {
    grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
  }
  
  .server-files-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }
  
  .header-buttons {
    width: 100%;
  }
  
  .header-buttons .btn {
    flex: 1;
  }
}
</style>
