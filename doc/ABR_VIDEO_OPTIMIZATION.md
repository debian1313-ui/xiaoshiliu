# ABR 与视频优化配置指南

本文档说明新增的 ABR (自适应码率) 和视频优化功能的配置方法。

## 目录

- [前端配置 (Vue3)](#前端配置-vue3)
- [后端配置 (Express)](#后端配置-express)
- [使用场景](#使用场景)
- [常见问题](#常见问题)

---

## 前端配置 (Vue3)

在 `vue3-project/.env` 文件中配置以下参数：

### 1. ABR 最大分辨率限制

```bash
# 限制ABR自动模式可选择的最大分辨率高度（像素）
# 例如: 720 表示自动模式最高只能选择720p
# 注意: 用户手动选择画质时不受此限制
VITE_VIDEO_MAX_RESOLUTION_HEIGHT=720
```

**说明**：
- 设置为 `720` 时，ABR 自动模式最高选择 720p，即使有 1080p 可用
- 用户可以通过画质菜单手动选择 1080p 或更高分辨率
- 设置为 `0` 或不设置表示不限制
- **适用场景**：移动网络、带宽受限环境

### 2. 调试模式

```bash
# 在浏览器控制台输出播放器配置信息
VITE_VIDEO_DEBUG_CONFIG=true
```

**说明**：
- `true`: 在控制台输出详细的播放器配置，便于调试
- `false`: 不输出（生产环境建议）

**输出示例**：
```javascript
🎬 Shaka Player 配置: {
  streaming: {
    bufferingGoal: 16,
    rebufferingGoal: 5,
    ...
  },
  abr: {
    enabled: true,
    defaultBandwidthEstimate: 500000,
    ...
  },
  maxResolutionHeight: 720,
  note: '最大分辨率限制仅在ABR自动模式下生效，用户手动选择画质时不受限制'
}
```

### 3. 短视频优化参数

针对 15 秒以内的短视频，可以调整以下参数以实现更快的分辨率切换：

```bash
# 缓冲目标（秒）- 短视频可设置较小值
VITE_VIDEO_BUFFERING_GOAL=8

# 重新缓冲目标（秒）
VITE_VIDEO_REBUFFERING_GOAL=3

# 码率切换间隔（秒）- 短视频建议设为1秒
VITE_VIDEO_SWITCH_INTERVAL=1

# 带宽升级阈值（0-1）- 值越小越激进
VITE_VIDEO_BANDWIDTH_UPGRADE_TARGET=0.85

# 带宽降级阈值（0-1）- 值越大越敏感
VITE_VIDEO_BANDWIDTH_DOWNGRADE_TARGET=0.50
```

**短视频推荐配置**：
```bash
VITE_VIDEO_BUFFERING_GOAL=8
VITE_VIDEO_REBUFFERING_GOAL=3
VITE_VIDEO_SWITCH_INTERVAL=1
```

**长视频推荐配置**：
```bash
VITE_VIDEO_BUFFERING_GOAL=30
VITE_VIDEO_REBUFFERING_GOAL=5
VITE_VIDEO_SWITCH_INTERVAL=5
```

### 4. ABR 稳定性优化（防止频繁切换）

**v1.3.1 新增功能**：智能 ABR 沉淀期，避免初始播放时的频繁码率切换。

**问题描述**：
当视频加载时，播放器会先选择一个默认的 720p 轨道，但 ABR 算法会立即根据估算带宽进行切换，导致出现如下日志：
```
已选择默认轨道: 720p (406x720) 码率: 539k
码率切换: 539k ↑ 1191k 720x1280
码率切换: 1191k ↓ 275k 204x360
```

**解决方案**：
系统现在会在选择默认轨道后等待 **15秒沉淀期**，在此期间：
1. ABR 保持禁用状态，默认轨道有充足时间建立缓冲
2. 沉淀期结束后，系统检查缓冲健康度（前向缓冲是否 > 8秒）
3. 只有在缓冲充足时才重新启用 ABR，允许根据网络状况升级
4. 如果缓冲不足，继续保持当前轨道以确保流畅播放

**工作原理**：
```javascript
// 选择默认 720p 轨道后
15秒等待 → 检查缓冲 → 缓冲 > 8秒 ? 启用ABR : 保持当前轨道
```

**效果**：
- ✅ 减少初始播放时的频繁码率切换
- ✅ 如果默认轨道播放流畅，就保持不动
- ✅ 只在缓冲充足且有升级空间时才允许 ABR 升级
- ✅ 更稳定的播放体验，更少的卡顿

**相关参数**：
```bash
# 带宽升级阈值（推荐 0.9-0.95，避免过早升级）
VITE_VIDEO_BANDWIDTH_UPGRADE_TARGET=0.95

# 带宽降级阈值（推荐 0.3-0.4，仅严重卡顿时降级）
VITE_VIDEO_BANDWIDTH_DOWNGRADE_TARGET=0.35

# 码率切换间隔（推荐 5-8秒，避免频繁切换）
VITE_VIDEO_SWITCH_INTERVAL=8
```

**控制台日志示例**：
```
✅ 已选择默认轨道: 720p (406x720) 码率: 539k
... 15秒沉淀期 ...
✅ 缓冲充足 (12.3秒)，ABR已重新启用
🎯 ABR已启用: 优先保持720p，仅在严重卡顿时降级
```

或者：
```
✅ 已选择默认轨道: 720p (406x720) 码率: 539k
... 15秒沉淀期 ...
⏸️ 缓冲不足 (5.2秒)，暂不启用ABR以保持稳定
```

---

## 后端配置 (Express)

在 `express-project/.env` 文件中配置以下参数：

### 1. FFmpeg 编码优化参数

#### 编码预设（速度 vs 质量）

```bash
# 可选值: ultrafast, superfast, veryfast, faster, fast, medium, slow, slower, veryslow
# 建议: medium（平衡）, fast（快速）, slow（高质量）
FFMPEG_PRESET=medium
```

**说明**：
- `ultrafast` - 最快，质量最差
- `medium` - 平衡（推荐）
- `veryslow` - 最慢，质量最好

#### 编码配置（兼容性 vs 质量）

```bash
# 可选值: baseline, main, high
FFMPEG_PROFILE=main
```

**说明**：
- `baseline` - 兼容性最好，适合低端设备
- `main` - 平衡选项（推荐）
- `high` - 最佳质量，需要较新设备

#### 恒定质量模式（CRF）

```bash
# CRF 值: 0-51，值越小质量越高
# 建议: 23（默认）, 18-23（高质量）, 23-28（标准质量）
# 留空表示使用 VBR 码率模式（推荐）
FFMPEG_CRF=
```

**说明**：
- 不设置 CRF（推荐）：使用 **VBR 动态码率模式**，更可控
- 设置 CRF：使用恒定质量模式，码率完全动态，质量恒定

### 2. 高级编码参数

```bash
# GOP 大小（关键帧间隔，以帧数计）
# 建议: 等于帧率的2倍（如30fps设为60）
# 留空使用默认值（自动 = 帧率 x 2）
FFMPEG_GOP_SIZE=

# B帧数量（0-16）
# 建议: 0-3（快速）, 3-5（平衡）, 5-8（高压缩）
FFMPEG_B_FRAMES=

# 参考帧数量（1-16）
# 建议: 1-3（兼容性）, 3-5（平衡）, 5-8（高质量）
FFMPEG_REF_FRAMES=
```

### 3. 音频编码参数

```bash
# 音频码率（kbps）
# 建议: 128（标准）, 192（高质量）, 64-96（节省带宽）
FFMPEG_AUDIO_BITRATE=128

# 音频采样率（Hz）
# 可选: 44100, 48000
# 建议: 48000（高质量）, 44100（标准）
FFMPEG_AUDIO_SAMPLE_RATE=48000
```

### 4. 硬件加速

```bash
# 是否启用硬件加速
FFMPEG_HARDWARE_ACCEL=false

# 硬件加速类型（当启用时使用）
# 可选: cuda（NVIDIA）, qsv（Intel）, videotoolbox（macOS）, vaapi（Linux）
FFMPEG_HARDWARE_ACCEL_TYPE=
```

---

## VBR (动态码率) 说明

### 什么是 VBR？

**VBR (Variable Bitrate, 可变比特率)** 是一种视频编码模式，允许码率根据视频内容复杂度动态变化。

### VBR 的优势

1. **更高的视觉质量**：复杂场景获得更高码率，简单场景使用更低码率
2. **更小的文件体积**：平均码率更低，节省存储空间
3. **更好的带宽利用**：减少不必要的码率浪费
4. **更流畅的播放体验**：ABR 播放时切换更智能

### VBR 参数设置

本系统默认使用 VBR 模式，参数配置如下：

```bash
-b:v ${目标码率}k           # 平均目标码率
-maxrate ${最大码率}k        # 最大码率上限（目标 x 1.5）
-bufsize ${缓冲区大小}k      # 码率控制缓冲区（目标 x 3）
```

### 码率计算示例

**720p 视频（目标码率 2500kbps）：**

- 目标码率：**2500 kbps**（平均水平）
- 最大码率：**3750 kbps**（1.5倍，动态峰值）
- 缓冲区：**7500 kbps**（3倍，平滑控制）

**实际效果**：
- 简单场景（静止画面）：500-1000 kbps
- 中等场景：2000-2500 kbps
- 复杂场景（快速运动）：3000-3750 kbps
- **绝对上限**：不会超过 3750 kbps

### VBR vs CBR 对比

| 特性 | VBR（可变码率） | CBR（固定码率） |
|------|----------------|----------------|
| 码率变化 | 动态变化 | 固定不变 |
| 视觉质量 | 更优 | 一般 |
| 文件大小 | 更小 | 更大 |
| 带宽利用 | 更高效 | 浪费 |
| 适用场景 | 点播、存储 | 直播 |

---

## 使用场景

### 场景 1：移动网络用户

**问题**：移动网络带宽有限，希望限制最高画质以节省流量。

**配置**：
```bash
# 前端
VITE_VIDEO_MAX_RESOLUTION_HEIGHT=720
VITE_VIDEO_DEFAULT_BANDWIDTH=500000
```

**效果**：ABR 自动模式最高选择 720p，用户仍可手动选择更高画质。

### 场景 2：短视频应用（抖音、快手类）

**问题**：视频多为 15 秒以内，需要快速响应和分辨率切换。

**配置**：
```bash
# 前端
VITE_VIDEO_BUFFERING_GOAL=8
VITE_VIDEO_REBUFFERING_GOAL=3
VITE_VIDEO_SWITCH_INTERVAL=1
VITE_VIDEO_MAX_RESOLUTION_HEIGHT=720
```

**效果**：更少的缓冲、更快的切换、更流畅的体验。

### 场景 3：高质量视频平台

**问题**：追求最佳视觉质量，不限制分辨率和码率。

**配置**：
```bash
# 前端
VITE_VIDEO_MAX_RESOLUTION_HEIGHT=0  # 不限制

# 后端
FFMPEG_PRESET=slow
FFMPEG_PROFILE=high
FFMPEG_CRF=18
ORIGINAL_VIDEO_MAX_BITRATE=15000
```

**效果**：最高质量编码，支持 1080p/4K，用户体验最佳。

### 场景 4：带宽受限服务器

**问题**：服务器出口带宽有限，希望降低总体码率。

**配置**：
```bash
# 后端
DASH_MAX_BITRATE=3000
ORIGINAL_VIDEO_MAX_BITRATE=5000
DASH_RESOLUTIONS=1280x720:2000,854x480:800,640x360:500
```

**效果**：降低所有分辨率的码率，减少带宽消耗。

---

## 常见问题

### Q1: 用户能否手动选择超过限制的分辨率？

**A:** 可以。`VITE_VIDEO_MAX_RESOLUTION_HEIGHT` 只限制 ABR 自动模式，用户通过画质菜单可以手动选择任何可用的分辨率（包括 1080p、4K 等）。

### Q2: 如何启用调试模式查看播放器配置？

**A:** 在前端 `.env` 文件中设置：
```bash
VITE_VIDEO_DEBUG_CONFIG=true
```
然后在浏览器开发者工具的控制台中查看输出。

### Q3: VBR 和 CRF 哪个更好？

**A:** 
- **VBR**（默认，推荐）：码率更可控，适合大多数场景
- **CRF**（可选）：恒定质量，适合追求极致画质的场景

一般情况下推荐使用 VBR（不设置 `FFMPEG_CRF`）。

### Q4: 如何优化短视频的播放体验？

**A:** 调整以下参数：
```bash
VITE_VIDEO_BUFFERING_GOAL=8        # 降低缓冲目标
VITE_VIDEO_SWITCH_INTERVAL=1       # 更快切换
VITE_VIDEO_MAX_RESOLUTION_HEIGHT=720  # 限制最高画质
```

### Q5: 硬件加速什么时候该启用？

**A:** 
- **启用条件**：服务器有专用 GPU（NVIDIA、Intel、AMD）
- **优势**：转码速度提升 2-10 倍
- **劣势**：质量略低于 CPU 编码
- **建议**：大量视频转码时启用，追求质量时禁用

### Q6: 如何查看转码日志确认 VBR 模式？

**A:** 转码时会输出以下日志：
```
📊 流0 VBR模式: 目标=2500k, 最大=3750k, 缓冲=7500k
📊 流1 VBR模式: 目标=5000k, 最大=7500k, 缓冲=15000k
```

如果看到此日志，说明 VBR 模式已正确启用。

### Q7: 为什么视频加载时会频繁切换码率？

**A:** **v1.3.1 已修复**。早期版本中，播放器选择默认 720p 轨道后会立即重新启用 ABR，导致根据估算带宽频繁切换。

**新版本行为**：
- 选择默认轨道后有 15 秒沉淀期
- 期间 ABR 保持禁用，让默认轨道充分缓冲
- 沉淀期结束后检查缓冲健康度（需 > 8秒）
- 只有在缓冲充足时才重新启用 ABR

**如何验证**：
在浏览器控制台查看日志：
```
✅ 已选择默认轨道: 720p (406x720) 码率: 539k
✅ 缓冲充足 (12.3秒)，ABR已重新启用
```

如果默认轨道播放流畅且缓冲充足，就不会看到频繁的码率切换。

### Q8: 如何调整 ABR 沉淀期和缓冲阈值？

**A:** 沉淀期（15秒）和缓冲阈值（8秒）目前是硬编码在 `ShakaVideoPlayer.vue` 中的常量。如需调整：

1. 打开 `vue3-project/src/components/ShakaVideoPlayer.vue`
2. 找到 `selectDefaultBitrateTrack` 函数
3. 修改以下值：
   ```javascript
   const settlingPeriod = 15000  // 沉淀期（毫秒）
   if (bufferedAhead > 8) {      // 缓冲阈值（秒）
   ```

**建议值**：
- 短视频（< 30秒）：沉淀期 5-10秒，缓冲阈值 3-5秒
- 中等视频（30秒 - 5分钟）：沉淀期 10-15秒，缓冲阈值 5-8秒
- 长视频（> 5分钟）：沉淀期 15-20秒，缓冲阈值 8-12秒

---

## 相关文档

- [视频转码详细说明](./VIDEO_TRANSCODING.md)
- [部署指南](./DEPLOYMENT.md)
- [API 接口文档](./API_DOCS.md)

---

**最后更新**: 2026-01-02
**版本**: v1.3.1 - 新增 ABR 沉淀期功能，防止频繁码率切换
