<template>
  <div class="multi-image-upload">
    <div class="upload-grid" @dragover.prevent @drop.prevent="handleDrop">

      <div v-for="(imageItem, index) in imageList" :key="imageItem.id" class="image-item" :class="{
        'dragging': dragIndex === index,
        'touch-dragging': isTouchDragging && touchStartIndex === index,
        'long-pressing': isLongPressed && touchStartIndex === index && !isTouchDragging,
        'is-paid': props.paymentEnabled && !imageItem.isFreePreview,
        'is-free': props.paymentEnabled && imageItem.isFreePreview
      }" draggable="true" @dragstart="handleDragStart(index, $event)" @dragenter.prevent="handleDragEnter(index)"
        @dragover.prevent @dragend="handleDragEnd" @touchstart="handleTouchStart(index, $event)"
        @touchmove="handleTouchMove($event)" @touchend="handleTouchEnd($event)">
        <div class="image-preview" @click="handleImagePreviewClick(index)">
          <img :src="imageItem.preview" alt="预览图片" />
          <div class="image-overlay">
            <div class="image-actions">
              <button @click.stop="removeImage(index)" class="action-btn remove-btn"
                :disabled="isUploading || (!props.allowDeleteLast && imageList.length <= 1)">
                <SvgIcon name="delete" />
              </button>
            </div>
            <div class="image-index">{{ index + 1 }}</div>
          </div>
          <!-- 付费/免费预览标识 -->
          <div v-if="props.paymentEnabled" class="payment-badge" :class="{ 'free': imageItem.isFreePreview }" @click.stop="toggleFreePreview(index)">
            <span v-if="imageItem.isFreePreview" class="badge-text">👁 免费</span>
            <span v-else class="badge-text">🔒 付费</span>
          </div>
        </div>
      </div>


      <div v-if="imageList.length < maxImages" class="upload-item" @click="!isUploading && triggerFileInput()"
        :class="{ 'drag-over': isDragOver, 'uploading': isUploading }"
        @dragover.prevent="!isUploading && (isDragOver = true)" @dragleave.prevent="isDragOver = false"
        @drop.prevent="!isUploading && handleFileDrop($event)">
        <input ref="fileInput" type="file" accept="image/*" multiple @change="handleFileSelect" style="display: none"
          :disabled="isUploading" />

        <div class="upload-placeholder">
          <SvgIcon name="publish" class="upload-icon" :class="{ 'uploading': isUploading }" />
          <p>{{ isUploading ? '上传中...' : '添加图片' }}</p>
          <p class="upload-hint">{{ imageList.length }}/{{ maxImages }}</p>
          <p v-if="!isUploading" class="drag-hint">或拖拽图片到此处</p>
        </div>
      </div>
    </div>

    <div v-if="error" class="error-message">
      {{ error }}
    </div>

    <!-- 水印选项 -->
    <div class="watermark-option">
      <label class="watermark-checkbox">
        <input type="checkbox" v-model="enableWatermark" />
        <span class="checkmark"></span>
        <span class="label-text">添加水印</span>
      </label>
      
      <!-- 水印透明度滑块（仅在启用水印时显示） -->
      <div v-if="enableWatermark" class="watermark-opacity-slider">
        <label class="opacity-label">
          <span>透明度</span>
          <span class="opacity-value">{{ watermarkOpacity }}%</span>
        </label>
        <input 
          type="range" 
          v-model.number="watermarkOpacity" 
          min="10" 
          max="100" 
          step="5"
          class="opacity-slider"
        />
      </div>
    </div>

    <div class="upload-tips">
      <p>• 最多上传{{ maxImages }}张图片</p>
      <p>• 支持 JPG、PNG 格式</p>
      <p>• 单张图片不超过100MB</p>
      <p class="drag-tip">• <span class="desktop-tip">拖拽图片可调整顺序</span><span class="mobile-tip">长按图片可拖拽排序</span></p>
    </div>


    <MessageToast v-if="showToast" :message="toastMessage" :type="toastType" @close="handleToastClose" />

    <!-- 图片查看器 -->
    <ImageViewer :visible="showImageViewer" :images="viewerImages" :initial-index="currentImageIndex" image-type="post"
      @close="handleImageViewerClose" @change="handleImageViewerChange" />
  </div>
