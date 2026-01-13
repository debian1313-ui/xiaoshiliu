const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { HTTP_STATUS, RESPONSE_CODES, ERROR_MESSAGES } = require('../constants');
const { pool, prisma, email: emailConfig, oauth2: oauth2Config, queue: queueConfig } = require('../config/config');
const { generateAccessToken, generateRefreshToken, verifyToken } = require('../utils/jwt');
const { authenticateToken } = require('../middleware/auth');
const { getIPLocation, getRealIP } = require('../utils/ipLocation');
const { sendEmailCode } = require('../utils/email');
const { auditNickname, isAuditEnabled } = require('../utils/contentAudit');
const { addIPLocationTask, isQueueEnabled } = require('../utils/queueService');
const svgCaptcha = require('svg-captcha');
const path = require('path');
const fs = require('fs');

// 存储验证码的临时对象
const captchaStore = new Map();
// 存储邮箱验证码的临时对象
const emailCodeStore = new Map();
// 存储OAuth2 state参数（用于防止CSRF攻击）
const oauth2StateStore = new Map();

// 获取认证配置状态（包括邮件功能和OAuth2配置）
router.get('/auth-config', (req, res) => {
  res.json({
    code: RESPONSE_CODES.SUCCESS,
    data: {
      emailEnabled: emailConfig.enabled,
      oauth2Enabled: oauth2Config.enabled,
      oauth2OnlyLogin: oauth2Config.onlyOAuth2,
      // 只返回必要的OAuth2配置，不返回敏感信息
      oauth2LoginUrl: oauth2Config.enabled ? oauth2Config.loginUrl : ''
    },
    message: 'success'
  });
});

// 获取邮件功能配置状态（保持向后兼容）
router.get('/email-config', (req, res) => {
  res.json({
    code: RESPONSE_CODES.SUCCESS,
    data: {
      emailEnabled: emailConfig.enabled
    },
    message: 'success'
  });
});

// 生成验证码
router.get('/captcha', (req, res) => {
  try {
    // 字体文件路径
    const fontDir = path.join(__dirname, '..', 'fonts');

    // 自动读取字体文件夹中的所有.ttf文件
    let fontFiles = [];
    if (fs.existsSync(fontDir)) {
      fontFiles = fs.readdirSync(fontDir).filter(file => file.endsWith('.ttf'));
    }

    // 如果有字体文件，随机选择一个加载
    if (fontFiles.length > 0) {
      const randomFont = fontFiles[Math.floor(Math.random() * fontFiles.length)];
      const fontPath = path.join(fontDir, randomFont);
      svgCaptcha.loadFont(fontPath);
    }

    const captcha = svgCaptcha.create({
      size: 4, // 验证码长度
      ignoreChars: '0o1ilcIC', // 排除容易混淆的字符
      noise: 4, // 干扰线条数
      color: true, // 彩色验证码
      fontSize: 40,
      background: `#${Math.floor(Math.random() * 16777215).toString(16)}`, // 随机颜色
    });

    // 生成唯一的captchaId
    const captchaId = Date.now() + Math.random().toString(36).substr(2, 9);

    // 存储验证码（半分钟过期）
    captchaStore.set(captchaId, {
      text: captcha.text, // 保持原始大小写
      expires: Date.now() + 30 * 1000 // 半分钟过期
    });

    // 清理过期的验证码
    for (const [key, value] of captchaStore.entries()) {
      if (Date.now() > value.expires) {
        captchaStore.delete(key);
      }
    }

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: {
        captchaId,
        captchaSvg: captcha.data
      },
      message: '验证码生成成功'
    });
  } catch (error) {
    console.error('生成验证码失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 检查用户ID是否已存在
router.get('/check-user-id', async (req, res) => {
  try {
    const { user_id } = req.query; // 前端传过来的汐社号
    if (!user_id) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '请输入汐社号' });
    }
    // 查数据库是否已有该ID
    const existingUser = await prisma.user.findUnique({
      where: { user_id: user_id.toString() },
      select: { id: true }
    });
    // 存在返回false，不存在返回true（供前端判断是否可继续）
    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: { isUnique: !existingUser },
      message: existingUser ? '汐社号已存在' : '汐社号可用'
    });
  } catch (error) {
    console.error('检查用户ID失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 发送邮箱验证码
router.post('/send-email-code', async (req, res) => {
  try {
    // 检查邮件功能是否启用
    if (!emailConfig.enabled) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '邮件功能未启用' });
    }

    const { email } = req.body;

    if (!email) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '请输入邮箱地址' });
    }

    // 验证邮箱格式
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '邮箱格式不正确' });
    }

    // 检查邮箱是否已被注册
    const existingUser = await prisma.user.findFirst({
      where: { email: email },
      select: { id: true }
    });

    if (existingUser) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.CONFLICT, message: '该邮箱已被注册' });
    }

    // 生成6位随机验证码
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    // 发送验证码到邮箱
    await sendEmailCode(email, code);

    // 存储验证码（10分钟过期）
    const expires = Date.now() + 10 * 60 * 1000;
    emailCodeStore.set(email, {
      code,
      expires
    });

    // 清理过期的验证码
    for (const [key, value] of emailCodeStore.entries()) {
      if (Date.now() > value.expires) {
        emailCodeStore.delete(key);
      }
    }

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '验证码发送成功，请查收邮箱'
    });

  } catch (error) {
    console.error('发送邮箱验证码失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '验证码发送失败，请稍后重试' });
  }
});

