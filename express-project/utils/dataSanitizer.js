/**
 * 数据脱敏工具模块
 * 用于过滤和脱敏API响应中的敏感数据
 */

// 用户敏感字段列表（这些字段不应该被返回给普通用户）
const USER_SENSITIVE_FIELDS = [
  'password',
  'oauth2_id',
  'is_active'  // 仅管理员需要查看
];

// 仅自己可见的用户字段（其他用户不应该看到）
const USER_PRIVATE_FIELDS = [
  'email'
];

// 需要部分脱敏的字段
const FIELDS_TO_MASK = {
  email: maskEmail,
  id_card: maskIdCard,
  contact_phone: maskPhone
};

/**
 * 邮箱脱敏处理
 * 例如：example@gmail.com -> ex***le@gmail.com
 * @param {string} email - 原始邮箱
 * @returns {string} - 脱敏后的邮箱
 */
function maskEmail(email) {
  if (!email || typeof email !== 'string') return '';
  
  const parts = email.split('@');
  if (parts.length !== 2) return '***';
  
  const [localPart, domain] = parts;
  if (localPart.length <= 2) {
    return `${localPart[0]}***@${domain}`;
  }
  
  const visibleLength = Math.min(2, Math.floor(localPart.length / 3));
  const start = localPart.substring(0, visibleLength);
  const end = localPart.substring(localPart.length - visibleLength);
  
  return `${start}***${end}@${domain}`;
}

/**
 * 身份证号码脱敏处理
 * 例如：110101199001011234 -> 1101***********1234
 * @param {string} idCard - 原始身份证号码
 * @returns {string} - 脱敏后的身份证号码
 */
function maskIdCard(idCard) {
  if (!idCard || typeof idCard !== 'string') return '';
  
  if (idCard.length < 8) return '***';
  
  const start = idCard.substring(0, 4);
  const end = idCard.substring(idCard.length - 4);
  
  return `${start}***${end}`;
}

/**
 * 手机号码脱敏处理
 * 例如：13800138000 -> 138****8000
 * @param {string} phone - 原始手机号码
 * @returns {string} - 脱敏后的手机号码
 */
function maskPhone(phone) {
  if (!phone || typeof phone !== 'string') return '';
  
  if (phone.length < 7) return '***';
  
  const start = phone.substring(0, 3);
  const end = phone.substring(phone.length - 4);
  
  return `${start}****${end}`;
}

/**
 * 移除用户对象中的敏感字段
 * @param {object} user - 用户对象
 * @param {object} options - 可选配置
 * @param {number|null} options.currentUserId - 当前登录用户的ID
 * @param {boolean} options.isAdmin - 是否为管理员
 * @param {boolean} options.includeMaskedEmail - 是否包含脱敏的邮箱
 * @returns {object} - 过滤后的用户对象
 */
function sanitizeUser(user, options = {}) {
  if (!user || typeof user !== 'object') return user;
  
  const { currentUserId = null, isAdmin = false, includeMaskedEmail = false } = options;
  
  // 创建用户对象的副本
  const sanitized = { ...user };
  
  // 移除敏感字段
  for (const field of USER_SENSITIVE_FIELDS) {
    delete sanitized[field];
  }
  
  // 处理私有字段（仅自己可见或管理员可见）
  const isOwner = currentUserId !== null && user.id === currentUserId;
  
  if (!isOwner && !isAdmin) {
    for (const field of USER_PRIVATE_FIELDS) {
      if (includeMaskedEmail && field === 'email' && sanitized.email) {
        // 如果需要显示脱敏的邮箱
        sanitized.email = maskEmail(sanitized.email);
      } else {
        delete sanitized[field];
      }
    }
  }
  
  return sanitized;
}

/**
 * 批量清理用户数组中的敏感字段
 * @param {array} users - 用户数组
 * @param {object} options - 可选配置
 * @returns {array} - 过滤后的用户数组
 */
function sanitizeUsers(users, options = {}) {
  if (!Array.isArray(users)) return users;
  
  return users.map(user => sanitizeUser(user, options));
}

/**
 * 清理笔记中嵌入的用户信息
 * @param {object} post - 笔记对象
 * @param {object} options - 可选配置
 * @returns {object} - 过滤后的笔记对象
 */
function sanitizePost(post, options = {}) {
  if (!post || typeof post !== 'object') return post;
  
  const sanitized = { ...post };
  
  // 如果笔记中嵌套了完整的用户对象
  if (sanitized.user && typeof sanitized.user === 'object') {
    sanitized.user = sanitizeUser(sanitized.user, options);
  }
  
  // 移除嵌入在笔记中的敏感用户字段
  // 这些字段通常来自JOIN查询
  for (const field of USER_SENSITIVE_FIELDS) {
    delete sanitized[field];
  }
  
  return sanitized;
}

/**
 * 批量清理笔记数组中的敏感数据
 * @param {array} posts - 笔记数组
 * @param {object} options - 可选配置
 * @returns {array} - 过滤后的笔记数组
 */
function sanitizePosts(posts, options = {}) {
  if (!Array.isArray(posts)) return posts;
  
  return posts.map(post => sanitizePost(post, options));
}

/**
 * 清理评论中的敏感数据
 * @param {object} comment - 评论对象
 * @param {object} options - 可选配置
 * @returns {object} - 过滤后的评论对象
 */
function sanitizeComment(comment, options = {}) {
  if (!comment || typeof comment !== 'object') return comment;
  
  const sanitized = { ...comment };
  
  // 移除评论中可能包含的敏感用户字段
  for (const field of USER_SENSITIVE_FIELDS) {
    delete sanitized[field];
  }
  
  return sanitized;
}

/**
 * 批量清理评论数组中的敏感数据
 * @param {array} comments - 评论数组
 * @param {object} options - 可选配置
 * @returns {array} - 过滤后的评论数组
 */
function sanitizeComments(comments, options = {}) {
  if (!Array.isArray(comments)) return comments;
  
  return comments.map(comment => sanitizeComment(comment, options));
}

/**
 * 清理通知中的敏感数据
 * @param {object} notification - 通知对象
 * @param {object} options - 可选配置
 * @returns {object} - 过滤后的通知对象
 */
function sanitizeNotification(notification, options = {}) {
  if (!notification || typeof notification !== 'object') return notification;
  
  const sanitized = { ...notification };
  
  // 移除通知中可能包含的敏感字段
  for (const field of USER_SENSITIVE_FIELDS) {
    delete sanitized[field];
  }
  
  return sanitized;
}

/**
 * 批量清理通知数组中的敏感数据
 * @param {array} notifications - 通知数组
 * @param {object} options - 可选配置
 * @returns {array} - 过滤后的通知数组
 */
function sanitizeNotifications(notifications, options = {}) {
  if (!Array.isArray(notifications)) return notifications;
  
  return notifications.map(notification => sanitizeNotification(notification, options));
}

module.exports = {
  // 脱敏函数
  maskEmail,
  maskIdCard,
  maskPhone,
  
  // 数据清理函数
  sanitizeUser,
  sanitizeUsers,
  sanitizePost,
  sanitizePosts,
  sanitizeComment,
  sanitizeComments,
  sanitizeNotification,
  sanitizeNotifications,
  
  // 导出敏感字段列表（供其他模块参考）
  USER_SENSITIVE_FIELDS,
  USER_PRIVATE_FIELDS
};
