const prisma = require('./prisma');

// Mapping from table names to Prisma model names
const tableToModel = {
  'users': 'user',
  'posts': 'post',
  'comments': 'comment',
  'likes': 'like',
  'notifications': 'notification',
  'follows': 'follow',
  'collections': 'collection',
  'tags': 'tag',
  'categories': 'category',
  'audit': 'audit',
  'admin': 'admin'
};

/**
 * 获取表的记录总数
 * @param {string} table - 表名
 * @param {Object} where - Prisma where条件（可选）
 * @returns {Promise<number>} 记录总数
 */
async function getTableCount(table, where = {}) {
  try {
    const modelName = tableToModel[table] || table;
    const count = await prisma[modelName].count({ where });
    return count;
  } catch (error) {
    console.error(`获取${table}表记录数失败:`, error);
    throw error;
  }
}

/**
 * 获取多个表的统计信息
 * @param {Array} tables - 表配置数组，每个元素包含 {table, alias?, where?}
 * @returns {Promise<Object>} 统计结果对象
 */
async function getMultipleTableStats(tables) {
  try {
    const results = {};
    
    for (const config of tables) {
      const { table, alias, where = {} } = config;
      const count = await getTableCount(table, where);
      results[alias || table] = count;
    }
    
    return results;
  } catch (error) {
    console.error('获取多表统计信息失败:', error);
    throw error;
  }
}

/**
 * 获取分页查询的总数和数据
 * @param {string} table - 表名
 * @param {Object} options - 查询选项
 * @param {Object} options.where - Prisma where条件
 * @param {Object} options.select - Prisma select条件
 * @param {Object} options.orderBy - Prisma orderBy条件
 * @param {number} options.page - 页码
 * @param {number} options.limit - 每页数量
 * @returns {Promise<Object>} 包含total和data的对象
 */
async function getPaginatedData(table, options = {}) {
  const {
    where = {},
    select = undefined,
    orderBy = { id: 'desc' },
    page = 1,
    limit = 20
  } = options;
  
  try {
    const modelName = tableToModel[table] || table;
    const skip = (page - 1) * limit;
    
    // 获取总数和数据
    const [total, data] = await Promise.all([
      prisma[modelName].count({ where }),
      prisma[modelName].findMany({
        where,
        select,
        orderBy,
        skip,
        take: limit
      })
    ]);
    
    return {
      total,
      data,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    };
  } catch (error) {
    console.error('获取分页数据失败:', error);
    throw error;
  }
}

module.exports = {
  getTableCount,
  getMultipleTableStats,
  getPaginatedData
};