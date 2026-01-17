/**
 * 本地违禁词检查工具
 * 
 * @description 用于检查内容是否包含本地违禁词
 * 支持普通匹配和通配符匹配
 * 所有违禁词适用于所有内容类型（通用）
 */

// 缓存违禁词列表，避免每次查询数据库
let bannedWordsCache = [];
let cacheLastUpdated = 0;
const CACHE_TTL = 60000; // 缓存60秒

/**
 * 将通配符模式转换为正则表达式
 * 支持 * (匹配任意字符) 和 ? (匹配单个字符)
 * @param {string} pattern - 通配符模式
 * @returns {RegExp|null} 正则表达式，如果模式无效则返回null
 */
function wildcardToRegex(pattern) {
  // 限制模式长度以防止ReDoS
  if (!pattern || pattern.length > 100) {
    return null;
  }
  
  // 限制连续的通配符数量
  if (/\*{3,}/.test(pattern)) {
    return null;
  }
  
  try {
    // 转义特殊正则字符，但保留 * 和 ?
    let regexStr = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&') // 转义特殊字符
      .replace(/\*+/g, '.*?')  // * 匹配任意字符(非贪婪模式)
      .replace(/\?/g, '.');   // ? 匹配单个字符
    
    return new RegExp(regexStr, 'i'); // 不区分大小写
  } catch (e) {
    console.error('无效的正则模式:', pattern, e.message);
    return null;
  }
}

/**
 * 从数据库刷新违禁词缓存
 * @param {Object} prisma - Prisma客户端实例
 */
async function refreshBannedWordsCache(prisma) {
  try {
    const words = await prisma.bannedWord.findMany({
      where: { enabled: true },
      select: { word: true, is_regex: true, category_id: true }
    });

    // 重置缓存为统一列表
    bannedWordsCache = words.map(item => ({
      word: item.word,
      isRegex: item.is_regex,
      regex: item.is_regex ? wildcardToRegex(item.word) : null,
      categoryId: item.category_id
    }));

    cacheLastUpdated = Date.now();
    console.log(`✅ 违禁词缓存已刷新 - 共 ${bannedWordsCache.length} 个违禁词`);
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
 * 检查内容是否包含违禁词（通用，适用于所有内容类型）
 * @param {Object} prisma - Prisma客户端实例
 * @param {string} content - 待检查内容
 * @returns {Promise<{matched: boolean, matchedWords: string[]}>} 检查结果
 */
async function checkBannedWords(prisma, content) {
  if (!content || !content.trim()) {
    return { matched: false, matchedWords: [] };
  }

  await ensureCacheUpdated(prisma);

  const matchedWords = [];
  const contentLower = content.toLowerCase();

  for (const item of bannedWordsCache) {
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
  return checkBannedWords(prisma, username);
}

/**
 * 检查评论是否包含违禁词
 * @param {Object} prisma - Prisma客户端实例
 * @param {string} comment - 评论内容
 * @returns {Promise<{matched: boolean, matchedWords: string[]}>}
 */
async function checkCommentBannedWords(prisma, comment) {
  return checkBannedWords(prisma, comment);
}

/**
 * 检查个人简介是否包含违禁词
 * @param {Object} prisma - Prisma客户端实例
 * @param {string} bio - 个人简介
 * @returns {Promise<{matched: boolean, matchedWords: string[]}>}
 */
async function checkBioBannedWords(prisma, bio) {
  return checkBannedWords(prisma, bio);
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
  getBannedWordAuditResult
};
