<template>
  <div class="publish-container">
    <!-- 顶部导航栏 -->
    <div class="publish-header">
      <button class="back-btn" @click="handleBack">
        <SvgIcon name="leftArrow" width="24" height="24" />
      </button>
      <div class="header-right">
        <button class="header-action-btn" @click="goToDraftBox">
          <SvgIcon name="draft" width="20" height="20" />
        </button>
        <button class="header-action-btn" @click="goToPostManagement">
          <SvgIcon name="post" width="20" height="20" />
        </button>
      </div>
    </div>

    <div class="publish-content">
      <!-- 登录提示 -->
      <div class="login-prompt" v-if="!isLoggedIn">
        <div class="prompt-content">
          <SvgIcon name="post" width="48" height="48" class="prompt-icon" />
          <h3>请先登录</h3>
          <p>登录后即可发布和管理笔记</p>
        </div>
      </div>

      <div v-if="isLoggedIn" class="editor-main">
        <!-- 媒体类型切换 -->
        <div class="media-type-tabs">
          <button 
            type="button" 
            class="media-tab" 
            :class="{ active: uploadType === 'image' }"
            @click="switchUploadType('image')"
          >
            图文
          </button>
          <button 
            type="button" 
            class="media-tab" 
            :class="{ active: uploadType === 'video' }"
            @click="switchUploadType('video')"
          >
            视频
          </button>
        </div>

        <!-- 上传组件 -->
        <div class="media-upload-section">
          <MultiImageUpload 
            v-if="uploadType === 'image'"
            ref="multiImageUploadRef" 
            v-model="form.images" 
            :max-images="9" 
            :allow-delete-last="true"
            @error="handleUploadError" 
          />
          <VideoUpload 
            v-if="uploadType === 'video'"
            ref="videoUploadRef"
            v-model="form.video"
            @error="handleUploadError"
          />
        </div>

        <!-- 文字配图按钮 -->
        <div v-if="uploadType === 'image'" class="text-image-section">
          <button type="button" class="text-image-btn" @click="openTextImageModal">
            <SvgIcon name="magic" width="16" height="16" />
            <span>文字配图</span>
          </button>
        </div>

        <!-- 标题输入 -->
        <div class="title-section">
          <input 
            v-model="form.title" 
            type="text" 
            class="title-input" 
            placeholder="添加标题" 
            maxlength="100"
          />
        </div>

        <!-- 正文输入 -->
        <div class="content-section">
          <ContentEditableInput 
            ref="contentTextarea" 
            v-model="form.content" 
            :input-class="'content-textarea'"
            placeholder="添加正文" 
            :enable-mention="true" 
            :mention-users="mentionUsers" 
            @focus="handleContentFocus"
            @blur="handleContentBlur" 
            @keydown="handleInputKeydown" 
            @mention="handleMentionInput" 
          />
        </div>

        <!-- 标签展示区域 -->
        <div v-if="form.tags.length > 0" class="tags-display">
          <div class="tags-scroll">
            <span 
              v-for="(tag, index) in form.tags" 
              :key="index" 
              class="tag-chip"
              @click="removeTag(index)"
            >
              #{{ tag }}
            </span>
          </div>
        </div>

        <!-- 工具栏 -->
        <div class="editor-toolbar">
          <button type="button" class="toolbar-btn" @click="scrollToTagSection" aria-label="话题">
            <SvgIcon name="hash" width="18" height="18" />
            <span>话题</span>
          </button>
          <button type="button" class="toolbar-btn" @click="toggleMentionPanel" aria-label="用户">
            <SvgIcon name="mention" width="18" height="18" />
            <span>用户</span>
          </button>
          <button type="button" class="toolbar-btn" @click="toggleEmojiPanel" aria-label="表情">
            <SvgIcon name="emoji" width="18" height="18" />
            <span>表情</span>
          </button>
        </div>

        <!-- 表情选择器 -->
        <div v-if="showEmojiPanel" class="emoji-panel-overlay" v-click-outside="closeEmojiPanel">
          <div class="emoji-panel" @click.stop>
            <EmojiPicker @select="handleEmojiSelect" />
          </div>
        </div>

        <MentionModal :visible="showMentionPanel" @close="closeMentionPanel" @select="handleMentionSelect" />

        <!-- 分隔线 -->
        <div class="editor-divider"></div>

        <!-- 设置选项列表 -->
        <div class="settings-list">
          <!-- 分类选项 -->
          <div class="setting-item" @click="openCategorySelect">
            <div class="setting-left">
              <SvgIcon name="category" width="20" height="20" />
              <span>选择分类</span>
            </div>
            <div class="setting-right">
              <span class="setting-value">{{ selectedCategoryName || '请选择' }}</span>
              <SvgIcon name="right" width="16" height="16" />
            </div>
          </div>

          <!-- 标签选项 -->
          <div ref="tagSectionRef" class="setting-item" @click="openTagSelector">
            <div class="setting-left">
              <SvgIcon name="hash" width="20" height="20" />
              <span>添加标签</span>
            </div>
            <div class="setting-right">
              <span class="setting-value">{{ form.tags.length > 0 ? `已选${form.tags.length}个` : '最多10个' }}</span>
              <SvgIcon name="right" width="16" height="16" />
            </div>
          </div>

          <!-- 公开可见选项 -->
          <div class="setting-item">
            <div class="setting-left">
              <SvgIcon name="view" width="20" height="20" />
              <span>公开可见</span>
            </div>
            <div class="setting-right">
              <span class="setting-value">公开</span>
              <SvgIcon name="right" width="16" height="16" />
            </div>
          </div>
        </div>

        <!-- 分类选择弹窗 -->
        <div v-if="showCategorySelect" class="select-modal-overlay" @click="closeCategorySelect">
          <div class="select-modal" @click.stop>
            <div class="select-modal-header">
              <span>选择分类</span>
              <button class="close-modal-btn" @click="closeCategorySelect">
                <SvgIcon name="close" width="20" height="20" />
              </button>
            </div>
            <div class="select-modal-content">
              <div 
                v-for="category in categories" 
                :key="category.id" 
                class="select-option"
                :class="{ active: form.category_id === category.id }"
                @click="selectCategory(category)"
              >
                {{ category.name }}
              </div>
            </div>
          </div>
        </div>

        <!-- 标签选择弹窗 -->
        <div v-if="showTagSelect" class="select-modal-overlay" @click="closeTagSelector">
          <div class="select-modal tag-modal" @click.stop>
            <div class="select-modal-header">
              <span>添加标签</span>
              <button class="close-modal-btn" @click="closeTagSelector">
                <SvgIcon name="close" width="20" height="20" />
              </button>
            </div>
            <div class="select-modal-content">
              <TagSelector v-model="form.tags" :max-tags="10" />
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 底部操作栏 -->
    <div v-if="isLoggedIn" class="publish-footer">
      <button class="footer-btn draft-btn" :disabled="!canSaveDraft || isSavingDraft" @click="handleSaveDraft">
        {{ isSavingDraft ? '保存中...' : '存草稿' }}
      </button>
      <button class="footer-btn publish-btn" :disabled="!canPublish || isPublishing" @click="handlePublish">
        {{ isPublishing ? '发布中...' : '发布笔记' }}
      </button>
    </div>

    <MessageToast v-if="showToast" :message="toastMessage" :type="toastType" @close="handleToastClose" />

    <!-- 文字配图模态框 -->
    <TextImageModal :visible="showTextImageModal" @close="closeTextImageModal" @generate="handleTextImageGenerate" />
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { useAuthStore } from '@/stores/auth'
import { useNavigationStore } from '@/stores/navigation'
import { createPost, getPostDetail, updatePost, deletePost } from '@/api/posts'
import { getCategories } from '@/api/categories'
import { useScrollLock } from '@/composables/useScrollLock'
import { hasMentions, cleanMentions } from '@/utils/mentionParser'

