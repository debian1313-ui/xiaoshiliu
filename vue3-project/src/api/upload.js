import SparkMD5 from 'spark-md5'

// 默认分片大小 3MB
const DEFAULT_CHUNK_SIZE = 3 * 1024 * 1024
// 图片分片上传阈值 3MB
const IMAGE_CHUNK_THRESHOLD = 3 * 1024 * 1024
// 默认图片最大大小 100MB (will be overridden by server config)
let IMAGE_MAX_SIZE = 100 * 1024 * 1024
// 前端初步检查的最大大小 10MB (宽松的预检查，实际限制由服务器配置决定)
export const PRELIMINARY_MAX_SIZE = 10 * 1024 * 1024

/**
 * 获取服务器图片配置
 * @returns {Promise<{imageMaxFileSize: number}>}
 */
async function getImageConfig() {
  try {
    const response = await fetch('/api/upload/chunk/config', {
      headers: {
        'Authorization': `******'token')}`
      }
    })
    const result = await response.json()
    if (result.code === 200 && result.data && result.data.imageMaxFileSize) {
      IMAGE_MAX_SIZE = result.data.imageMaxFileSize
      return { imageMaxFileSize: result.data.imageMaxFileSize }
    }
    return { imageMaxFileSize: IMAGE_MAX_SIZE }
  } catch (error) {
    console.warn('获取图片配置失败，使用默认配置:', error)
    return { imageMaxFileSize: IMAGE_MAX_SIZE }
  }
}

/**
 * 计算文件MD5（用于生成唯一标识符）
 * @param {File} file - 文件
 * @returns {Promise<string>} MD5值
 */
async function calculateFileMD5(file) {
  return new Promise((resolve, reject) => {
    const spark = new SparkMD5.ArrayBuffer()
    const reader = new FileReader()
    const chunkSize = 2 * 1024 * 1024 // 2MB chunks for MD5 calculation
    let currentChunk = 0
    const chunks = Math.ceil(file.size / chunkSize)

    reader.onload = (e) => {
      spark.append(e.target.result)
      currentChunk++

      if (currentChunk < chunks) {
        loadNext()
      } else {
        resolve(spark.end())
      }
    }

    reader.onerror = () => {
      reject(new Error('文件读取失败'))
    }

    function loadNext() {
      const start = currentChunk * chunkSize
      const end = Math.min(start + chunkSize, file.size)
      reader.readAsArrayBuffer(file.slice(start, end))
    }

    loadNext()
  })
}

/**
 * 计算分片MD5
 * @param {Blob} chunk - 分片数据
 * @returns {Promise<string>} MD5值
 */
async function calculateChunkMD5(chunk) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const spark = new SparkMD5.ArrayBuffer()
      spark.append(e.target.result)
      resolve(spark.end())
    }
    reader.onerror = () => reject(new Error('分片读取失败'))
    reader.readAsArrayBuffer(chunk)
  })
}

/**
 * 验证分片是否已存在
 * @param {string} identifier - 文件标识符
 * @param {number} chunkNumber - 分片编号
 * @param {string} md5 - 分片MD5
 * @returns {Promise<{exists: boolean, valid: boolean}>}
 */
async function verifyChunk(identifier, chunkNumber, md5) {
  try {
    const response = await fetch(`/api/upload/chunk/verify?identifier=${identifier}&chunkNumber=${chunkNumber}&md5=${md5}`, {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      }
    })
    const result = await response.json()
    if (result.code === 200) {
      return result.data
    }
    return { exists: false, valid: false }
  } catch (error) {
    console.warn('分片验证失败:', error)
    return { exists: false, valid: false }
  }
}

/**
 * 上传单个分片
 * @param {Blob} chunk - 分片数据
 * @param {Object} params - 分片参数
 * @returns {Promise<{success: boolean, data?: Object, message?: string}>}
 */
async function uploadChunk(chunk, params) {
  const { identifier, chunkNumber, totalChunks, filename } = params
  
  const formData = new FormData()
  formData.append('file', chunk, `chunk_${chunkNumber}`)
  formData.append('identifier', identifier)
  formData.append('chunkNumber', chunkNumber.toString())
  formData.append('totalChunks', totalChunks.toString())
  formData.append('filename', filename)

  try {
    const response = await fetch('/api/upload/chunk', {
      method: 'POST',
      body: formData,
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      }
    })
    
    const result = await response.json()
    return {
      success: result.code === 200,
      data: result.data,
      message: result.message
    }
  } catch (error) {
    console.error(`分片 ${chunkNumber} 上传失败:`, error)
    return {
      success: false,
      message: error.message || '分片上传失败'
    }
  }
}