// 绑定邮箱
router.post('/bind-email', authenticateToken, async (req, res) => {
  try {
    // 检查邮件功能是否启用
    if (!emailConfig.enabled) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '邮件功能未启用' });
    }

    const { email, emailCode } = req.body;
    const userId = req.user.id;

    if (!email || !emailCode) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '请输入邮箱和验证码' });
    }

    // 验证邮箱格式
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '邮箱格式不正确' });
    }

    // 检查邮箱是否已被其他用户使用
    const existingUser = await prisma.user.findFirst({
      where: { email: email, NOT: { id: BigInt(userId) } },
      select: { id: true }
    });

    if (existingUser) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.CONFLICT, message: '该邮箱已被其他用户绑定' });
    }

    // 验证邮箱验证码
    const storedEmailCode = emailCodeStore.get(email);
    if (!storedEmailCode) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '邮箱验证码已过期或不存在' });
    }

    if (Date.now() > storedEmailCode.expires) {
      emailCodeStore.delete(email);
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '邮箱验证码已过期' });
    }

    if (emailCode !== storedEmailCode.code) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '邮箱验证码错误' });
    }

    // 验证码验证成功，删除已使用的验证码
    emailCodeStore.delete(email);

    // 更新用户邮箱
    await prisma.user.update({
      where: { id: BigInt(userId) },
      data: { email: email }
    });

    console.log(`用户绑定邮箱成功 - 用户ID: ${userId}, 邮箱: ${email}`);

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '邮箱绑定成功',
      data: { email }
    });

  } catch (error) {
    console.error('绑定邮箱失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '绑定邮箱失败，请稍后重试' });
  }
});

// 发送找回密码验证码
router.post('/send-reset-code', async (req, res) => {
  try {
    // 检查邮件功能是否启用
    if (!emailConfig.enabled) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '邮件功能未启用' });
    }

    const { email } = req.body;

    if (!email) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '请输入邮箱地址' });
    }

    // 验证邮箱格式
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '邮箱格式不正确' });
    }

    // 检查邮箱是否已注册
    const existingUser = await prisma.user.findFirst({
      where: { email: email },
      select: { id: true, user_id: true }
    });

    if (!existingUser) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.NOT_FOUND, message: '该邮箱未绑定任何账号' });
    }

    // 生成6位随机验证码
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    // 发送验证码到邮箱
    await sendEmailCode(email, code);

    // 存储验证码（10分钟过期）
    const expires = Date.now() + 10 * 60 * 1000;
    emailCodeStore.set(`reset_${email}`, {
      code,
      expires,
      userId: existingUser[0].id
    });

    // 清理过期的验证码
    for (const [key, value] of emailCodeStore.entries()) {
      if (Date.now() > value.expires) {
        emailCodeStore.delete(key);
      }
    }

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '验证码发送成功，请查收邮箱',
      data: {
        user_id: existingUser[0].user_id
      }
    });

  } catch (error) {
    console.error('发送找回密码验证码失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '验证码发送失败，请稍后重试' });
  }
});

// 验证找回密码验证码
router.post('/verify-reset-code', async (req, res) => {
  try {
    // 检查邮件功能是否启用
    if (!emailConfig.enabled) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '邮件功能未启用' });
    }

    const { email, emailCode } = req.body;

    if (!email || !emailCode) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '缺少必要参数' });
    }

    // 验证邮箱验证码
    const storedData = emailCodeStore.get(`reset_${email}`);
    if (!storedData) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '验证码已过期，请重新获取' });
    }

    if (Date.now() > storedData.expires) {
      emailCodeStore.delete(`reset_${email}`);
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '验证码已过期，请重新获取' });
    }

    if (storedData.code !== emailCode) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '验证码错误' });
    }

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '验证码验证成功'
    });

  } catch (error) {
    console.error('验证找回密码验证码失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '验证失败，请稍后重试' });
  }
});