import MultiImageUpload from '@/components/MultiImageUpload.vue'
import VideoUpload from '@/components/VideoUpload.vue'
import SvgIcon from '@/components/SvgIcon.vue'
import TagSelector from '@/components/TagSelector.vue'
import MessageToast from '@/components/MessageToast.vue'
import EmojiPicker from '@/components/EmojiPicker.vue'
import MentionModal from '@/components/mention/MentionModal.vue'
import ContentEditableInput from '@/components/ContentEditableInput.vue'
import TextImageModal from '@/views/publish/components/TextImageModal.vue'

const router = useRouter()
const route = useRoute()
const userStore = useUserStore()
const authStore = useAuthStore()
const navigationStore = useNavigationStore()
const { lock, unlock } = useScrollLock()

const multiImageUploadRef = ref(null)
const videoUploadRef = ref(null)
const contentTextarea = ref(null)
const tagSectionRef = ref(null)

// 上传类型状态
const uploadType = ref('image') // 'image' 或 'video'

const isPublishing = ref(false)
const isSavingDraft = ref(false)
const showEmojiPanel = ref(false)
const showMentionPanel = ref(false)
const isContentFocused = ref(false)
const showTextImageModal = ref(false)
const showCategorySelect = ref(false)
const showTagSelect = ref(false)

