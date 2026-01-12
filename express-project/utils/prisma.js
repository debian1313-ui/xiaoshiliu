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
    const schemaPath = path.resolve(__dirname, '..', 'prisma', 'schema.prisma');
    const content = fs.readFileSync(schemaPath, 'utf-8');
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
 * 自动切换 schema 并重新生成 Prisma Client
 */
function autoSwitchSchema(targetType) {
  const prismaDir = path.resolve(__dirname, '..', 'prisma');
  const schemaFile = path.join(prismaDir, 'schema.prisma');
  const mysqlSchema = path.join(prismaDir, 'schema.mysql.prisma');
  const postgresSchema = path.join(prismaDir, 'schema.postgresql.prisma');
  
  let sourceFile;
  if (targetType === 'mysql') {
    sourceFile = fs.existsSync(mysqlSchema) ? mysqlSchema : null;
  } else if (targetType === 'postgresql') {
    sourceFile = fs.existsSync(postgresSchema) ? postgresSchema : null;
  }
  
  if (!sourceFile) {
    console.error(`⚠️  找不到 ${targetType} schema 文件`);
    return false;
  }
  
  // 备份当前 MySQL schema
  const currentType = getCurrentSchemaType();
  if (!fs.existsSync(mysqlSchema) && currentType === 'mysql' && fs.existsSync(schemaFile)) {
    fs.copyFileSync(schemaFile, mysqlSchema);
    console.log('✓ 已备份 MySQL schema');
  }
  
  // 复制目标 schema
  fs.copyFileSync(sourceFile, schemaFile);
  console.log(`✓ 已切换到 ${targetType === 'mysql' ? 'MySQL' : 'PostgreSQL'} schema`);
  
  // 重新生成 Prisma Client
  try {
    console.log('✓ 正在生成 Prisma Client...');
    execSync('npx prisma generate', {
      cwd: path.resolve(__dirname, '..'),
      stdio: 'pipe'
    });
    console.log('✓ Prisma Client 生成完成\n');
    return true;
  } catch (error) {
    console.error('⚠️  Prisma Client 生成失败');
    return false;
  }
}

// 自动检测并切换 schema
const targetDbType = detectDatabaseType();
const currentSchemaType = getCurrentSchemaType();

if (targetDbType !== 'unknown' && currentSchemaType !== 'unknown' && targetDbType !== currentSchemaType) {
  console.log(`\n⚠️  检测到数据库类型变更: ${currentSchemaType} -> ${targetDbType}`);
  autoSwitchSchema(targetDbType);
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