/**
 * 合并分片
 * @param {Object} params - 合并参数
 * @returns {Promise<{success: boolean, data?: Object, message?: string}>}
 */
async function mergeChunks(params) {
  const { identifier, totalChunks, filename, fileType } = params

  try {
    const response = await fetch('/api/upload/chunk/merge', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      },
      body: JSON.stringify({
        identifier,
        totalChunks,
        filename,
        fileType: fileType || 'video' // 默认为视频，与后端保持一致
      })
    })
    
    const result = await response.json()
    return {
      success: result.code === 200,
      data: result.data,
      message: result.message
    }
  } catch (error) {
    console.error('分片合并失败:', error)
    return {
      success: false,
      message: error.message || '分片合并失败'
    }
  }
}

/**
 * 格式化文件大小
 * @param {number} bytes - 字节数
 * @returns {string} 格式化后的文件大小
 */
function formatFileSize(bytes) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

/**
 * 格式化上传速度
 * @param {number} bytesPerSecond - 每秒字节数
 * @returns {string} 格式化后的速度
 */
function formatSpeed(bytesPerSecond) {
  if (bytesPerSecond === 0) return '0 B/s'
  const k = 1024
  const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  const i = Math.floor(Math.log(bytesPerSecond) / Math.log(k))
  return parseFloat((bytesPerSecond / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

/**
 * 分片上传图片文件
 * @param {File} file - 图片文件
 * @param {Object} options - 选项
 * @returns {Promise<{success: boolean, data?: Object, message?: string}>}
 */
async function uploadImageChunked(file, options = {}) {
  const { onProgress, onSpeedUpdate, watermark, watermarkOpacity } = options

  try {
    // 计算文件唯一标识符
    console.log('📊 计算文件MD5...')
    const fileMD5 = await calculateFileMD5(file)
    const identifier = `${fileMD5}_${file.size}`
    console.log(`📝 文件标识符: ${identifier}`)

    // 计算分片数量
    const chunkSize = DEFAULT_CHUNK_SIZE
    const totalChunks = Math.ceil(file.size / chunkSize)
    console.log(`📦 文件大小: ${formatFileSize(file.size)}, 分片数: ${totalChunks}`)

    let uploadedChunks = 0
    let uploadedBytes = 0
    const startTime = Date.now()
    let lastUpdateTime = startTime
    let lastUploadedBytes = 0

    // 逐个上传分片
    for (let i = 1; i <= totalChunks; i++) {
      const start = (i - 1) * chunkSize
      const end = Math.min(start + chunkSize, file.size)
      const chunk = file.slice(start, end)

      // 计算分片MD5用于验证
      const chunkMD5 = await calculateChunkMD5(chunk)

      // 检查分片是否已存在（断点续传）
      const verifyResult = await verifyChunk(identifier, i, chunkMD5)
      
      if (verifyResult.exists && verifyResult.valid) {
        console.log(`⏭️ 分片 ${i}/${totalChunks} 已存在，跳过`)
        uploadedChunks++
        uploadedBytes += chunk.size
        
        // 计算进度和速度
        const progress = Math.round((uploadedBytes / file.size) * 100)
        const currentTime = Date.now()
        const timeDiff = (currentTime - lastUpdateTime) / 1000 // 秒
        const bytesDiff = uploadedBytes - lastUploadedBytes
        const speed = timeDiff > 0 ? bytesDiff / timeDiff : 0
        
        onProgress?.(progress)
        onSpeedUpdate?.(speed)
        
        lastUpdateTime = currentTime
        lastUploadedBytes = uploadedBytes
        continue
      }

      // 上传分片
      console.log(`📤 上传分片 ${i}/${totalChunks}...`)
      const chunkStartTime = Date.now()
      
      const uploadResult = await uploadChunk(chunk, {
        identifier,
        chunkNumber: i,
        totalChunks,
        filename: file.name
      })

      if (!uploadResult.success) {
        console.error(`❌ 分片 ${i} 上传失败:`, uploadResult.message)
        return {
          success: false,
          message: `分片 ${i} 上传失败: ${uploadResult.message}`
        }
      }

      uploadedChunks++
      uploadedBytes += chunk.size
      
      // 计算进度和速度
      const currentTime = Date.now()
      const chunkTime = (currentTime - chunkStartTime) / 1000 // 秒
      const chunkSpeed = chunkTime > 0 ? chunk.size / chunkTime : 0
      const progress = Math.round((uploadedBytes / file.size) * 100)
      
      onProgress?.(progress)
      onSpeedUpdate?.(chunkSpeed)
      
      lastUpdateTime = currentTime
      lastUploadedBytes = uploadedBytes
      
      console.log(`✅ 分片 ${i}/${totalChunks} 上传成功`)
    }

    // 合并分片
    console.log('🔄 开始合并分片...')
    const mergeResult = await mergeChunks({
      identifier,
      totalChunks,
      filename: file.name,
      fileType: 'image'
    })

    if (!mergeResult.success) {
      console.error('❌ 分片合并失败:', mergeResult.message)
      return {
        success: false,
        message: mergeResult.message || '分片合并失败'
      }
    }

    console.log('✅ 图片上传完成:', mergeResult.data)
    return {
      success: true,
      data: mergeResult.data
    }
  } catch (error) {
    console.error('❌ 分片上传失败:', error)
    return {
      success: false,
      message: error.message || '图片上传失败'
    }
  }
}

export async function uploadImage(file, options = {}) {
  try {
    if (!file) throw new Error('请选择要上传的文件')
    if (file instanceof File && !file.type.startsWith('image/')) throw new Error('请选择图片文件')
    
    // 获取服务器配置的图片最大大小
    await getImageConfig()
    
    if (file.size > IMAGE_MAX_SIZE) {
      const maxSizeMB = Math.round(IMAGE_MAX_SIZE / (1024 * 1024))
      throw new Error(`图片大小不能超过${maxSizeMB}MB`)
    }

    // WebP转换会在后端处理质量，不需要前端压缩
    // 如果文件大小超过3MB，使用分片上传
    if (file.size > IMAGE_CHUNK_THRESHOLD) {
      console.log(`📦 文件大小 ${formatFileSize(file.size)} 超过阈值，使用分片上传`)
      
      const result = await uploadImageChunked(file, {
        onProgress: options.onProgress,
        onSpeedUpdate: options.onSpeedUpdate,
        watermark: options.watermark,
        watermarkOpacity: options.watermarkOpacity
      })
      
      if (result.success) {
        return {
          success: true,
          data: { url: result.data.url, originalName: file.name, size: file.size },
          message: '上传成功'
        }
      } else {
        throw new Error(result.message || '分片上传失败')
      }
    }

    // 否则使用普通上传
    const formData = new FormData()
    const filename = options.filename || (file instanceof File ? file.name : 'image.png')
    formData.append('file', file, filename)
    
    // 添加水印选项（仅当显式开启时才应用）
    const applyWatermark = options.watermark === true
    formData.append('watermark', applyWatermark.toString())
    
    // 添加水印透明度（如果用户指定）
    if (options.watermarkOpacity !== undefined) {
      formData.append('watermarkOpacity', options.watermarkOpacity.toString())
    }

    // 创建AbortController用于超时控制
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 60000) // 60秒超时

    const response = await fetch('/api/upload/single', {
      method: 'POST',
      body: formData,
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      }
    })

    clearTimeout(timeoutId)

    if (!response.ok) throw new Error(`HTTP错误: ${response.status}`)

    const result = await response.json()
    if (result.code !== 200) throw new Error(result.message || '上传失败')

    return {
      success: true,
      data: { url: result.data.url, originalName: filename, size: file.size },
      message: '上传成功'
    }
  } catch (error) {
    let errorMessage = '上传失败，请重试'

    if (error.name === 'AbortError') {
      errorMessage = '上传超时，请检查网络连接或稍后重试'
    } else if (error.message) {
      errorMessage = error.message
    }

    return {
      success: false,
      data: null,
      message: errorMessage
    }
  }
}

export async function uploadImages(files, options = {}) {
  try {
    const { maxCount = 9, onProgress, onSingleComplete, onSpeedUpdate, watermark, watermarkOpacity } = options
    const fileArray = Array.from(files)

    if (fileArray.length === 0) throw new Error('请选择要上传的文件')
    if (fileArray.length > maxCount) throw new Error(`最多只能上传${maxCount}张图片`)

    const results = []
    const errors = []

    for (let i = 0; i < fileArray.length; i++) {
      const file = fileArray[i]

      try {
        onProgress?.({
          current: i + 1,
          total: fileArray.length,
          percent: Math.round(((i + 1) / fileArray.length) * 100)
        })

        // 传递水印选项（包括透明度）和速度回调
        const result = await uploadImage(file, { 
          watermark, 
          watermarkOpacity,
          onSpeedUpdate: (speed) => {
            onSpeedUpdate?.({ fileIndex: i, speed, fileName: file.name })
          }
        })

        if (result.success) {
          results.push(result.data)
          onSingleComplete?.({ index: i, file, result: result.data, success: true })
        } else {
          errors.push({ file: file.name, error: result.message })
          onSingleComplete?.({ index: i, file, result: null, success: false, error: result.message })
        }
      } catch (error) {
        errors.push({ file: file.name, error: error.message })
        onSingleComplete?.({ index: i, file, result: null, success: false, error: error.message })
      }
    }

    return {
      success: results.length > 0,
      data: {
        uploaded: results,
        errors,
        total: fileArray.length,
        successCount: results.length,
        errorCount: errors.length
      },
      message: errors.length === 0 ? '所有图片上传成功' : `${results.length}张上传成功，${errors.length}张失败`
    }
  } catch (error) {
    return {
      success: false,
      data: null,
      message: error.message || '批量上传失败，请重试'
    }
  }
}

export async function uploadCroppedImage(blob, options = {}) {
  try {
    if (!blob) throw new Error('请选择要上传的文件')
    
    const formData = new FormData()
    const filename = options.filename || 'avatar.png'
    formData.append('file', blob, filename)

    // 自动检测token类型（管理员或普通用户）
    const adminToken = localStorage.getItem('admin_token')
    const userToken = localStorage.getItem('token')
    const token = adminToken || userToken

    if (!token) {
      throw new Error('未登录，请先登录')
    }

    // 使用后端的单图片上传接口
    const response = await fetch('/api/upload/single', {
      method: 'POST',
      body: formData,
      headers: {
        'Authorization': `Bearer ${token}`
      }
    })

    if (!response.ok) {
      throw new Error(`HTTP错误: ${response.status}`)
    }

    const result = await response.json()
    
    if (result.code === 200) {
      return {
        success: true,
        data: { url: result.data.url, originalName: filename, size: blob.size },
        message: '上传成功'
      }
    } else {
      throw new Error(result.message || '上传失败')
    }
  } catch (error) {
    console.error('头像上传失败:', error)
    return {
      success: false,
      data: null,
      message: error.message || '上传失败，请重试'
    }
  }
}

/**
 * 验证图片文件
 * @param {File} file - 文件对象
 * @param {Object} options - 验证选项
 * @param {number} options.maxSize - 最大文件大小（字节），默认使用IMAGE_MAX_SIZE（应在调用uploadImage后使用以确保获取到最新配置）
 * @param {Array<string>} options.allowedTypes - 允许的文件类型
 * @returns {Object} 验证结果 {valid: boolean, error: string}
 */
export function validateImageFile(file, options = {}) {
  const {
    maxSize = IMAGE_MAX_SIZE,
    allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
  } = options

  if (!file) return { valid: false, error: '请选择文件' }
  if (!file.type.startsWith('image/')) return { valid: false, error: '请选择图片文件' }
  if (allowedTypes.length > 0 && !allowedTypes.includes(file.type)) {
    return { valid: false, error: `不支持的文件类型` }
  }
  if (file.size > maxSize) {
    const maxSizeMB = Math.round(maxSize / (1024 * 1024))
    return { valid: false, error: `文件大小不能超过${maxSizeMB}MB` }
  }
  return { valid: true, error: null }
}

// Export formatFileSize and formatSpeed as named exports
export { formatFileSize, formatSpeed }

export function createImagePreview(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) {
      reject(new Error('不是有效的图片文件'))
      return
    }
    const reader = new FileReader()
    reader.onload = (e) => resolve(e.target.result)
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}


export default {
  uploadImage,
  uploadImages,
  uploadCroppedImage,
  validateImageFile,
  formatFileSize, // Keep for backward compatibility
  createImagePreview
  // Note: formatSpeed is intentionally only exported as a named export
  // to encourage using the more explicit import { formatSpeed } syntax
}
