import request from './request.js'
import apiConfig from '@/config/api.js'
import SparkMD5 from 'spark-md5'

/**
 * 默认分片大小 3MB
 */
const DEFAULT_CHUNK_SIZE = 3 * 1024 * 1024

/**
 * 默认最大文件大小 100MB
 */
const DEFAULT_MAX_FILE_SIZE = 100 * 1024 * 1024

/**
 * 视频上传API
 */
export const videoApi = {
  /**
   * 获取服务器分片配置
   * @returns {Promise<{chunkSize: number, maxFileSize: number, imageMaxFileSize: number}>}
   */
  async getChunkConfig() {
    try {
      const response = await request.get('/upload/chunk/config')
      if (response.success) {
        return {
          chunkSize: response.data.chunkSize || DEFAULT_CHUNK_SIZE,
          maxFileSize: response.data.maxFileSize || DEFAULT_MAX_FILE_SIZE,
          imageMaxFileSize: response.data.imageMaxFileSize || 5 * 1024 * 1024
        }
      }
      return { 
        chunkSize: DEFAULT_CHUNK_SIZE, 
        maxFileSize: DEFAULT_MAX_FILE_SIZE,
        imageMaxFileSize: 5 * 1024 * 1024
      }
    } catch (error) {
      console.warn('获取分片配置失败，使用默认配置:', error)
      return { 
        chunkSize: DEFAULT_CHUNK_SIZE, 
        maxFileSize: DEFAULT_MAX_FILE_SIZE,
        imageMaxFileSize: 5 * 1024 * 1024
      }
    }
  },

  /**
   * 计算文件MD5（用于生成唯一标识符）
   * @param {File} file - 文件
   * @returns {Promise<string>} MD5值
   */
  async calculateFileMD5(file) {
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
  },

  /**
   * 计算分片MD5
   * @param {Blob} chunk - 分片数据
   * @returns {Promise<string>} MD5值
   */
  async calculateChunkMD5(chunk) {
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
  },

  /**
   * 验证分片是否已存在
   * @param {string} identifier - 文件标识符
   * @param {number} chunkNumber - 分片编号
   * @param {string} md5 - 分片MD5
   * @returns {Promise<{exists: boolean, valid: boolean}>}
   */
  async verifyChunk(identifier, chunkNumber, md5) {
    try {
      const response = await request.get('/upload/chunk/verify', {
        params: { identifier, chunkNumber, md5 }
      })
      if (response.success) {
        return response.data
      }
      return { exists: false, valid: false }
    } catch (error) {
      console.warn('分片验证失败:', error)
      return { exists: false, valid: false }
    }
  },

  /**
   * 上传单个分片
   * @param {Blob} chunk - 分片数据
   * @param {Object} params - 分片参数
   * @returns {Promise<{success: boolean, data?: Object, message?: string}>}
   */
  async uploadChunk(chunk, params) {
    const { identifier, chunkNumber, totalChunks, filename } = params
    
    const formData = new FormData()
    formData.append('file', chunk, `chunk_${chunkNumber}`)
    formData.append('identifier', identifier)
    formData.append('chunkNumber', chunkNumber.toString())
    formData.append('totalChunks', totalChunks.toString())
    formData.append('filename', filename)

    try {
      const response = await request.post('/upload/chunk', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120000 // 2分钟超时
      })
      
      return {
        success: response.success,
        data: response.data,
        message: response.message
      }
    } catch (error) {
      console.error(`分片 ${chunkNumber} 上传失败:`, error)
      return {
        success: false,
        message: error.message || '分片上传失败'
      }
    }
  },

  /**
   * 合并分片
   * @param {Object} params - 合并参数
   * @returns {Promise<{success: boolean, data?: Object, message?: string}>}
   */
  async mergeChunks(params) {
    const { identifier, totalChunks, filename, fileType } = params

    try {
      const response = await request.post('/upload/chunk/merge', {
        identifier,
        totalChunks,
        filename,
        fileType: fileType || 'video' // 默认为视频
      }, {
        timeout: 300000 // 5分钟超时
      })
      
      return {
        success: response.success,
        data: response.data,
        message: response.message
      }
    } catch (error) {
      console.error('分片合并失败:', error)
      return {
        success: false,
        message: error.message || '分片合并失败'
      }
    }
  },

  /**
   * 分片上传视频文件
   * @param {File} file - 视频文件
   * @param {Object} options - 选项
   * @param {Function} options.onProgress - 进度回调 (0-100)
   * @param {Function} options.onChunkProgress - 分片进度回调
   * @param {Function} options.onSpeedUpdate - 速度回调
   * @returns {Promise<{success: boolean, data?: Object, message?: string}>}
   */
  async uploadVideoChunked(file, options = {}) {
    const { onProgress, onChunkProgress, onSpeedUpdate } = options

    try {
      // 获取服务器分片配置
      const config = await this.getChunkConfig()
      const chunkSize = config.chunkSize

      // 计算文件唯一标识符
      console.log('📊 计算文件MD5...')
      const fileMD5 = await this.calculateFileMD5(file)
      const identifier = `${fileMD5}_${file.size}`
      console.log(`📝 文件标识符: ${identifier}`)

      // 计算分片数量
      const totalChunks = Math.ceil(file.size / chunkSize)
      console.log(`📦 文件大小: ${this.formatFileSize(file.size)}, 分片数: ${totalChunks}`)

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
        const chunkMD5 = await this.calculateChunkMD5(chunk)

        // 检查分片是否已存在（断点续传）
        const verifyResult = await this.verifyChunk(identifier, i, chunkMD5)
        
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
          onChunkProgress?.({ current: i, total: totalChunks, skipped: true })
          
          lastUpdateTime = currentTime
          lastUploadedBytes = uploadedBytes
          continue
        }

        // 上传分片
        console.log(`📤 上传分片 ${i}/${totalChunks}...`)
        const chunkStartTime = Date.now()
        
        const uploadResult = await this.uploadChunk(chunk, {
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
        onChunkProgress?.({ current: i, total: totalChunks, skipped: false })
        
        lastUpdateTime = currentTime
        lastUploadedBytes = uploadedBytes
        
        console.log(`✅ 分片 ${i}/${totalChunks} 上传成功`)
      }

      // 合并分片
      console.log('🔄 开始合并分片...')
      const mergeResult = await this.mergeChunks({
        identifier,
        totalChunks,
        filename: file.name,
        fileType: 'video'
      })

      if (!mergeResult.success) {
        console.error('❌ 分片合并失败:', mergeResult.message)
        return {
          success: false,
          message: mergeResult.message || '分片合并失败'
        }
      }

      console.log('✅ 视频上传完成:', mergeResult.data)
      return {
        success: true,
        data: mergeResult.data
      }
    } catch (error) {
      console.error('❌ 分片上传失败:', error)
      return {
        success: false,
        message: error.message || '视频上传失败'
      }
    }
  },

  /**
   * 上传单个视频文件
   * @param {File} file - 视频文件
   * @param {Function} onProgress - 上传进度回调
   * @param {File} thumbnail - 缩略图文件（可选）
   * @returns {Promise} 上传结果
   */
  async uploadVideo(file, onProgress, thumbnail = null) {
    const formData = new FormData()
    formData.append('file', file)
    
    // 如果有缩略图，一起上传
    if (thumbnail) {
      formData.append('thumbnail', thumbnail)
    }

    try {
      const response = await request.post('/upload/video', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        },
        timeout: 300000, // 5分钟超时，适应大视频文件
        onUploadProgress: (progressEvent) => {
          if (onProgress && progressEvent.total) {
            const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total)
            onProgress(progress)
          }
        }
      })

      
      if (response.success) {
        return {
          success: true,
          data: response.data
        }
      } else {
        console.error('❌ 视频上传API失败响应:', response)
        return {
          success: false,
          message: response.message || '视频上传失败'
        }
      }
    } catch (error) {
      console.error('视频上传失败:', error)
      return {
        success: false,
        message: error.response?.data?.message || error.message || '视频上传失败'
      }
    }
  },

  /**
   * 验证视频文件
   * @param {File} file - 视频文件
   * @returns {Object} 验证结果
   */
  validateVideoFile(file) {
    const maxSize = apiConfig.upload.video?.maxFileSize || DEFAULT_MAX_FILE_SIZE
    const allowedTypes = apiConfig.upload.video?.allowedTypes || [
      'video/mp4', 
      'video/avi', 
      'video/mov', 
      'video/wmv', 
      'video/flv', 
      'video/webm'
    ]

    // 检查文件类型
    if (!file.type.startsWith('video/')) {
      return {
        valid: false,
        message: '请选择视频文件'
      }
    }

    // 检查具体的视频格式
    if (!allowedTypes.includes(file.type)) {
      return {
        valid: false,
        message: '不支持的视频格式，请选择 MP4、AVI、MOV、WMV、FLV 或 WebM 格式'
      }
    }

    // 检查文件大小
    if (file.size > maxSize) {
      return {
        valid: false,
        message: `文件大小不能超过 ${this.formatFileSize(maxSize)}`
      }
    }

    return {
      valid: true,
      message: '文件验证通过'
    }
  },

  /**
   * 格式化文件大小
   * @param {number} bytes - 字节数
   * @returns {string} 格式化后的文件大小
   */
  formatFileSize(bytes) {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  },

  /**
   * 创建视频预览
   * @param {File} file - 视频文件
   * @returns {string} 预览URL
   */
  createVideoPreview(file) {
    return URL.createObjectURL(file)
  },

  /**
   * 释放视频预览资源
   * @param {string} url - 预览URL
   */
  revokeVideoPreview(url) {
    if (url && url.startsWith('blob:')) {
      URL.revokeObjectURL(url)
    }
  }
}

export default videoApi