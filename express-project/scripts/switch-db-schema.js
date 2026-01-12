#!/usr/bin/env node
/**
 * Prisma Schema 自动切换脚本
 * 
 * 根据 DATABASE_URL 环境变量自动选择正确的 Prisma schema 文件
 * - MySQL: 使用 schema.prisma (默认)
 * - PostgreSQL: 使用 schema.postgresql.prisma
 * 
 * 使用方法:
 *   node scripts/switch-db-schema.js
 *   npm run db:switch
 * 
 * @author Auto-generated
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const PRISMA_DIR = path.resolve(__dirname, '..', 'prisma');
const SCHEMA_FILE = path.join(PRISMA_DIR, 'schema.prisma');
const MYSQL_SCHEMA = path.join(PRISMA_DIR, 'schema.mysql.prisma');
const POSTGRES_SCHEMA = path.join(PRISMA_DIR, 'schema.postgresql.prisma');

/**
 * 安全地解析 DATABASE_URL 并提取协议
 * @param {string} databaseUrl 
 * @returns {string|null} 数据库协议 (mysql, postgresql, postgres) 或 null
 */
function parseDbProtocol(databaseUrl) {
  if (!databaseUrl || typeof databaseUrl !== 'string') {
    return null;
  }
  
  // 清理字符串：去除前后空白
  const cleanUrl = databaseUrl.trim();
  
  try {
    // 使用 URL 构造器解析
    const url = new URL(cleanUrl);
    // 协议包含冒号，如 "mysql:"，需要去掉
    return url.protocol.replace(':', '').toLowerCase();
  } catch {
    // 如果 URL 构造器失败，尝试简单的协议提取
    const protocolMatch = cleanUrl.match(/^([a-z][a-z0-9+.-]*):\/\//i);
    if (protocolMatch) {
      return protocolMatch[1].toLowerCase();
    }
    return null;
  }
}

/**
 * 检测数据库类型
 * @returns {'mysql' | 'postgresql' | 'unknown'}
 */
function detectDatabaseType() {
  const databaseUrl = process.env.DATABASE_URL || '';
  const protocol = parseDbProtocol(databaseUrl);
  
  if (protocol === 'mysql') {
    return 'mysql';
  } else if (protocol === 'postgresql' || protocol === 'postgres') {
    return 'postgresql';
  }
  
  return 'unknown';
}

/**
 * 安全地遮蔽 DATABASE_URL 中的敏感信息
 * @param {string} databaseUrl 
 * @returns {string} 遮蔽后的 URL
 */
function maskDatabaseUrl(databaseUrl) {
  if (!databaseUrl || typeof databaseUrl !== 'string') {
    return '(empty)';
  }
  
  try {
    const url = new URL(databaseUrl.trim());
    // 遮蔽用户名和密码
    if (url.username) {
      url.username = '***';
    }
    if (url.password) {
      url.password = '***';
    }
    return url.toString();
  } catch {
    // 如果 URL 解析失败，使用正则表达式遮蔽
    return databaseUrl.replace(/\/\/[^:]*:[^@]*@/, '//***:***@');
  }
}

/**
 * 获取当前 schema.prisma 使用的数据库类型
 * @returns {'mysql' | 'postgresql' | 'unknown'}
 */
function getCurrentSchemaType() {
  try {
    const content = fs.readFileSync(SCHEMA_FILE, 'utf-8');
    // 使用正则表达式匹配 provider 字段
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
 * 备份当前的 schema.prisma 为 schema.mysql.prisma (如果还没有备份)
 */
function backupMySQLSchema() {
  if (!fs.existsSync(MYSQL_SCHEMA) && fs.existsSync(SCHEMA_FILE)) {
    const currentType = getCurrentSchemaType();
    if (currentType === 'mysql') {
      fs.copyFileSync(SCHEMA_FILE, MYSQL_SCHEMA);
      console.log('✓ 已备份 MySQL schema 到 schema.mysql.prisma');
    }
  }
}

/**
 * 切换到指定的数据库 schema
 * @param {'mysql' | 'postgresql'} dbType 
 */
function switchSchema(dbType) {
  let sourceFile;
  
  if (dbType === 'mysql') {
    // 优先使用备份的 MySQL schema，否则检查当前 schema 是否已经是 MySQL
    if (fs.existsSync(MYSQL_SCHEMA)) {
      sourceFile = MYSQL_SCHEMA;
    } else {
      const currentType = getCurrentSchemaType();
      if (currentType === 'mysql') {
        console.log('✓ 当前已经是 MySQL schema，无需切换');
        return true;
      }
      console.error('✗ 找不到 MySQL schema 文件 (schema.mysql.prisma)');
      return false;
    }
  } else if (dbType === 'postgresql') {
    if (!fs.existsSync(POSTGRES_SCHEMA)) {
      console.error('✗ 找不到 PostgreSQL schema 文件 (schema.postgresql.prisma)');
      return false;
    }
    sourceFile = POSTGRES_SCHEMA;
  } else {
    console.error('✗ 不支持的数据库类型:', dbType);
    return false;
  }
  
  // 备份当前 MySQL schema (如果需要)
  backupMySQLSchema();
  
  // 复制目标 schema 到 schema.prisma
  fs.copyFileSync(sourceFile, SCHEMA_FILE);
  console.log(`✓ 已切换到 ${dbType === 'mysql' ? 'MySQL' : 'PostgreSQL'} schema`);
  
  return true;
}

/**
 * 主函数
 */
function main() {
  console.log('=== Prisma Schema 自动切换工具 ===\n');
  
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('✗ 错误: 未设置 DATABASE_URL 环境变量');
    console.log('请在 .env 文件中配置 DATABASE_URL');
    process.exit(1);
  }
  
  // 检测目标数据库类型
  const targetDbType = detectDatabaseType();
  console.log('DATABASE_URL:', maskDatabaseUrl(databaseUrl));
  console.log('检测到数据库类型:', targetDbType === 'mysql' ? 'MySQL' : targetDbType === 'postgresql' ? 'PostgreSQL' : '未知');
  
  if (targetDbType === 'unknown') {
    console.error('\n✗ 错误: 无法识别 DATABASE_URL 中的数据库类型');
    console.log('支持的格式:');
    console.log('  MySQL: mysql://USER:PASSWORD@HOST:PORT/DATABASE');
    console.log('  PostgreSQL: postgresql://USER:PASSWORD@HOST:PORT/DATABASE');
    process.exit(1);
  }
  
  // 检查当前 schema 类型
  const currentDbType = getCurrentSchemaType();
  console.log('当前 schema 类型:', currentDbType === 'mysql' ? 'MySQL' : currentDbType === 'postgresql' ? 'PostgreSQL' : '未知');
  
  // 如果类型相同，无需切换
  if (currentDbType === targetDbType) {
    console.log('\n✓ Schema 类型匹配，无需切换');
    process.exit(0);
  }
  
  // 切换 schema
  console.log('\n正在切换 schema...');
  const success = switchSchema(targetDbType);
  
  if (success) {
    console.log('\n=== 切换完成 ===');
    console.log('下一步操作:');
    console.log('  1. 运行 npx prisma generate 生成 Prisma Client');
    console.log('  2. 运行 npx prisma db push 同步数据库结构');
    console.log('  或者运行 npx prisma migrate dev 创建迁移文件');
    process.exit(0);
  } else {
    console.error('\n=== 切换失败 ===');
    process.exit(1);
  }
}

// 运行主函数
main();