</template>

<script setup>
import { ref, watch, nextTick } from 'vue'
import SvgIcon from '@/components/SvgIcon.vue'
import MessageToast from '@/components/MessageToast.vue'
import ImageViewer from '@/components/ImageViewer.vue'
import { imageUploadApi, uploadApi } from '@/api/index.js'

const props = defineProps({
  modelValue: {
    type: Array,
    default: () => []
  },
  maxImages: {
    type: Number,
    default: 9
  },
  allowDeleteLast: {
    type: Boolean,
    default: false
  },
  paymentEnabled: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:modelValue', 'error'])

const fileInput = ref(null)
const imageList = ref([])
const error = ref('')
const isDragOver = ref(false)
const isUploading = ref(false)

// 水印选项（默认关闭，用户勾选后才添加水印）
const enableWatermark = ref(false)
// 水印透明度（默认50%）
const watermarkOpacity = ref(50)

// 消息提示相关
const showToast = ref(false)
const toastMessage = ref('')
const toastType = ref('success')

// 拖拽相关状态
const dragIndex = ref(-1)
const dragOverIndex = ref(-1)

// 触摸拖拽相关状态
const touchStartIndex = ref(-1)
const touchStartX = ref(0)
const touchStartY = ref(0)
const touchCurrentY = ref(0)
const isTouchDragging = ref(false)
const touchThreshold = 10 // 触摸移动阈值
const longPressTimer = ref(null)
const longPressDelay = 300 // 长按延迟时间
const isLongPressed = ref(false)

// ImageViewer相关状态
const showImageViewer = ref(false)
const currentImageIndex = ref(0)
const viewerImages = ref([])

// 生成唯一ID
const generateId = () => Date.now() + Math.random().toString(36).substr(2, 9)

// 初始化图片列表（如果有外部传入的值）
const initializeImageList = (images) => {
  return images.map((image, index) => {
    if (typeof image === 'string') {
      // 如果是URL字符串，说明是已上传的图片
      return {
        id: generateId(),
        file: null,
        preview: image,
        uploaded: true,
        url: image,
        isFreePreview: index === 0 // 默认第一张为免费预览
      }
    } else if (image.file) {
      // 如果是文件对象
      return {
        id: image.id || generateId(),
        file: image.file,
        preview: image.preview,
        uploaded: false,
        url: null,
        isFreePreview: image.isFreePreview !== undefined ? image.isFreePreview : index === 0
      }
    }
    // 保留已有的 isFreePreview 属性
    return {
      ...image,
      isFreePreview: image.isFreePreview !== undefined ? image.isFreePreview : index === 0
    }
  })
}

// 切换图片的免费预览状态
const toggleFreePreview = (index) => {
  if (imageList.value[index]) {
    imageList.value[index].isFreePreview = !imageList.value[index].isFreePreview
    updateModelValue()
    showMessage(imageList.value[index].isFreePreview ? '已设为免费预览' : '已设为付费内容', 'success')
  }
}

// 用于防止循环更新的标志
let isInternalUpdate = false

// 监听外部值变化
watch(() => props.modelValue, (newValue) => {
  if (isInternalUpdate) return // 如果是内部更新触发的，跳过

  if (newValue && newValue.length > 0) {
    imageList.value = initializeImageList(newValue)
  } else {
    imageList.value = []
  }
}, { immediate: true })

// 监听内部数组变化，同步到外部
watch(imageList, (newValue) => {
  if (isInternalUpdate) return // 防止循环更新

  isInternalUpdate = true

  // 将内部格式转换为外部格式
  const externalValue = newValue.map(item => ({
    id: item.id,
    file: item.file,
    preview: item.preview,
    uploaded: item.uploaded,
    url: item.url,
    isFreePreview: item.isFreePreview
  }))
  emit('update:modelValue', externalValue)

  // 在下一个tick重置标志
  nextTick(() => {
    isInternalUpdate = false
  })
}, { deep: true, flush: 'post' })

// 手动触发 model 更新
const updateModelValue = () => {
  const externalValue = imageList.value.map(item => ({
    id: item.id,
    file: item.file,
    preview: item.preview,
    uploaded: item.uploaded,
    url: item.url,
    isFreePreview: item.isFreePreview
  }))
  emit('update:modelValue', externalValue)
}

const triggerFileInput = () => {
  fileInput.value?.click()
}

const createImagePreview = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => resolve(e.target.result)
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

const addFiles = async (files) => {
  const fileArray = Array.from(files)

  // 检查数量限制
  const remainingSlots = props.maxImages - imageList.value.length
  if (fileArray.length > remainingSlots) {
    const errorMsg = `最多只能再添加${remainingSlots}张图片`
    error.value = errorMsg
    emit('error', errorMsg)
    return
  }

  // 验证所有文件
  for (const file of fileArray) {
    // 先检查文件大小（100MB限制）
    if (file.size > 100 * 1024 * 1024) {
      const fileSizeMB = (file.size / (1024 * 1024)).toFixed(1)
      const errorMsg = `图片大小为 ${fileSizeMB}MB，超过 100MB 限制，请选择更小的图片`

      // 显示Toast提示
      showMessage(errorMsg, 'error')

      // 同时设置错误状态
      error.value = errorMsg
      emit('error', errorMsg)
      return
    }

    const validation = imageUploadApi.validateImageFile(file)
    if (!validation.valid) {
      const errorMsg = `${file.name}: ${validation.error}`
      error.value = errorMsg
      emit('error', errorMsg)
      return
    }
  }

  error.value = ''

  try {
    // 为每个文件创建预览（不进行前端压缩，由后端处理）
    for (const file of fileArray) {
      const preview = await createImagePreview(file)
      const imageItem = {
        id: generateId(),
        file, // 直接使用原始文件，后端负责压缩处理
        preview,
        uploaded: false,
        url: null
      }
      imageList.value.push(imageItem)
    }
  } catch (err) {
    console.error('处理图片失败:', err)
    const errorMsg = '处理图片失败，请重试'
    error.value = errorMsg
    emit('error', errorMsg)
  }
}

const handleFileSelect = async (event) => {
  const files = event.target.files
  if (files.length === 0) return

  await addFiles(files)

  // 清空文件输入
  if (fileInput.value) {
    fileInput.value.value = ''
  }
}

const handleFileDrop = async (event) => {
  isDragOver.value = false
  const files = event.dataTransfer.files
  if (files.length === 0) return

  await addFiles(files)
}

const removeImage = (index) => {
  // 如果不允许删除最后一张图片且只有一张图片，不允许删除
  if (!props.allowDeleteLast && imageList.value.length <= 1) {
    return
  }
  imageList.value.splice(index, 1)
  error.value = ''
}

// 拖拽排序相关方法
const handleDragStart = (index, event) => {
  dragIndex.value = index
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/html', event.target.outerHTML)
}

const handleDragEnter = (index) => {
  if (dragIndex.value !== -1 && dragIndex.value !== index) {
    dragOverIndex.value = index
  }
}

const handleDragEnd = () => {
  if (dragIndex.value !== -1 && dragOverIndex.value !== -1) {
    // 执行排序
    const draggedItem = imageList.value[dragIndex.value]
    imageList.value.splice(dragIndex.value, 1)
    imageList.value.splice(dragOverIndex.value, 0, draggedItem)
  }

  // 重置状态
  dragIndex.value = -1
  dragOverIndex.value = -1
}

const handleDrop = (event) => {
  event.preventDefault()
  handleDragEnd()
}

// 触摸事件处理函数
const handleTouchStart = (index, event) => {
  // 不阻止默认行为，允许正常滚动
  const touch = event.touches[0]
  touchStartIndex.value = index
  touchStartX.value = touch.clientX
  touchStartY.value = touch.clientY
  touchCurrentY.value = touch.clientY
  isTouchDragging.value = false
  isLongPressed.value = false

  // 设置长按定时器
  longPressTimer.value = setTimeout(() => {
    isLongPressed.value = true
    // 触发触觉反馈（如果支持）
    if (navigator.vibrate) {
      navigator.vibrate(50)
    }
  }, longPressDelay)
}

const handleTouchMove = (event) => {
  if (touchStartIndex.value === -1) return

  const touch = event.touches[0]
  touchCurrentY.value = touch.clientY
  const deltaX = Math.abs(touch.clientX - touchStartX.value)
  const deltaY = Math.abs(touchCurrentY.value - touchStartY.value)
  const totalDelta = Math.sqrt(deltaX * deltaX + deltaY * deltaY) // 计算总移动距离
  // 如果移动距离超过阈值，清除长按定时器
  if (totalDelta > touchThreshold && longPressTimer.value) {
    clearTimeout(longPressTimer.value)
    longPressTimer.value = null
  }

  // 只有在长按后才允许拖拽（使用总移动距离判定）
  if (isLongPressed.value && totalDelta > touchThreshold && !isTouchDragging.value) {
    isTouchDragging.value = true
    dragIndex.value = touchStartIndex.value
  }

  // 只有在实际拖拽状态下才阻止默认滚动行为
  if (isTouchDragging.value) {
    event.preventDefault() // 防止页面滚动
    // 计算当前触摸位置对应的目标索引
    const targetIndex = getTouchTargetIndex(touch.clientX, touch.clientY)
    if (targetIndex !== -1 && targetIndex !== dragIndex.value) {
      dragOverIndex.value = targetIndex
    }
  }
}

const handleTouchEnd = (event) => {
  // 清除长按定时器
  if (longPressTimer.value) {
    clearTimeout(longPressTimer.value)
    longPressTimer.value = null
  }

  // 如果正在拖拽状态，尝试执行排序
  if (isTouchDragging.value && dragIndex.value !== -1) {
    // 始终根据最终触摸位置重新计算目标索引，确保准确性
    const touch = event.changedTouches[0]
    let finalTargetIndex = -1

    if (touch) {
      // 尝试使用clientX和clientY计算
      finalTargetIndex = getTouchTargetIndex(touch.clientX, touch.clientY)
    }

    // 执行排序（如果有有效的目标位置且不同于起始位置）
    if (finalTargetIndex !== -1 && finalTargetIndex !== dragIndex.value) {
      const draggedItem = imageList.value[dragIndex.value]
      imageList.value.splice(dragIndex.value, 1)
      imageList.value.splice(finalTargetIndex, 0, draggedItem)

      // 排序成功后的触觉反馈
      if (navigator.vibrate) {
        navigator.vibrate(30)
      }
    }
  }

  // 重置触摸状态
  touchStartIndex.value = -1
  touchStartX.value = 0
  touchStartY.value = 0
  touchCurrentY.value = 0
  isTouchDragging.value = false
  isLongPressed.value = false
  dragIndex.value = -1
  dragOverIndex.value = -1
}

// 根据触摸位置直接检测目标元素（使用 elementFromPoint）
const getTouchTargetIndex = (clientX, clientY) => {
  // 使用 elementFromPoint 直接获取触摸点下的元素
  const elementAtPoint = document.elementFromPoint(clientX, clientY)
  if (!elementAtPoint) {
    return -1
  }

  // 查找最近的 .image-item 元素
  let imageItem = elementAtPoint.closest('.image-item')

  if (!imageItem) {
    return -1
  }

  // 获取所有图片项来确定索引
  const uploadGrid = document.querySelector('.upload-grid')
  if (!uploadGrid) {
    return -1
  }

  const imageItems = uploadGrid.querySelectorAll('.image-item')
  const targetIndex = Array.from(imageItems).indexOf(imageItem)
  return targetIndex >= 0 ? targetIndex : -1
}

// 获取所有已上传图片的URL
const getAllImageData = async () => {
  const allImageData = []

  for (const item of imageList.value) {
    if (item.uploaded && item.url && !item.url.startsWith('data:')) {
      // 已上传的图片，直接使用URL
      allImageData.push(item.url)
    }
    // 不再处理未上传的图片，因为现在使用uploadAllImages方法直接上传
  }

  return allImageData
}


// 暴露上传方法给父组件（保持兼容性）
const uploadAllImages = async () => {
  // 如果正在上传，防止重复上传
  if (isUploading.value) {
    return []
  }

  // 找出需要上传的图片（有file但还没上传的）
  const unuploadedImages = imageList.value.filter(item => !item.uploaded && item.file)

  // 如果没有需要上传的新图片，收集所有已有的URL并返回
  if (unuploadedImages.length === 0) {
    const existingUrls = imageList.value
      .filter(item => item.uploaded && item.url && !item.url.startsWith('data:'))
      .map(item => item.url)
    return existingUrls
  }

  isUploading.value = true
  error.value = ''

  try {
    // 上传新图片 - 使用新的upload.js API，传递水印选项
    const files = unuploadedImages.map(item => item.file)

    const result = await uploadApi.uploadImages(files, { 
      watermark: enableWatermark.value,
      watermarkOpacity: watermarkOpacity.value 
    })

    if (result.success && result.data && result.data.uploaded && result.data.uploaded.length > 0) {
      // 更新上传成功的图片状态
      let uploadIndex = 0
      for (let i = 0; i < imageList.value.length; i++) {
        const item = imageList.value[i]
        if (!item.uploaded && item.file) {
          if (uploadIndex < result.data.uploaded.length) {
            const uploadedData = result.data.uploaded[uploadIndex]
            item.uploaded = true
            item.url = uploadedData.url

            uploadIndex++
          }
        }
      }

      // 收集所有图片URL（按照imageList的顺序）
      const allUrls = imageList.value
        .filter(item => item.uploaded && item.url && !item.url.startsWith('data:'))
        .map(item => item.url)
      return allUrls
    } else {
      const errorMsg = result.message || '上传失败，没有成功上传的图片'
      console.error('上传失败:', errorMsg, result)
      throw new Error(errorMsg)
    }
  } catch (err) {
    console.error('批量上传异常:', err)
    error.value = '上传失败: ' + (err.message || '未知错误')
    throw err
  } finally {
    isUploading.value = false
  }
}

// 获取图片数量
const getImageCount = () => {
  return imageList.value.length
}

// 重置组件
const reset = () => {
  imageList.value = []
  error.value = ''
  if (fileInput.value) {
    fileInput.value.value = ''
  }
}

// 根据URL列表同步更新图片列表
const syncWithUrls = (urls) => {
  // 设置标志，防止触发外部更新
  isInternalUpdate = true

  if (!Array.isArray(urls)) {
    imageList.value = []
    nextTick(() => {
      isInternalUpdate = false
    })
    return
  }

  // 如果URL数组为空，清空图片列表
  if (urls.length === 0) {
    imageList.value = []
    nextTick(() => {
      isInternalUpdate = false
    })
    return
  }

  // 去重处理，确保URL数组中没有重复项
  const uniqueUrls = [...new Set(urls.filter(url => url && url.trim()))]

  // 重新构建图片列表，确保与URL数组完全一致
  const newImageList = []

  for (let i = 0; i < uniqueUrls.length; i++) {
    const url = uniqueUrls[i]

    // 只处理有效的URL，不处理任何占位符
    if (url && !url.startsWith('[待上传:')) {
      // 有效的URL，先检查是否已存在相同URL的图片项
      const existingImageWithSameUrl = imageList.value.find(item =>
        item.uploaded && item.url === url
      )

      if (existingImageWithSameUrl) {
        // 如果已存在相同URL的图片项，直接使用它
        newImageList.push(existingImageWithSameUrl)
      } else {
        // 如果不存在，创建新的已上传图片项
        newImageList.push({
          id: generateId(),
          file: null,
          preview: url,
          uploaded: true,
          url: url
        })
      }
    }
  }

  // 替换整个图片列表
  imageList.value = newImageList

  // 在下一个tick重置标志
  nextTick(() => {
    isInternalUpdate = false
  })
}

// 根据ID删除图片
const removeImageById = (imageId) => {
  const index = imageList.value.findIndex(item => item.id === imageId)
  if (index !== -1) {
    imageList.value.splice(index, 1)
  }
}

// 显示消息提示
const showMessage = (message, type = 'success') => {
  toastMessage.value = message
  toastType.value = type
  showToast.value = true
}

// 关闭消息提示
const handleToastClose = () => {
  showToast.value = false
}

// 处理图片预览点击事件
const handleImagePreviewClick = (index) => {
  // 准备图片数据用于ImageViewer
  viewerImages.value = imageList.value.map(item => ({
    url: item.preview,
    alt: `预览图片 ${imageList.value.indexOf(item) + 1}`
  }))
  currentImageIndex.value = index
  showImageViewer.value = true
}

// 关闭图片查看器
const handleImageViewerClose = () => {
  showImageViewer.value = false
}

// 图片查看器索引变化
const handleImageViewerChange = (newIndex) => {
  currentImageIndex.value = newIndex
}

// 暴露方法和属性给父组件
defineExpose({
  uploadAllImages,
  getAllImageData,
  getImageCount,
  reset,
  syncWithUrls,
  removeImageById,
  addFiles,
  imageList,
  isUploading
})
</script>

<style scoped>
.multi-image-upload {
  width: 100%;
}

.upload-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 10px;
  margin-bottom: 10px;
}

.image-item,
.upload-item {
  aspect-ratio: 1;
  border-radius: 8px;
  overflow: hidden;
  position: relative;
}

.image-preview {
  width: 100%;
  height: 100%;
  position: relative;
  cursor: zoom-in;
}

.image-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
}

