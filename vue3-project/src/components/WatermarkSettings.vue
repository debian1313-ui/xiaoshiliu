<template>
  <div class="watermark-settings" v-if="enabled">
    <!-- 水印位置选择器 -->
    <div class="setting-group">
      <label class="setting-label">位置</label>
      <div class="position-grid">
        <button
          v-for="pos in positions"
          :key="pos.value"
          type="button"
          class="position-btn"
          :class="{ active: position === pos.value }"
          @click="setPosition(pos.value)"
          :title="pos.label"
        >
          <span class="position-dot"></span>
        </button>
      </div>
    </div>

    <!-- 水印颜色选择器 -->
    <div class="setting-group">
      <label class="setting-label">颜色</label>
      <div class="color-options">
        <button
          v-for="c in colorPresets"
          :key="c.value"
          type="button"
          class="color-preset-btn"
          :class="{ active: color === c.value }"
          :style="{ backgroundColor: c.value }"
          @click="setColor(c.value)"
          :title="c.label"
        ></button>
        <div class="custom-color-wrapper">
          <input
            type="color"
            v-model="customColor"
            class="custom-color-picker"
            @input="setColor(customColor)"
            title="自定义颜色"
          />
        </div>
      </div>
    </div>

    <!-- 字体大小选择器 -->
    <div class="setting-group">
      <label class="setting-label">
        <span>字号</span>
        <span class="size-value">{{ fontSize }}px</span>
      </label>
      <div class="size-options">
        <button
          v-for="size in sizePresets"
          :key="size.value"
          type="button"
          class="size-preset-btn"
          :class="{ active: fontSize === size.value }"
          @click="setFontSize(size.value)"
        >
          {{ size.label }}
        </button>
      </div>
      <input
        type="range"
        v-model.number="fontSize"
        :min="minFontSize"
        :max="maxFontSize"
        step="1"
        class="size-slider"
      />
    </div>

    <!-- 水印透明度 -->
    <div class="setting-group">
      <label class="setting-label">
        <span>透明度</span>
        <span class="opacity-value">{{ opacity }}%</span>
      </label>
      <input
        type="range"
        v-model.number="opacity"
        min="10"
        max="100"
        step="5"
        class="opacity-slider"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'

const props = defineProps({
  enabled: {
    type: Boolean,
    default: false
  },
  modelValue: {
    type: Object,
    default: () => ({
      position: '9',
      color: '#ffffff',
      fontSize: 20,
      opacity: 50
    })
  }
})

const emit = defineEmits(['update:modelValue'])

// 位置选项 (九宫格)
const positions = [
  { value: '1', label: '左上' },
  { value: '2', label: '上中' },
  { value: '3', label: '右上' },
  { value: '4', label: '左中' },
  { value: '5', label: '中心' },
  { value: '6', label: '右中' },
  { value: '7', label: '左下' },
  { value: '8', label: '下中' },
  { value: '9', label: '右下' }
]

// 颜色预设
const colorPresets = [
  { value: '#ffffff', label: '白色' },
  { value: '#000000', label: '黑色' },
  { value: '#ff4757', label: '红色' },
  { value: '#2ed573', label: '绿色' },
  { value: '#1e90ff', label: '蓝色' },
  { value: '#ffa502', label: '橙色' }
]

// 字体大小预设
const sizePresets = [
  { value: 16, label: '小' },
  { value: 20, label: '中' },
  { value: 28, label: '大' }
]

// 字体大小范围
const minFontSize = 12
const maxFontSize = 40

// 本地状态
const position = ref(props.modelValue.position || '9')
const color = ref(props.modelValue.color || '#ffffff')
const customColor = ref(props.modelValue.color || '#ffffff')
const fontSize = ref(props.modelValue.fontSize || 20)
const opacity = ref(props.modelValue.opacity || 50)

// 监听外部值变化
watch(() => props.modelValue, (newValue) => {
  if (newValue) {
    position.value = newValue.position || '9'
    color.value = newValue.color || '#ffffff'
    customColor.value = newValue.color || '#ffffff'
    fontSize.value = newValue.fontSize || 20
    opacity.value = newValue.opacity || 50
  }
}, { deep: true, immediate: true })

// 监听内部值变化，同步到外部
watch([position, color, fontSize, opacity], () => {
  emit('update:modelValue', {
    position: position.value,
    color: color.value,
    fontSize: fontSize.value,
    opacity: opacity.value
  })
})

const setPosition = (value) => {
  position.value = value
}

const setColor = (value) => {
  color.value = value
  customColor.value = value
}

const setFontSize = (value) => {
  fontSize.value = value
}
</script>

<style scoped>
.watermark-settings {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  background: var(--bg-color-secondary);
  border-radius: 8px;
  margin-top: 8px;
}

.setting-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.setting-label {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  color: var(--text-color-secondary);
  font-weight: 500;
}

.size-value,
.opacity-value {
  color: var(--primary-color);
  font-weight: 600;
}

/* 位置选择器 - 九宫格 */
.position-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
  width: fit-content;
}

.position-btn {
  width: 28px;
  height: 28px;
  border: 1px solid var(--border-color-primary);
  background: var(--bg-color-primary);
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.position-btn:hover {
  border-color: var(--primary-color);
}

.position-btn.active {
  border-color: var(--primary-color);
  background: var(--primary-color);
}

.position-dot {
  width: 6px;
  height: 6px;
  background: var(--text-color-tertiary);
  border-radius: 50%;
  transition: all 0.2s ease;
}

.position-btn.active .position-dot {
  background: white;
}

/* 颜色选择器 */
.color-options {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.color-preset-btn {
  width: 24px;
  height: 24px;
  border: 2px solid transparent;
  border-radius: 50%;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 0 0 1px var(--border-color-primary);
}

.color-preset-btn:hover {
  transform: scale(1.1);
}

.color-preset-btn.active {
  border-color: var(--primary-color);
  box-shadow: 0 0 0 2px var(--primary-color);
}

.custom-color-wrapper {
  position: relative;
}

.custom-color-picker {
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 50%;
  cursor: pointer;
  overflow: hidden;
  box-shadow: 0 0 0 1px var(--border-color-primary);
}

.custom-color-picker::-webkit-color-swatch-wrapper {
  padding: 0;
}

.custom-color-picker::-webkit-color-swatch {
  border: none;
  border-radius: 50%;
}

/* 字体大小选择器 */
.size-options {
  display: flex;
  gap: 8px;
}

.size-preset-btn {
  padding: 4px 12px;
  border: 1px solid var(--border-color-primary);
  background: var(--bg-color-primary);
  border-radius: 16px;
  cursor: pointer;
  font-size: 12px;
  color: var(--text-color-secondary);
  transition: all 0.2s ease;
}

.size-preset-btn:hover {
  border-color: var(--primary-color);
  color: var(--primary-color);
}

.size-preset-btn.active {
  border-color: var(--primary-color);
  background: var(--primary-color);
  color: white;
}

/* 滑块样式 */
.size-slider,
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

.size-slider::-webkit-slider-thumb,
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

.size-slider::-webkit-slider-thumb:hover,
.opacity-slider::-webkit-slider-thumb:hover {
  transform: scale(1.1);
}

.size-slider::-moz-range-thumb,
.opacity-slider::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--primary-color);
  cursor: pointer;
  border: none;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

/* 移动端适配 */
@media (max-width: 480px) {
  .watermark-settings {
    padding: 10px;
    gap: 10px;
  }

  .position-btn {
    width: 24px;
    height: 24px;
  }

  .color-preset-btn,
  .custom-color-picker {
    width: 22px;
    height: 22px;
  }
}
</style>
