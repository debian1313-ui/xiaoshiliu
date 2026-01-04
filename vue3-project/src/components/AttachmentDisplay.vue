<template>
  <div class="attachment-display" v-if="attachment">
    <div class="attachment-card" @click="handleDownload">
      <div class="file-icon" :class="getFileIconClass(attachment.originalname || attachment.name)">
        <SvgIcon :name="getFileIconName(attachment.originalname || attachment.name)" width="20" height="20" />
      </div>
      <div class="file-info">
        <p class="file-name">{{ attachment.originalname || attachment.name }}</p>
        <p class="file-size" v-if="attachment.size">{{ formatFileSize(attachment.size) }}</p>
      </div>
      <div class="download-icon">
        <SvgIcon name="download" width="16" height="16" />
      </div>
    </div>
  </div>
</template>

<script setup>
import SvgIcon from '@/components/SvgIcon.vue'
import { 
  downloadAttachment,
  formatFileSize as formatSize,
  getFileIconType 
} from '@/api/attachment.js'

const props = defineProps({
  attachment: {
    type: Object,
    default: null
  }
})

// 下载附件
const handleDownload = () => {
  if (props.attachment) {
    const filename = props.attachment.filename || props.attachment.url?.split('/').pop()
    const originalName = props.attachment.originalname || props.attachment.name
    
    if (filename) {
      downloadAttachment(filename, originalName)
    } else if (props.attachment.url) {
      // 如果只有URL，直接打开
      window.open(props.attachment.url, '_blank')
    }
  }
}

// 格式化文件大小
const formatFileSize = (bytes) => {
  return formatSize(bytes)
}

// 获取文件图标名称
const getFileIconName = (filename) => {
  if (!filename) return 'file'
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
  if (!filename) return 'icon-file'
  const iconType = getFileIconType(filename)
  return `icon-${iconType}`
}
</script>

<style scoped>
.attachment-display {
  margin: 8px 0;
}

.attachment-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: var(--bg-color-secondary);
  border: 1px solid var(--border-color-primary);
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.attachment-card:hover {
  background: var(--bg-color-tertiary);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.file-icon {
  width: 36px;
  height: 36px;
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

.file-info {
  flex: 1;
  min-width: 0;
}

.file-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-color-primary);
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.file-size {
  font-size: 11px;
  color: var(--text-color-secondary);
  margin: 2px 0 0;
}

.download-icon {
  flex-shrink: 0;
  color: var(--primary-color);
  opacity: 0.6;
  transition: opacity 0.2s ease;
}

.attachment-card:hover .download-icon {
  opacity: 1;
}

/* 响应式 */
@media (max-width: 480px) {
  .attachment-card {
    padding: 8px 12px;
  }
  
  .file-icon {
    width: 32px;
    height: 32px;
  }
  
  .file-name {
    font-size: 12px;
  }
}
</style>
