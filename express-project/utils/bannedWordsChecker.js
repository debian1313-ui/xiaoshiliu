/**
 * 本地违禁词检查工具
 * 
 * @description 用于检查内容是否包含本地违禁词
 * 支持普通匹配和通配符匹配
 */

const { BANNED_WORD_TYPES } = require('../constants');

// 缓存违禁词列表，避免每次查询数据库
let bannedWordsCache = {
  [BANNED_WORD_TYPES.USERNAME]: [],
  [BANNED_WORD_TYPES.COMMENT]: [],
  [BANNED_WORD_TYPES.BIO]: []
};
let cacheLastUpdated = 0;
const CACHE_TTL = 60000; // 缓存60秒

/**
 * 将通配符模式转换为正则表达式
 * 支持 * (匹配任意字符) 和 ? (匹配单个字符)
 * @param {string} pattern - 通配符模式
 * @returns {RegExp} 正则表达式
 */
function wildcardToRegex(pattern) {
  // 转义特殊正则字符，但保留 * 和 ?
  let regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // 转义特殊字符
    .replace(/\*/g, '.*')  // * 匹配任意字符
    .replace(/\?/g, '.');  // ? 匹配单个字符
  
  return new RegExp(regexStr, 'i'); // 不区分大小写
}

/**
 * 从数据库刷新违禁词缓存
 * @param {Object} prisma - Prisma客户端实例
 */
async function refreshBannedWordsCache(prisma) {
  try {
    const words = await prisma.bannedWord.findMany({
      where: { enabled: true },
      select: { word: true, type: true, is_regex: true }
    });

    // 重置缓存
    bannedWordsCache = {
      [BANNED_WORD_TYPES.USERNAME]: [],
      [BANNED_WORD_TYPES.COMMENT]: [],
      [BANNED_WORD_TYPES.BIO]: []
    };

    // 按类型分组
    for (const item of words) {
      if (bannedWordsCache[item.type]) {
        bannedWordsCache[item.type].push({
          word: item.word,
          isRegex: item.is_regex,
          regex: item.is_regex ? wildcardToRegex(item.word) : null
        });
      }
    }

    cacheLastUpdated = Date.now();
    console.log(`✅ 违禁词缓存已刷新 - 用户名: ${bannedWordsCache[1].length}, 评论: ${bannedWordsCache[2].length}, 简介: ${bannedWordsCache[3].length}`);
  } catch (error) {
    console.error('刷新违禁词缓存失败:', error);
  }
}

/**
 * 确保缓存是最新的
 * @param {Object} prisma - Prisma客户端实例
 */
async function ensureCacheUpdated(prisma) {
  if (Date.now() - cacheLastUpdated > CACHE_TTL) {
    await refreshBannedWordsCache(prisma);
  }
}

/**
 * 检查内容是否包含违禁词
 * @param {Object} prisma - Prisma客户端实例
 * @param {string} content - 待检查内容
 * @param {number} type - 违禁词类型 (1:用户名 2:评论 3:简介)
 * @returns {Promise<{matched: boolean, matchedWords: string[]}>} 检查结果
 */
async function checkBannedWords(prisma, content, type) {
  if (!content || !content.trim()) {
    return { matched: false, matchedWords: [] };
  }

  await ensureCacheUpdated(prisma);

  const words = bannedWordsCache[type] || [];
  const matchedWords = [];
  const contentLower = content.toLowerCase();

  for (const item of words) {
    if (item.isRegex && item.regex) {
      // 使用正则表达式匹配
      if (item.regex.test(content)) {
        matchedWords.push(item.word);
      }
    } else {
      // 普通包含匹配（不区分大小写）
      if (contentLower.includes(item.word.toLowerCase())) {
        matchedWords.push(item.word);
      }
    }
  }

  return {
    matched: matchedWords.length > 0,
    matchedWords
  };
}

/**
 * 检查用户名是否包含违禁词
 * @param {Object} prisma - Prisma客户端实例
 * @param {string} username - 用户名
 * @returns {Promise<{matched: boolean, matchedWords: string[]}>}
 */
async function checkUsernameBannedWords(prisma, username) {
  return checkBannedWords(prisma, username, BANNED_WORD_TYPES.USERNAME);
}

/**
 * 检查评论是否包含违禁词
 * @param {Object} prisma - Prisma客户端实例
 * @param {string} comment - 评论内容
 * @returns {Promise<{matched: boolean, matchedWords: string[]}>}
 */
async function checkCommentBannedWords(prisma, comment) {
  return checkBannedWords(prisma, comment, BANNED_WORD_TYPES.COMMENT);
}

/**
 * 检查个人简介是否包含违禁词
 * @param {Object} prisma - Prisma客户端实例
 * @param {string} bio - 个人简介
 * @returns {Promise<{matched: boolean, matchedWords: string[]}>}
 */
async function checkBioBannedWords(prisma, bio) {
  return checkBannedWords(prisma, bio, BANNED_WORD_TYPES.BIO);
}

/**
 * 强制刷新缓存（在添加/修改/删除违禁词后调用）
 * @param {Object} prisma - Prisma客户端实例
 */
async function forceRefreshCache(prisma) {
  cacheLastUpdated = 0;
  await refreshBannedWordsCache(prisma);
}

/**
 * 获取违禁词审核结果格式
 * @param {string[]} matchedWords - 匹配的违禁词
 * @returns {Object} 审核结果对象
 */
function getBannedWordAuditResult(matchedWords) {
  return {
    passed: false,
    risk_level: 'high',
    score: 100,
    main_category: '本地违禁词',
    categories: ['banned_word'],
    matched_keywords: matchedWords,
    problem_sentences: [],
    suggestion: 'block',
    reason: `触发本地违禁词: ${matchedWords.join(', ')}`
  };
}

module.exports = {
  checkBannedWords,
  checkUsernameBannedWords,
  checkCommentBannedWords,
  checkBioBannedWords,
  refreshBannedWordsCache,
  forceRefreshCache,
  getBannedWordAuditResult,
  BANNED_WORD_TYPES
};
