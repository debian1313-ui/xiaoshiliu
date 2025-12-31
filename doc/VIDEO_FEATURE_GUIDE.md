# 视频功能配置指南

本文档介绍小石榴项目中视频播放器和DASH转码功能的配置与使用方法。

## 功能特性

### 1. Shaka Player 视频播放器

项目使用 [Shaka Player](https://github.com/shaka-project/shaka-player) 作为视频播放器，提供以下功能：

- ✅ **DASH格式支持** - 支持播放 MPEG-DASH (.mpd) 流媒体
- ✅ **自适应码率** - 根据网络状况自动切换视频质量
- ✅ **手动画质选择** - 支持手动选择视频清晰度（360p、480p、720p、1080p等）
- ✅ **美观的自定义控制栏** - 完全自定义的播放控制界面
- ✅ **完整的播放控制** - 播放/暂停、进度条、音量控制、全屏等
- ✅ **响应式设计** - 适配PC端和移动端

### 2. 视频DASH转码

后端支持自动将上传的视频转换为DASH格式，提供以下特性：

- ✅ **智能分辨率检测** - 自动检测视频原始分辨率
- ✅ **自适应码率生成** - 根据原视频生成多个码率版本
- ✅ **智能画质选择** - 只转换小于等于原视频分辨率的版本（例如480p视频不会生成720p、1080p）
- ✅ **可配置的转码参数** - 分片时长、码率范围、分辨率列表可自由配置
- ✅ **灵活的文件组织** - 支持自定义输出文件夹格式（如：2025-12-30/userId/timestamp）
- ✅ **异步转码** - 不阻塞视频上传响应，后台自动处理

## 配置说明

### 前端配置 (vue3-project/.env)

在 `vue3-project/.env` 文件中配置视频播放器参数：

```env
# 视频播放器配置 (Shaka Player)
# 是否自动播放视频
VITE_VIDEO_AUTOPLAY=false

# 是否显示播放控件
VITE_VIDEO_CONTROLS=true

# 是否显示播放按钮
VITE_VIDEO_SHOW_PLAY_BUTTON=true

# 是否静音播放
VITE_VIDEO_MUTED=false

# 是否循环播放
VITE_VIDEO_LOOP=false

# 默认音量 (0-1)
VITE_VIDEO_DEFAULT_VOLUME=0.8

# 是否启用自适应码率
VITE_VIDEO_ADAPTIVE_BITRATE=true
```

**配置项说明：**

- `VITE_VIDEO_AUTOPLAY`: 设置为 `true` 时视频自动播放
- `VITE_VIDEO_CONTROLS`: 设置为 `false` 隐藏控制栏
- `VITE_VIDEO_SHOW_PLAY_BUTTON`: 设置为 `false` 隐藏播放按钮
- `VITE_VIDEO_MUTED`: 设置为 `true` 静音播放
- `VITE_VIDEO_LOOP`: 设置为 `true` 循环播放
- `VITE_VIDEO_DEFAULT_VOLUME`: 默认音量，范围 0-1
- `VITE_VIDEO_ADAPTIVE_BITRATE`: 设置为 `false` 禁用自适应码率

### 后端配置 (express-project/.env)

在 `express-project/.env` 文件中配置视频转码参数：

```env
# 视频转码配置
# FFmpeg可执行文件路径
FFMPEG_PATH=/app/bin/ffmpeg
FFPROBE_PATH=/app/bin/ffprobe

# 是否启用视频转码为DASH格式 (true/false)
VIDEO_TRANSCODING_ENABLED=true

# DASH转码输出目录格式，支持变量: {date}, {userId}, {timestamp}
# 默认格式: YYYY-MM-DD/userId/timestamp
VIDEO_DASH_OUTPUT_FORMAT={date}/{userId}/{timestamp}

# DASH分片时长（秒）
DASH_SEGMENT_DURATION=4

# 最小码率 (kbps)
DASH_MIN_BITRATE=500

# 最大码率 (kbps) - 1080p
DASH_MAX_BITRATE=5000

# 支持的分辨率列表（逗号分隔），系统会智能检测视频实际分辨率，只转换存在的分辨率
# 格式: 宽x高:码率kbps
DASH_RESOLUTIONS=1920x1080:5000,1280x720:2500,854x480:1000,640x360:750

# 是否删除原始视频文件（转码成功后）
DELETE_ORIGINAL_VIDEO=false
```

**配置项说明：**

- `FFMPEG_PATH`: FFmpeg 可执行文件路径（Docker环境为 `/app/bin/ffmpeg`）
- `FFPROBE_PATH`: FFprobe 可执行文件路径（Docker环境为 `/app/bin/ffprobe`）
- `VIDEO_TRANSCODING_ENABLED`: 是否启用视频转码，设置为 `false` 将跳过转码
- `VIDEO_DASH_OUTPUT_FORMAT`: 输出文件夹格式，支持以下变量：
  - `{date}`: 当前日期 (YYYY-MM-DD)
  - `{userId}`: 用户ID
  - `{timestamp}`: 时间戳
- `DASH_SEGMENT_DURATION`: 视频分片时长，单位：秒，建议 2-10 秒
- `DASH_MIN_BITRATE`: 最小视频码率，单位：kbps
- `DASH_MAX_BITRATE`: 最大视频码率，单位：kbps
- `DASH_RESOLUTIONS`: 预设的分辨率和码率列表，格式为 `宽x高:码率`
- `DELETE_ORIGINAL_VIDEO`: 转码成功后是否删除原始视频文件

**分辨率和码率建议：**

| 分辨率 | 宽x高 | 建议码率 | 适用场景 |
|--------|-------|----------|----------|
| 360p | 640x360 | 500-800 kbps | 低带宽、移动网络 |
| 480p | 854x480 | 800-1200 kbps | 标清、一般网络 |
| 720p | 1280x720 | 2000-3000 kbps | 高清、良好网络 |
| 1080p | 1920x1080 | 4000-6000 kbps | 全高清、高速网络 |

## 使用方法

### 在组件中使用视频播放器

```vue
<template>
  <div class="video-container">
    <ShakaVideoPlayer
      :src="videoUrl"
      :poster-url="posterUrl"
      :autoplay="false"
      :show-controls="true"
      :adaptive-bitrate="true"
      @play="onPlay"
      @pause="onPause"
      @ended="onEnded"
    />
  </div>
</template>

<script setup>
import ShakaVideoPlayer from '@/components/ShakaVideoPlayer.vue'

const videoUrl = 'http://localhost:3001/uploads/videos/dash/2025-12-30/1/1704028800000/manifest.mpd'
const posterUrl = 'http://localhost:3001/uploads/covers/cover.jpg'

const onPlay = () => {
  console.log('视频开始播放')
}

const onPause = () => {
  console.log('视频暂停')
}

const onEnded = () => {
  console.log('视频播放结束')
}
</script>
```

### 播放器组件属性

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `src` | String | - | 视频源URL，支持DASH (.mpd) 或普通视频文件 |
| `posterUrl` | String | '' | 海报图片URL |
| `autoplay` | Boolean | false | 是否自动播放 |
| `showControls` | Boolean | true | 是否显示控制栏 |
| `showPlayButton` | Boolean | true | 是否显示播放按钮 |
| `muted` | Boolean | false | 是否静音 |
| `loop` | Boolean | false | 是否循环播放 |
| `adaptiveBitrate` | Boolean | true | 是否启用自适应码率 |

### 播放器组件事件

| 事件 | 参数 | 说明 |
|------|------|------|
| `play` | - | 视频开始播放时触发 |
| `pause` | - | 视频暂停时触发 |
| `ended` | - | 视频播放结束时触发 |
| `error` | error | 播放出错时触发 |
| `loaded` | - | 视频加载完成时触发 |

### 播放器组件方法

通过 `ref` 可以调用以下方法：

```vue
<script setup>
import { ref } from 'vue'

const playerRef = ref(null)

// 播放视频
const play = () => {
  playerRef.value.play()
}

// 暂停视频
const pause = () => {
  playerRef.value.pause()
}

// 跳转到指定时间（秒）
const seekTo = (time) => {
  playerRef.value.seek(time)
}
</script>

<template>
  <ShakaVideoPlayer ref="playerRef" :src="videoUrl" />
</template>
```

## 视频转码工作流程

1. **用户上传视频** - 前端上传视频文件到后端
2. **保存原始视频** - 后端将视频保存到本地存储
3. **返回上传成功** - 立即返回上传成功响应给前端
4. **后台转码** - 异步启动FFmpeg转码任务
   - 使用FFprobe分析视频分辨率、码率等信息
   - 智能选择适合的目标分辨率（不超过原视频分辨率）
   - 生成多个码率版本
   - 输出DASH格式的manifest.mpd文件
5. **转码完成** - 保存转码后的文件到配置的目录结构中
6. **播放视频** - 前端使用Shaka Player播放.mpd文件

**文件结构示例：**

```
uploads/videos/dash/
└── 2025-12-30/              # 日期
    └── 123/                  # 用户ID
        └── 1704028800000/    # 时间戳
            ├── manifest.mpd  # DASH manifest文件
            ├── init-stream0.m4s
            ├── init-stream1.m4s
            ├── chunk-stream0-00001.m4s
            ├── chunk-stream0-00002.m4s
            ├── chunk-stream1-00001.m4s
            └── ...
```

## Docker 部署说明

项目的 Docker 配置已经包含了 FFmpeg 的安装和配置：

### Dockerfile 配置

```dockerfile
# 安装 FFmpeg 和 FFprobe
RUN apk add --no-cache ffmpeg

# 创建符号链接到 /app/bin
RUN mkdir -p /app/bin && \
    ln -s /usr/bin/ffmpeg /app/bin/ffmpeg && \
    ln -s /usr/bin/ffprobe /app/bin/ffprobe
```

### 本地开发环境

如果在本地开发环境（非Docker）运行，需要：

1. 安装 FFmpeg 和 FFprobe
   ```bash
   # macOS
   brew install ffmpeg
   
   # Ubuntu/Debian
   sudo apt-get install ffmpeg
   
   # Windows
   # 下载并安装 https://ffmpeg.org/download.html
   ```

2. 在 `.env` 文件中配置正确的路径
   ```env
   # macOS/Linux
   FFMPEG_PATH=/usr/local/bin/ffmpeg
   FFPROBE_PATH=/usr/local/bin/ffprobe
   
   # Windows
   FFMPEG_PATH=C:/ffmpeg/bin/ffmpeg.exe
   FFPROBE_PATH=C:/ffmpeg/bin/ffprobe.exe
   ```

## 故障排查

### 1. 视频无法播放

**问题：** 浏览器显示"您的浏览器不支持视频播放"

**解决方法：**
- 确保使用现代浏览器（Chrome 85+、Firefox 90+、Safari 14+）
- 检查浏览器是否启用了JavaScript
- 尝试清除浏览器缓存

### 2. 转码失败

**问题：** 后端日志显示"FFmpeg不可用"或"转码失败"

**解决方法：**
- 检查 FFmpeg 是否正确安装：`ffmpeg -version`
- 验证 `.env` 中的路径配置是否正确
- 检查文件权限，确保应用有写入权限
- 查看详细错误日志

**常见错误：**

**错误1: "Unrecognized option 'adaptation_sets'"**
```
❌ 视频转码失败: ffmpeg exited with code 8: Unrecognized option 'adaptation_sets'
```
**原因：** FFmpeg 版本过旧或 adaptation_sets 参数语法错误

**解决方法：**
- 确保使用 FFmpeg 4.1+ 版本
- 检查 adaptation_sets 选项没有多余的引号
- 已在最新版本中修复（v1.4.1+）

**错误2: 视频没有音频流导致转码失败**

**解决方法：**
- 系统会自动检测音频流
- 无音频的视频也可以正常转码（v1.4.1+）

### 3. 画质选择不显示

**问题：** 播放器中没有画质选择选项

**可能原因：**
- 视频只有一个分辨率版本
- `adaptiveBitrate` 属性设置为 `false`
- 视频不是DASH格式（普通MP4文件）

**解决方法：**
- 确保启用了视频转码功能
- 上传高分辨率视频（至少720p以上）以生成多个版本
- 确保 `adaptiveBitrate` 设置为 `true`

### 4. 自适应码率不工作

**问题：** 网络变化时视频画质不会自动切换

**解决方法：**
- 确认播放的是DASH格式视频（.mpd文件）
- 检查 `VITE_VIDEO_ADAPTIVE_BITRATE` 是否为 `true`
- 确保视频有多个码率版本

## 性能优化建议

1. **分片时长：** 建议设置为 2-6 秒，过长会影响切换速度，过短会增加请求数
2. **码率设置：** 根据目标用户的网络环境调整码率范围
3. **分辨率选择：** 不必生成所有分辨率，根据实际需求选择 2-3 个常用分辨率即可
4. **CDN加速：** 建议将转码后的视频文件部署到CDN，提升播放体验
5. **缓存策略：** 为 `.mpd` 和 `.m4s` 文件配置适当的缓存策略

## 常见问题

**Q: 为什么不直接播放原视频文件？**

A: DASH格式提供了自适应码率功能，能根据用户的网络状况自动选择最合适的画质，提供更好的用户体验。同时，DASH格式支持快速的seek操作。

**Q: 转码需要多长时间？**

A: 转码时间取决于视频时长、分辨率和服务器性能。一般来说，1分钟的1080p视频在中等性能服务器上需要 1-3 分钟转码。

**Q: 可以禁用转码功能吗？**

A: 可以。将 `VIDEO_TRANSCODING_ENABLED` 设置为 `false` 即可禁用转码，视频将以原始格式保存和播放。

**Q: Shaka Player支持哪些浏览器？**

A: Shaka Player支持所有现代浏览器，包括：
- Chrome 85+
- Firefox 90+
- Safari 14+
- Edge 85+
- Opera 71+

**Q: 可以自定义播放器样式吗？**

A: 可以。`ShakaVideoPlayer.vue` 组件的样式完全可自定义，您可以根据项目需求修改 CSS。

## 相关资源

- [Shaka Player 官方文档](https://shaka-player-demo.appspot.com/docs/api/tutorial-welcome.html)
- [MPEG-DASH 标准](https://dashif.org/)
- [FFmpeg 官方文档](https://ffmpeg.org/documentation.html)
- [视频编码最佳实践](https://trac.ffmpeg.org/wiki/Encode/H.264)

## 更新日志

### v1.4.1 (2025-12-31)

**Bug 修复:**
- ✅ 修复 FFmpeg adaptation_sets 参数错误导致转码失败
- ✅ 修复视频无音频流时转码失败的问题
- ✅ 改进 FFmpeg 命令构建逻辑

**新功能:**
- ✅ 自动更新数据库中的视频URL为DASH格式
- ✅ 转码完成后直接替换原视频地址为manifest.mpd
- ✅ 添加详细的FFmpeg命令日志输出

**改进:**
- ✅ 智能检测音频流，无音频视频也能正常转码
- ✅ 更好的错误处理和日志记录
- ✅ 添加FFmpeg stderr输出以便调试

### v1.4.0 (2025-12-31)

- ✅ 集成 Shaka Player 作为视频播放器
- ✅ 实现视频DASH格式转码
- ✅ 支持智能分辨率检测和选择
- ✅ 支持可配置的播放器参数
- ✅ 添加自定义播放控制栏
- ✅ 支持画质手动选择和自适应切换
- ✅ Docker环境自动安装和配置FFmpeg

## 技术支持

如有问题，请提交 [GitHub Issue](https://github.com/ZTMYO/XiaoShiLiu/issues) 或联系项目维护者。
