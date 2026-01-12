/**
 * Prisma Client Singleton
 * 
 * 根据 DATABASE_URL 自动选择对应的 Prisma schema 文件
 * - MySQL: 使用 schema.mysql.prisma
 * - PostgreSQL: 使用 schema.postgresql.prisma
 * 
 * 不会修改或覆盖任何 schema 文件，直接使用 --schema 参数指定
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
 * 根据数据库类型获取对应的 schema 文件路径
 */
function getSchemaPath(dbType) {
  if (dbType === 'mysql') {
    return fs.existsSync(MYSQL_SCHEMA) ? MYSQL_SCHEMA : null;
  } else if (dbType === 'postgresql') {
    return fs.existsSync(POSTGRES_SCHEMA) ? POSTGRES_SCHEMA : null;
  }
  return null;
}

/**
 * 获取当前生成的 Prisma Client 使用的数据库类型
 */
function getGeneratedClientType() {
  try {
    const generatedSchemaPath = path.resolve(__dirname, '..', 'node_modules', '.prisma', 'client', 'schema.prisma');
    if (fs.existsSync(generatedSchemaPath)) {
      const content = fs.readFileSync(generatedSchemaPath, 'utf-8');
      const providerMatch = content.match(/provider\s*=\s*"(mysql|postgresql)"/i);
      if (providerMatch) {
        return providerMatch[1].toLowerCase();
      }
    }
  } catch {
    // 忽略错误
  }
  return 'unknown';
}

/**
 * 使用指定的 schema 文件生成 Prisma Client
 */
function generatePrismaClient(schemaPath) {
  try {
    console.log(`✓ 使用 schema: ${path.basename(schemaPath)}`);
    console.log('✓ 正在生成 Prisma Client...');
    execSync(`npx prisma generate --schema="${schemaPath}"`, {
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

/**
 * 清除 Prisma Client 的 require 缓存
 */
function clearPrismaCache() {
  try {
    const prismaClientPath = require.resolve('@prisma/client');
    const prismaClientDir = path.dirname(prismaClientPath);
    Object.keys(require.cache).forEach(key => {
      if (key.startsWith(prismaClientDir) || key.includes('.prisma/client')) {
        delete require.cache[key];
      }
    });
  } catch {
    // 忽略错误
  }
}

// 在模块加载时进行检测
const targetDbType = detectDatabaseType();
const generatedClientType = getGeneratedClientType();
const schemaPath = getSchemaPath(targetDbType);

// 检查是否需要重新生成 Prisma Client
if (targetDbType !== 'unknown' && schemaPath) {
  if (generatedClientType !== targetDbType) {
    console.log(`\n⚠️  检测到数据库类型: ${targetDbType === 'mysql' ? 'MySQL' : 'PostgreSQL'}`);
    console.log(`⚠️  当前 Prisma Client: ${generatedClientType === 'unknown' ? '未生成' : generatedClientType}`);
    
    if (generatePrismaClient(schemaPath)) {
      clearPrismaCache();
    }
  }
} else if (targetDbType !== 'unknown' && !schemaPath) {
  console.error(`⚠️  找不到 ${targetDbType} 对应的 schema 文件`);
  console.error(`   请确保存在 prisma/schema.${targetDbType}.prisma 文件`);
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
