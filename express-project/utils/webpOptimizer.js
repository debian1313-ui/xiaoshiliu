/**
 * WebP图片优化器
 * 提供WebP转换和水印功能
 * 从PHP-Proj/webp/webp-optimizer.php移植
 * 
 * @description 自动将上传的图片优化为WebP格式，支持压缩、缩放和水印功能
 */

const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const config = require('../config/config');

// 常量定义
const CHAR_WIDTH_RATIO = 0.6;  // 字符宽度估算比例
const MAX_ALPHA = 255;         // Alpha通道最大值
const DEFAULT_WATERMARK_PADDING = 20; // 水印默认边距（像素）

/**
 * 解析路径（相对路径转换为绝对路径）
 * 独立函数，在类外部定义以避免构造函数中调用尚未定义的方法
 * @param {string|null} inputPath - 输入路径
 * @returns {string|null}
 */
function resolvePath(inputPath) {
  if (!inputPath) {
    return null;
  }
  
  // 路径以 / 开头但不是以常见系统目录开头（如 /usr, /var, /etc, /opt, /home）
  // 则视为相对于项目根目录的路径
  const systemDirs = ['/usr', '/var', '/etc', '/opt', '/home', '/root', '/tmp', '/lib', '/bin', '/sbin'];
  const isSystemPath = systemDirs.some(dir => inputPath.startsWith(dir + '/') || inputPath === dir);
  
  if (inputPath.startsWith('/') && !isSystemPath) {
    // 以 / 开头但不是系统路径，移除开头的斜杠后与项目根目录拼接
    return path.join(process.cwd(), inputPath.substring(1));
  }
  
  // 如果不是绝对路径，也相对于项目根目录解析
  if (!path.isAbsolute(inputPath)) {
    return path.join(process.cwd(), inputPath);
  }
  
  return inputPath;
}

/**
 * WebP优化器类
 */
class WebPOptimizer {
  constructor() {
    this.options = this.getDefaultOptions();
  }

  /**
   * 从配置中获取选项，如果没有配置则使用默认值
   */
  getDefaultOptions() {
    const webpConfig = config.webp || {};
    
    return {
      // 基本设置
      enableWebpConversion: webpConfig.enableConversion !== false, // 默认启用
      webpQuality: webpConfig.quality || 85,
      convertJpeg: webpConfig.convertJpeg !== false,
      convertPng: webpConfig.convertPng !== false,
      keepOriginal: webpConfig.keepOriginal || false,
      
      // 尺寸设置
      maxWidth: webpConfig.maxWidth || null,
      maxHeight: webpConfig.maxHeight || null,
      
      // 高级WebP选项
      webpLossless: webpConfig.lossless || false,
      webpAlphaQuality: webpConfig.alphaQuality || 100,
      
      // 水印设置
      enableWatermark: webpConfig.watermark?.enabled || false,
      watermarkType: webpConfig.watermark?.type || 'text', // 'text' 或 'image'
      watermarkText: webpConfig.watermark?.text || '',
      watermarkFontSize: webpConfig.watermark?.fontSize || 24,
      watermarkFontPath: resolvePath(webpConfig.watermark?.fontPath),
      watermarkImage: resolvePath(webpConfig.watermark?.imagePath),
      watermarkOpacity: webpConfig.watermark?.opacity || 50,
      watermarkPosition: webpConfig.watermark?.position || '9', // 九宫格位置，默认右下
      watermarkPositionMode: webpConfig.watermark?.positionMode || 'grid', // 'grid' 或 'precise'
      watermarkPreciseX: webpConfig.watermark?.preciseX || 0,
      watermarkPreciseY: webpConfig.watermark?.preciseY || 0,
      watermarkImageRatio: webpConfig.watermark?.imageRatio || 4, // 1-10, 表示图片水印占原图比例的1/10到10/10
      watermarkTileMode: webpConfig.watermark?.tileMode || false, // 平铺模式
      watermarkColor: webpConfig.watermark?.color || '#ffffff',
      
      // 用户名水印设置
      enableUsernameWatermark: webpConfig.usernameWatermark?.enabled || false,
      usernameWatermarkFontSize: webpConfig.usernameWatermark?.fontSize || 20,
      usernameWatermarkFontPath: resolvePath(webpConfig.usernameWatermark?.fontPath),
      usernameWatermarkOpacity: webpConfig.usernameWatermark?.opacity || 70,
      usernameWatermarkPosition: webpConfig.usernameWatermark?.position || '7', // 默认左下
      usernameWatermarkPositionMode: webpConfig.usernameWatermark?.positionMode || 'grid',
      usernameWatermarkPreciseX: webpConfig.usernameWatermark?.preciseX || 20,
      usernameWatermarkPreciseY: webpConfig.usernameWatermark?.preciseY || 20,
      usernameWatermarkColor: webpConfig.usernameWatermark?.color || '#ffffff',
      usernameWatermarkText: webpConfig.usernameWatermark?.text || '@username'
    };
  }