const showToast = ref(false)
const toastMessage = ref('')
const toastType = ref('success')

const form = reactive({
  title: '',
  content: '',
  images: [],
  video: null,
  tags: [],
  category_id: null
})

// 草稿相关状态
const currentDraftId = ref(null)
const isEditMode = ref(false)

const categories = ref([])

// 提及用户数据（实际使用中应该从 API 获取）
const mentionUsers = ref([])

const canPublish = computed(() => {
  // 检查必填字段：标题、内容、分类
  if (!form.title.trim() || !form.content.trim() || !form.category_id) {
    return false
  }
  
  if (uploadType.value === 'image') {
    // 检查图片上传组件是否有待上传的图片
    if (!multiImageUploadRef.value) return false
    return multiImageUploadRef.value.getImageCount() > 0
  } else if (uploadType.value === 'video') {
    // 检查视频组件是否有待上传的视频
    if (!videoUploadRef.value) return false
    const videoData = videoUploadRef.value.getVideoData()
    return videoData && (videoData.uploaded || videoData.file)
  }
  
  return false
})

const canSaveDraft = computed(() => {
  // 草稿保存条件：有标题或内容，并且有媒体文件
  const hasContent = form.title.trim() || form.content.trim()
  
  if (!hasContent) return false
  
  if (uploadType.value === 'image') {
    // 检查图片上传组件是否有待上传的图片
    if (!multiImageUploadRef.value) return false
    return multiImageUploadRef.value.getImageCount() > 0
  } else if (uploadType.value === 'video') {
    // 检查视频组件是否有待上传的视频
    if (!videoUploadRef.value) return false
    const videoData = videoUploadRef.value.getVideoData()
    return videoData && (videoData.uploaded || videoData.file)
  }
  
  return false
})

// 登录状态检查
const isLoggedIn = computed(() => userStore.isLoggedIn)

// 打开登录模态框
const openLoginModal = () => {
  authStore.openLoginModal()
}

onMounted(async () => {
  navigationStore.scrollToTop('instant')
  // 先加载分类列表，确保分类数据可用
  await loadCategories()
  // 检查是否是编辑草稿模式
  const draftId = route.query.draftId
  const mode = route.query.mode

  if (draftId && mode === 'edit') {
    await loadDraftData(draftId)
  }
})

onUnmounted(() => {
})

const loadCategories = async () => {
  try {
    const response = await getCategories()
    if (response.success && response.data) {
      categories.value = response.data.map(category => ({
        id: category.id,
        name: category.name
      }))
    }
  } catch (error) {
    console.error('加载分类失败:', error)
    showMessage('加载分类失败', 'error')
  }
}

const validateForm = () => {
  return true
}

const showMessage = (message, type = 'success') => {
  toastMessage.value = message
  toastType.value = type
  showToast.value = true
}

const handleToastClose = () => {
  showToast.value = false
}

const handleBack = () => {
  router.back()
}

// 跳转到笔记管理页面
const goToPostManagement = () => {
  router.push('/post-management')
}

// 跳转到草稿箱页面
const goToDraftBox = () => {
  router.push('/draft-box')
}

const handleUploadError = (error) => {
  showMessage(error, 'error')
}

// 切换上传类型
const switchUploadType = (type) => {
  if (uploadType.value === type) return
  
  uploadType.value = type
  
  // 切换时清空对应的数据
  if (type === 'image') {
    form.video = ''
    if (videoUploadRef.value) {
      videoUploadRef.value.reset()
    }
  } else {
    form.images = []
    if (multiImageUploadRef.value) {
      multiImageUploadRef.value.reset()
    }
  }
}

const openTextImageModal = () => {
  showTextImageModal.value = true
  lock()
}

const closeTextImageModal = () => {
  showTextImageModal.value = false
  unlock()
}

const handleTextImageGenerate = async (data) => {

  
  // 将生成的图片添加到MultiImageUpload组件
  const imageComponent = multiImageUploadRef.value
  if (imageComponent && data.imageFile) {
    try {
      // 使用addFiles方法添加图片文件
      await imageComponent.addFiles([data.imageFile])
      showMessage('文字配图生成成功！', 'success')
    } catch (error) {
      console.error('添加图片失败:', error)
      showMessage('添加图片失败，请重试', 'error')
    }
  } else {
    showMessage('图片生成失败，请重试', 'error')
  }
  
  closeTextImageModal()
}

const handleCategoryChange = (data) => {
  form.category_id = data.value
}

