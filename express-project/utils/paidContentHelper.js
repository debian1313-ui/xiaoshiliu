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
 * 获取免费预览数量（已废弃，保留向后兼容）
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
 * 保护帖子列表项中的付费内容
 * @param {Object} post - 帖子对象
 * @param {Object} options - 选项
 * @param {Object} options.paymentSetting - 付费设置
 * @param {boolean} options.isAuthor - 是否为作者
 * @param {boolean} options.hasPurchased - 是否已购买
 * @param {Object} options.videoData - 视频数据
 * @param {Array} options.imageData - 图片数据列表 [{url: string, is_free: number}]
 */
function protectPostListItem(post, options) {
  const { paymentSetting, isAuthor, hasPurchased, videoData, imageData } = options;
  
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
    let images = imageData || [];
    
    // 将图片数据按 is_free 排序：免费的在前
    images = [...images].sort((a, b) => (b.is_free || 0) - (a.is_free || 0));
    
    // 保护付费图片：只显示标记为免费的图片
    if (protect) {
      images = images.filter(img => img.is_free === 1);
    }
    
    // 提取URL列表
    const imageUrls = images.map(img => img.url || img.image_url);
    
    post.images = imageUrls;
    // 封面图：如果有图片则显示第一张（免费图片在前）
    post.image = imageUrls.length > 0 ? imageUrls[0] : null;
  }
  
  post.isPaidContent = paid;
}

/**
 * 保护帖子详情中的付费内容
 * @param {Object} post - 帖子对象
 * @param {Object} options - 选项
 * @param {Array} options.imageData - 图片数据列表 [{url: string, is_free: number}]
 */
function protectPostDetail(post, options = {}) {
  const imageData = options.imageData || [];
  
  // 将图片按 is_free 排序：免费的在前
  let sortedImages = [...imageData].sort((a, b) => (b.is_free || 0) - (a.is_free || 0));
  
  // 只显示标记为免费的图片
  const freeImages = sortedImages.filter(img => img.is_free === 1);
  post.images = freeImages.map(img => img.url || img.image_url);
  
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
