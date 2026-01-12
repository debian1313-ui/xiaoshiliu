/**
 * Prisma Client Singleton
 * 
 * 根据 DATABASE_URL 自动选择对应的 Prisma schema
 * - MySQL: 使用 schema.prisma
 * - PostgreSQL: 使用 schema.postgresql.prisma
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Add BigInt serialization support for JSON.stringify
if (typeof BigInt.prototype.toJSON !== 'function') {
  BigInt.prototype.toJSON = function() {
    const num = Number(this);
    if (Number.isSafeInteger(num)) {
      return num;
    }
    return this.toString();
  };
}

const PRISMA_DIR = path.resolve(__dirname, '..', 'prisma');
const SCHEMA_FILE = path.join(PRISMA_DIR, 'schema.prisma');
const MYSQL_SCHEMA = path.join(PRISMA_DIR, 'schema.mysql.prisma');
const POSTGRES_SCHEMA = path.join(PRISMA_DIR, 'schema.postgresql.prisma');

/**
 * 检测 DATABASE_URL 中的数据库类型
 */
function detectDatabaseType() {
  const databaseUrl = process.env.DATABASE_URL || '';
  if (databaseUrl.startsWith('mysql://')) {
    return 'mysql';
  } else if (databaseUrl.startsWith('postgresql://') || databaseUrl.startsWith('postgres://')) {
    return 'postgresql';
  }
  return 'unknown';
}

/**
 * 获取当前 schema.prisma 使用的数据库类型
 */
function getCurrentSchemaType() {
  try {
    const content = fs.readFileSync(SCHEMA_FILE, 'utf-8');
    const providerMatch = content.match(/provider\s*=\s*"(mysql|postgresql)"/i);
    if (providerMatch) {
      return providerMatch[1].toLowerCase();
    }
  } catch {
    // schema.prisma 不存在或读取失败
  }
  return 'unknown';
}

/**
 * 检查 Prisma Client 是否需要重新生成
 * 通过检查生成的 client 中的 provider 来判断
 */
function needsRegenerate(targetType) {
  try {
    // 检查生成的 Prisma Client 的 schema 信息
    const generatedSchemaPath = path.resolve(__dirname, '..', 'node_modules', '.prisma', 'client', 'schema.prisma');
    if (fs.existsSync(generatedSchemaPath)) {
      const content = fs.readFileSync(generatedSchemaPath, 'utf-8');
      const providerMatch = content.match(/provider\s*=\s*"(mysql|postgresql)"/i);
      if (providerMatch) {
        return providerMatch[1].toLowerCase() !== targetType;
      }
    }
    return true; // 如果找不到生成的 schema，需要重新生成
  } catch {
    return true;
  }
}

/**
 * 自动切换 schema 并重新生成 Prisma Client
 */
function autoSwitchSchema(targetType) {
  let sourceFile;
  if (targetType === 'mysql') {
    sourceFile = fs.existsSync(MYSQL_SCHEMA) ? MYSQL_SCHEMA : null;
  } else if (targetType === 'postgresql') {
    sourceFile = fs.existsSync(POSTGRES_SCHEMA) ? POSTGRES_SCHEMA : null;
  }
  
  if (!sourceFile) {
    console.error(`⚠️  找不到 ${targetType} schema 文件`);
    return false;
  }
  
  // 备份当前 MySQL schema（如果还没有备份）
  const currentType = getCurrentSchemaType();
  if (!fs.existsSync(MYSQL_SCHEMA) && currentType === 'mysql' && fs.existsSync(SCHEMA_FILE)) {
    fs.copyFileSync(SCHEMA_FILE, MYSQL_SCHEMA);
    console.log('✓ 已备份 MySQL schema');
  }
  
  // 复制目标 schema 到 schema.prisma
  fs.copyFileSync(sourceFile, SCHEMA_FILE);
  console.log(`✓ 已切换到 ${targetType === 'mysql' ? 'MySQL' : 'PostgreSQL'} schema`);
  
  return true;
}

/**
 * 生成 Prisma Client
 */
function generatePrismaClient() {
  try {
    console.log('✓ 正在生成 Prisma Client...');
    execSync('npx prisma generate', {
      cwd: path.resolve(__dirname, '..'),
      stdio: 'pipe'
    });
    console.log('✓ Prisma Client 生成完成\n');
    return true;
  } catch (error) {
    console.error('⚠️  Prisma Client 生成失败:', error.message);
    return false;
  }
}

// 在模块加载时进行检测和切换
const targetDbType = detectDatabaseType();
const currentSchemaType = getCurrentSchemaType();

// 检查是否需要切换 schema 文件
if (targetDbType !== 'unknown' && currentSchemaType !== 'unknown' && targetDbType !== currentSchemaType) {
  console.log(`\n⚠️  检测到数据库类型变更: ${currentSchemaType} -> ${targetDbType}`);
  autoSwitchSchema(targetDbType);
}

// 检查是否需要重新生成 Prisma Client
if (targetDbType !== 'unknown' && needsRegenerate(targetDbType)) {
  console.log(`\n⚠️  Prisma Client 与目标数据库类型不匹配，正在重新生成...`);
  if (generatePrismaClient()) {
    // 清除 require 缓存，确保加载新生成的 client
    const prismaClientPath = require.resolve('@prisma/client');
    const prismaClientDir = path.dirname(prismaClientPath);
    Object.keys(require.cache).forEach(key => {
      if (key.startsWith(prismaClientDir) || key.includes('.prisma/client')) {
        delete require.cache[key];
      }
    });
  }
}

// 加载 Prisma Client
const { PrismaClient } = require('@prisma/client');

const prisma = global.prisma || new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

if (process.env.NODE_ENV !== 'production') {
  global.prisma = prisma;
}

module.exports = prisma;
