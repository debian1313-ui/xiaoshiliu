/**
 * 应用常量定义
 */

// HTTP状态码
const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_SERVER_ERROR: 500
};

// 响应码
const RESPONSE_CODES = {
  SUCCESS: 200,
  ERROR: 500,
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409
};

// 错误消息
const ERROR_MESSAGES = {
  VALIDATION_FAILED: '数据验证失败',
  UNAUTHORIZED: '未授权访问',
  FORBIDDEN: '权限不足',
  NOT_FOUND: '资源不存在',
  DUPLICATE_ENTRY: '数据已存在',
  DATABASE_ERROR: '数据库操作失败',
  UPLOAD_FAILED: '图片上传失败',
  INVALID_TOKEN: '无效的令牌',
  TOKEN_EXPIRED: '令牌已过期',
  INTERNAL_SERVER_ERROR: '服务器内部错误',
  BAD_REQUEST: '请求参数错误',
  REQUEST_FAILED: '请求失败',
  SESSION_EXPIRED: '会话已过期',
  NETWORK_ERROR: '网络连接错误',
  REQUEST_CONFIG_ERROR: '请求配置错误'
};

// 付费内容相关常量
const PAID_CONTENT = {
  CONTENT_PREVIEW_LENGTH: 100 // 付费内容预览的文本长度限制
};

// 审核类型常量
const AUDIT_TYPES = {
  PERSONAL: 1,    // 个人认证
  BUSINESS: 2,    // 企业认证
  COMMENT: 3,     // 评论审核
  NICKNAME: 4,    // 昵称审核
  BIO: 5          // 个人简介审核
};

// 审核状态常量
const AUDIT_STATUS = {
  PENDING: 0,   // 待审核
  APPROVED: 1,  // 已通过
  REJECTED: 2   // 已拒绝
};

// 违禁词类型常量
const BANNED_WORD_TYPES = {
  USERNAME: 1,  // 用户名/昵称
  COMMENT: 2,   // 评论内容
  BIO: 3        // 个人简介
};

module.exports = {
  HTTP_STATUS,
  RESPONSE_CODES,
  ERROR_MESSAGES,
  PAID_CONTENT,
  AUDIT_TYPES,
  AUDIT_STATUS,
  BANNED_WORD_TYPES
};