  /**
   * 解析路径的实例方法（调用独立函数）
   * @param {string|null} inputPath - 输入路径
   * @returns {string|null}
   */
  resolvePath(inputPath) {
    return resolvePath(inputPath);
  }

  /**
   * 检查文件是否支持转换为WebP
   * @param {string} mimetype - 文件MIME类型
   * @returns {boolean}
   */
  shouldConvert(mimetype) {
    if (!this.options.enableWebpConversion) {
      return false;
    }

    const mimeType = mimetype.toLowerCase();
    
    if ((mimeType === 'image/jpeg' || mimeType === 'image/jpg') && this.options.convertJpeg) {
      return true;
    }
    
    if (mimeType === 'image/png' && this.options.convertPng) {
      return true;
    }
    
    return false;
  }
  
  /**
   * 检查文件是否是支持处理的图片格式（用于水印等处理）
   * @param {string} mimetype - 文件MIME类型
   * @returns {boolean}
   */
  isSupportedImage(mimetype) {
    const mimeType = mimetype.toLowerCase();
    return mimeType === 'image/jpeg' || 
           mimeType === 'image/jpg' || 
           mimeType === 'image/png' || 
           mimeType === 'image/webp';
  }

  /**
   * 计算水印位置坐标
   * @param {number} position - 九宫格位置 (1-9)
   * @param {number} imageWidth - 图片宽度
   * @param {number} imageHeight - 图片高度
   * @param {number} watermarkWidth - 水印宽度
   * @param {number} watermarkHeight - 水印高度
   * @param {Object} options - 额外选项
   * @returns {{x: number, y: number}}
   */
  getWatermarkPosition(position, imageWidth, imageHeight, watermarkWidth, watermarkHeight, options = {}) {
    const positionMode = options.positionMode || this.options.watermarkPositionMode;
    
    // 精确坐标模式
    if (positionMode === 'precise') {
      return {
        x: options.preciseX || this.options.watermarkPreciseX || 0,
        y: options.preciseY || this.options.watermarkPreciseY || 0
      };
    }
    
    // 九宫格模式
    const padding = DEFAULT_WATERMARK_PADDING;
    let x = 0;
    let y = 0;
    
    switch (String(position)) {
      case '1': // 左上
        x = padding;
        y = padding;
        break;
      case '2': // 上中
        x = Math.floor((imageWidth - watermarkWidth) / 2);
        y = padding;
        break;
      case '3': // 右上
        x = imageWidth - watermarkWidth - padding;
        y = padding;
        break;
      case '4': // 左中
        x = padding;
        y = Math.floor((imageHeight - watermarkHeight) / 2);
        break;
      case '5': // 中心
        x = Math.floor((imageWidth - watermarkWidth) / 2);
        y = Math.floor((imageHeight - watermarkHeight) / 2);
        break;
      case '6': // 右中
        x = imageWidth - watermarkWidth - padding;
        y = Math.floor((imageHeight - watermarkHeight) / 2);
        break;
      case '7': // 左下
        x = padding;
        y = imageHeight - watermarkHeight - padding;
        break;
      case '8': // 下中
        x = Math.floor((imageWidth - watermarkWidth) / 2);
        y = imageHeight - watermarkHeight - padding;
        break;
      case '9': // 右下
      default:
        x = imageWidth - watermarkWidth - padding;
        y = imageHeight - watermarkHeight - padding;
        break;
    }
    
    // 确保坐标不为负数
    x = Math.max(0, x);
    y = Math.max(0, y);
    
    return { x, y };
  }

