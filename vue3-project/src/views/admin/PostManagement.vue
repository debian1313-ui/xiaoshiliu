<template>
  <CrudTable title="笔记管理" entity-name="笔记" api-endpoint="/admin/posts" :columns="columns" :form-fields="formFields"
    :search-fields="searchFields" />
</template>

<script setup>
import CrudTable from '@/views/admin/components/CrudTable.vue'

const columns = [
  { key: 'id', label: 'ID', type: 'post-link', sortable: true },
  { key: 'title', label: '标题', type: 'content', sortable: false },
  { key: 'user_display_id', label: '汐社号', type: 'user-link', sortable: false },
  { key: 'type', label: '类型', type: 'mapped', map: { 1: '图文', 2: '视频' }, sortable: false },
  { key: 'is_draft', label: '草稿', sortable: false, type: 'boolean', trueText: '是', falseText: '否' },
  { key: 'content', label: '内容', type: 'content', sortable: false },
  { key: 'tags', label: '标签', type: 'tags', sortable: false },
  { key: 'images', label: '媒体', type: 'image-gallery', sortable: false },
  { key: 'view_count', label: '浏览', sortable: true },
  { key: 'like_count', label: '点赞', sortable: true },
  { key: 'collect_count', label: '收藏', sortable: true },
  { key: 'comment_count', label: '评论', sortable: true },
  { key: 'created_at', label: '发布时间', type: 'date', sortable: true }
]

const formFields = [
  { key: 'user_id', label: '作者ID', type: 'number', required: true, placeholder: '请输入用户ID' },
  { key: 'title', label: '标题', type: 'text', required: false, placeholder: '请输入笔记标题（可选）' },
  { key: 'content', label: '内容', type: 'textarea', required: false, placeholder: '请输入笔记内容（可选）' },
  {
    key: 'type',
    label: '笔记类型',
    type: 'select',
    required: true,
    options: [
      { value: 1, label: '图文笔记' },
      { value: 2, label: '视频笔记' }
    ]
  },
  { key: 'is_draft', label: '草稿', type: 'checkbox', required: false, description: '勾选表示保存为草稿，不勾选表示发布' },
  { key: 'view_count', label: '浏览量', type: 'number', required: false, placeholder: '请输入浏览量', min: 0 },
  { key: 'tags', label: '标签', type: 'tags', maxTags: 10 },
  { key: 'images', label: '图片上传', type: 'multi-image-upload', maxImages: 9, condition: { field: 'type', value: 1 } },
  { key: 'video_upload', label: '视频上传', type: 'video-upload', condition: { field: 'type', value: 2 } }
]

const searchFields = [
  { key: 'title', label: '标题', placeholder: '搜索标题' },
  {
    key: 'type',
    label: '类型',
    type: 'select',
    placeholder: '选择类型',
    options: [
      { value: '', label: '全部类型' },
      { value: '1', label: '图文' },
      { value: '2', label: '视频' }
    ]
  },
  {
    key: 'is_draft',
    label: '发布状态',
    type: 'select',
    placeholder: '发布状态',
    options: [
      { value: '', label: '全部状态' },
      { value: '0', label: '已发布' },
      { value: '1', label: '草稿' }
    ]
  },
  { key: 'user_display_id', label: '作者汐社号', placeholder: '搜索作者汐社号' }
]
</script>