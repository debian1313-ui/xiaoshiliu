/**
 * 内容审核服务 - 通过Dify API进行关键词审核
 * 
 * @description 使用Dify API对评论、用户名称等内容进行审核
 */

// 安全加载配置，防止配置模块加载失败导致应用崩溃
let auditConfig = { enabled: false, apiUrl: '', apiKey: '' };
try {
  const config = require('../config/config');
  auditConfig = config.contentAudit || { enabled: false, apiUrl: '', apiKey: '' };
} catch (error) {
  console.error('加载内容审核配置失败:', error.message);
}

/**
 * 默认的审核通过结果
 * @returns {Object} 默认通过结果
 */
function getDefaultPassResult(reason = '审核通过') {
  return {
    passed: true,
    risk_level: 'low',
    score: 0,
    main_category: '',
    categories: [],
    matched_keywords: [],
    problem_sentences: [],
    suggestion: 'pass',
    reason
  };
}

/**
 * 审核结果类型
 * @typedef {Object} AuditResult
 * @property {boolean} passed - 是否通过审核
 * @property {string} risk_level - 风险等级 (low, medium, high)
 * @property {number} score - 风险分数
 * @property {string} main_category - 主要违规类别
 * @property {string[]} categories - 违规类别列表
 * @property {string[]} matched_keywords - 匹配到的关键词
 * @property {string[]} problem_sentences - 问题句子
 * @property {string} suggestion - 处理建议 (pass, review, block)
 * @property {string} reason - 审核原因说明
 */

/**
 * 调用Dify API进行内容审核
 * @param {string} content - 待审核内容
 * @param {string} userId - 用户ID (用于Dify API的user参数)
 * @returns {Promise<AuditResult>} 审核结果
 */
async function auditContent(content, userId = 'system') {
  // 如果未启用内容审核或未配置API密钥，直接返回通过
  if (!auditConfig || !auditConfig.enabled || !auditConfig.apiKey) {
    return getDefaultPassResult('内容审核未启用');
  }

  try {
    const response = await fetch(auditConfig.apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${auditConfig.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        inputs: {},
        query: content,
        response_mode: 'blocking',
        conversation_id: '',
        user: userId,
        files: []
      })
    });

    if (!response.ok) {
      console.error('Dify API请求失败:', response.status, response.statusText);
      // API调用失败时，默认通过以避免阻塞正常功能
      return getDefaultPassResult('API请求失败，默认通过');
    }

    const data = await response.json();
    
    // 解析Dify返回的答案
    // Dify API返回格式: { answer: "JSON字符串", ... }
    let auditResult;
    try {
      // answer可能是JSON字符串，需要解析
      if (data.answer) {
        auditResult = typeof data.answer === 'string' ? JSON.parse(data.answer) : data.answer;
      } else {
        // 如果没有answer字段，尝试直接使用返回数据
        auditResult = data;
      }
    } catch (parseError) {
      console.error('解析Dify返回结果失败:', parseError);
      // 解析失败时，默认通过
      return getDefaultPassResult('返回结果解析失败，默认通过');
    }

    // 返回标准化的审核结果
    return {
      passed: auditResult.passed !== undefined ? auditResult.passed : true,
      risk_level: auditResult.risk_level || 'low',
      score: auditResult.score || 0,
      main_category: auditResult.main_category || '',
      categories: auditResult.categories || [],
      matched_keywords: auditResult.matched_keywords || [],
      problem_sentences: auditResult.problem_sentences || [],
      suggestion: auditResult.suggestion || 'pass',
      reason: auditResult.reason || ''
    };
  } catch (error) {
    console.error('内容审核服务异常:', error);
    // 异常情况下默认通过
    return getDefaultPassResult('审核服务异常，默认通过');
  }
}

/**
 * 审核评论内容
 * @param {string} content - 评论内容
 * @param {string|number} userId - 用户ID
 * @returns {Promise<AuditResult>} 审核结果
 */
async function auditComment(content, userId) {
  return auditContent(content, `user-${userId}`);
}

/**
 * 审核用户昵称
 * @param {string} nickname - 用户昵称
 * @param {string|number} userId - 用户ID
 * @returns {Promise<AuditResult>} 审核结果
 */
async function auditNickname(nickname, userId) {
  return auditContent(nickname, `user-${userId}`);
}

/**
 * 审核个人简介内容
 * @param {string} bio - 个人简介内容
 * @param {number|string} userId - 用户ID
 * @returns {Promise<Object>} 审核结果
 */
async function auditBio(bio, userId) {
  return auditContent(bio, `user-bio-${userId}`);
}

/**
 * 检查内容审核是否启用
 * @returns {boolean} 是否启用
 */
function isAuditEnabled() {
  return auditConfig.enabled && !!auditConfig.apiKey;
}

module.exports = {
  auditContent,
  auditComment,
  auditNickname,
  auditBio,
  isAuditEnabled
};
