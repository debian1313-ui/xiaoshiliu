import SparkMD5 from 'spark-md5'

// 压缩图片函数
const compressImage = (file, maxSizeMB = 0.8, quality = 0.4) => {
  return new Promise((resolve) => {
    // 对于800KB以下的文件不进行压缩
    if (file.size <= maxSizeMB * 1024 * 1024) {
      resolve(file)
      return
    }

    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    const img = new Image()

    img.onload = () => {
      // 超过800KB的图片使用强力压缩
      const compressQuality = 0.4
      const maxDimension = 1200

      // 计算新的尺寸
      let { width, height } = img
      if (width > maxDimension || height > maxDimension) {
        const ratio = Math.min(maxDimension / width, maxDimension / height)
        width = Math.floor(width * ratio)
        height = Math.floor(height * ratio)
      }

      canvas.width = width
      canvas.height = height

      // 绘制并压缩
      ctx.drawImage(img, 0, 0, width, height)
      canvas.toBlob((blob) => {
        const compressedFile = new File([blob], file.name, {
          type: file.type,
          lastModified: Date.now()
        })

        resolve(compressedFile)
      }, file.type, compressQuality)
    }

    img.onerror = () => resolve(file) // 加载失败，返回原文件
    img.src = URL.createObjectURL(file)
  })
}

/**
 * 大图片分片上传的阈值 3MB
 */
const LARGE_IMAGE_THRESHOLD = 3 * 1024 * 1024

/**
 * 默认分片大小 1MB（图片分片比视频小一些）
 */
const IMAGE_CHUNK_SIZE = 1 * 1024 * 1024

/**
 * 格式化文件大小（内部使用）
 * @param {number} bytes - 字节数
 * @returns {string}
 */
function formatFileSizeInternal(bytes) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

/**
 * 计算文件MD5
 * @param {File|Blob} file - 文件
 * @returns {Promise<string>} MD5值
 */