  /**
   * 创建文字水印SVG
   * @param {string} text - 水印文字
   * @param {number} fontSize - 字体大小
   * @param {string} color - 颜色 (hex格式)
   * @param {number} opacity - 透明度 (0-100)
   * @param {string|null} fontPath - 自定义字体路径
   * @returns {Buffer} SVG缓冲区
   */
  createTextWatermarkSvg(text, fontSize, color, opacity, fontPath = null) {
    // 将hex颜色转换为rgba
    const hexColor = color.replace('#', '');
    const r = parseInt(hexColor.substring(0, 2), 16);
    const g = parseInt(hexColor.substring(2, 4), 16);
    const b = parseInt(hexColor.substring(4, 6), 16);
    const a = opacity / 100;
    
    // 计算文字宽度（估算，中文字符宽度约等于字体大小）
    // 检测中文字符并调整宽度估算
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const otherChars = text.length - chineseChars;
    const charWidth = fontSize * CHAR_WIDTH_RATIO;
    const width = Math.ceil(chineseChars * fontSize + otherChars * charWidth) + 20;
    const height = fontSize + 10;
    
    // 构建字体相关的CSS
    let fontFaceRule = '';
    let fontFamily = '"Noto Sans CJK SC", "Source Han Sans SC", "Microsoft YaHei", "PingFang SC", Arial, sans-serif';
    
    // 如果提供了自定义字体路径，将字体嵌入为base64
    // 这是唯一可靠的方法让librsvg（Sharp的SVG渲染器）正确加载自定义字体
    if (fontPath && fs.existsSync(fontPath)) {
      try {
        // 读取字体文件并转换为base64
        const fontData = fs.readFileSync(fontPath);
        const fontBase64 = fontData.toString('base64');
        
        // 根据字体文件扩展名确定MIME类型
        const ext = path.extname(fontPath).toLowerCase();
        let mimeType = 'font/ttf';
        if (ext === '.otf') {
          mimeType = 'font/otf';
        } else if (ext === '.woff') {
          mimeType = 'font/woff';
        } else if (ext === '.woff2') {
          mimeType = 'font/woff2';
        }
        
        fontFaceRule = `
          @font-face {
            font-family: 'CustomWatermarkFont';
            src: url('data:${mimeType};base64,${fontBase64}') format('${ext === '.otf' ? 'opentype' : 'truetype'}');
          }`;
        fontFamily = '"CustomWatermarkFont", "Noto Sans CJK SC", "Source Han Sans SC", Arial, sans-serif';
        console.log(`WebP Optimizer: 使用自定义字体(base64嵌入) - ${fontPath}, 大小: ${Math.round(fontData.length/1024)}KB`);
      } catch (fontError) {
        console.error(`WebP Optimizer: 读取字体文件失败: ${fontError.message}`);
      }
    }
    
    // 创建SVG
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <style>
        ${fontFaceRule}
        .watermark-text {
          font-family: ${fontFamily};
          font-size: ${fontSize}px;
          fill: rgba(${r}, ${g}, ${b}, ${a});
          text-shadow: 1px 1px 2px rgba(0, 0, 0, ${a * 0.8});
        }
      </style>
      <text x="10" y="${fontSize}" class="watermark-text">${this.escapeXml(text)}</text>
    </svg>`;
    
    return Buffer.from(svg);
  }

  /**
   * 转义XML特殊字符
   * @param {string} text
   * @returns {string}
   */
  escapeXml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * 处理水印文字中的占位符
   * @param {string} text - 水印文字
   * @param {Object} context - 上下文（包含用户信息等）
   * @returns {string}
   */
  processWatermarkText(text, context = {}) {
    let processedText = text;
    
    // 替换@username占位符
    if (processedText.includes('@username')) {
      const username = context.username || 'guest';
      processedText = processedText.replace(/@username/g, username);
    }
    
    return processedText;
  }

  /**
   * 应用文字水印
   * @param {sharp.Sharp} image - Sharp图片对象
   * @param {Object} metadata - 图片元数据
   * @param {Object} context - 上下文
   * @returns {Promise<sharp.Sharp>}
   */
  async applyTextWatermark(image, metadata, context = {}) {
    if (!this.options.enableWatermark || this.options.watermarkType !== 'text') {
      return image;
    }
    
    const text = this.processWatermarkText(this.options.watermarkText, context);
    if (!text) {
      console.warn('WebP Optimizer: 文字水印内容为空');
      return image;
    }
    
    console.log(`WebP Optimizer: 应用文字水印 - 内容: "${text}", 字体大小: ${this.options.watermarkFontSize}, 位置: ${this.options.watermarkPosition}`);
    
    const fontSize = this.options.watermarkFontSize;
    const opacity = this.options.watermarkOpacity;
    const color = this.options.watermarkColor;
    const fontPath = this.options.watermarkFontPath;
    
    // 创建文字水印SVG（传入字体路径）
    const svgBuffer = this.createTextWatermarkSvg(text, fontSize, color, opacity, fontPath);
    
    // 获取SVG尺寸估算（改进中文字符宽度计算）
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const otherChars = text.length - chineseChars;
    const charWidth = fontSize * CHAR_WIDTH_RATIO;
    const watermarkWidth = Math.ceil(chineseChars * fontSize + otherChars * charWidth) + 20;
    const watermarkHeight = fontSize + 10;
    
    // 计算位置
    const position = this.getWatermarkPosition(
      this.options.watermarkPosition,
      metadata.width,
      metadata.height,
      watermarkWidth,
      watermarkHeight,
      {
        positionMode: this.options.watermarkPositionMode,
        preciseX: this.options.watermarkPreciseX,
        preciseY: this.options.watermarkPreciseY
      }
    );
    
    // 应用水印
    return image.composite([{
      input: svgBuffer,
      top: position.y,
      left: position.x
    }]);
  }

  /**
   * 应用图片水印
   * @param {sharp.Sharp} image - Sharp图片对象
   * @param {Object} metadata - 图片元数据
   * @returns {Promise<sharp.Sharp>}
   */
  async applyImageWatermark(image, metadata) {
    if (!this.options.enableWatermark || this.options.watermarkType !== 'image') {
      return image;
    }
    
    const watermarkPath = this.options.watermarkImage;
    console.log(`WebP Optimizer: 尝试加载图片水印 - 路径: ${watermarkPath}`);
    
    if (!watermarkPath) {
      console.warn('WebP Optimizer: 未配置水印图片路径');
      return image;
    }
    
    if (!fs.existsSync(watermarkPath)) {
      console.warn(`WebP Optimizer: 水印图片不存在: ${watermarkPath}`);
      return image;
    }
    
    try {
      console.log(`WebP Optimizer: 成功找到水印图片: ${watermarkPath}`);
      // 加载水印图片
      let watermark = sharp(watermarkPath);
      const watermarkMeta = await watermark.metadata();
      console.log(`WebP Optimizer: 水印图片尺寸: ${watermarkMeta.width}x${watermarkMeta.height}, 格式: ${watermarkMeta.format}`);
      
      // 计算水印尺寸（基于比例）
      const ratio = this.options.watermarkImageRatio / 10;
      const targetSize = Math.min(metadata.width, metadata.height) * ratio;
      
      let newWidth, newHeight;
      if (watermarkMeta.width > watermarkMeta.height) {
        newWidth = Math.round(targetSize);
        newHeight = Math.round((watermarkMeta.height / watermarkMeta.width) * targetSize);
      } else {
        newHeight = Math.round(targetSize);
        newWidth = Math.round((watermarkMeta.width / watermarkMeta.height) * targetSize);
      }
      
      // 调整水印大小
      const opacity = this.options.watermarkOpacity / 100;
      console.log(`WebP Optimizer: 水印缩放 - 目标尺寸: ${newWidth}x${newHeight}, 透明度: ${opacity * 100}%, 平铺模式: ${this.options.watermarkTileMode ? '是' : '否'}`);
      
      // 获取水印Buffer - 先调整大小
      const resizedWatermark = watermark.resize(newWidth, newHeight).ensureAlpha();
      
      let watermarkBuffer;
      if (opacity < 1) {
        // 需要调整透明度时，提取并修改alpha通道
        // 使用 raw 格式获取像素数据，手动调整alpha通道
        const { data, info } = await resizedWatermark
          .raw()
          .toBuffer({ resolveWithObject: true });
        
        // 修改每个像素的alpha通道
        for (let i = 3; i < data.length; i += 4) {
          data[i] = Math.round(data[i] * opacity);
        }
        
        // 重新创建图片
        watermarkBuffer = await sharp(data, {
          raw: {
            width: info.width,
            height: info.height,
            channels: 4
          }
        }).png().toBuffer();
        
        console.log(`WebP Optimizer: 已应用水印透明度调整`);
      } else {
        // 不需要调整透明度时，直接使用原图
        watermarkBuffer = await resizedWatermark.toBuffer();
      }
      
      // 检查是否使用平铺模式
      if (this.options.watermarkTileMode) {
        // 平铺模式：在整个图片上平铺水印
        const compositeOps = [];
        const padding = 20; // 水印之间的间距
        
        // 计算需要多少行和列
        const cols = Math.ceil(metadata.width / (newWidth + padding));
        const rows = Math.ceil(metadata.height / (newHeight + padding));
        
        console.log(`WebP Optimizer: 平铺模式 - 列数: ${cols}, 行数: ${rows}`);
        
        for (let row = 0; row < rows; row++) {
          for (let col = 0; col < cols; col++) {
            const x = col * (newWidth + padding);
            const y = row * (newHeight + padding);
            
            // 确保水印在图片范围内
            if (x < metadata.width && y < metadata.height) {
              compositeOps.push({
                input: watermarkBuffer,
                top: y,
                left: x
              });
            }
          }
        }
        
        console.log(`WebP Optimizer: 平铺水印数量: ${compositeOps.length}`);
        return image.composite(compositeOps);
      } else {
        // 单个水印模式
        const position = this.getWatermarkPosition(
          this.options.watermarkPosition,
          metadata.width,
          metadata.height,
          newWidth,
          newHeight,
          {
            positionMode: this.options.watermarkPositionMode,
            preciseX: this.options.watermarkPreciseX,
            preciseY: this.options.watermarkPreciseY
          }
        );
        
        console.log(`WebP Optimizer: 水印位置 - x: ${position.x}, y: ${position.y}`);
        
        // 应用水印
        return image.composite([{
          input: watermarkBuffer,
          top: position.y,
          left: position.x
        }]);
      }
    } catch (error) {
      console.error('WebP Optimizer: 应用图片水印失败:', error.message);
      return image;
    }
  }

  /**
   * 应用用户名水印
   * @param {sharp.Sharp} image - Sharp图片对象
   * @param {Object} metadata - 图片元数据
   * @param {Object} context - 上下文（包含用户信息）
   * @returns {Promise<sharp.Sharp>}
   */
  async applyUsernameWatermark(image, metadata, context = {}) {
    if (!this.options.enableUsernameWatermark) {
      return image;
    }
    
    const text = this.processWatermarkText(this.options.usernameWatermarkText, context);
    if (!text) {
      console.warn('WebP Optimizer: 用户名水印内容为空');
      return image;
    }
    
    console.log(`WebP Optimizer: 应用用户名水印 - 内容: "${text}", 字体大小: ${this.options.usernameWatermarkFontSize}, 位置: ${this.options.usernameWatermarkPosition}`);
    
    const fontSize = this.options.usernameWatermarkFontSize;
    const opacity = this.options.usernameWatermarkOpacity;
    const color = this.options.usernameWatermarkColor;
    const fontPath = this.options.usernameWatermarkFontPath;
    
    // 创建文字水印SVG（传入字体路径）
    const svgBuffer = this.createTextWatermarkSvg(text, fontSize, color, opacity, fontPath);
    
    // 获取SVG尺寸估算（改进中文字符宽度计算）
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const otherChars = text.length - chineseChars;
    const charWidth = fontSize * CHAR_WIDTH_RATIO;
    const watermarkWidth = Math.ceil(chineseChars * fontSize + otherChars * charWidth) + 20;
    const watermarkHeight = fontSize + 10;
    
    // 计算位置
    const position = this.getWatermarkPosition(
      this.options.usernameWatermarkPosition,
      metadata.width,
      metadata.height,
      watermarkWidth,
      watermarkHeight,
      {
        positionMode: this.options.usernameWatermarkPositionMode,
        preciseX: this.options.usernameWatermarkPreciseX,
        preciseY: this.options.usernameWatermarkPreciseY
      }
    );
    
    // 应用水印
    return image.composite([{
      input: svgBuffer,
      top: position.y,
      left: position.x
    }]);
  }

  /**
   * 处理图片 - 主入口函数
   * @param {Buffer} fileBuffer - 文件缓冲区
   * @param {string} mimetype - 文件MIME类型
   * @param {Object} context - 上下文（包含用户信息等，以及 applyWatermark 控制是否添加水印）
   * @returns {Promise<{buffer: Buffer, filename: string, mimetype: string, processed: boolean}>}
   */
  async processImage(fileBuffer, mimetype, context = {}) {
    // 检查是否是支持的图片格式
    const isSupported = this.isSupportedImage(mimetype);
    if (!isSupported) {
      return {
        buffer: fileBuffer,
        mimetype: mimetype,
        processed: false
      };
    }
    
    // 检查是否需要转换为WebP
    const shouldConvertToWebp = this.shouldConvert(mimetype);
    
    // 用户可以通过 context.applyWatermark 控制是否添加水印
    // 如果未指定（undefined），则使用后端配置的默认值
    // 如果指定了 false，则不添加水印
    // 如果指定了 true，则添加水印（前提是后端已启用）
    const userWantsWatermark = context.applyWatermark !== false; // 默认为 true
    const shouldApplyWatermark = userWantsWatermark && (this.options.enableWatermark || this.options.enableUsernameWatermark);
    const shouldResize = this.options.maxWidth || this.options.maxHeight;
    
    // 如果不需要任何处理，直接返回原图
    if (!shouldConvertToWebp && !shouldApplyWatermark && !shouldResize) {
      return {
        buffer: fileBuffer,
        mimetype: mimetype,
        processed: false
      };
    }
    
    try {
      // 创建Sharp实例
      let image = sharp(fileBuffer);
      let metadata = await image.metadata();
      
      console.log(`WebP Optimizer: 处理图片 - 原始尺寸: ${metadata.width}x${metadata.height}, 格式: ${metadata.format}`);
      console.log(`WebP Optimizer: 水印配置 - 后端主水印: ${this.options.enableWatermark ? '启用' : '禁用'}, 类型: ${this.options.watermarkType}, 用户名水印: ${this.options.enableUsernameWatermark ? '启用' : '禁用'}`);
      console.log(`WebP Optimizer: 用户选择 - 添加水印: ${userWantsWatermark ? '是' : '否'}, 实际应用: ${shouldApplyWatermark ? '是' : '否'}`);
      
      // 1. 尺寸缩放
      if (shouldResize) {
        const resizeOptions = {};
        
        if (this.options.maxWidth && metadata.width > this.options.maxWidth) {
          resizeOptions.width = this.options.maxWidth;
        }
        
        if (this.options.maxHeight && metadata.height > this.options.maxHeight) {
          resizeOptions.height = this.options.maxHeight;
        }
        
        if (Object.keys(resizeOptions).length > 0) {
          resizeOptions.fit = 'inside';
          resizeOptions.withoutEnlargement = true;
          image = image.resize(resizeOptions);
          
          // 更新metadata以反映新尺寸 - 使用resolveWithObject获取info包含新尺寸
          const { data: resizedBuffer, info } = await image.toBuffer({ resolveWithObject: true });
          image = sharp(resizedBuffer);
          metadata = { ...metadata, width: info.width, height: info.height };
          
          console.log(`WebP Optimizer: 已缩放 - 新尺寸: ${metadata.width}x${metadata.height}`);
        }
      }
      
      // 2. 应用水印
      if (shouldApplyWatermark) {
        // 应用文字/图片水印
        if (this.options.enableWatermark) {
          if (this.options.watermarkType === 'text') {
            image = await this.applyTextWatermark(image, metadata, context);
            // 获取buffer并重新创建Sharp实例，确保composite操作被应用
            const buffer = await image.toBuffer();
            image = sharp(buffer);
          } else if (this.options.watermarkType === 'image') {
            image = await this.applyImageWatermark(image, metadata);
            // 获取buffer并重新创建Sharp实例，确保composite操作被应用
            const buffer = await image.toBuffer();
            image = sharp(buffer);
          }
        }
        
        // 应用用户名水印
        if (this.options.enableUsernameWatermark) {
          image = await this.applyUsernameWatermark(image, metadata, context);
          // 获取buffer并重新创建Sharp实例，确保composite操作被应用
          const buffer = await image.toBuffer();
          image = sharp(buffer);
        }
      }
      
      // 3. WebP转换或保持原格式
      let outputBuffer;
      let outputMimetype = mimetype;
      
      if (shouldConvertToWebp) {
        const webpOptions = {
          quality: this.options.webpQuality,
          alphaQuality: this.options.webpAlphaQuality,
          lossless: this.options.webpLossless
        };
        
        outputBuffer = await image.webp(webpOptions).toBuffer();
        outputMimetype = 'image/webp';
        
        console.log(`WebP Optimizer: 已转换为WebP - 质量: ${this.options.webpQuality}, 无损: ${this.options.webpLossless}`);
      } else if (mimetype.toLowerCase() === 'image/webp') {
        // 如果原图是WebP，保持WebP格式输出
        const webpOptions = {
          quality: this.options.webpQuality,
          alphaQuality: this.options.webpAlphaQuality,
          lossless: this.options.webpLossless
        };
        outputBuffer = await image.webp(webpOptions).toBuffer();
        outputMimetype = 'image/webp';
        console.log(`WebP Optimizer: 保持WebP格式输出 - 质量: ${this.options.webpQuality}`);
      } else {
        // 如果不转换WebP，保持原格式输出
        outputBuffer = await image.toBuffer();
      }
      
      console.log(`WebP Optimizer: 处理完成 - 原始大小: ${fileBuffer.length}, 处理后: ${outputBuffer.length}`);
      
      return {
        buffer: outputBuffer,
        mimetype: outputMimetype,
        processed: true
      };
    } catch (error) {
      console.error('WebP Optimizer: 图片处理失败:', error.message);
      // 处理失败时返回原图
      return {
        buffer: fileBuffer,
        mimetype: mimetype,
        processed: false,
        error: error.message
      };
    }
  }

  /**
   * 生成WebP文件名
   * @param {string} originalFilename - 原始文件名
   * @returns {string}
   */
  generateWebpFilename(originalFilename) {
    const ext = path.extname(originalFilename);
    const basename = path.basename(originalFilename, ext);
    return `${basename}.webp`;
  }

  /**
   * 检查Sharp模块是否可用
   * @returns {boolean}
   */
  static isAvailable() {
    try {
      require('sharp');
      return true;
    } catch (error) {
      console.warn('WebP Optimizer: Sharp模块不可用:', error.message);
      return false;
    }
  }
}

// 创建单例实例
const webpOptimizer = new WebPOptimizer();

// 启动时输出配置信息，帮助用户排查问题
console.log('========== WebP Optimizer 配置 ==========');
console.log(`WebP转换: ${webpOptimizer.options.enableWebpConversion ? '启用' : '禁用'}`);
console.log(`主水印: ${webpOptimizer.options.enableWatermark ? '启用' : '禁用'}`);
if (webpOptimizer.options.enableWatermark) {
  console.log(`  - 类型: ${webpOptimizer.options.watermarkType}`);
  if (webpOptimizer.options.watermarkType === 'text') {
    console.log(`  - 文字: ${webpOptimizer.options.watermarkText || '(未配置)'}`);
    const fontPath = webpOptimizer.options.watermarkFontPath;
    if (fontPath) {
      const fontExists = fs.existsSync(fontPath);
      console.log(`  - 字体: ${fontPath}`);
      console.log(`  - 字体存在: ${fontExists ? '是' : '否 ⚠️ 请检查路径!'}`);
    } else {
      console.log(`  - 字体: 使用系统默认字体`);
    }
  } else if (webpOptimizer.options.watermarkType === 'image') {
    const imgPath = webpOptimizer.options.watermarkImage;
    const imgExists = imgPath && fs.existsSync(imgPath);
    console.log(`  - 图片: ${imgPath || '(未配置)'}`);
    console.log(`  - 图片存在: ${imgExists ? '是' : '否 ⚠️ 请检查路径!'}`);
  }
  console.log(`  - 位置: ${webpOptimizer.options.watermarkPosition}`);
  console.log(`  - 透明度: ${webpOptimizer.options.watermarkOpacity}%`);
}
console.log(`用户名水印: ${webpOptimizer.options.enableUsernameWatermark ? '启用' : '禁用'}`);
if (webpOptimizer.options.enableUsernameWatermark) {
  console.log(`  - 文字: ${webpOptimizer.options.usernameWatermarkText}`);
  console.log(`  - 位置: ${webpOptimizer.options.usernameWatermarkPosition}`);
  const fontPath = webpOptimizer.options.usernameWatermarkFontPath;
  if (fontPath) {
    const fontExists = fs.existsSync(fontPath);
    console.log(`  - 字体: ${fontPath}`);
    console.log(`  - 字体存在: ${fontExists ? '是' : '否 ⚠️ 请检查路径!'}`);
  } else {
    console.log(`  - 字体: 使用系统默认字体`);
  }
}
console.log('==========================================');

/**
 * 处理图片（便捷函数）
 * @param {Buffer} fileBuffer - 文件缓冲区
 * @param {string} mimetype - 文件MIME类型
 * @param {Object} context - 上下文
 * @returns {Promise<{buffer: Buffer, mimetype: string, processed: boolean}>}
 */
async function processImage(fileBuffer, mimetype, context = {}) {
  return webpOptimizer.processImage(fileBuffer, mimetype, context);
}

/**
 * 生成WebP文件名（便捷函数）
 * @param {string} originalFilename - 原始文件名
 * @returns {string}
 */
function generateWebpFilename(originalFilename) {
  return webpOptimizer.generateWebpFilename(originalFilename);
}

/**
 * 检查是否应该转换为WebP（便捷函数）
 * @param {string} mimetype - 文件MIME类型
 * @returns {boolean}
 */
function shouldConvert(mimetype) {
  return webpOptimizer.shouldConvert(mimetype);
}

/**
 * 刷新配置（重新从config读取）
 */
function refreshConfig() {
  webpOptimizer.options = webpOptimizer.getDefaultOptions();
}

module.exports = {
  WebPOptimizer,
  webpOptimizer,
  processImage,
  generateWebpFilename,
  shouldConvert,
  refreshConfig
};
