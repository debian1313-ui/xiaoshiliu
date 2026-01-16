/**
 * 汐社校园图文社区 - Express后端服务
 * 
 * @author ZTMYO
 * @github https://github.com/ZTMYO
 * @description 基于Express框架的图文社区后端API服务
 * @version v1.3.0
 * @license GPLv3
 */

// Add BigInt serialization support for JSON.stringify BEFORE any other imports
// This is critical because Prisma returns BigInt for BIGINT columns
// and JavaScript's JSON.stringify doesn't know how to serialize BigInt
if (typeof BigInt.prototype.toJSON !== 'function') {
  BigInt.prototype.toJSON = function() {
    // Convert to number if it's safe, otherwise to string
    const num = Number(this);
    if (Number.isSafeInteger(num)) {
      return num;
    }
    return this.toString();
  };
}

const express = require('express');
const path = require('path');
const cors = require('cors');
const { execSync } = require('child_process');
const config = require('./config/config');
const { HTTP_STATUS, RESPONSE_CODES } = require('./constants');
const prisma = require('./utils/prisma');
const { initQueueService, closeQueueService, cleanupExpiredBrowsingHistory } = require('./utils/queueService');

// 加载环境变量
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

// 定时清理过期浏览历史的间隔（1小时）
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
let cleanupTimer = null;

// 默认管理员账户配置
// 用户名: admin
// 密码: 123456 (SHA-256加密后的值)
const DEFAULT_ADMIN = {
  username: 'admin',
  // SHA-256 hash of '123456'
  passwordHash: '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92'
};

// 导入路由模块
const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const postsRoutes = require('./routes/posts');
const commentsRoutes = require('./routes/comments');
const likesRoutes = require('./routes/likes');
const tagsRoutes = require('./routes/tags');
const searchRoutes = require('./routes/search');
const notificationsRoutes = require('./routes/notifications');
const systemNotificationsRoutes = require('./routes/systemNotifications');
const uploadRoutes = require('./routes/upload');
const statsRoutes = require('./routes/stats');
const adminRoutes = require('./routes/admin');
const balanceRoutes = require('./routes/balance');

const app = express();

// 中间件配置
// CORS配置
const corsOptions = {
  origin: [
    'http://localhost:5173',
    'http://localhost:3001'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));  // 显式处理OPTIONS请求
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 静态文件服务 - 提供uploads目录的文件访问
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 健康检查路由
app.get('/api/health', (req, res) => {
  res.status(HTTP_STATUS.OK).json({
    code: RESPONSE_CODES.SUCCESS,
    message: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// 路由配置
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/posts', postsRoutes);
app.use('/api/comments', commentsRoutes);
app.use('/api/likes', likesRoutes);
app.use('/api/tags', tagsRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/system-notifications', systemNotificationsRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/balance', balanceRoutes);

// 错误处理中间件
app.use((err, req, res, next) => {
  console.error('服务器错误:', err);
  res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '服务器内部错误' });
});

// 404 处理
app.use('*', (req, res) => {
  res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '接口不存在' });
});

/**
 * 执行 Prisma db push 命令同步数据库表结构
 * 当环境变量 AUTO_DB_PUSH=true 时自动执行
 */
async function runPrismaDbPush() {
  if (process.env.AUTO_DB_PUSH !== 'true') {
    return;
  }

  console.log('● 自动执行 Prisma db push...');
  
  try {
    execSync('npx prisma db push --skip-generate', {
      cwd: __dirname,
      stdio: 'inherit'
    });
    console.log('● Prisma db push 完成');
  } catch (error) {
    console.error('● Prisma db push 失败:', error.message);
    throw error;
  }
}

/**
 * 检查并创建默认管理员账户
 * 如果管理员表为空，则创建默认管理员
 */
async function ensureDefaultAdmin() {
  try {
    // 检查管理员表是否有数据
    const adminCount = await prisma.admin.count();
    
    if (adminCount === 0) {
      console.log('● 未检测到管理员账户，正在创建默认管理员...');
      
      await prisma.admin.create({
        data: {
          username: DEFAULT_ADMIN.username,
          password: DEFAULT_ADMIN.passwordHash
        }
      });
      
      console.log(`● 默认管理员账户创建成功 (用户名: ${DEFAULT_ADMIN.username})`);
    }
  } catch (error) {
    console.error('● 创建默认管理员失败:', error.message);
    // 不抛出错误，允许应用继续启动
  }
}

/**
 * Prisma 数据库连接验证和表结构检查
 * 在程序启动时自动验证数据库连接和表结构
 */
async function validatePrismaConnection() {
  try {
    // 如果启用了自动 db push，先执行
    await runPrismaDbPush();

    // 测试数据库连接
    await prisma.$connect();
    console.log('● Prisma ORM 数据库连接成功');
    
    // 验证核心表结构是否存在（通过简单查询验证）
    const tables = [
      { name: 'users', model: prisma.user },
      { name: 'posts', model: prisma.post },
      { name: 'comments', model: prisma.comment },
      { name: 'notifications', model: prisma.notification },
      { name: 'admin', model: prisma.admin }
    ];
    
    let validTables = 0;
    for (const table of tables) {
      try {
        await table.model.count();
        validTables++;
      } catch (error) {
        console.warn(`  ⚠️ 表 ${table.name} 可能不存在或结构不匹配`);
      }
    }
    
    if (validTables === tables.length) {
      console.log(`● Prisma 表结构验证通过 (${validTables}/${tables.length} 核心表)`);
    } else {
      console.warn(`● Prisma 表结构部分验证 (${validTables}/${tables.length} 核心表)`);
      console.log('  提示: 运行 "npx prisma db push" 同步表结构');
    }
    
    // 检查并创建默认管理员
    await ensureDefaultAdmin();
    
    return true;
  } catch (error) {
    console.error('● Prisma 数据库连接失败:', error.message);
    console.log('  提示: 请检查 DATABASE_URL 环境变量配置');
    console.log('  提示: 运行 "npx prisma generate" 生成 Prisma Client');
    console.log('  提示: 运行 "npx prisma db push" 同步表结构');
    return false;
  }
}

// 启动服务器
const PORT = config.server.port;

// 先验证 Prisma 连接，然后启动服务器
validatePrismaConnection().then(async (connected) => {
  // 初始化异步队列服务
  await initQueueService();
  
  // 启动定时清理过期浏览历史任务（每小时执行一次）
  if (connected) {
    // 首次启动时执行一次清理
    cleanupExpiredBrowsingHistory();
    
    // 设置定时任务
    cleanupTimer = setInterval(() => {
      cleanupExpiredBrowsingHistory();
    }, CLEANUP_INTERVAL_MS);
    
    console.log('● 浏览历史定时清理任务已启动（每小时执行）');
  }
  
  app.listen(PORT, () => {
    console.log(`● 服务器运行在端口 ${PORT}`);
    console.log(`● 环境: ${config.server.env}`);
    if (!connected) {
      console.warn('● 警告: 数据库连接失败，部分功能可能不可用');
    }
  });
});

// 优雅关闭 - 断开 Prisma 连接和队列服务
process.on('beforeExit', async () => {
  // 清除定时器
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
  }
  await closeQueueService();
  await prisma.$disconnect();
});

module.exports = app;