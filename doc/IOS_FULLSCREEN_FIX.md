/**
 * iOS Safari 全屏功能测试文档
 * 
 * 本文档说明了针对 iOS Safari 全屏按钮无效问题的修复方案
 */

## 问题描述

在 iOS Safari 浏览器中，标准的 Fullscreen API (`requestFullscreen()`) 不被支持，
导致全屏按钮点击后无反应。

## 原因分析

iOS Safari 使用 webkit 前缀的全屏 API：
- `webkitRequestFullscreen()` 用于 HTML 元素
- `webkitEnterFullscreen()` 用于 video 元素
- `webkitExitFullscreen()` 用于退出全屏

## 修复方案

### 1. 全屏进入功能 (toggleFullscreen)

修改后的代码支持以下浏览器 API（按优先级）：

```javascript
// 标准 API
element.requestFullscreen()

// iOS Safari 和旧版 Safari
element.webkitRequestFullscreen()

// iOS Safari 视频元素专用
element.webkitEnterFullscreen()

// Firefox
element.mozRequestFullScreen()

// IE11
element.msRequestFullscreen()
```

### 2. 全屏退出功能

支持以下退出 API：

```javascript
document.exitFullscreen()
document.webkitExitFullscreen()
document.mozCancelFullScreen()
document.msExitFullscreen()
videoElement.webkitExitFullscreen()
```

### 3. 全屏状态监听

添加了多种浏览器的全屏状态变化事件监听：

```javascript
// 标准事件
document.addEventListener('fullscreenchange', handler)

// Safari/Chrome
document.addEventListener('webkitfullscreenchange', handler)

// Firefox
document.addEventListener('mozfullscreenchange', handler)

// IE11
document.addEventListener('MSFullscreenChange', handler)

// iOS Safari 特殊事件
videoElement.addEventListener('webkitbeginfullscreen', handler)
videoElement.addEventListener('webkitendfullscreen', handler)
```

### 4. 全屏状态检测

检查多种可能的全屏元素：

```javascript
const isFullscreen = !!(
  document.fullscreenElement ||
  document.webkitFullscreenElement ||
  document.mozFullScreenElement ||
  document.msFullscreenElement
)
```

## 测试方法

### 桌面浏览器测试

1. **Chrome/Edge**
   - 点击全屏按钮应该进入全屏
   - 按 ESC 或再次点击按钮退出全屏
   - 全屏图标应该正确切换

2. **Firefox**
   - 功能同 Chrome
   - 测试 mozRequestFullScreen API

3. **Safari**
   - 功能同 Chrome
   - 测试 webkitRequestFullscreen API

### 移动端测试

**iOS Safari (重点测试)**

测试设备：iPhone (iOS 12+)

测试步骤：
1. 打开 Safari 浏览器
2. 访问视频页面
3. 点击视频播放
4. 点击全屏按钮
5. 验证：
   - ✅ 视频应该进入全屏模式
   - ✅ 全屏按钮图标应该变为退出全屏图标
   - ✅ 点击退出全屏或系统返回按钮应该退出全屏
   - ✅ 退出全屏后，按钮图标应该恢复

**Android Chrome**
- 应该使用标准 Fullscreen API
- 功能与桌面版一致

## 浏览器兼容性

| 浏览器 | 版本 | 支持状态 |
|--------|------|---------|
| Chrome | 71+ | ✅ 完全支持 |
| Firefox | 64+ | ✅ 完全支持 |
| Safari | 13+ | ✅ 完全支持 |
| Edge | 79+ | ✅ 完全支持 |
| iOS Safari | 12+ | ✅ 完全支持 (webkit) |
| Android Chrome | 71+ | ✅ 完全支持 |
| IE11 | 11 | ✅ 完全支持 (ms前缀) |

## 技术细节

### iOS Safari 特殊处理

iOS Safari 有以下特点：

1. **容器全屏 vs 视频全屏**
   - 优先尝试容器的 `webkitRequestFullscreen()`
   - 如果失败，回退到视频元素的 `webkitEnterFullscreen()`

2. **独立的全屏事件**
   - 使用 `webkitbeginfullscreen` 和 `webkitendfullscreen` 事件
   - 这些事件仅在视频元素上触发

3. **限制**
   - 必须在用户交互（如点击）中触发
   - 不能通过脚本自动触发

### 错误处理

所有全屏操作都包裹在 try-catch 中：

```javascript
try {
  await element.requestFullscreen()
} catch (err) {
  console.error('全屏切换失败:', err)
}
```

### 内存管理

在组件卸载时正确清理事件监听器：

```javascript
onBeforeUnmount(() => {
  if (fullscreenStateHandler) {
    document.removeEventListener('fullscreenchange', fullscreenStateHandler)
    document.removeEventListener('webkitfullscreenchange', fullscreenStateHandler)
    document.removeEventListener('mozfullscreenchange', fullscreenStateHandler)
    document.removeEventListener('MSFullscreenChange', fullscreenStateHandler)
  }
})
```

## 常见问题

### Q: iOS Safari 全屏后看不到控制栏？

A: iOS Safari 在视频全屏时会使用系统原生控制栏，自定义控制栏会被隐藏。这是正常行为。

### Q: 为什么有时候全屏按钮不生效？

A: 确保全屏操作是在用户交互（点击、触摸）事件中触发的，浏览器出于安全考虑不允许自动全屏。

### Q: 如何测试 iOS Safari？

A: 
1. 使用真实 iOS 设备测试（推荐）
2. 使用 Mac 上的 Safari 开发者工具远程调试
3. 使用 BrowserStack 等云测试服务

## 参考资料

- [MDN: Fullscreen API](https://developer.mozilla.org/en-US/docs/Web/API/Fullscreen_API)
- [Can I Use: Fullscreen API](https://caniuse.com/fullscreen)
- [WebKit Fullscreen API](https://webkit.org/blog/7734/auto-play-policy-changes-for-macos/)
- [iOS Safari Web APIs](https://developer.apple.com/documentation/webkitjs)

## 修改文件

- `vue3-project/src/components/ShakaVideoPlayer.vue`
  - 修改 `toggleFullscreen()` 函数
  - 更新全屏状态监听器
  - 添加事件清理逻辑
