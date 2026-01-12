<template>
  <div class="visibility-selector">
    <div class="visibility-label">可见性设置</div>
    <div class="visibility-options">
      <div 
        v-for="option in visibilityOptions" 
        :key="option.value" 
        class="visibility-option" 
        :class="{ selected: modelValue === option.value }"
        @click="selectVisibility(option.value)"
      >
        <div class="option-icon">{{ option.icon }}</div>
        <div class="option-content">
          <div class="option-title">{{ option.label }}</div>
          <div class="option-desc">{{ option.description }}</div>
        </div>
        <div v-if="modelValue === option.value" class="option-check">
          <SvgIcon name="check" width="16" height="16" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import SvgIcon from '@/components/SvgIcon.vue'

const props = defineProps({
  modelValue: {
    type: String,
    default: 'public'
  }
})

const emit = defineEmits(['update:modelValue', 'change'])

const visibilityOptions = [
  {
    value: 'public',
    label: '公开',
    description: '所有人可见',
    icon: '🌍'
  },
  {
    value: 'friends_only',
    label: '互关好友可见',
    description: '仅互相关注的好友可见',
    icon: '👥'
  },
  {
    value: 'private',
    label: '私密',
    description: '仅自己可见',
    icon: '🔒'
  }
]

const selectVisibility = (value) => {
  emit('update:modelValue', value)
  emit('change', value)
}
</script>

<style scoped>
.visibility-selector {
  margin-top: 12px;
}

.visibility-label {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-color-primary);
  margin-bottom: 12px;
}

.visibility-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.visibility-option {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--bg-color-secondary);
  border: 1px solid var(--border-color-primary);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.visibility-option:hover {
  border-color: var(--primary-color);
  background: var(--bg-color-primary);
}

.visibility-option.selected {
  border-color: var(--primary-color);
  background: rgba(var(--primary-color-rgb), 0.05);
}

.option-icon {
  font-size: 20px;
  line-height: 1;
  flex-shrink: 0;
}

.option-content {
  flex: 1;
  min-width: 0;
}

.option-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-color-primary);
  margin-bottom: 2px;
}

.option-desc {
  font-size: 12px;
  color: var(--text-color-tertiary);
}

.option-check {
  color: var(--primary-color);
  flex-shrink: 0;
}

.visibility-option.selected .option-title {
  color: var(--primary-color);
}
</style>
