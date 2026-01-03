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
const net = require('net');
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

  // 保持外部URL原样返回，便于加载远程字体/资源
  if (/^https?:\/\//i.test(inputPath)) {
    return inputPath;
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
    // 使用通用的衬线字体作为fallback，这些在大多数系统上都有中文支持
    let fontFamily = '"Noto Sans CJK SC", "Source Han Sans CN", "WenQuanYi Zen Hei", "WenQuanYi Micro Hei", "Droid Sans Fallback", "Microsoft YaHei", "PingFang SC", "SimHei", "Heiti SC", sans-serif';
    
    const rawFontPath = fontPath ? String(fontPath) : '';
    const getFontExtension = (input) => path.extname(input.split('?')[0]).toLowerCase();
    const fontExtension = rawFontPath ? getFontExtension(rawFontPath) : '';
    let safeExternalFontUrl = null;
    if (rawFontPath && /^https?:\/\//i.test(rawFontPath)) {
      try {
        const parsedUrl = new URL(rawFontPath);
        const allowedProtocols = ['http:', 'https:'];
        if (allowedProtocols.includes(parsedUrl.protocol)) {
          const hostname = parsedUrl.hostname;
          const ipVersion = net.isIP(hostname);
          let isPrivateIp = false;
          if (ipVersion === 4) {
            isPrivateIp = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|169\.254\.)/.test(hostname);
          } else if (ipVersion === 6) {
            const normalizedHost = hostname.toLowerCase();
            isPrivateIp = normalizedHost === '::1' || normalizedHost.startsWith('fc00:') || normalizedHost.startsWith('fd00:') || normalizedHost.startsWith('fe80:');
          }
          if (hostname === 'localhost' || isPrivateIp) {
            console.warn(`WebP Optimizer: 外部字体URL指向内网或本地地址，已忽略 - ${hostname}`);
          } else {
            safeExternalFontUrl = parsedUrl.toString();
          }
        } else {
          console.warn(`WebP Optimizer: 外部字体协议不被允许 - ${parsedUrl.protocol}`);
        }
      } catch (err) {
        console.warn(`WebP Optimizer: 外部字体URL无效 - ${err.message}`);
      }
    }
    const isExternalFont = !!safeExternalFontUrl;
    // 如果提供了自定义字体路径，将字体嵌入为base64，或使用远程字体URL
    // 注意：librsvg对自定义字体的支持有限，可能需要安装系统字体
    if (isExternalFont && safeExternalFontUrl) {
      const ext = fontExtension;
      let formatHint = 'truetype';
      if (ext === '.otf') {
        formatHint = 'opentype';
      } else if (ext === '.woff') {
        formatHint = 'woff';
      } else if (ext === '.woff2') {
        formatHint = 'woff2';
      }
      const encodedUrl = encodeURI(safeExternalFontUrl);
      const cssSafeUrl = encodedUrl.replace(/([\\'"(){}@\s;])/g, '\\$1');
      fontFaceRule = `
        @font-face {
          font-family: 'CustomWatermarkFont';
          src: url('${cssSafeUrl}') format('${formatHint}');
          font-weight: normal;
          font-style: normal;
        }`;
      fontFamily = '"CustomWatermarkFont", "Noto Sans CJK SC", "Source Han Sans CN", "WenQuanYi Zen Hei", "SimHei", sans-serif';
      console.log(`WebP Optimizer: 使用远程字体 - ${safeExternalFontUrl}`);
    } else if (fontPath && fs.existsSync(fontPath)) {
      try {
        // 读取字体文件并转换为base64
        const fontData = fs.readFileSync(fontPath);
        const fontBase64 = fontData.toString('base64');
        
        // 根据字体文件扩展名确定MIME类型和格式
        const ext = fontExtension;
        let mimeType = 'font/ttf';
        let formatHint = 'truetype';
        if (ext === '.otf') {
          mimeType = 'font/otf';
          formatHint = 'opentype';
        } else if (ext === '.woff') {
          mimeType = 'font/woff';
          formatHint = 'woff';
        } else if (ext === '.woff2') {
          mimeType = 'font/woff2';
          formatHint = 'woff2';
        }
        
        // 使用多种方式声明字体，增加兼容性
        fontFaceRule = `
          @font-face {
            font-family: 'CustomWatermarkFont';
            src: url('data:${mimeType};base64,${fontBase64}') format('${formatHint}');
            font-weight: normal;
            font-style: normal;
          }`;
        fontFamily = '"CustomWatermarkFont", "Noto Sans CJK SC", "Source Han Sans CN", "WenQuanYi Zen Hei", "SimHei", sans-serif';
        console.log(`WebP Optimizer: 使用自定义字体(base64嵌入) - ${fontPath}, 大小: ${Math.round(fontData.length/1024)}KB`);
      } catch (fontError) {
        console.error(`WebP Optimizer: 读取字体文件失败: ${fontError.message}`);
      }
    } else {
      console.log(`WebP Optimizer: 使用系统默认中文字体`);
    }
    
    // 创建SVG - 使用dominant-baseline和text-anchor来更好地定位文字
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <defs>
        <style type="text/css">
          ${fontFaceRule}
          .watermark-text {
            font-family: ${fontFamily};
            font-size: ${fontSize}px;
            fill: rgba(${r}, ${g}, ${b}, ${a});
            font-weight: normal;
          }
        </style>
      </defs>
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
   * 使用sharp的text方法创建文字水印
   * @param {string} text - 水印文字
   * @param {number} fontSize - 字体大小
   * @param {string} color - 颜色 (hex格式)
   * @param {number} opacity - 透明度 (0-100)
   * @param {string|null} fontPath - 自定义字体路径
   * @returns {Object} sharp text input对象
   */
  createTextWatermarkInput(text, fontSize, color, opacity, fontPath = null) {
    // 将hex颜色转换为rgba
    const hexColor = color.replace('#', '');
    const r = parseInt(hexColor.substring(0, 2), 16);
    const g = parseInt(hexColor.substring(2, 4), 16);
    const b = parseInt(hexColor.substring(4, 6), 16);
    const a = Math.round((opacity / 100) * 255);
    
    // 构建text input对象
    const textInput = {
      text: text,
      width: 2400, // 设置较大的宽度以支持长文本
      height: fontSize * 2, // 高度为字体大小的2倍
      rgba: true,
      dpi: 300
    };
    
    // 如果有自定义字体路径，添加font属性
    if (fontPath && fs.existsSync(fontPath)) {
      textInput.font = fontPath;
      textInput.fontfile = fontPath;
      console.log(`WebP Optimizer: 使用自定义字体 - ${fontPath}`);
    } else {
      // 使用系统字体，优先使用支持中文的字体
      textInput.font = 'sans-serif';
      console.log(`WebP Optimizer: 使用系统默认字体`);
    }
    
    // 设置颜色和透明度
    // Sharp的text功能会创建一个图层，我们通过blend来控制透明度
    return {
      input: textInput,
      blend: 'over',
      // 注意: sharp的text目前不直接支持设置颜色，需要通过其他方式处理
      // 我们继续使用SVG方法以保持颜色和透明度的精确控制
    };
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
    
    const fontSize = this.options.watermarkFontSize;
    // 用户自定义透明度优先，否则使用配置的透明度
    const opacity = context.customOpacity || this.options.watermarkOpacity;
    const color = this.options.watermarkColor;
    const fontPath = this.options.watermarkFontPath;
    
    console.log(`WebP Optimizer: 应用文字水印 - 内容: "${text}", 字体大小: ${fontSize}, 透明度: ${opacity}%, 位置: ${this.options.watermarkPosition}`);
    
    try {
      // 尝试使用sharp的text方法（适用于sharp 0.32.0+）
      // text方法对中文支持更好，但需要系统字体支持
      const hexColor = color.replace('#', '');
      const r = parseInt(hexColor.substring(0, 2), 16);
      const g = parseInt(hexColor.substring(2, 4), 16);
      const b = parseInt(hexColor.substring(4, 6), 16);
      const a = Math.round((opacity / 100) * 255);
      
      // 创建text input
      const textInput = {
        text: {
          text: text,
          font: 'sans-serif',
          fontSize: fontSize,
          rgba: true,
          dpi: 300
        }
      };
      
      // 如果有自定义字体，设置fontfile
      if (fontPath && fs.existsSync(fontPath)) {
        textInput.text.fontfile = fontPath;
        console.log(`WebP Optimizer: 使用自定义字体文件 - ${fontPath}`);
      }
      
      // 计算水印尺寸（估算）
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
      
      // 先创建文字图层
      const textBuffer = await sharp({
        text: {
          text: text,
          font: fontPath && fs.existsSync(fontPath) ? undefined : 'sans-serif',
          fontfile: fontPath && fs.existsSync(fontPath) ? fontPath : undefined,
          rgba: true,
          dpi: 300
        }
      })
      .png()
      .toBuffer();
      
      // 调整颜色和透明度
      const textImage = sharp(textBuffer);
      const textMeta = await textImage.metadata();
      
      // 应用颜色tint和透明度
      let processedText = textImage;
      
      // 如果需要调整颜色或透明度
      if (opacity < 100) {
        const { data, info } = await textImage.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        
        // 修改颜色和透明度
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] > 0) { // 只处理非透明像素
            data[i] = r;     // R
            data[i + 1] = g; // G
            data[i + 2] = b; // B
            data[i + 3] = Math.round(data[i + 3] * (opacity / 100)); // A
          }
        }
        
        processedText = sharp(data, {
          raw: {
            width: info.width,
            height: info.height,
            channels: 4
          }
        });
      }
      
      const processedBuffer = await processedText.png().toBuffer();
      
      // 应用水印
      return image.composite([{
        input: processedBuffer,
        top: position.y,
        left: position.x,
        blend: 'over'
      }]);
      
    } catch (error) {
      console.warn(`WebP Optimizer: 使用text方法失败，回退到SVG方法: ${error.message}`);
      
      // 回退到SVG方法
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
  }

  /**
   * 应用图片水印
   * @param {sharp.Sharp} image - Sharp图片对象
   * @param {Object} metadata - 图片元数据
   * @param {Object} context - 上下文（包含用户自定义选项）
   * @returns {Promise<sharp.Sharp>}
   */
/**
   * 应用图片水印 - 修正版（支持 PNG 透明度叠加）
   */
  async applyImageWatermark(image, metadata, context = {}) {
    if (!this.options.enableWatermark || this.options.watermarkType !== 'image') {
      return image;
    }
    
    const watermarkPath = this.options.watermarkImage;
    
    // 修正：移除错误的 fs.parse，改用标准的路径和存在性检查
    if (!watermarkPath) {
      console.warn('WebP Optimizer: 未配置水印图片路径');
      return image;
    }
    
    if (!fs.existsSync(watermarkPath)) {
      console.warn(`WebP Optimizer: 水印图片不存在: ${watermarkPath}`);
      return image;
    }
    
    try {
      // 1. 加载水印并确保有 Alpha 通道（PNG 默认会有，但 ensureAlpha 可以增加兼容性）
      let watermarkProcessor = sharp(watermarkPath).ensureAlpha();
      const watermarkMeta = await watermarkProcessor.metadata();
      
      // 2. 计算缩放尺寸（基于配置比例）
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
      
      // 3. 调整水印大小
      watermarkProcessor = watermarkProcessor.resize(newWidth, newHeight);
      
      // 4. 应用全局透明度 (关键修复)
      // 用户自定义透明度优先，否则使用配置的透明度
      const opacity = context.customOpacity || this.options.watermarkOpacity;
      console.log(`WebP Optimizer: 图片水印透明度 - ${opacity}%${context.customOpacity ? ' (用户自定义)' : ' (后端配置)'}`);
      
      if (opacity < 100) {
        const alphaFactor = opacity / 100;
        // 使用 linear 函数调整通道：[R, G, B, A] 
        // 保持 RGB (1倍增益)，将 Alpha 通道乘以 alphaFactor
        watermarkProcessor = watermarkProcessor.linear([1, 1, 1, alphaFactor], [0, 0, 0, 0]);
      }
      
      // 转换为 PNG Buffer 供后续 composite 使用
      const watermarkBuffer = await watermarkProcessor.png().toBuffer();
      
      // 5. 处理合成（平铺或单点）
      if (this.options.watermarkTileMode) {
        const compositeOps = [];
        const padding = 20;
        const cols = Math.ceil(metadata.width / (newWidth + padding));
        const rows = Math.ceil(metadata.height / (newHeight + padding));
        
        for (let row = 0; row < rows; row++) {
          for (let col = 0; col < cols; col++) {
            const x = col * (newWidth + padding);
            const y = row * (newHeight + padding);
            
            if (x < metadata.width && y < metadata.height) {
              compositeOps.push({
                input: watermarkBuffer,
                top: y,
                left: x,
                blend: 'over'
              });
            }
          }
        }
        return image.composite(compositeOps);
      } else {
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
        
        return image.composite([{
          input: watermarkBuffer,
          top: position.y,
          left: position.x,
          blend: 'over'
        }]);
      }
    } catch (error) {
      console.error('WebP Optimizer: 图片水印应用失败:', error.message);
      return image;
    }
  }
  /**
   * 应用用户名水印
   * @param {sharp.Sharp} image - Sharp图片对象
   * @param {Object} metadata - 图片元数据
   * @param {Object} context - 上下文（包含用户信息和自定义选项）
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
    
    // 前端自定义选项优先，否则使用后端配置
    const fontSize = context.usernameFontSize || this.options.usernameWatermarkFontSize;
    const opacity = context.usernameOpacity || this.options.usernameWatermarkOpacity;
    const color = context.usernameColor || this.options.usernameWatermarkColor;
    const fontPath = this.options.usernameWatermarkFontPath;
    
    // 位置：优先使用前端提供的精确坐标，否则使用配置的位置模式
    let position;
    let positionSource = '后端默认';
    
    if (context.usernamePositionX !== undefined && context.usernamePositionY !== undefined) {
      // 前端提供了精确坐标
      position = {
        x: context.usernamePositionX,
        y: context.usernamePositionY
      };
      positionSource = '前端自定义 (精确坐标)';
    } else if (context.usernamePosition) {
      // 前端提供了九宫格位置
      const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
      const otherChars = text.length - chineseChars;
      const charWidth = fontSize * CHAR_WIDTH_RATIO;
      const watermarkWidth = Math.ceil(chineseChars * fontSize + otherChars * charWidth) + 20;
      const watermarkHeight = fontSize + 10;
      
      position = this.getWatermarkPosition(
        context.usernamePosition,
        metadata.width,
        metadata.height,
        watermarkWidth,
        watermarkHeight,
        {
          positionMode: 'grid',
          preciseX: 20,
          preciseY: 20
        }
      );
      positionSource = '前端自定义 (九宫格)';
    } else {
      // 使用后端配置的位置
      const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
      const otherChars = text.length - chineseChars;
      const charWidth = fontSize * CHAR_WIDTH_RATIO;
      const watermarkWidth = Math.ceil(chineseChars * fontSize + otherChars * charWidth) + 20;
      const watermarkHeight = fontSize + 10;
      
      position = this.getWatermarkPosition(
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
    }
    
    console.log(`WebP Optimizer: 应用用户名水印 - 内容: "${text}", 字体大小: ${fontSize}${context.usernameFontSize ? ' (前端)' : ' (后端)'}, 透明度: ${opacity}%${context.usernameOpacity ? ' (前端)' : ' (后端)'}, 位置: ${positionSource}`);
    
    try {
      // 尝试使用sharp的text方法（适用于sharp 0.32.0+）
      const hexColor = color.replace('#', '');
      const r = parseInt(hexColor.substring(0, 2), 16);
      const g = parseInt(hexColor.substring(2, 4), 16);
      const b = parseInt(hexColor.substring(4, 6), 16);
      
      // 先创建文字图层
      const textBuffer = await sharp({
        text: {
          text: text,
          font: fontPath && fs.existsSync(fontPath) ? undefined : 'sans-serif',
          fontfile: fontPath && fs.existsSync(fontPath) ? fontPath : undefined,
          rgba: true,
          dpi: 300
        }
      })
      .png()
      .toBuffer();
      
      // 调整颜色和透明度
      const textImage = sharp(textBuffer);
      const textMeta = await textImage.metadata();
      
      // 应用颜色和透明度
      let processedText = textImage;
      
      // 如果需要调整颜色或透明度
      if (opacity < 100 || color !== '#000000') {
        const { data, info } = await textImage.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        
        // 修改颜色和透明度
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] > 0) { // 只处理非透明像素
            data[i] = r;     // R
            data[i + 1] = g; // G
            data[i + 2] = b; // B
            data[i + 3] = Math.round(data[i + 3] * (opacity / 100)); // A
          }
        }
        
        processedText = sharp(data, {
          raw: {
            width: info.width,
            height: info.height,
            channels: 4
          }
        });
      }
      
      const processedBuffer = await processedText.png().toBuffer();
      
      // 应用水印
      return image.composite([{
        input: processedBuffer,
        top: position.y,
        left: position.x,
        blend: 'over'
      }]);
      
    } catch (error) {
      console.warn(`WebP Optimizer: 用户名水印使用text方法失败，回退到SVG方法: ${error.message}`);
      
      // 回退到SVG方法
      const svgBuffer = this.createTextWatermarkSvg(text, fontSize, color, opacity, fontPath);
      
      // 应用水印
      return image.composite([{
        input: svgBuffer,
        top: position.y,
        left: position.x
      }]);
    }
  }

  /**
   * 处理图片 - 主入口函数
   * @param {Buffer} fileBuffer - 文件缓冲区
   * @param {string} mimetype - 文件MIME类型
   * @param {Object} context - 上下文（包含用户信息等，以及 applyWatermark 控制是否添加水印，isAvatar 控制头像模式）
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
    
    // 头像上传模式：强制转换为WebP，质量75%
    const isAvatar = context.isAvatar === true;
    
    // 检查是否需要转换为WebP
    // 头像模式下强制转换为WebP
    const shouldConvertToWebp = isAvatar || this.shouldConvert(mimetype);
    
    // 用户可以通过 context.applyWatermark 控制是否添加水印
    // 如果未指定（undefined），则使用后端配置的默认值
    // 如果指定了 false，则不添加水印
    // 如果指定了 true，则添加水印（前提是后端已启用）
    const userWantsWatermark = context.applyWatermark === true; // 默认为不添加，需显式开启
    const shouldApplyWatermark = userWantsWatermark && (this.options.enableWatermark || this.options.enableUsernameWatermark);
    const shouldResize = this.options.maxWidth || this.options.maxHeight;
    
    // 用户自定义透明度（覆盖默认配置）
    const customOpacity = context.customOpacity;
    
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
      
      console.log(`WebP Optimizer: 处理图片 - 原始尺寸: ${metadata.width}x${metadata.height}, 格式: ${metadata.format}${isAvatar ? ', 头像模式' : ''}`);
      console.log(`WebP Optimizer: 水印配置 - 后端主水印: ${this.options.enableWatermark ? '启用' : '禁用'}, 类型: ${this.options.watermarkType}, 用户名水印: ${this.options.enableUsernameWatermark ? '启用' : '禁用'}`);
      console.log(`WebP Optimizer: 用户选择 - 添加水印: ${userWantsWatermark ? '是' : '否'}, 实际应用: ${shouldApplyWatermark ? '是' : '否'}${customOpacity ? `, 自定义透明度: ${customOpacity}%` : ''}`);
      
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
            image = await this.applyImageWatermark(image, metadata, context);
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
        // 头像模式使用75%质量，其他使用配置的默认质量
        const avatarQuality = 75;
        const webpOptions = {
          quality: isAvatar ? avatarQuality : this.options.webpQuality,
          alphaQuality: this.options.webpAlphaQuality,
          lossless: isAvatar ? false : this.options.webpLossless // 头像模式禁用无损压缩
        };
        
        outputBuffer = await image.webp(webpOptions).toBuffer();
        outputMimetype = 'image/webp';
        
        console.log(`WebP Optimizer: 已转换为WebP - 质量: ${webpOptions.quality}${isAvatar ? ' (头像模式)' : ''}, 无损: ${webpOptions.lossless}`);
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