.image-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--overlay-bg);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  padding: 8px;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.image-preview:hover .image-overlay {
  opacity: 1;
}

.image-actions {
  display: flex;
  gap: 8px;
  align-self: flex-end;
}

.action-btn {
  background: rgba(255, 255, 255, 0.814);
  border: none;
  border-radius: 50%;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
  opacity: 0.5;
}

.remove-btn:hover:not(:disabled) {
  opacity: 1;
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  background-color: rgba(255, 255, 255, 0.3);
}

.action-btn svg {
  width: 12px;
  height: 12px;
}

.image-index {
  background: rgba(0, 0, 0, 0.534);
  color: white;
  border-radius: 12px;
  padding: 4px 8px;
  font-size: 12px;
  font-weight: bold;
  align-self: flex-start;
}

.upload-item {
  border: 2px dashed var(--border-color-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
  background: var(--bg-color-primary);
}

.upload-item:hover,
.upload-item.drag-over {
  border-color: var(--primary-color);
}

.upload-item.uploading {
  border-color: var(--primary-color);
  background-color: rgba(255, 71, 87, 0.05);
  cursor: not-allowed;
  opacity: 0.7;
}

.upload-icon.uploading {
  animation: spin 1s linear infinite;
  color: var(--primary-color);
}

.image-item {
  transition: all 0.2s ease;
  cursor: move;
  user-select: none;
}

/* 付费/免费预览标识样式 */
.payment-badge {
  position: absolute;
  bottom: 8px;
  left: 8px;
  background: rgba(255, 71, 87, 0.9);
  color: white;
  border-radius: 12px;
  padding: 4px 8px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 2px;
}

.payment-badge:hover {
  transform: scale(1.05);
}

.payment-badge.free {
  background: rgba(46, 204, 113, 0.9);
}

.badge-text {
  white-space: nowrap;
}

/* 付费/免费图片边框样式 */
.image-item.is-paid {
  box-shadow: 0 0 0 2px rgba(255, 71, 87, 0.5);
}

.image-item.is-free {
  box-shadow: 0 0 0 2px rgba(46, 204, 113, 0.5);
}

.image-item:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

/* 拖拽状态样式 */
.image-item.dragging {
  opacity: 0.5;
  transform: scale(1.05) rotate(5deg);
  z-index: 1000;
  box-shadow: 0 8px 25px rgba(0, 0, 0, 0.3);
}

.image-item.touch-dragging {
  opacity: 0.8;
  transform: scale(1.6) rotate(3deg);
  z-index: 1000;
}

.image-item.long-pressing {
  transform: scale(0.95);
}

/* 移动端优化 */
@media (max-width: 768px) {
  .image-item {
    touch-action: pan-y;
    /* 允许垂直滚动，但禁用其他手势 */
  }

  .image-item.touch-dragging {
    touch-action: none;
    /* 拖拽时完全禁用默认触摸行为 */
    transform: rotate(2deg);
  }

  .image-item.long-pressing {
    transform: scale(0.9);
  }

  .image-overlay {
    pointer-events: none;
    /* 移动端让overlay不干扰触摸事件 */
  }

  .image-overlay .action-btn {
    pointer-events: auto;
    /* 但保持按钮可点击 */
  }

  .upload-grid {
    user-select: none;
    /* 防止文本选择 */
  }
}

.upload-placeholder {
  text-align: center;
  color: var(--text-color-secondary);
}

.upload-icon {
  width: 24px;
  height: 24px;
  margin-bottom: 5px;
  color: var(--text-color-secondary);
}

.upload-placeholder p {
  margin: 2px 0;
  font-size: 12px;
}

.upload-hint {
  color: var(--text-color-secondary);
  font-size: 10px !important;
}

.drag-hint {
  color: var(--text-color-secondary);
  font-size: 10px !important;
  margin-top: 4px;
}

.upload-loading {
  text-align: center;
  color: var(--primary-color);
}

.loading-icon {
  width: 20px;
  height: 20px;
  margin-bottom: 5px;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

.upload-loading p {
  margin: 2px 0;
  font-size: 12px;
}

.error-message {
  color: var(--primary-color);
  font-size: 12px;
  margin-bottom: 10px;
}

.upload-tips {
  font-size: 12px;
  color: var(--text-color-secondary);
  line-height: 1.4;
}

.upload-tips p {
  margin: 2px 0;
}

.drag-tip .mobile-tip {
  display: none;
}

.drag-tip .desktop-tip {
  display: inline;
}

/* 水印选项样式 */
.watermark-option {
  margin: 10px 0;
  padding: 8px 0;
}

.watermark-checkbox {
  display: flex;
  align-items: center;
  cursor: pointer;
  user-select: none;
  font-size: 14px;
  color: var(--text-color-primary);
}

.watermark-checkbox input[type="checkbox"] {
  display: none;
}

.watermark-checkbox .checkmark {
  width: 18px;
  height: 18px;
  border: 2px solid var(--border-color-primary);
  border-radius: 4px;
  margin-right: 8px;
  position: relative;
  transition: all 0.2s ease;
  background: var(--bg-color-primary);
}

.watermark-checkbox input[type="checkbox"]:checked + .checkmark {
  background: var(--primary-color);
  border-color: var(--primary-color);
}

.watermark-checkbox input[type="checkbox"]:checked + .checkmark::after {
  content: '';
  position: absolute;
  left: 5px;
  top: 2px;
  width: 5px;
  height: 9px;
  border: solid white;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}

.watermark-checkbox .label-text {
  color: var(--text-color-secondary);
}

/* 水印透明度滑块样式 */
.watermark-opacity-slider {
  margin-top: 10px;
  padding: 8px 0;
}

.opacity-label {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  color: var(--text-color-secondary);
  margin-bottom: 6px;
}

.opacity-value {
  font-weight: 500;
  color: var(--primary-color);
}

.opacity-slider {
  width: 100%;
  height: 6px;
  -webkit-appearance: none;
  appearance: none;
  background: var(--border-color-primary);
  border-radius: 3px;
  outline: none;
  cursor: pointer;
}

.opacity-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--primary-color);
  cursor: pointer;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  transition: transform 0.2s ease;
}

.opacity-slider::-webkit-slider-thumb:hover {
  transform: scale(1.1);
}

.opacity-slider::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--primary-color);
  cursor: pointer;
  border: none;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

/* 移动端显示不同的提示 */
@media (max-width: 768px) {
  .drag-tip .mobile-tip {
    display: inline;
  }

  .drag-tip .desktop-tip {
    display: none;
  }
}
</style>
