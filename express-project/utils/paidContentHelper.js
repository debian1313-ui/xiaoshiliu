/**
 * 付费内容保护助手
 * 用于保护付费内容不被未购买用户访问
 */

const { PAID_CONTENT } = require('../constants');

/**
 * 判断是否为付费内容
 * @param {Object} paymentSetting - 付费设置对象
 * @returns {boolean} 是否为付费内容
 */
function isPaidContent(paymentSetting) {
  return paymentSetting && paymentSetting.enabled === 1;
}

/**
 * 判断是否需要保护内容
 * @param {Object} paymentSetting - 付费设置对象
 * @param {boolean} isAuthor - 是否为作者
 * @param {boolean} hasPurchased - 是否已购买
 * @returns {boolean} 是否需要保护内容
 */
function shouldProtectContent(paymentSetting, isAuthor, hasPurchased) {
  return isPaidContent(paymentSetting) && !isAuthor && !hasPurchased;
}

/**
 * 获取免费预览数量
 * @param {Object} paymentSetting - 付费设置对象
 * @returns {number} 免费预览图片数量
 */
function getFreePreviewCount(paymentSetting) {
  if (!paymentSetting) return 0;
  return paymentSetting.free_preview_count || paymentSetting.freePreviewCount || 0;
}

/**
 * 安全截断Unicode文本
 * 确保不会在多字节字符中间截断
 * @param {string} text - 要截断的文本
 * @param {number} maxLength - 最大长度
 * @returns {string} 截断后的文本
 */
function safeUnicodeTruncate(text, maxLength) {
  if (!text || text.length <= maxLength) {
    return text;
  }
  
  // 使用Array.from来正确处理Unicode字符
  const chars = Array.from(text);
  if (chars.length <= maxLength) {
    return text;
  }
  
  return chars.slice(0, maxLength).join('') + '...';
}

/**
 * 对图片进行排序，免费图片优先
 * @param {Array} images - 图片数组
 * @returns {Array} 排序后的图片数组
 */
function sortImagesByFreeFirst(images) {
  if (!Array.isArray(images) || images.length === 0) {
    return images;
  }
  
  return [...images].sort((a, b) => {
    const aIsFree = typeof a === 'object' && a.isFreePreview === true;
    const bIsFree = typeof b === 'object' && b.isFreePreview === true;
    if (aIsFree && !bIsFree) return -1;
    if (!aIsFree && bIsFree) return 1;
    return 0;
  });
}

/**
 * 保护帖子列表项中的付费内容
 * @param {Object} post - 帖子对象
 * @param {Object} options - 选项
 * @param {Object} options.paymentSetting - 付费设置
 * @param {boolean} options.isAuthor - 是否为作者
 * @param {boolean} options.hasPurchased - 是否已购买
 * @param {Object} options.videoData - 视频数据
 * @param {Array} options.imageUrls - 图片URL列表
 */
function protectPostListItem(post, options) {
  const { paymentSetting, isAuthor, hasPurchased, videoData, imageUrls } = options;
  
  const paid = isPaidContent(paymentSetting);
  const protect = shouldProtectContent(paymentSetting, isAuthor, hasPurchased);
  
  if (post.type === 2) {
    // 视频笔记
    post.images = videoData && videoData.cover_url ? [videoData.cover_url] : [];
    // 保护付费视频：不返回video_url
    post.video_url = protect ? null : (videoData ? videoData.video_url : null);
    post.image = videoData && videoData.cover_url ? videoData.cover_url : null;
  } else {
    // 图文笔记
    let images = imageUrls || [];
    
    // 对图片进行排序：免费图片优先显示
    images = sortImagesByFreeFirst(images);
    
    // 获取第一张图片作为封面（排序后免费图片优先）
    let coverImage = null;
    if (images.length > 0) {
      const firstImg = images[0];
      coverImage = typeof firstImg === 'object' ? firstImg.url : firstImg;
    }
    
    // 保护付费图片
    if (protect) {
      // 优先使用isFreePreview属性过滤，如果图片是对象格式
      const hasIsFreePreviewProp = images.some(img => typeof img === 'object' && img.isFreePreview !== undefined);
      
      if (hasIsFreePreviewProp) {
        // 使用isFreePreview属性过滤，只保留标记为免费的图片
        images = images.filter(img => typeof img === 'object' && img.isFreePreview === true);
        // 如果所有图片都是付费的，返回空数组
        // 前端会根据paymentOverlay显示模糊封面图作为预览
        if (images.length === 0) {
          images = [];
        }
      } else {
        // 旧格式：使用freePreviewCount
        const freeCount = getFreePreviewCount(paymentSetting);
        const minPreview = Math.max(1, freeCount);
        if (images.length > minPreview) {
          images = images.slice(0, minPreview);
        }
      }
    }
    post.images = images;
    // 封面图始终显示第一张（排序后的免费图片优先）
    post.image = coverImage;
  }
  
  post.isPaidContent = paid;
}

/**
 * 保护帖子详情中的付费内容
 * @param {Object} post - 帖子对象
 * @param {Object} options - 选项
 * @param {number} options.freePreviewCount - 免费预览数量（旧格式兼容）
 */
function protectPostDetail(post, options = {}) {
  // 处理图片：优先使用isFreePreview属性，否则使用freePreviewCount
  if (post.images && post.images.length > 0) {
    // 首先对图片进行排序：免费图片优先显示
    post.images = sortImagesByFreeFirst(post.images);
    
    const hasIsFreePreviewProp = post.images.some(img => typeof img === 'object' && img.isFreePreview !== undefined);
    
    if (hasIsFreePreviewProp) {
      // 计算付费图片数量（需要在过滤前计算）
      const paidImagesCount = post.images.filter(img => typeof img === 'object' && img.isFreePreview === false).length;
      const totalImagesCount = post.images.length;
      
      // 保存总图片数和付费图片数，供前端显示解锁提示
      post.totalImagesCount = totalImagesCount;
      post.hiddenPaidImagesCount = paidImagesCount;
      
      console.log(`🔧 [paidContentHelper] protectPostDetail - 总图片: ${totalImagesCount}, 付费图片: ${paidImagesCount}`);
      
      // 使用isFreePreview属性过滤，只保留标记为免费的图片
      post.images = post.images.filter(img => typeof img === 'object' && img.isFreePreview === true);
    } else {
      // 旧格式：限制图片数量为免费预览数量
      const freePreviewCount = options.freePreviewCount || 0;
      const totalImagesCount = post.images.length;
      post.totalImagesCount = totalImagesCount;
      post.hiddenPaidImagesCount = Math.max(0, totalImagesCount - freePreviewCount);
      
      if (post.images.length > freePreviewCount) {
        post.images = post.images.slice(0, freePreviewCount);
      }
    }
  }
  
  // 隐藏视频URL（只保留封面图用于预览）
  if (post.type === 2) {
    post.video_url = null;
    if (post.videos) {
      post.videos = post.videos.map(v => ({ cover_url: v.cover_url, video_url: null }));
    }
  }
  
  // 隐藏附件
  post.attachment = null;
  
  // 安全截断内容文本
  if (post.content && Array.from(post.content).length > PAID_CONTENT.CONTENT_PREVIEW_LENGTH) {
    post.content = safeUnicodeTruncate(post.content, PAID_CONTENT.CONTENT_PREVIEW_LENGTH);
    post.contentTruncated = true;
  }
}

module.exports = {
  isPaidContent,
  shouldProtectContent,
  getFreePreviewCount,
  safeUnicodeTruncate,
  protectPostListItem,
  protectPostDetail
};
