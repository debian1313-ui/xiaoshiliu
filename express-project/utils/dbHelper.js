/**
 * 通用数据库操作工具
 * 使用 Prisma ORM 进行数据库操作
 */
const prisma = require('./prisma')

// Mapping from SQL table names to Prisma model names
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
  'admin': 'admin',
  'post_images': 'postImage',
  'post_videos': 'postVideo',
  'post_tags': 'postTag',
  'post_attachments': 'postAttachment',
  'post_payment_settings': 'postPaymentSetting',
  'user_sessions': 'userSession',
  'user_points': 'userPoints',
  'user_purchased_content': 'userPurchasedContent',
  'points_log': 'pointsLog'
};

/**
 * Get the Prisma model name for a given table name
 * @param {string} table - Table name
 * @returns {string} Prisma model name
 */
function getModelName(table) {
  return tableToModel[table] || table;
}

/**
 * 检查记录是否存在
 * @param {string} table - 表名 (对应 Prisma model 名称)
 * @param {string} field - 字段名
 * @param {*} value - 字段值
 * @returns {Promise<boolean>} 是否存在
 */
async function recordExists(table, field, value) {
  const modelName = getModelName(table);
  const count = await prisma[modelName].count({
    where: { [field]: value }
  })
  return count > 0
}

/**
 * 检查多个记录是否存在
 * @param {string} table - 表名
 * @param {string} field - 字段名
 * @param {Array} values - 字段值数组
 * @returns {Promise<Object>} {existingCount: number, missingValues: Array}
 */
async function recordsExist(table, field, values) {
  if (!values || values.length === 0) {
    return { existingCount: 0, missingValues: [] }
  }

  const modelName = getModelName(table);
  const result = await prisma[modelName].findMany({
    where: { [field]: { in: values } },
    select: { [field]: true }
  })

  const existingValues = result.map(row => row[field])
  const missingValues = values.filter(value => !existingValues.includes(value))

  return {
    existingCount: existingValues.length,
    missingValues
  }
}

/**
 * 检查唯一性约束
 * @param {string} table - 表名
 * @param {string} field - 字段名
 * @param {*} value - 字段值
 * @param {number} excludeId - 排除的ID（用于更新操作）
 * @returns {Promise<boolean>} 是否唯一
 */
async function isUnique(table, field, value, excludeId = null) {
  const modelName = getModelName(table);
  const where = { [field]: value }
  
  if (excludeId) {
    where.id = { not: BigInt(excludeId) }
  }

  const count = await prisma[modelName].count({ where })
  return count === 0
}

/**
 * 创建记录
 * @param {string} table - 表名
 * @param {Object} data - 数据对象
 * @returns {Promise<number>} 插入的ID
 */
async function createRecord(table, data) {
  const modelName = getModelName(table);
  const result = await prisma[modelName].create({ data })
  return Number(result.id)
}

/**
 * 更新记录
 * @param {string} table - 表名
 * @param {number} id - 记录ID
 * @param {Object} data - 更新数据
 * @returns {Promise<number>} 影响的行数
 */
async function updateRecord(table, id, data) {
  const modelName = getModelName(table);
  try {
    await prisma[modelName].update({
      where: { id: BigInt(id) },
      data
    })
    return 1
  } catch (error) {
    if (error.code === 'P2025') {
      return 0 // Record not found
    }
    throw error
  }
}

/**
 * 删除记录
 * @param {string} table - 表名
 * @param {number} id - 记录ID
 * @returns {Promise<number>} 影响的行数
 */
async function deleteRecord(table, id) {
  const modelName = getModelName(table);
  try {
    await prisma[modelName].delete({
      where: { id: BigInt(id) }
    })
    return 1
  } catch (error) {
    if (error.code === 'P2025') {
      return 0 // Record not found
    }
    throw error
  }
}

/**
 * 批量删除记录
 * @param {string} table - 表名
 * @param {Array} ids - ID数组
 * @returns {Promise<number>} 影响的行数
 */
async function deleteRecords(table, ids) {
  if (!ids || ids.length === 0) {
    return 0
  }

  const modelName = getModelName(table);
  const result = await prisma[modelName].deleteMany({
    where: { id: { in: ids.map(id => BigInt(id)) } }
  })

  return result.count
}

/**
 * 获取记录详情
 * @param {string} table - 表名
 * @param {number} id - 记录ID
 * @param {string} fields - 要查询的字段，默认为* (在 Prisma 中忽略)
 * @returns {Promise<Object|null>} 记录对象或null
 */
async function getRecord(table, id, fields = '*') {
  const modelName = getModelName(table);
  const result = await prisma[modelName].findUnique({
    where: { id: BigInt(id) }
  })

  return result
}

/**
 * 获取分页记录列表
 * @param {string} table - 表名
 * @param {Object} options - 查询选项
 * @param {number} options.page - 页码
 * @param {number} options.limit - 每页数量
 * @param {Object} options.where - WHERE条件 (Prisma格式)
 * @param {Object} options.orderBy - 排序字段 (Prisma格式)
 * @param {Object} options.select - 查询字段 (Prisma格式)
 * @returns {Promise<Object>} {data: Array, total: number, page: number, limit: number}
 */
async function getRecords(table, options = {}) {
  const {
    page = 1,
    limit = 20,
    where = {},
    orderBy = { created_at: 'desc' },
    select = undefined
  } = options

  const modelName = getModelName(table);
  const skip = (page - 1) * limit

  // 获取总数
  const total = await prisma[modelName].count({ where })

  // 获取数据
  const data = await prisma[modelName].findMany({
    where,
    orderBy,
    skip,
    take: limit,
    select
  })

  return {
    data,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit)
  }
}

/**
 * 执行级联删除
 * @param {Array} cascadeRules - 级联删除规则数组
 * @param {number|Array} targetIds - 目标ID或ID数组
 * @returns {Promise<void>}
 */
async function cascadeDelete(cascadeRules, targetIds) {
  const ids = Array.isArray(targetIds) ? targetIds : [targetIds]
  const bigIntIds = ids.map(id => BigInt(id))

  for (const rule of cascadeRules) {
    const { table, field } = rule
    await prisma[table].deleteMany({
      where: { [field]: { in: bigIntIds } }
    })
  }
}

module.exports = {
  recordExists,
  recordsExist,
  isUnique,
  createRecord,
  updateRecord,
  deleteRecord,
  deleteRecords,
  getRecord,
  getRecords,
  cascadeDelete
}