async function calculateFileMD5(file) {
  return new Promise((resolve, reject) => {
    const spark = new SparkMD5.ArrayBuffer()
    const reader = new FileReader()
    const chunkSize = 2 * 1024 * 1024
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
 * 分片上传大图片
 * @param {File} file - 图片文件
 * @param {Object} options - 上传选项
 * @returns {Promise<{success: boolean, data?: Object, message?: string}>}
 */
async function uploadLargeImageChunked(file, options = {}) {
  try {
    const chunkSize = IMAGE_CHUNK_SIZE
    
    // 计算文件唯一标识符
    console.log('📊 计算图片MD5...')
    const fileMD5 = await calculateFileMD5(file)
    const identifier = `img_${fileMD5}_${file.size}`
    console.log(`📝 图片标识符: ${identifier}`)

    // 计算分片数量
    const totalChunks = Math.ceil(file.size / chunkSize)
    console.log(`📦 图片大小: ${formatFileSizeInternal(file.size)}, 分片数: ${totalChunks}`)

    const token = localStorage.getItem('token')
    if (!token) {
      throw new Error('未登录，请先登录')
    }

    // 逐个上传分片
    for (let i = 1; i <= totalChunks; i++) {
      const start = (i - 1) * chunkSize
      const end = Math.min(start + chunkSize, file.size)
      const chunk = file.slice(start, end)

      const formData = new FormData()
      formData.append('file', chunk, `chunk_${i}`)
      formData.append('identifier', identifier)
      formData.append('chunkNumber', i.toString())
      formData.append('totalChunks', totalChunks.toString())
      formData.append('filename', file.name)
      formData.append('fileType', 'image') // 标记为图片类型

      console.log(`📤 上传图片分片 ${i}/${totalChunks}...`)
      
      const response = await fetch('/api/upload/chunk', {
        method: 'POST',
        body: formData,
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      if (!response.ok) {
        throw new Error(`分片 ${i} 上传失败: HTTP ${response.status}`)
      }

      const result = await response.json()
      if (result.code !== 200) {
        throw new Error(`分片 ${i} 上传失败: ${result.message}`)
      }

      console.log(`✅ 图片分片 ${i}/${totalChunks} 上传成功`)
    }

    // 合并分片，传递水印选项
    console.log('🔄 开始合并图片分片...')
    const mergeFormData = new FormData()
    mergeFormData.append('identifier', identifier)
    mergeFormData.append('totalChunks', totalChunks.toString())
    mergeFormData.append('filename', file.name)
    mergeFormData.append('fileType', 'image')

    // 添加水印选项
    if (options.watermark !== undefined) {
      mergeFormData.append('watermark', options.watermark.toString())
    }
    if (options.watermarkOpacity !== undefined) {
      mergeFormData.append('watermarkOpacity', options.watermarkOpacity.toString())
    }
    if (options.watermarkPosition !== undefined) {
      mergeFormData.append('watermarkPosition', options.watermarkPosition.toString())
    }
    if (options.watermarkColor !== undefined) {
      mergeFormData.append('watermarkColor', options.watermarkColor)
    }
    if (options.watermarkFontSize !== undefined) {
      mergeFormData.append('watermarkFontSize', options.watermarkFontSize.toString())
    }

    const mergeResponse = await fetch('/api/upload/chunk/merge', {
      method: 'POST',
      body: mergeFormData,
      headers: {
        'Authorization': `Bearer ${token}`
      }
    })

    if (!mergeResponse.ok) {
      throw new Error(`图片合并失败: HTTP ${mergeResponse.status}`)
    }

    const mergeResult = await mergeResponse.json()
    if (mergeResult.code !== 200) {
      throw new Error(`图片合并失败: ${mergeResult.message}`)
    }

    console.log('✅ 大图片分片上传完成:', mergeResult.data)
    return {
      success: true,
      data: { url: mergeResult.data.url, originalName: file.name, size: file.size }
    }
  } catch (error) {
    console.error('❌ 大图片分片上传失败:', error)
    return {
      success: false,
      message: error.message || '大图片上传失败'
    }
  }
}

export async function uploadImage(file, options = {}) {
  try {
    if (!file) throw new Error('请选择要上传的文件')
    if (file instanceof File && !file.type.startsWith('image/')) throw new Error('请选择图片文件')
    // 增加图片大小限制到10MB（因为现在支持分片上传）
    if (file.size > 10 * 1024 * 1024) throw new Error('图片大小不能超过10MB')

    // 压缩图片
    const compressedFile = await compressImage(file)
    const filename = options.filename || (compressedFile instanceof File ? compressedFile.name : 'image.png')

    // 检查压缩后的文件大小，如果大于3MB则使用分片上传
    if (compressedFile.size > LARGE_IMAGE_THRESHOLD) {
      console.log(`📦 图片大于3MB (${formatFileSizeInternal(compressedFile.size)})，使用分片上传`)
      return await uploadLargeImageChunked(compressedFile, options)
    }

    // 小于3MB的图片使用普通上传
    const formData = new FormData()
    formData.append('file', compressedFile, filename)
    
    // 添加水印选项（仅当显式开启时才应用）
    const applyWatermark = options.watermark === true
    formData.append('watermark', applyWatermark.toString())
    
    // 添加水印自定义设置
    if (options.watermarkOpacity !== undefined) {
      formData.append('watermarkOpacity', options.watermarkOpacity.toString())
    }
    if (options.watermarkPosition !== undefined) {
      formData.append('watermarkPosition', options.watermarkPosition.toString())
    }
    if (options.watermarkColor !== undefined) {
      formData.append('watermarkColor', options.watermarkColor)
    }
    if (options.watermarkFontSize !== undefined) {
      formData.append('watermarkFontSize', options.watermarkFontSize.toString())
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
    const { 
      maxCount = 9, 
      onProgress, 
      onSingleComplete, 
      watermark, 
      watermarkOpacity,
      watermarkPosition,
      watermarkColor,
      watermarkFontSize
    } = options
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

        // 传递水印选项（包括所有自定义设置）
        const result = await uploadImage(file, { 
          watermark, 
          watermarkOpacity,
          watermarkPosition,
          watermarkColor,
          watermarkFontSize
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

export function validateImageFile(file, options = {}) {
  const {
    maxSize = 5 * 1024 * 1024,
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

export function formatFileSize(bytes) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

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
  formatFileSize,
  createImagePreview
}