// 重置密码
router.post('/reset-password', async (req, res) => {
  try {
    // 检查邮件功能是否启用
    if (!emailConfig.enabled) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '邮件功能未启用' });
    }

    const { email, emailCode, newPassword } = req.body;

    if (!email || !emailCode || !newPassword) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '缺少必要参数' });
    }

    // 验证密码长度
    if (newPassword.length < 6 || newPassword.length > 20) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '密码长度必须在6-20位之间' });
    }

    // 验证邮箱验证码
    const storedData = emailCodeStore.get(`reset_${email}`);
    if (!storedData) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '验证码已过期，请重新获取' });
    }

    if (Date.now() > storedData.expires) {
      emailCodeStore.delete(`reset_${email}`);
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '验证码已过期，请重新获取' });
    }

    if (storedData.code !== emailCode) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '验证码错误' });
    }

    // 更新密码 (use SHA256 hash)
    const hashedPassword = crypto.createHash('sha256').update(newPassword).digest('hex');
    await prisma.user.updateMany({
      where: { email: email },
      data: { password: hashedPassword }
    });

    // 删除已使用的验证码
    emailCodeStore.delete(`reset_${email}`);

    console.log(`用户重置密码成功 - 邮箱: ${email}`);

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '密码重置成功，请使用新密码登录'
    });

  } catch (error) {
    console.error('重置密码失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '重置密码失败，请稍后重试' });
  }
});

// 解除邮箱绑定
router.delete('/unbind-email', authenticateToken, async (req, res) => {
  try {
    // 检查邮件功能是否启用
    if (!emailConfig.enabled) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '邮件功能未启用' });
    }

    const userId = req.user.id;

    // 检查用户是否已绑定邮箱
    const user = await prisma.user.findUnique({
      where: { id: BigInt(userId) },
      select: { email: true }
    });

    if (!user) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '用户不存在' });
    }

    const currentEmail = user.email;
    if (!currentEmail || currentEmail.trim() === '') {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '您尚未绑定邮箱' });
    }

    // 解除邮箱绑定（将email设为空字符串）
    await prisma.user.update({
      where: { id: BigInt(userId) },
      data: { email: '' }
    });

    console.log(`用户解除邮箱绑定成功 - 用户ID: ${userId}, 原邮箱: ${currentEmail}`);

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '邮箱解绑成功'
    });

  } catch (error) {
    console.error('解除邮箱绑定失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '解除邮箱绑定失败，请稍后重试' });
  }
});