const handleContentFocus = () => {
  isContentFocused.value = true
}

const handleContentBlur = () => {
  setTimeout(() => {
    isContentFocused.value = false
  }, 100)
}

const toggleEmojiPanel = () => {
  if (showEmojiPanel.value) {
    closeEmojiPanel()
  } else {
    showEmojiPanel.value = true
    lock()
  }
}

const closeEmojiPanel = () => {
  showEmojiPanel.value = false
  unlock()
}

const toggleMentionPanel = () => {
  // 如果要打开面板，先插入@符号
  if (!showMentionPanel.value && contentTextarea.value && contentTextarea.value.insertAtSymbol) {
    contentTextarea.value.insertAtSymbol()
  }
  showMentionPanel.value = !showMentionPanel.value
}

const closeMentionPanel = () => {
  showMentionPanel.value = false
  unlock()
}

// 滚动到标签区域
const scrollToTagSection = () => {
  showTagSelect.value = true
  lock()
}

// 打开分类选择
const openCategorySelect = () => {
  showCategorySelect.value = true
  lock()
}

// 关闭分类选择
const closeCategorySelect = () => {
  showCategorySelect.value = false
  unlock()
}

// 选择分类
const selectCategory = (category) => {
  form.category_id = category.id
  closeCategorySelect()
}

// 计算选中的分类名称
const selectedCategoryName = computed(() => {
  const category = categories.value.find(c => c.id === form.category_id)
  return category ? category.name : ''
})

// 打开标签选择
const openTagSelector = () => {
  showTagSelect.value = true
  lock()
}

// 关闭标签选择
const closeTagSelector = () => {
  showTagSelect.value = false
  unlock()
}

// 移除标签
const removeTag = (index) => {
  form.tags.splice(index, 1)
}

// 处理@符号输入事件
const handleMentionInput = () => {
  // 当用户输入@符号时，自动打开mention面板
  if (!showMentionPanel.value) {
    showMentionPanel.value = true
  }
}

// 处理表情选择
const handleEmojiSelect = (emoji) => {
  const emojiChar = emoji.i
  const inputElement = contentTextarea.value

  if (inputElement && inputElement.insertEmoji) {
    // 使用ContentEditableInput组件的insertEmoji方法
    inputElement.insertEmoji(emojiChar)
  } else {
    // 备用方案：直接添加到末尾
    form.content += emojiChar
    nextTick(() => {
      if (inputElement) {
        inputElement.focus()
      }
    })
  }

  closeEmojiPanel()
}

// 处理好友选择
const handleMentionSelect = (friend) => {
  // 调用ContentEditableInput组件的selectMentionUser方法
  if (contentTextarea.value && contentTextarea.value.selectMentionUser) {
    contentTextarea.value.selectMentionUser(friend)
  }

  // 关闭mention面板
  closeMentionPanel()
}

// 处理键盘事件，实现mention标签整体删除
const handleInputKeydown = (event) => {
  if (event.key === 'Backspace') {
    const selection = window.getSelection()
    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0)

      // 如果没有选中内容且光标在mention链接后面
      if (range.collapsed) {
        const container = range.startContainer
        const offset = range.startOffset

        // 检查光标前面的节点是否是mention链接
        let prevNode = null
        if (container.nodeType === Node.TEXT_NODE && offset === 0) {
          prevNode = container.previousSibling
        } else if (container.nodeType === Node.ELEMENT_NODE && offset > 0) {
          prevNode = container.childNodes[offset - 1]
        }

        // 如果前面的节点是mention链接，删除整个链接
        if (prevNode && prevNode.nodeType === Node.ELEMENT_NODE &&
          prevNode.classList && prevNode.classList.contains('mention-link')) {
          event.preventDefault()
          prevNode.remove()

          // 更新form.content
          form.content = event.target.textContent || ''
          return
        }
      }
    }
  }
}



