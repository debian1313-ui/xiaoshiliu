/**
 * 附件上传和下载 API
 * 支持 zip, rar, 7z, gz, tar, pdf, doc, docx, xls, xlsx, ppt, pptx, txt, csv 等文件类型
 */

// 默认附件最大大小 50MB
const DEFAULT_ATTACHMENT_MAX_SIZE = 50 * 1024 * 1024

// 允许的附件类型
const ALLOWED_ATTACHMENT_EXTENSIONS = [
  '.zip', '.rar', '.7z', '.gz', '.tar',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.txt', '.csv'
]

/**
 * 获取文件扩展名
 * @param {string} filename - 文件名
 * @returns {string} 扩展名（小写）
 */
function getFileExtension(filename) {
  const lastDot = filename.lastIndexOf('.')
  if (lastDot === -1) return ''
  return filename.substring(lastDot).toLowerCase()
}

/**
 * 验证附件文件
 * @param {File} file - 文件对象
 * @param {Object} options - 选项
 * @returns {{valid: boolean, error: string|null}}
 */
export function validateAttachmentFile(file, options = {}) {
  const {
    maxSize = DEFAULT_ATTACHMENT_MAX_SIZE,
    allowedExtensions = ALLOWED_ATTACHMENT_EXTENSIONS
  } = options

  if (!file) {
    return { valid: false, error: '请选择文件' }
  }

  const ext = getFileExtension(file.name)
  if (!ext || !allowedExtensions.includes(ext)) {
    return { 
      valid: false, 
      error: `不支持的文件类型，允许的类型：${allowedExtensions.join(', ')}` 
    }
  }

  if (file.size > maxSize) {
    const maxSizeMB = Math.round(maxSize / (1024 * 1024))
    return { valid: false, error: `文件大小不能超过${maxSizeMB}MB` }
  }

  return { valid: true, error: null }
}

/**
 * 上传附件
 * @param {File} file - 文件对象
 * @param {Object} options - 选项
 * @returns {Promise<{success: boolean, data?: Object, message?: string}>}
 */
export async function uploadAttachment(file, options = {}) {
  try {
    const { onProgress } = options

    // 验证文件
    const validation = validateAttachmentFile(file)
    if (!validation.valid) {
      return {
        success: false,
        data: null,
        message: validation.error
      }
    }

    const formData = new FormData()
    formData.append('file', file, file.name)

    // 获取token
    const token = localStorage.getItem('token') || localStorage.getItem('admin_token')
    if (!token) {
      return {
        success: false,
        data: null,
        message: '未登录，请先登录'
      }
    }

    // 创建XMLHttpRequest以支持上传进度
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest()
      
      // 上传进度
      if (onProgress) {
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            const percent = Math.round((e.loaded / e.total) * 100)
            onProgress(percent)
          }
        })
      }

      // 请求完成
      xhr.addEventListener('load', () => {
        try {
          const response = JSON.parse(xhr.responseText)
          if (xhr.status === 200 && response.code === 200) {
            resolve({
              success: true,
              data: response.data,
              message: '上传成功'
            })
          } else {
            resolve({
              success: false,
              data: null,
              message: response.message || '上传失败'
            })
          }
        } catch (error) {
          resolve({
            success: false,
            data: null,
            message: '解析响应失败'
          })
        }
      })

      // 请求错误
      xhr.addEventListener('error', () => {
        resolve({
          success: false,
          data: null,
          message: '网络错误，上传失败'
        })
      })

      // 请求超时
      xhr.addEventListener('timeout', () => {
        resolve({
          success: false,
          data: null,
          message: '上传超时，请重试'
        })
      })

      // 发送请求
      xhr.open('POST', '/api/upload/attachment')
      xhr.setRequestHeader('Authorization', `Bearer ${token}`)
      xhr.timeout = 120000 // 2分钟超时
      xhr.send(formData)
    })
  } catch (error) {
    console.error('附件上传失败:', error)
    return {
      success: false,
      data: null,
      message: error.message || '上传失败，请重试'
    }
  }
}

/**
 * 获取附件下载URL
 * @param {string} filename - 服务器返回的文件名
 * @param {string} originalName - 原始文件名（可选，用于下载时显示）
 * @returns {string} 下载URL
 */
export function getAttachmentDownloadUrl(filename, originalName = '') {
  let url = `/api/upload/attachment/download/${encodeURIComponent(filename)}`
  if (originalName) {
    url += `?name=${encodeURIComponent(originalName)}`
  }
  return url
}

/**
 * 下载附件
 * @param {string} filename - 服务器返回的文件名
 * @param {string} originalName - 原始文件名（可选，用于下载时显示）
 */
export function downloadAttachment(filename, originalName = '') {
  const url = getAttachmentDownloadUrl(filename, originalName)
  
  // 创建隐藏的a标签并触发下载
  const link = document.createElement('a')
  link.href = url
  link.download = originalName || filename
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

/**
 * 格式化文件大小
 * @param {number} bytes - 字节数
 * @returns {string} 格式化后的大小
 */
export function formatFileSize(bytes) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

/**
 * 获取文件图标类型（可用于显示不同的图标）
 * @param {string} filename - 文件名
 * @returns {string} 图标类型
 */
export function getFileIconType(filename) {
  const ext = getFileExtension(filename)
  const iconMap = {
    '.zip': 'archive',
    '.rar': 'archive',
    '.7z': 'archive',
    '.gz': 'archive',
    '.tar': 'archive',
    '.pdf': 'pdf',
    '.doc': 'word',
    '.docx': 'word',
    '.xls': 'excel',
    '.xlsx': 'excel',
    '.ppt': 'powerpoint',
    '.pptx': 'powerpoint',
    '.txt': 'text',
    '.csv': 'spreadsheet'
  }
  return iconMap[ext] || 'file'
}

export default {
  uploadAttachment,
  downloadAttachment,
  getAttachmentDownloadUrl,
  validateAttachmentFile,
  formatFileSize,
  getFileIconType
}