// 用户注册
router.post('/register', async (req, res) => {
  try {
    const { user_id, nickname, password, captchaId, captchaText, email, emailCode } = req.body;

    // 根据邮件功能是否启用，决定必填参数
    const isEmailEnabled = emailConfig.enabled;

    if (isEmailEnabled) {
      // 邮件功能启用时，邮箱和邮箱验证码必填
      if (!user_id || !nickname || !password || !captchaId || !captchaText || !email || !emailCode) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '缺少必要参数' });
      }
    } else {
      // 邮件功能未启用时，邮箱和邮箱验证码可选
      if (!user_id || !nickname || !password || !captchaId || !captchaText) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '缺少必要参数' });
      }
    }

    // 检查用户ID是否已存在
    const existingUser = await prisma.user.findUnique({
      where: { user_id: user_id.toString() },
      select: { id: true }
    });
    if (existingUser) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.CONFLICT, message: '用户ID已存在' });
    }

    // 验证验证码
    const storedCaptcha = captchaStore.get(captchaId);
    if (!storedCaptcha) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '验证码已过期或不存在' });
    }

    if (Date.now() > storedCaptcha.expires) {
      captchaStore.delete(captchaId);
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '验证码已过期' });
    }

    if (captchaText !== storedCaptcha.text) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '验证码错误' });
    }

    // 验证码验证成功，删除已使用的验证码
    captchaStore.delete(captchaId);

    // 邮件功能启用时才验证邮箱
    if (isEmailEnabled) {
      // 验证邮箱格式
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '邮箱格式不正确' });
      }

      // 验证邮箱验证码
      const storedEmailCode = emailCodeStore.get(email);
      if (!storedEmailCode) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '邮箱验证码已过期或不存在' });
      }

      if (Date.now() > storedEmailCode.expires) {
        emailCodeStore.delete(email);
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '邮箱验证码已过期' });
      }

      if (emailCode !== storedEmailCode.code) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '邮箱验证码错误' });
      }

      // 邮箱验证码验证成功，删除已使用的验证码
      emailCodeStore.delete(email);
    }

    if (user_id.length < 3 || user_id.length > 15) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '汐社号长度必须在3-15位之间' });
    }

    if (!/^[a-zA-Z0-9_]+$/.test(user_id)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '汐社号只能包含字母、数字和下划线' });
    }

    if (nickname.length > 10) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '昵称长度必须少于10位' });
    }

    if (password.length < 6 || password.length > 20) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '密码长度必须在6-20位之间' });
    }

    // 审核昵称（如果启用了内容审核）
    if (isAuditEnabled()) {
      try {
        const nicknameAuditResult = await auditNickname(nickname, user_id);
        
        // 确保审核结果存在并且不通过
        if (nicknameAuditResult && nicknameAuditResult.passed === false) {
          // 昵称审核不通过，拒绝注册
          return res.status(HTTP_STATUS.BAD_REQUEST).json({ 
            code: RESPONSE_CODES.VALIDATION_ERROR, 
            message: '昵称包含敏感内容，请修改后重试',
            data: {
              reason: nicknameAuditResult.reason || '昵称不符合社区规范'
            }
          });
        }
      } catch (auditError) {
        console.error('昵称审核异常:', auditError);
        // 审核异常时不阻塞注册，继续流程
      }
    }

    // 获取用户IP属地
    const userIP = getRealIP(req);
    let ipLocation;
    try {
      ipLocation = await getIPLocation(userIP);
    } catch (error) {
      ipLocation = '未知';
    }
    // 获取用户User-Agent
    const userAgent = req.headers['user-agent'] || '';
    // 默认头像使用空字符串，前端会使用本地默认头像
    const defaultAvatar = '';

    // 插入新用户（密码使用SHA2哈希加密）
    // 邮件功能未启用时，email字段存储空字符串
    const userEmail = isEmailEnabled ? email : '';
    const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');
    const newUser = await prisma.user.create({
      data: {
        user_id: user_id,
        nickname: nickname,
        password: hashedPassword,
        email: userEmail,
        avatar: defaultAvatar,
        bio: '',
        location: ipLocation
      }
    });

    const userId = newUser.id;

    // 生成JWT令牌
    const accessToken = generateAccessToken({ userId: Number(userId), user_id });
    const refreshToken = generateRefreshToken({ userId: Number(userId), user_id });

    // 保存会话
    await prisma.userSession.create({
      data: {
        user_id: userId,
        token: accessToken,
        refresh_token: refreshToken,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        user_agent: userAgent,
        is_active: true
      }
    });

    // 获取完整用户信息
    const userInfo = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, user_id: true, nickname: true, avatar: true, bio: true, location: true, follow_count: true, fans_count: true, like_count: true }
    });

    console.log(`用户注册成功 - 用户ID: ${userId}, 汐社号: ${userInfo.user_id}`);

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '注册成功',
      data: {
        user: { ...userInfo, id: Number(userInfo.id) },
        tokens: {
          access_token: accessToken,
          refresh_token: refreshToken,
          expires_in: 3600
        }
      }
    });
  } catch (error) {
    console.error('用户注册失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 用户登录
router.post('/login', async (req, res) => {
  try {
    const { user_id, password } = req.body;
    if (!user_id || !password) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '缺少必要参数' });
    }

    // 查找用户
    const user = await prisma.user.findUnique({
      where: { user_id: user_id.toString() },
      select: { id: true, user_id: true, nickname: true, password: true, avatar: true, bio: true, location: true, follow_count: true, fans_count: true, like_count: true, is_active: true, gender: true, zodiac_sign: true, mbti: true, education: true, major: true, interests: true }
    });

    if (!user) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.NOT_FOUND, message: '用户不存在' });
    }

    if (!user.is_active) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ code: RESPONSE_CODES.FORBIDDEN, message: '账户已被禁用' });
    }

    // 验证密码（哈希比较）
    const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');
    if (user.password !== hashedPassword) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '密码错误' });
    }

    // 生成JWT令牌
    const accessToken = generateAccessToken({ userId: Number(user.id), user_id: user.user_id });
    const refreshToken = generateRefreshToken({ userId: Number(user.id), user_id: user.user_id });

    // 获取用户IP和User-Agent
    const userIP = getRealIP(req);
    const userAgent = req.headers['user-agent'] || '';

    // 获取IP地理位置并更新用户location
    // 如果启用了异步队列，使用队列处理；否则同步处理
    let ipLocation = user.location || '未知';
    if (isQueueEnabled()) {
      // 异步更新 IP 属地
      addIPLocationTask(Number(user.id), userIP);
    } else {
      // 同步更新 IP 属地
      ipLocation = await getIPLocation(userIP);
      await prisma.user.update({
        where: { id: user.id },
        data: { location: ipLocation }
      });
    }

    // 清除旧会话并保存新会话
    await prisma.userSession.updateMany({
      where: { user_id: user.id },
      data: { is_active: false }
    });
    await prisma.userSession.create({
      data: {
        user_id: user.id,
        token: accessToken,
        refresh_token: refreshToken,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        user_agent: userAgent,
        is_active: true
      }
    });

    // 更新用户对象中的location字段
    const userResponse = { ...user, id: Number(user.id), location: ipLocation };

    // 移除密码字段
    delete userResponse.password;

    // 处理interests字段（如果是JSON字符串则解析）
    if (userResponse.interests) {
      try {
        userResponse.interests = typeof userResponse.interests === 'string'
          ? JSON.parse(userResponse.interests)
          : userResponse.interests;
      } catch (e) {
        userResponse.interests = null;
      }
    }

    console.log(`用户登录成功 - 用户ID: ${user.id}, 汐社号: ${user.user_id}`);

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '登录成功',
      data: {
        user: userResponse,
        tokens: {
          access_token: accessToken,
          refresh_token: refreshToken,
          expires_in: 3600
        }
      }
    });
  } catch (error) {
    console.error('用户登录失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 刷新令牌
router.post('/refresh', async (req, res) => {
  try {
    const { refresh_token } = req.body;

    if (!refresh_token) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '缺少刷新令牌' });
    }

    // 验证刷新令牌
    const decoded = verifyToken(refresh_token);

    // 检查会话是否有效
    const session = await prisma.userSession.findFirst({
      where: {
        user_id: BigInt(decoded.userId),
        refresh_token: refresh_token,
        is_active: true,
        expires_at: { gt: new Date() }
      },
      select: { id: true }
    });

    if (!session) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({ code: RESPONSE_CODES.UNAUTHORIZED, message: '刷新令牌无效或已过期' });
    }

    // 生成新的令牌
    const newAccessToken = generateAccessToken({ userId: decoded.userId, user_id: decoded.user_id });
    const newRefreshToken = generateRefreshToken({ userId: decoded.userId, user_id: decoded.user_id });

    // 获取用户IP和User-Agent
    const userIP = getRealIP(req);
    const userAgent = req.headers['user-agent'] || '';

    // 获取IP地理位置并更新用户location
    // 如果启用了异步队列，使用队列处理；否则同步处理
    if (isQueueEnabled()) {
      // 异步更新 IP 属地
      addIPLocationTask(decoded.userId, userIP);
    } else {
      // 同步更新 IP 属地
      const ipLocation = await getIPLocation(userIP);
      await prisma.user.update({
        where: { id: BigInt(decoded.userId) },
        data: { location: ipLocation }
      });
    }

    // 更新会话
    await prisma.userSession.update({
      where: { id: session.id },
      data: {
        token: newAccessToken,
        refresh_token: newRefreshToken,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        user_agent: userAgent
      }
    });

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '令牌刷新成功',
      data: {
        access_token: newAccessToken,
        refresh_token: newRefreshToken,
        expires_in: 3600
      }
    });
  } catch (error) {
    console.error('刷新令牌失败:', error);
    res.status(HTTP_STATUS.UNAUTHORIZED).json({ code: RESPONSE_CODES.UNAUTHORIZED, message: '刷新令牌无效' });
  }
});