const handlePublish = async () => {

  
  // 验证必填字段
  if (!form.title.trim()) {
    showMessage('请输入标题', 'error')
    return
  }

  if (!form.content.trim()) {
    showMessage('请输入内容', 'error')
    return
  }

  if (!form.category_id) {
    showMessage('请选择分类', 'error')
    return
  }

  // 根据上传类型验证媒体文件
  if (uploadType.value === 'image') {
    if (!multiImageUploadRef.value || multiImageUploadRef.value.getImageCount() === 0) {
      showMessage('请至少上传一张图片', 'error')
      return
    }
  } else if (uploadType.value === 'video') {
    if (!videoUploadRef.value) {
      showMessage('请选择视频文件', 'error')
      return
    }
    
    const videoData = videoUploadRef.value.getVideoData()
    if (!videoData || (!videoData.uploaded && !videoData.file)) {
      showMessage('请选择视频文件', 'error')
      return
    }
  }

  isPublishing.value = true

  try {
    let mediaData = []
    
    if (uploadType.value === 'image') {
      const imageComponent = multiImageUploadRef.value
      if (!imageComponent) {
        showMessage('图片组件未初始化', 'error')
        return
      }

      // 处理图片上传
      if (imageComponent.getImageCount() > 0) {
        showMessage('正在上传图片...', 'info')
        const uploadedImages = await imageComponent.uploadAllImages()

        if (uploadedImages.length === 0) {
          showMessage('图片上传失败', 'error')
          return
        }

        mediaData = uploadedImages
      }
    } else {
      // 视频上传处理

      const videoComponent = videoUploadRef.value
      if (!videoComponent) {
        console.error('❌ 视频组件未初始化')
        showMessage('视频组件未初始化', 'error')
        return
      }

      // 检查是否有视频文件需要上传
      const videoData = videoComponent.getVideoData()

      
      if (videoData && videoData.file && !videoData.uploaded) {

        showMessage('正在上传视频...', 'info')
        
        try {
          const uploadResult = await videoComponent.startUpload()

          
          if (uploadResult && uploadResult.success) {
            mediaData = {
              url: uploadResult.data.url,
              coverUrl: uploadResult.data.coverUrl,
              name: uploadResult.data.originalname || videoData.name,
              size: uploadResult.data.size || videoData.size
            }

          } else {
            console.error('❌ 视频上传失败:', uploadResult)
            showMessage('视频上传失败: ' + (uploadResult?.message || '未知错误'), 'error')
            return
          }
        } catch (error) {
          console.error('❌ 视频上传异常:', error)
          showMessage('视频上传失败', 'error')
          return
        }
      } else if (videoData && videoData.url) {
        // 已经上传过的视频

        mediaData = {
          url: videoData.url,
          coverUrl: videoData.coverUrl,
          name: videoData.name,
          size: videoData.size
        }

      } else {
        console.error('❌ 视频数据异常:', videoData)
        showMessage('视频数据异常', 'error')
        return
      }
    }

    const postData = {
      title: form.title.trim(),
      content: form.content,
      images: uploadType.value === 'image' ? mediaData : [],
      video: uploadType.value === 'video' ? mediaData : null,
      tags: form.tags,
      category_id: form.category_id,
      type: uploadType.value === 'image' ? 1 : 2, // 1: 图文, 2: 视频
      is_draft: false // 发布状态
    }




    showMessage('正在发布笔记...', 'info')




    let response
    if (isEditMode.value && currentDraftId.value) {

      response = await updatePost(currentDraftId.value, postData)
    } else {
      // 普通发布

      response = await createPost(postData)
    }



    if (response.success) {
      showMessage('发布成功！', 'success')
      resetForm()

      setTimeout(() => {
        router.push('/post-management')
      }, 1500)
    } else {
      showMessage(response.message || '发布失败', 'error')
    }
  } catch (err) {
    console.error('发布失败:', err)
    showMessage('发布失败，请重试', 'error')
  } finally {
    isPublishing.value = false
  }
}


// 重置表单
const resetForm = () => {
  form.title = ''
  form.content = ''
  form.images = []
  form.video = null
  form.tags = []
  form.category_id = null
  
  if (multiImageUploadRef.value) {
    multiImageUploadRef.value.reset()
  }
  if (videoUploadRef.value) {
    videoUploadRef.value.reset()
  }
}

