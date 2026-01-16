<template>
  <CrudTable 
    title="系统通知管理" 
    entity-name="系统通知" 
    api-endpoint="/admin/system-notifications" 
    :columns="columns"
    :form-fields="formFields" 
    :search-fields="searchFields" 
  />
</template>

<script setup>
import CrudTable from '@/views/admin/components/CrudTable.vue'

// 系统通知类型映射
const notificationTypeMap = {
  'system': '系统消息',
  'activity': '活动消息'
}

const columns = [
  { key: 'id', label: 'ID', sortable: true },
  { key: 'title', label: '标题', maxLength: 30, sortable: false },
  { key: 'content', label: '内容', type: 'content', maxLength: 50, sortable: false },
  { key: 'type', label: '通知类型', type: 'mapped', map: notificationTypeMap, sortable: false },
  { key: 'image_url', label: '图片', type: 'image', sortable: false },
  { key: 'link_url', label: '链接', type: 'link', maxLength: 30, sortable: false },
  { key: 'is_active', label: '启用状态', type: 'boolean', trueText: '启用', falseText: '禁用', sortable: false },
  { key: 'confirmation_count', label: '确认人数', sortable: false },
  { key: 'created_at', label: '创建时间', type: 'date', sortable: true }
]

const formFields = [
  { key: 'title', label: '标题', type: 'text', required: true, placeholder: '请输入通知标题' },
  { key: 'content', label: '内容', type: 'textarea', required: true, placeholder: '请输入通知内容' },
  {
    key: 'type',
    label: '通知类型',
    type: 'select',
    required: true,
    options: [
      { value: 'system', label: '系统消息' },
      { value: 'activity', label: '活动消息' }
    ]
  },
  { key: 'images', label: '图片上传', type: 'multi-image-upload', maxImages: 1 },
  { key: 'link_url', label: '跳转链接', type: 'text', placeholder: '请输入跳转链接URL（可选）' }
]

const searchFields = [
  { key: 'title', label: '标题', placeholder: '搜索标题' },
  {
    key: 'type',
    label: '通知类型',
    type: 'select',
    placeholder: '通知类型',
    options: [
      { value: '', label: '全部类型' },
      { value: 'system', label: '系统消息' },
      { value: 'activity', label: '活动消息' }
    ]
  }
]
</script>