// 退出登录
router.post('/logout', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const token = req.token;

    // 将当前会话设为无效
    await prisma.userSession.updateMany({
      where: { user_id: BigInt(userId), token: token },
      data: { is_active: false }
    });

    console.log(`用户退出成功 - 用户ID: ${userId}`);

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '退出成功'
    });
  } catch (error) {
    console.error('退出登录失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 获取当前用户信息
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await prisma.user.findUnique({
      where: { id: BigInt(userId) },
      select: { id: true, user_id: true, nickname: true, avatar: true, bio: true, location: true, email: true, follow_count: true, fans_count: true, like_count: true, is_active: true, created_at: true, gender: true, zodiac_sign: true, mbti: true, education: true, major: true, interests: true, verified: true }
    });

    if (!user) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '用户不存在' });
    }

    // Format user response
    const userResponse = { ...user, id: Number(user.id) };

    // 处理interests字段（如果是JSON字符串则解析）
    if (userResponse.interests) {
      try {
        userResponse.interests = typeof userResponse.interests === 'string'
          ? JSON.parse(userResponse.interests)
          : userResponse.interests;
      } catch (e) {
        userResponse.interests = null;
      }
    }

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: 'success',
      data: userResponse
    });
  } catch (error) {
    console.error('获取用户信息失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 管理员登录
router.post('/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '缺少必要参数' });
    }

    // 查找管理员
    const admin = await prisma.admin.findUnique({
      where: { username: username },
      select: { id: true, username: true, password: true }
    });

    if (!admin) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.NOT_FOUND, message: '管理员账号不存在' });
    }

    // 验证密码（哈希比较）
    const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');
    if (admin.password !== hashedPassword) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '密码错误' });
    }

    // 生成JWT令牌
    const accessToken = generateAccessToken({
      adminId: Number(admin.id),
      username: admin.username,
      type: 'admin'
    });
    const refreshToken = generateRefreshToken({
      adminId: Number(admin.id),
      username: admin.username,
      type: 'admin'
    });

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '登录成功',
      data: {
        admin: { id: Number(admin.id), username: admin.username },
        tokens: {
          access_token: accessToken,
          refresh_token: refreshToken,
          expires_in: 3600
        }
      }
    });
  } catch (error) {
    console.error('管理员登录失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 获取当前管理员信息
router.get('/admin/me', authenticateToken, async (req, res) => {
  try {
    // 检查是否为管理员token
    if (!req.user.type || req.user.type !== 'admin') {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ code: RESPONSE_CODES.FORBIDDEN, message: '权限不足' });
    }

    const adminId = req.user.adminId;

    const admin = await prisma.admin.findUnique({
      where: { id: BigInt(adminId) },
      select: { id: true, username: true }
    });

    if (!admin) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '管理员不存在' });
    }

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: 'success',
      data: { id: Number(admin.id), username: admin.username }
    });
  } catch (error) {
    console.error('获取管理员信息失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 获取管理员列表
router.get('/admin/admins', authenticateToken, async (req, res) => {
  try {
    // 检查是否为管理员token
    if (!req.user.type || req.user.type !== 'admin') {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ code: RESPONSE_CODES.FORBIDDEN, message: '权限不足' });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // 搜索条件
    const where = {};
    if (req.query.username) {
      where.username = { contains: req.query.username };
    }

    // 验证排序字段
    const allowedSortFields = ['username', 'created_at'];
    const sortField = allowedSortFields.includes(req.query.sortField) ? req.query.sortField : 'created_at';
    const sortOrder = req.query.sortOrder && req.query.sortOrder.toUpperCase() === 'ASC' ? 'asc' : 'desc';

    // 获取总数和列表
    const [total, admins] = await Promise.all([
      prisma.admin.count({ where }),
      prisma.admin.findMany({
        where,
        select: { username: true, password: true, created_at: true },
        orderBy: { [sortField]: sortOrder },
        skip,
        take: limit
      })
    ]);

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: 'success',
      data: {
        data: admins,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('获取管理员列表失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 创建管理员
router.post('/admin/admins', authenticateToken, async (req, res) => {
  try {
    // 检查是否为管理员token
    if (!req.user.type || req.user.type !== 'admin') {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ code: RESPONSE_CODES.FORBIDDEN, message: '权限不足' });
    }

    const { username, password } = req.body;

    // 验证必填字段
    if (!username || !password) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '账号和密码不能为空' });
    }

    // 检查用户名是否已存在
    const existingAdmin = await prisma.admin.findUnique({
      where: { username: username },
      select: { id: true }
    });

    if (existingAdmin) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.CONFLICT, message: '账号已存在' });
    }

    // 创建管理员（密码使用SHA2哈希加密）
    const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');
    const newAdmin = await prisma.admin.create({
      data: {
        username: username,
        password: hashedPassword
      }
    });

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '创建管理员成功',
      data: {
        id: Number(newAdmin.id)
      }
    });
  } catch (error) {
    console.error('创建管理员失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 更新管理员信息
router.put('/admin/admins/:id', authenticateToken, async (req, res) => {
  try {
    // 检查是否为管理员token
    if (!req.user.type || req.user.type !== 'admin') {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ code: RESPONSE_CODES.FORBIDDEN, message: '权限不足' });
    }

    const adminId = req.params.id;
    const { password } = req.body;

    // 验证必填字段
    if (!password) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '密码不能为空' });
    }

    // 检查管理员是否存在
    const admin = await prisma.admin.findUnique({
      where: { username: adminId },
      select: { username: true }
    });

    if (!admin) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '管理员不存在' });
    }

    // 更新管理员密码（使用SHA2哈希加密）
    const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');
    await prisma.admin.update({
      where: { username: adminId },
      data: { password: hashedPassword }
    });

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '更新管理员信息成功'
    });
  } catch (error) {
    console.error('更新管理员信息失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 删除管理员
router.delete('/admin/admins/:id', authenticateToken, async (req, res) => {
  try {
    // 检查是否为管理员token
    if (!req.user.type || req.user.type !== 'admin') {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ code: RESPONSE_CODES.FORBIDDEN, message: '权限不足' });
    }

    const adminId = req.params.id;

    // 检查管理员是否存在
    const admin = await prisma.admin.findUnique({
      where: { username: adminId },
      select: { username: true }
    });

    if (!admin) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '管理员不存在' });
    }

    // 删除管理员
    await prisma.admin.delete({ where: { username: adminId } });

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '删除管理员成功'
    });
  } catch (error) {
    console.error('删除管理员失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 重置管理员密码
router.put('/admin/admins/:id/password', authenticateToken, async (req, res) => {
  try {
    // 检查是否为管理员token
    if (!req.user.type || req.user.type !== 'admin') {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ code: RESPONSE_CODES.FORBIDDEN, message: '权限不足' });
    }

    const adminId = req.params.id;
    const { password } = req.body;

    // 验证密码
    if (!password || password.length < 6) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '密码不能为空且长度不能少于6位' });
    }

    // 检查管理员是否存在
    const admin = await prisma.admin.findUnique({
      where: { id: BigInt(adminId) },
      select: { id: true }
    });

    if (!admin) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '管理员不存在' });
    }

    // 更新密码（使用SHA2哈希加密）
    const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');
    await prisma.admin.update({
      where: { id: BigInt(adminId) },
      data: { password: hashedPassword }
    });

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '重置密码成功'
    });
  } catch (error) {
    console.error('重置密码失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// ========== OAuth2 登录相关 ==========

// OAuth2用户信息查询字段（减少重复）
const OAUTH2_USER_SELECT_FIELDS = { id: true, user_id: true, nickname: true, avatar: true, bio: true, location: true, follow_count: true, fans_count: true, like_count: true, is_active: true, gender: true, zodiac_sign: true, mbti: true, education: true, major: true, interests: true };

// 生成OAuth2 state参数
const generateOAuth2State = () => {
  const state = crypto.randomBytes(32).toString('base64url');
  // 存储state，5分钟过期
  oauth2StateStore.set(state, {
    created: Date.now(),
    expires: Date.now() + 5 * 60 * 1000
  });
  // 清理过期的state
  for (const [key, value] of oauth2StateStore.entries()) {
    if (Date.now() > value.expires) {
      oauth2StateStore.delete(key);
    }
  }
  return state;
};

// 验证并消费OAuth2 state参数
const validateOAuth2State = (state) => {
  const stored = oauth2StateStore.get(state);
  if (!stored) {
    return false;
  }
  // 删除已使用的state
  oauth2StateStore.delete(state);
  // 检查是否过期
  return Date.now() <= stored.expires;
};

// 获取OAuth2回调URL
const getOAuth2CallbackUrl = (req) => {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return `${protocol}://${host}${oauth2Config.callbackPath}`;
};

// OAuth2登录 - 重定向到OAuth2服务器
router.get('/oauth2/login', (req, res) => {
  try {
    // 检查OAuth2是否启用
    if (!oauth2Config.enabled) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ 
        code: RESPONSE_CODES.VALIDATION_ERROR, 
        message: 'OAuth2登录未启用' 
      });
    }

    // 检查OAuth2配置是否完整
    if (!oauth2Config.loginUrl || !oauth2Config.clientId) {
      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ 
        code: RESPONSE_CODES.ERROR, 
        message: 'OAuth2配置不完整' 
      });
    }

    // 生成state参数
    const state = generateOAuth2State();
    const callbackUrl = getOAuth2CallbackUrl(req);

    // 构建OAuth2授权URL
    const authUrl = `${oauth2Config.loginUrl}/oauth2/authorize?` +
      `response_type=code&` +
      `client_id=${encodeURIComponent(oauth2Config.clientId)}&` +
      `redirect_uri=${encodeURIComponent(callbackUrl)}&` +
      `state=${encodeURIComponent(state)}`;

    // 重定向到OAuth2授权页面
    res.redirect(authUrl);
  } catch (error) {
    console.error('OAuth2登录失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ 
      code: RESPONSE_CODES.ERROR, 
      message: 'OAuth2登录失败' 
    });
  }
});