// 加载草稿数据
const loadDraftData = async (draftId) => {
  try {
    const response = await getPostDetail(draftId)
    if (response && response.originalData) {
      const fullData = response
      const draft = response.originalData
      // 初始化表单数据
      form.title = response.title || ''
      form.content = draft.content || ''
      form.images = draft.images || []
      
      // 设置视频数据 - 从fullData中获取视频信息
      if (fullData.video_url) {
        // 构造完整的视频对象，包含VideoUpload组件需要的所有字段
        form.video = {
          url: fullData.video_url,
          coverUrl: fullData.cover_url,
          uploaded: true,
          name: '已上传的视频',
          size: 0,
          preview: fullData.video_url  // 添加preview字段，VideoUpload组件需要这个字段来显示video-success状态
        }
      } else {
        form.video = draft.video || null
      }

      // 处理标签数据：确保转换为字符串数组
      if (draft.tags && Array.isArray(draft.tags)) {
        form.tags = draft.tags.map(tag => {
          // 如果是对象格式，提取name字段
          if (typeof tag === 'object' && tag.name) {
            return tag.name
          }
          // 如果已经是字符串，直接返回
          return String(tag)
        })
      } else {
        form.tags = []
      }

      // 根据分类名称找到分类ID
      if (response.category && categories.value.length > 0) {
        const categoryItem = categories.value.find(cat => cat.name === response.category)
        form.category_id = categoryItem ? categoryItem.id : null
      } else {
        form.category_id = null
      }

      // 根据草稿数据类型设置uploadType
      if (fullData.type === 2 || (form.video && form.video.url)) {
        uploadType.value = 'video'
      } else if (form.images.length > 0 || fullData.type === 1) {
        // type: 1 表示图文类型，或者有图片数据
        uploadType.value = 'image'
      }
      

      // 设置编辑模式
      currentDraftId.value = draftId
      isEditMode.value = true

      // 等待DOM更新
      await nextTick()
      // 初始化图片组件
      if (uploadType.value === 'image' && form.images.length > 0 && multiImageUploadRef.value) {
        // 将图片数据转换为URL字符串数组
        const imageUrls = form.images.map(img => {
          if (typeof img === 'string') {
            return img
          } else if (img && img.url) {
            return img.url
          } else if (img && img.preview) {
            return img.preview
          }
          return null
        }).filter(url => url)
        multiImageUploadRef.value.syncWithUrls(imageUrls)
      }

      // 初始化视频组件
      if (uploadType.value === 'video' && form.video) {
        await nextTick()
        const videoData = form.video
        form.video = null // 先清空
        await nextTick()
        form.video = videoData // 再设置，确保触发watch
      }

      showMessage('草稿加载成功', 'success')
    } else {
      showMessage('草稿不存在或已被删除', 'error')
      router.push('/draft-box')
    }
  } catch (error) {
    console.error('加载草稿失败:', error)
    showMessage('加载草稿失败', 'error')
    router.push('/draft-box')
  }
}

const handleSaveDraft = async () => {
  // 验证是否有内容可以保存
  if (!form.title.trim() && !form.content.trim()) {
    showMessage('请输入标题或内容', 'error')
    return
  }

  // 验证是否有媒体文件
  if (uploadType.value === 'image') {
    if (!multiImageUploadRef.value || multiImageUploadRef.value.getImageCount() === 0) {
      showMessage('请至少上传一张图片', 'error')
      return
    }
  } else if (uploadType.value === 'video') {
    if (!videoUploadRef.value) {
      showMessage('请选择视频文件', 'error')
      return
    }
    
    const videoData = videoUploadRef.value.getVideoData()
    if (!videoData || (!videoData.uploaded && !videoData.file)) {
      showMessage('请选择视频文件', 'error')
      return
    }
  }

  isSavingDraft.value = true

  try {
    let mediaData = []
    
    if (uploadType.value === 'image') {
      // 如果有图片，先上传图片
      const imageComponent = multiImageUploadRef.value
      if (imageComponent && imageComponent.getImageCount() > 0) {
        showMessage('正在上传图片...', 'info')
        const uploadedImages = await imageComponent.uploadAllImages()
        mediaData = uploadedImages
      }
    } else if (uploadType.value === 'video') {
      // 视频上传处理
      const videoComponent = videoUploadRef.value
      if (videoComponent) {
        const videoData = videoComponent.getVideoData()
        if (videoData && videoData.file && !videoData.uploaded) {
          showMessage('正在上传视频...', 'info')
          
          try {
            const uploadResult = await videoComponent.startUpload()
            if (uploadResult && uploadResult.success) {
              mediaData = {
                url: uploadResult.data.url,
                coverUrl: uploadResult.data.coverUrl,
                name: uploadResult.data.originalname || videoData.name,
                size: uploadResult.data.size || videoData.size
              }
            } else {
              showMessage('视频上传失败: ' + (uploadResult?.message || '未知错误'), 'error')
              return
            }
          } catch (error) {
            console.error('视频上传失败:', error)
            showMessage('视频上传失败', 'error')
            return
          }
        } else if (videoData && videoData.url) {
          // 已经上传过的视频
          mediaData = {
            url: videoData.url,
            coverUrl: videoData.coverUrl,
            name: videoData.name,
            size: videoData.size
          }
        }
      }
    }

    const draftData = {
      title: form.title.trim() || '',
      content: form.content || '',
      images: uploadType.value === 'image' ? mediaData : [],
      video: uploadType.value === 'video' ? mediaData : null,
      tags: form.tags || [],
      category_id: form.category_id || null,
      type: uploadType.value === 'image' ? 1 : 2, // 1: 图文, 2: 视频
      is_draft: true
    }

    showMessage('正在保存草稿...', 'info')

    let response
    if (isEditMode.value && currentDraftId.value) {
      // 更新现有草稿
      response = await updatePost(currentDraftId.value, draftData)
    } else {
      // 创建新草稿
      response = await createPost(draftData)
      if (response.success && response.data) {
        currentDraftId.value = response.data.id
        isEditMode.value = true
      }
    }

    if (response.success) {
      showMessage('草稿保存成功！', 'success')

      // 清空表单
      resetForm()

      // 跳转到草稿箱页面
      setTimeout(() => {
        router.push('/draft-box')
      }, 1500)
    } else {
      showMessage(response.message || '草稿保存失败', 'error')
    }
  } catch (err) {
    console.error('草稿保存失败:', err)
    showMessage('草稿保存失败，请重试', 'error')
  } finally {
    isSavingDraft.value = false
  }
}
</script>

