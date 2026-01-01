# 视频上传大小限制配置说明

## 问题描述

之前视频上传大小限制被硬编码为 100MB，存在于多个位置：
- 后端 `routes/upload.js` 中的 multer 配置
- 后端分片配置接口返回值
- 前端 `VideoUpload.vue` 组件
- 前端 `FormModal.vue` 组件
- 前端 `config/api.js` 配置文件

## 解决方案

现在视频上传大小限制已经通过环境变量 `VIDEO_MAX_SIZE` 进行配置，支持动态调整。

## 配置方法

### 1. 后端配置

在 `.env` 文件中添加或修改 `VIDEO_MAX_SIZE` 环境变量：

```bash
# 视频最大上传大小 (支持格式: 100mb, 200MB, 1gb 等)
VIDEO_MAX_SIZE=100mb
```

支持的格式：
- `100mb` 或 `100MB` - 100兆字节
- `1gb` 或 `1GB` - 1吉字节
- `500kb` 或 `500KB` - 500千字节
- `1.5gb` - 1.5吉字节（支持小数）

### 2. 前端配置

前端会自动从后端 API (`/api/upload/chunk/config`) 获取视频大小限制配置，无需手动配置。

如果后端接口暂时不可用，前端会使用默认值 100MB 作为后备。

## 实现细节

### 后端改动

1. **config/config.js**
   - 添加 `parseSizeToBytes()` 函数，支持将大小字符串（如 "100mb"）转换为字节数
   - 在 `upload.video` 配置中添加 `maxSizeBytes` 字段，存储转换后的字节数

2. **routes/upload.js**
   - multer 配置使用 `config.upload.video.maxSizeBytes` 替代硬编码的 100MB
   - `/upload/chunk/config` 接口返回 `config.upload.video.maxSizeBytes` 替代硬编码值

3. **.env.example 和 .env.docker**
   - 添加 `VIDEO_MAX_SIZE=100mb` 环境变量示例

### 前端改动

1. **components/VideoUpload.vue**
   - 添加 `serverMaxSize` 响应式变量存储从服务器获取的配置
   - 添加 `actualMaxSize` 计算属性，优先使用服务器配置
   - 添加 `maxSizeMB` 计算属性，用于界面显示
   - 组件挂载时调用 `videoApi.getChunkConfig()` 获取服务器配置
   - 更新模板中的提示文本使用 `maxSizeMB` 动态显示

2. **views/admin/components/FormModal.vue**
   - 添加 `serverMaxVideoSize` 响应式变量存储服务器配置
   - 组件挂载时调用 `videoApi.getChunkConfig()` 获取服务器配置
   - 更新 `handleVideoFileSelect` 函数使用动态配置
   - 错误提示信息动态显示实际的大小限制

3. **config/api.js**
   - 添加注释说明 `maxFileSize` 是默认值，实际使用时从服务器获取

4. **views/admin/ApiDocs.vue 和 doc/API_DOCS.md**
   - 更新文档说明大小限制可通过环境变量配置

## 测试

### 后端测试

```bash
# 测试默认配置 (100MB)
cd express-project
node -e "const config = require('./config/config.js'); console.log(config.upload.video)"

# 测试自定义配置 (200MB)
VIDEO_MAX_SIZE=200mb node -e "const config = require('./config/config.js'); console.log(config.upload.video)"
```

### 前端测试

前端会在运行时自动从后端获取配置，可以通过浏览器开发者工具的 Network 面板查看：
1. 打开 `/api/upload/chunk/config` 接口调用
2. 查看返回的 `maxFileSize` 值是否正确

## 向后兼容性

- 如果未设置 `VIDEO_MAX_SIZE` 环境变量，默认使用 100MB
- 前端如果无法从后端获取配置，会使用默认值 100MB
- 所有改动都保持向后兼容，不会影响现有功能

## 注意事项

1. 修改 `VIDEO_MAX_SIZE` 后需要重启后端服务才能生效
2. 前端会在组件挂载时获取配置，如果已经打开的页面需要刷新才能看到新的限制
3. 建议根据服务器的存储空间和带宽合理设置视频大小限制
4. 过大的视频可能导致上传超时或服务器资源不足，建议保持在合理范围内（100MB-500MB）