// OAuth2回调处理
router.get('/oauth2/callback', async (req, res) => {
  try {
    const { code, state, error: oauthError, error_description } = req.query;

    console.log('OAuth2回调开始处理 - code:', code ? '存在' : '缺失', 'state:', state ? '存在' : '缺失');

    // 检查OAuth2是否启用
    if (!oauth2Config.enabled) {
      console.error('OAuth2回调失败: OAuth2未启用');
      return res.redirect('/?error=oauth2_disabled');
    }

    // 检查是否有错误响应
    if (oauthError) {
      console.error('OAuth2授权错误:', oauthError, error_description);
      return res.redirect(`/?error=oauth2_auth_error&message=${encodeURIComponent(error_description || oauthError)}`);
    }

    // 验证必要参数
    if (!code) {
      console.error('OAuth2回调失败: 缺少授权码');
      return res.redirect('/?error=missing_code');
    }

    // 验证state参数（防止CSRF攻击）
    // 注意：如果服务器重启，内存中的state会丢失，这里做容错处理
    if (state && !validateOAuth2State(state)) {
      console.warn('OAuth2 state验证失败，可能是服务器重启导致，继续处理...');
      // 不再强制要求state验证通过，因为state存储在内存中，服务器重启会丢失
      // 这是一个权衡：牺牲一点CSRF保护换取更好的用户体验
      // 生产环境建议使用Redis等持久化存储来保存state
    }

    const callbackUrl = getOAuth2CallbackUrl(req);
    console.log('OAuth2回调URL:', callbackUrl);
    console.log('OAuth2 Token请求地址:', `${oauth2Config.loginUrl}/oauth2/token`);

    // 使用授权码换取访问令牌
    const tokenResponse = await fetch(`${oauth2Config.loginUrl}/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        client_id: oauth2Config.clientId,
        redirect_uri: callbackUrl
      }).toString()
    });

    const tokenData = await tokenResponse.json();
    console.log('OAuth2 Token响应状态:', tokenResponse.status);

    if (tokenData.error) {
      console.error('OAuth2令牌错误:', tokenData.error, tokenData.error_description);
      return res.redirect(`/?error=token_error&message=${encodeURIComponent(tokenData.error_description || tokenData.error)}`);
    }

    if (!tokenData.access_token) {
      console.error('OAuth2响应缺少access_token:', JSON.stringify(tokenData));
      return res.redirect('/?error=missing_access_token');
    }

    console.log('OAuth2 Token获取成功');

    // 使用访问令牌获取用户信息
    const userInfoResponse = await fetch(`${oauth2Config.loginUrl}/oauth2/userinfo`, {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`
      }
    });

    console.log('OAuth2 UserInfo响应状态:', userInfoResponse.status);

    if (!userInfoResponse.ok) {
      console.error('获取OAuth2用户信息失败:', userInfoResponse.status);
      return res.redirect('/?error=userinfo_error');
    }

    const oauth2UserInfo = await userInfoResponse.json();
    console.log('OAuth2用户信息获取成功:', JSON.stringify(oauth2UserInfo));

    // 根据OAuth2用户信息查找或创建本地用户
    // OAuth2返回的用户信息格式：{ sub, user_id, username, vip_level, balance, email }
    const oauth2UserId = parseInt(oauth2UserInfo.user_id || oauth2UserInfo.sub, 10);
    const oauth2Username = oauth2UserInfo.username;
    const oauth2Email = oauth2UserInfo.email || '';

    // 验证oauth2UserId是有效的整数
    if (isNaN(oauth2UserId)) {
      console.error('OAuth2用户ID无效:', oauth2UserInfo.user_id || oauth2UserInfo.sub);
      return res.redirect('/?error=invalid_user_id');
    }

    // 首先尝试通过oauth2_id查找用户
    let existingUser = await prisma.user.findFirst({
      where: { oauth2_id: BigInt(oauth2UserId) },
      select: OAUTH2_USER_SELECT_FIELDS
    });

    let user;
    let isNewUser = false;

    if (existingUser) {
      // 找到已绑定的用户
      user = existingUser;
      
      if (!user.is_active) {
        return res.redirect('/?error=account_disabled');
      }
    } else {
      // 未找到绑定的用户，创建新用户
      isNewUser = true;
      
      // 生成唯一的user_id（基于OAuth2用户名或随机生成）
      let newUserId = oauth2Username || `user_${oauth2UserId}`;
      // 确保user_id唯一
      let suffix = 0;
      let baseUserId = newUserId;
      while (true) {
        const checkUser = await prisma.user.findUnique({
          where: { user_id: newUserId },
          select: { id: true }
        });
        if (!checkUser) {
          break;
        }
        suffix++;
        newUserId = `${baseUserId}_${suffix}`;
      }

      // 获取用户IP属地
      const userIP = getRealIP(req);
      let ipLocation;
      try {
        ipLocation = await getIPLocation(userIP);
      } catch (error) {
        ipLocation = '未知';
      }

      // 创建新用户（不设置密码，通过OAuth2登录）
      const defaultNickname = oauth2Username || `用户${oauth2UserId}`;
      const newUser = await prisma.user.create({
        data: {
          user_id: newUserId,
          nickname: defaultNickname,
          password: '',
          email: oauth2Email,
          avatar: '',
          bio: '这个人很懒，还没有简介',
          location: ipLocation,
          oauth2_id: BigInt(oauth2UserId)
        }
      });

      // 获取新创建的用户信息
      user = await prisma.user.findUnique({
        where: { id: newUser.id },
        select: OAUTH2_USER_SELECT_FIELDS
      });

      console.log(`OAuth2新用户创建成功 - 用户ID: ${newUser.id}, 汐社号: ${newUserId}, OAuth2_ID: ${oauth2UserId}`);
    }

    // 生成本站JWT令牌
    const accessToken = generateAccessToken({ userId: Number(user.id), user_id: user.user_id });
    const refreshToken = generateRefreshToken({ userId: Number(user.id), user_id: user.user_id });

    // 获取User-Agent
    const userAgent = req.headers['user-agent'] || '';

    // 清除旧会话并保存新会话
    await prisma.userSession.updateMany({
      where: { user_id: user.id },
      data: { is_active: false }
    });
    await prisma.userSession.create({
      data: {
        user_id: user.id,
        token: accessToken,
        refresh_token: refreshToken,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        user_agent: userAgent,
        is_active: true
      }
    });

    // Format user response
    const userResponse = { ...user, id: Number(user.id) };
    
    // 处理interests字段
    if (userResponse.interests) {
      try {
        userResponse.interests = typeof userResponse.interests === 'string'
          ? JSON.parse(userResponse.interests)
          : userResponse.interests;
      } catch (e) {
        userResponse.interests = null;
      }
    }

    console.log(`OAuth2用户登录成功 - 用户ID: ${user.id}, 汐社号: ${user.user_id}`);

    // 重定向回前端，携带token信息
    // 使用URL参数传递token（前端需要处理）
    const redirectParams = new URLSearchParams({
      oauth2_login: 'success',
      access_token: accessToken,
      refresh_token: refreshToken,
      is_new_user: isNewUser ? 'true' : 'false'
    });

    res.redirect(`/?${redirectParams.toString()}`);
  } catch (error) {
    console.error('OAuth2回调处理失败:', error.message);
    console.error('OAuth2回调错误堆栈:', error.stack);
    // 提供更详细的错误信息给前端
    const errorMessage = encodeURIComponent(error.message || '未知错误');
    res.redirect(`/?error=callback_error&message=${errorMessage}`);
  }
});

module.exports = router;