<style scoped>
/* 主容器 */
.publish-container {
  min-height: 100vh;
  background: var(--bg-color-primary);
  color: var(--text-color-primary);
  padding-bottom: 80px;
  transition: background-color 0.2s ease;
}

/* 顶部导航栏 */
.publish-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: var(--bg-color-primary);
  position: sticky;
  top: 0;
  z-index: 100;
}

.back-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: none;
  background: transparent;
  color: var(--text-color-primary);
  cursor: pointer;
  border-radius: 50%;
  transition: background 0.2s ease;
}

.back-btn:hover {
  background: var(--bg-color-secondary);
}

.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.header-action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: none;
  background: transparent;
  color: var(--text-color-secondary);
  cursor: pointer;
  border-radius: 50%;
  transition: all 0.2s ease;
}

.header-action-btn:hover {
  background: var(--bg-color-secondary);
  color: var(--text-color-primary);
}

/* 内容区域 */
.publish-content {
  padding: 0 16px;
}

.editor-main {
  display: flex;
  flex-direction: column;
  gap: 0;
}

/* 媒体类型切换 */
.media-type-tabs {
  display: flex;
  gap: 16px;
  padding: 12px 0;
  border-bottom: 1px solid var(--border-color-primary);
  margin-bottom: 16px;
}

.media-tab {
  padding: 8px 16px;
  border: none;
  background: transparent;
  color: var(--text-color-secondary);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  border-radius: 20px;
  transition: all 0.2s ease;
}

.media-tab.active {
  background: var(--primary-color);
  color: white;
}

.media-tab:hover:not(.active) {
  background: var(--bg-color-secondary);
}

/* 媒体上传区域 */
.media-upload-section {
  margin-bottom: 16px;
}

/* 文字配图按钮 */
.text-image-section {
  margin-bottom: 16px;
}

.text-image-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: var(--bg-color-secondary);
  color: var(--text-color-primary);
  border: 1px solid var(--border-color-primary);
  border-radius: 20px;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.2s ease;
}

.text-image-btn:hover {
  background: var(--primary-color);
  color: white;
  border-color: var(--primary-color);
}

/* 标题输入 */
.title-section {
  margin-bottom: 8px;
}

.title-input {
  width: 100%;
  padding: 12px 0;
  border: none;
  background: transparent;
  color: var(--text-color-primary);
  font-size: 18px;
  font-weight: 500;
  box-sizing: border-box;
}

.title-input:focus {
  outline: none;
}

.title-input::placeholder {
  color: var(--text-color-tertiary);
}

/* 正文输入 */
.content-section {
  margin-bottom: 16px;
  min-height: 120px;
}

.content-section :deep(.content-textarea) {
  width: 100%;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-color-primary);
  font-size: 15px;
  line-height: 1.6;
  min-height: 100px;
}

.content-section :deep(.content-textarea:focus) {
  outline: none;
}

.content-section :deep(.content-textarea:empty:before) {
  content: attr(placeholder);
  color: var(--text-color-tertiary);
}

/* 标签展示区域 */
.tags-display {
  margin-bottom: 16px;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

.tags-scroll {
  display: flex;
  gap: 8px;
  flex-wrap: nowrap;
}

.tag-chip {
  display: inline-flex;
  align-items: center;
  padding: 6px 12px;
  background: var(--bg-color-secondary);
  color: var(--text-color-primary);
  border: 1px solid var(--border-color-primary);
  border-radius: 16px;
  font-size: 13px;
  white-space: nowrap;
  cursor: pointer;
  transition: all 0.2s ease;
}

.tag-chip:hover {
  background: var(--primary-color-light);
  border-color: var(--primary-color);
  color: var(--primary-color);
}

/* 工具栏 */
.editor-toolbar {
  display: flex;
  gap: 8px;
  padding: 12px 0;
}

.toolbar-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 14px;
  background: var(--bg-color-secondary);
  color: var(--text-color-primary);
  border: 1px solid var(--border-color-primary);
  border-radius: 20px;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.2s ease;
}

.toolbar-btn:hover {
  background: var(--bg-color-tertiary);
  border-color: var(--text-color-secondary);
}

/* 表情面板 */
.emoji-panel-overlay {
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

.emoji-panel {
  background: var(--bg-color-primary);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  overflow: hidden;
  max-width: 90vw;
  max-height: 80vh;
}

/* 分隔线 */
.editor-divider {
  height: 1px;
  background: var(--border-color-primary);
  margin: 8px 0;
}

/* 设置选项列表 */
.settings-list {
  display: flex;
  flex-direction: column;
}

.setting-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 0;
  border-bottom: 1px solid var(--border-color-light);
  cursor: pointer;
  transition: background 0.2s ease;
}

.setting-item:hover {
  background: var(--bg-color-secondary);
  margin: 0 -16px;
  padding: 16px;
}

.setting-item:last-child {
  border-bottom: none;
}

.setting-left {
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--text-color-primary);
  font-size: 15px;
}

.setting-right {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-color-tertiary);
  font-size: 14px;
}

.setting-value {
  color: var(--text-color-secondary);
}

/* 选择弹窗 */
.select-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 1000;
}

.select-modal {
  width: 100%;
  max-width: 500px;
  max-height: 60vh;
  background: var(--bg-color-primary);
  border-radius: 16px 16px 0 0;
  overflow: hidden;
  animation: slideUp 0.3s ease;
}

.tag-modal {
  max-height: 80vh;
}

@keyframes slideUp {
  from {
    transform: translateY(100%);
  }
  to {
    transform: translateY(0);
  }
}

.select-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  border-bottom: 1px solid var(--border-color-primary);
  font-size: 16px;
  font-weight: 500;
}

.close-modal-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  color: var(--text-color-secondary);
  cursor: pointer;
  border-radius: 50%;
}

.close-modal-btn:hover {
  background: var(--bg-color-secondary);
}

.select-modal-content {
  padding: 16px;
  max-height: calc(60vh - 60px);
  overflow-y: auto;
}

.tag-modal .select-modal-content {
  max-height: calc(80vh - 60px);
}

.select-option {
  padding: 14px 16px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.2s ease;
  font-size: 15px;
}

.select-option:hover {
  background: var(--bg-color-secondary);
}

.select-option.active {
  background: var(--primary-color-light);
  color: var(--primary-color);
}

/* 底部操作栏 */
.publish-footer {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  gap: 12px;
  padding: 12px 16px;
  background: var(--bg-color-primary);
  border-top: 1px solid var(--border-color-primary);
  z-index: 100;
}

.footer-btn {
  flex: 1;
  padding: 14px 20px;
  border-radius: 24px;
  font-size: 16px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.footer-btn.draft-btn {
  background: transparent;
  color: var(--text-color-primary);
  border: 1px solid var(--border-color-primary);
}

.footer-btn.draft-btn:hover:not(:disabled) {
  background: var(--bg-color-secondary);
}

.footer-btn.publish-btn {
  background: #ff4757;
  color: white;
  border: none;
}

.footer-btn.publish-btn:hover:not(:disabled) {
  background: #ff3344;
}

.footer-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 登录提示样式 */
.login-prompt {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 20px;
  text-align: center;
}

.prompt-content {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.prompt-icon {
  color: var(--text-color-quaternary);
  margin-bottom: 16px;
}

.prompt-content h3 {
  color: var(--text-color-primary);
  font-size: 18px;
  font-weight: 600;
  margin: 0 0 8px 0;
}

.prompt-content p {
  color: var(--text-color-secondary);
  font-size: 14px;
  margin: 0 0 20px 0;
  line-height: 1.5;
}

/* 响应式设计 - 桌面端 */
@media (min-width: 768px) {
  .publish-container {
    max-width: 600px;
    margin: 0 auto;
    padding-bottom: 100px;
  }
  
  .select-modal {
    max-width: 400px;
    border-radius: 16px;
    margin-bottom: 20vh;
  }
  
  .select-modal-overlay {
    align-items: center;
  }
  
  @keyframes slideUp {
    from {
      opacity: 0;
      transform: scale(0.95);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }
}
</style>