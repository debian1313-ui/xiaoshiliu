const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { HTTP_STATUS, RESPONSE_CODES, ERROR_MESSAGES } = require('../constants');
const { prisma, email: emailConfig, oauth2: oauth2Config } = require('../config/config');
const { generateAccessToken, generateRefreshToken, verifyToken } = require('../utils/jwt');
const { authenticateToken } = require('../middleware/auth');
const { getIPLocation, getRealIP } = require('../utils/ipLocation');
const { sendEmailCode } = require('../utils/email');
const { auditNickname, isAuditEnabled } = require('../utils/contentAudit');
const svgCaptcha = require('svg-captcha');
const path = require('path');
const fs = require('fs');

// 存储验证码的临时对象
const captchaStore = new Map();
// 存储邮箱验证码的临时对象
const emailCodeStore = new Map();
// 存储OAuth2 state参数（用于防止CSRF攻击）
const oauth2StateStore = new Map();

// Helper function to hash password using SHA256 (compatible with SQL SHA2)
const hashPassword = (password) => {
  return crypto.createHash('sha256').update(password).digest('hex');
};

// 获取认证配置状态（包括邮件功能和OAuth2配置）
router.get('/auth-config', (req, res) => {
  res.json({
    code: RESPONSE_CODES.SUCCESS,
    data: {
      emailEnabled: emailConfig.enabled,
      oauth2Enabled: oauth2Config.enabled,
      oauth2OnlyLogin: oauth2Config.onlyOAuth2,
      oauth2LoginUrl: oauth2Config.enabled ? oauth2Config.loginUrl : ''
    },
    message: 'success'
  });
});

// 获取邮件功能配置状态
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
    const fontDir = path.join(__dirname, '..', 'fonts');
    let fontFiles = [];
    if (fs.existsSync(fontDir)) {
      fontFiles = fs.readdirSync(fontDir).filter(file => file.endsWith('.ttf'));
    }
    if (fontFiles.length > 0) {
      const randomFont = fontFiles[Math.floor(Math.random() * fontFiles.length)];
      const fontPath = path.join(fontDir, randomFont);
      svgCaptcha.loadFont(fontPath);
    }
    const captcha = svgCaptcha.create({
      size: 4,
      ignoreChars: '0o1ilcIC',
      noise: 4,
      color: true,
      fontSize: 40,
      background: `#${Math.floor(Math.random() * 16777215).toString(16)}`,
    });
    const captchaId = Date.now() + Math.random().toString(36).substr(2, 9);
    captchaStore.set(captchaId, {
      text: captcha.text,
      expires: Date.now() + 30 * 1000
    });
    for (const [key, value] of captchaStore.entries()) {
      if (Date.now() > value.expires) {
        captchaStore.delete(key);
      }
    }
    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: { captchaId, captchaSvg: captcha.data },
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
    const { user_id } = req.query;
    if (!user_id) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '请输入汐社号' });
    }
    const existingUser = await prisma.user.findUnique({
      where: { user_id: user_id.toString() }
    });
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
    if (!emailConfig.enabled) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '邮件功能未启用' });
    }
    const { email } = req.body;
    if (!email) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '请输入邮箱地址' });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '邮箱格式不正确' });
    }
    const existingUser = await prisma.user.findFirst({ where: { email } });
    if (existingUser) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.CONFLICT, message: '该邮箱已被注册' });
    }
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    await sendEmailCode(email, code);
    emailCodeStore.set(email, { code, expires: Date.now() + 10 * 60 * 1000 });
    for (const [key, value] of emailCodeStore.entries()) {
      if (Date.now() > value.expires) emailCodeStore.delete(key);
    }
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '验证码发送成功，请查收邮箱' });
  } catch (error) {
    console.error('发送邮箱验证码失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '验证码发送失败，请稀后重试' });
  }
});

// 绑定邮箱
router.post('/bind-email', authenticateToken, async (req, res) => {
  try {
    if (!emailConfig.enabled) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '邮件功能未启用' });
    }
    const { email, emailCode } = req.body;
    const userId = BigInt(req.user.id);
    if (!email || !emailCode) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '请输入邮箱和验证码' });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '邮箱格式不正确' });
    }
    const existingUser = await prisma.user.findFirst({ where: { email, id: { not: userId } } });
    if (existingUser) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.CONFLICT, message: '该邮箱已被其他用户绑定' });
    }
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
    emailCodeStore.delete(email);
    await prisma.user.update({ where: { id: userId }, data: { email } });
    console.log(`用户绑定邮箱成功 - 用户ID: ${userId}, 邮箱: ${email}`);
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '邮箱绑定成功', data: { email } });
  } catch (error) {
    console.error('绑定邮箱失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '绑定邮箱失败，请稀后重试' });
  }
});

// 发送找回密码验证码
router.post('/send-reset-code', async (req, res) => {
  try {
    if (!emailConfig.enabled) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '邮件功能未启用' });
    }
    const { email } = req.body;
    if (!email) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '请输入邮箱地址' });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '邮箱格式不正确' });
    }
    const existingUser = await prisma.user.findFirst({ where: { email }, select: { id: true, user_id: true } });
    if (!existingUser) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.NOT_FOUND, message: '该邮箱未绑定任何账号' });
    }
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    await sendEmailCode(email, code);
    emailCodeStore.set(`reset_${email}`, { code, expires: Date.now() + 10 * 60 * 1000, userId: existingUser.id });
    for (const [key, value] of emailCodeStore.entries()) {
      if (Date.now() > value.expires) emailCodeStore.delete(key);
    }
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '验证码发送成功，请查收邮箱', data: { user_id: existingUser.user_id } });
  } catch (error) {
    console.error('发送找回密码验证码失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '验证码发送失败，请稀后重试' });
  }
});

// 验证找回密码验证码
router.post('/verify-reset-code', async (req, res) => {
  try {
    if (!emailConfig.enabled) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '邮件功能未启用' });
    }
    const { email, emailCode } = req.body;
    if (!email || !emailCode) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '缺少必要参数' });
    }
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
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '验证码验证成功' });
  } catch (error) {
    console.error('验证找回密码验证码失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '验证失败，请稀后重试' });
  }
});

// 重置密码
router.post('/reset-password', async (req, res) => {
  try {
    if (!emailConfig.enabled) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '邮件功能未启用' });
    }
    const { email, emailCode, newPassword } = req.body;
    if (!email || !emailCode || !newPassword) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '缺少必要参数' });
    }
    if (newPassword.length < 6 || newPassword.length > 20) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '密码长度必须在6-20位之间' });
    }
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
    await prisma.user.updateMany({ where: { email }, data: { password: hashPassword(newPassword) } });
    emailCodeStore.delete(`reset_${email}`);
    console.log(`用户重置密码成功 - 邮箱: ${email}`);
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '密码重置成功，请使用新密码登录' });
  } catch (error) {
    console.error('重置密码失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '重置密码失败，请稀后重试' });
  }
});

// 解除邮箱绑定
router.delete('/unbind-email', authenticateToken, async (req, res) => {
  try {
    if (!emailConfig.enabled) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '邮件功能未启用' });
    }
    const userId = BigInt(req.user.id);
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!user) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '用户不存在' });
    }
    if (!user.email || user.email.trim() === '') {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '您尚未绑定邮箱' });
    }
    await prisma.user.update({ where: { id: userId }, data: { email: '' } });
    console.log(`用户解除邮箱绑定成功 - 用户ID: ${userId}, 原邮箱: ${user.email}`);
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '邮箱解绑成功' });
  } catch (error) {
    console.error('解除邮箱绑定失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '解除邮箱绑定失败，请稀后重试' });
  }
});

// 用户注册
router.post('/register', async (req, res) => {
  try {
    const { user_id, nickname, password, captchaId, captchaText, email, emailCode } = req.body;
    const isEmailEnabled = emailConfig.enabled;
    if (isEmailEnabled) {
      if (!user_id || !nickname || !password || !captchaId || !captchaText || !email || !emailCode) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '缺少必要参数' });
      }
    } else {
      if (!user_id || !nickname || !password || !captchaId || !captchaText) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '缺少必要参数' });
      }
    }
    const existingUser = await prisma.user.findUnique({ where: { user_id: user_id.toString() } });
    if (existingUser) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.CONFLICT, message: '用户ID已存在' });
    }
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
    captchaStore.delete(captchaId);
    if (isEmailEnabled) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '邮箱格式不正确' });
      }
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
    if (isAuditEnabled()) {
      try {
        const nicknameAuditResult = await auditNickname(nickname, user_id);
        if (nicknameAuditResult && nicknameAuditResult.passed === false) {
          return res.status(HTTP_STATUS.BAD_REQUEST).json({ 
            code: RESPONSE_CODES.VALIDATION_ERROR, 
            message: '昵称包含敏感内容，请修改后重试',
            data: { reason: nicknameAuditResult.reason || '昵称不符合社区规范' }
          });
        }
      } catch (auditError) {
        console.error('昵称审核异常:', auditError);
      }
    }
    const userIP = getRealIP(req);
    let ipLocation;
    try { ipLocation = await getIPLocation(userIP); } catch (error) { ipLocation = '未知'; }
    const userAgent = req.headers['user-agent'] || '';
    const userEmail = isEmailEnabled ? email : '';
    const newUser = await prisma.user.create({
      data: {
        user_id,
        nickname,
        password: hashPassword(password),
        email: userEmail,
        avatar: '',
        bio: '',
        location: ipLocation
      }
    });
    const userId = newUser.id;
    const accessToken = generateAccessToken({ userId: Number(userId), user_id });
    const refreshToken = generateRefreshToken({ userId: Number(userId), user_id });
    await prisma.userSession.create({
      data: {
        user_id: userId,
        token: accessToken,
        refresh_token: refreshToken,
        user_agent: userAgent,
        is_active: true
      }
    });
    const userRow = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, user_id: true, nickname: true, avatar: true, bio: true, location: true, follow_count: true, fans_count: true, like_count: true }
    });
    console.log(`用户注册成功 - 用户ID: ${userId}, 汐社号: ${user_id}`);
    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '注册成功',
      data: {
        user: { ...userRow, id: Number(userRow.id) },
        tokens: { access_token: accessToken, refresh_token: refreshToken, expires_in: 3600 }
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
    if (user.password !== hashPassword(password)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '密码错误' });
    }
    const accessToken = generateAccessToken({ userId: Number(user.id), user_id: user.user_id });
    const refreshToken = generateRefreshToken({ userId: Number(user.id), user_id: user.user_id });
    const userIP = getRealIP(req);
    const userAgent = req.headers['user-agent'] || '';
    const ipLocation = await getIPLocation(userIP);
    await prisma.user.update({ where: { id: user.id }, data: { location: ipLocation } });
    await prisma.userSession.updateMany({ where: { user_id: user.id }, data: { is_active: false } });
    await prisma.userSession.create({
      data: { user_id: user.id, token: accessToken, refresh_token: refreshToken, user_agent: userAgent, is_active: true }
    });
    const userData = { ...user, id: Number(user.id), location: ipLocation };
    delete userData.password;
    if (userData.interests) {
      try { userData.interests = typeof userData.interests === 'string' ? JSON.parse(userData.interests) : userData.interests; } catch (e) { userData.interests = null; }
    }
    console.log(`用户登录成功 - 用户ID: ${user.id}, 汐社号: ${user.user_id}`);
    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '登录成功',
      data: { user: userData, tokens: { access_token: accessToken, refresh_token: refreshToken, expires_in: 3600 } }
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
    const decoded = verifyToken(refresh_token);
    const session = await prisma.userSession.findFirst({
      where: { user_id: BigInt(decoded.userId), refresh_token, is_active: true }
    });
    if (!session) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({ code: RESPONSE_CODES.UNAUTHORIZED, message: '刷新令牌无效或已过期' });
    }
    const newAccessToken = generateAccessToken({ userId: decoded.userId, user_id: decoded.user_id });
    const newRefreshToken = generateRefreshToken({ userId: decoded.userId, user_id: decoded.user_id });
    const userIP = getRealIP(req);
    const userAgent = req.headers['user-agent'] || '';
    const ipLocation = await getIPLocation(userIP);
    await prisma.user.update({ where: { id: BigInt(decoded.userId) }, data: { location: ipLocation } });
    await prisma.userSession.update({
      where: { id: session.id },
      data: { token: newAccessToken, refresh_token: newRefreshToken, user_agent: userAgent }
    });
    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '令牌刷新成功',
      data: { access_token: newAccessToken, refresh_token: newRefreshToken, expires_in: 3600 }
    });
  } catch (error) {
    console.error('刷新令牌失败:', error);
    res.status(HTTP_STATUS.UNAUTHORIZED).json({ code: RESPONSE_CODES.UNAUTHORIZED, message: '刷新令牌无效' });
  }
});

// 退出登录
router.post('/logout', authenticateToken, async (req, res) => {
  try {
    const userId = BigInt(req.user.id);
    const token = req.token;
    await prisma.userSession.updateMany({ where: { user_id: userId, token }, data: { is_active: false } });
    console.log(`用户退出成功 - 用户ID: ${userId}`);
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '退出成功' });
  } catch (error) {
    console.error('退出登录失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 获取当前用户信息
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const userId = BigInt(req.user.id);
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, user_id: true, nickname: true, avatar: true, bio: true, location: true, email: true, follow_count: true, fans_count: true, like_count: true, is_active: true, created_at: true, gender: true, zodiac_sign: true, mbti: true, education: true, major: true, interests: true, verified: true }
    });
    if (!user) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '用户不存在' });
    }
    const userData = { ...user, id: Number(user.id) };
    if (userData.interests) {
      try { userData.interests = typeof userData.interests === 'string' ? JSON.parse(userData.interests) : userData.interests; } catch (e) { userData.interests = null; }
    }
    res.json({ code: RESPONSE_CODES.SUCCESS, message: 'success', data: userData });
  } catch (error) {
    console.error('获取用户信息失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// ======================== 管理员接口 ========================

// 管理员登录
router.post('/admin-login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '缺少必要参数' });
    }
    const admin = await prisma.admin.findUnique({ where: { username: username.toString() } });
    if (!admin) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.NOT_FOUND, message: '管理员账号不存在' });
    }
    if (admin.password !== hashPassword(password)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '密码错误' });
    }
    const accessToken = generateAccessToken({ adminId: Number(admin.id), username: admin.username, isAdmin: true });
    console.log(`管理员登录成功 - 用户名: ${username}`);
    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '登录成功',
      data: { admin: { id: Number(admin.id), username: admin.username }, token: accessToken }
    });
  } catch (error) {
    console.error('管理员登录失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 获取管理员列表
router.get('/admins', authenticateToken, async (req, res) => {
  try {
    if (!req.user.isAdmin) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ code: RESPONSE_CODES.FORBIDDEN, message: '无权访问' });
    }
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const username = req.query.username;
    const where = username ? { username: { contains: username } } : {};
    const [total, admins] = await Promise.all([
      prisma.admin.count({ where }),
      prisma.admin.findMany({
        where,
        select: { id: true, username: true, created_at: true },
        orderBy: { id: 'desc' },
        skip,
        take: limit
      })
    ]);
    const formattedAdmins = admins.map(a => ({ ...a, id: Number(a.id) }));
    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: 'success',
      data: { admins: formattedAdmins, pagination: { page, limit, total, pages: Math.ceil(total / limit) } }
    });
  } catch (error) {
    console.error('获取管理员列表失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 创建管理员
router.post('/admins', authenticateToken, async (req, res) => {
  try {
    if (!req.user.isAdmin) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ code: RESPONSE_CODES.FORBIDDEN, message: '无权访问' });
    }
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '用户名和密码不能为空' });
    }
    const existingAdmin = await prisma.admin.findUnique({ where: { username: username.toString() } });
    if (existingAdmin) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.CONFLICT, message: '管理员用户名已存在' });
    }
    const newAdmin = await prisma.admin.create({
      data: { username: username.toString(), password: hashPassword(password) }
    });
    console.log(`管理员创建成功 - 用户名: ${username}`);
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '创建成功', data: { id: Number(newAdmin.id), username: newAdmin.username } });
  } catch (error) {
    console.error('创建管理员失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 更新管理员密码
router.put('/admins/:id/password', authenticateToken, async (req, res) => {
  try {
    if (!req.user.isAdmin) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ code: RESPONSE_CODES.FORBIDDEN, message: '无权访问' });
    }
    const adminId = BigInt(req.params.id);
    const { password } = req.body;
    if (!password) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '密码不能为空' });
    }
    const admin = await prisma.admin.findUnique({ where: { id: adminId } });
    if (!admin) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '管理员不存在' });
    }
    await prisma.admin.update({ where: { id: adminId }, data: { password: hashPassword(password) } });
    console.log(`管理员密码修改成功 - ID: ${adminId}`);
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '密码修改成功' });
  } catch (error) {
    console.error('修改管理员密码失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 删除管理员
router.delete('/admins/:id', authenticateToken, async (req, res) => {
  try {
    if (!req.user.isAdmin) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ code: RESPONSE_CODES.FORBIDDEN, message: '无权访问' });
    }
    const adminId = BigInt(req.params.id);
    if (Number(adminId) === req.user.adminId) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '不能删除自己的账号' });
    }
    const admin = await prisma.admin.findUnique({ where: { id: adminId } });
    if (!admin) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '管理员不存在' });
    }
    await prisma.admin.delete({ where: { id: adminId } });
    console.log(`管理员删除成功 - ID: ${adminId}`);
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '删除成功' });
  } catch (error) {
    console.error('删除管理员失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 修改用户密码（管理员）
router.put('/admin/users/:id/password', authenticateToken, async (req, res) => {
  try {
    if (!req.user.isAdmin) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ code: RESPONSE_CODES.FORBIDDEN, message: '无权访问' });
    }
    const userId = BigInt(req.params.id);
    const { password } = req.body;
    if (!password) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '密码不能为空' });
    }
    if (password.length < 6 || password.length > 20) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '密码长度必须在6-20位之间' });
    }
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '用户不存在' });
    }
    await prisma.user.update({ where: { id: userId }, data: { password: hashPassword(password) } });
    console.log(`管理员修改用户密码成功 - 用户ID: ${userId}`);
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '密码修改成功' });
  } catch (error) {
    console.error('管理员修改用户密码失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// 修改自己的密码
router.put('/password', authenticateToken, async (req, res) => {
  try {
    const userId = BigInt(req.user.id);
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '缺少必要参数' });
    }
    if (newPassword.length < 6 || newPassword.length > 20) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '新密码长度必须在6-20位之间' });
    }
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { password: true } });
    if (!user) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '用户不存在' });
    }
    if (user.password !== hashPassword(oldPassword)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '原密码错误' });
    }
    await prisma.user.update({ where: { id: userId }, data: { password: hashPassword(newPassword) } });
    console.log(`用户修改密码成功 - 用户ID: ${userId}`);
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '密码修改成功' });
  } catch (error) {
    console.error('修改密码失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// ======================== OAuth2 登录接口 ========================

// 获取OAuth2授权URL
router.get('/oauth2/authorize', (req, res) => {
  try {
    if (!oauth2Config.enabled) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: 'OAuth2登录未启用' });
    }
    const state = crypto.randomBytes(32).toString('hex');
    const { redirect_uri } = req.query;
    if (redirect_uri) {
      oauth2StateStore.set(state, { redirect_uri, expires: Date.now() + 5 * 60 * 1000 });
    } else {
      oauth2StateStore.set(state, { expires: Date.now() + 5 * 60 * 1000 });
    }
    for (const [key, value] of oauth2StateStore.entries()) {
      if (Date.now() > value.expires) oauth2StateStore.delete(key);
    }
    const authUrl = `${oauth2Config.loginUrl}/authorize?response_type=code&client_id=${oauth2Config.clientId}&state=${state}`;
    res.json({ code: RESPONSE_CODES.SUCCESS, data: { url: authUrl, state }, message: 'success' });
  } catch (error) {
    console.error('获取OAuth2授权URL失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

// OAuth2回调处理
router.post('/oauth2/callback', async (req, res) => {
  try {
    if (!oauth2Config.enabled) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: 'OAuth2登录未启用' });
    }
    const { code, state } = req.body;
    if (!code) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '授权码不能为空' });
    }
    if (state && !oauth2StateStore.has(state)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '无效的state参数' });
    }
    let storedState = null;
    if (state) {
      storedState = oauth2StateStore.get(state);
      if (Date.now() > storedState.expires) {
        oauth2StateStore.delete(state);
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: 'state参数已过期' });
      }
      oauth2StateStore.delete(state);
    }
    const tokenResponse = await fetch(`${oauth2Config.loginUrl}/api/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'authorization_code', code, client_id: oauth2Config.clientId })
    });
    const tokenData = await tokenResponse.json();
    if (!tokenData.success || !tokenData.data?.access_token) {
      console.error('OAuth2获取token失败:', tokenData);
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.ERROR, message: tokenData.message || 'OAuth2授权失败' });
    }
    const { access_token: oauth2AccessToken } = tokenData.data;
    const userResponse = await fetch(`${oauth2Config.loginUrl}/api/auth/userinfo`, {
      headers: { 'Authorization': `Bearer ${oauth2AccessToken}` }
    });
    const userData = await userResponse.json();
    if (!userData.success || !userData.data) {
      console.error('OAuth2获取用户信息失败:', userData);
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.ERROR, message: userData.message || '获取用户信息失败' });
    }
    const oauth2User = userData.data;
    const oauth2Id = BigInt(oauth2User.id);
    let existingUser = await prisma.user.findUnique({ where: { oauth2_id: oauth2Id } });
    const userIP = getRealIP(req);
    const userAgent = req.headers['user-agent'] || '';
    let ipLocation = '未知';
    try { ipLocation = await getIPLocation(userIP); } catch (error) {}
    if (existingUser) {
      if (!existingUser.is_active) {
        return res.status(HTTP_STATUS.FORBIDDEN).json({ code: RESPONSE_CODES.FORBIDDEN, message: '账户已被禁用' });
      }
      await prisma.user.update({ where: { id: existingUser.id }, data: { location: ipLocation, last_login_at: new Date() } });
      const accessToken = generateAccessToken({ userId: Number(existingUser.id), user_id: existingUser.user_id });
      const refreshToken = generateRefreshToken({ userId: Number(existingUser.id), user_id: existingUser.user_id });
      await prisma.userSession.updateMany({ where: { user_id: existingUser.id }, data: { is_active: false } });
      await prisma.userSession.create({
        data: { user_id: existingUser.id, token: accessToken, refresh_token: refreshToken, user_agent: userAgent, is_active: true }
      });
      const user = await prisma.user.findUnique({
        where: { id: existingUser.id },
        select: { id: true, user_id: true, nickname: true, avatar: true, bio: true, location: true, follow_count: true, fans_count: true, like_count: true, is_active: true, gender: true, zodiac_sign: true, mbti: true, education: true, major: true, interests: true }
      });
      const formattedUser = { ...user, id: Number(user.id) };
      if (formattedUser.interests) {
        try { formattedUser.interests = typeof formattedUser.interests === 'string' ? JSON.parse(formattedUser.interests) : formattedUser.interests; } catch (e) { formattedUser.interests = null; }
      }
      console.log(`OAuth2用户登录成功 - 用户ID: ${existingUser.id}, 汐社号: ${existingUser.user_id}`);
      res.json({
        code: RESPONSE_CODES.SUCCESS,
        message: '登录成功',
        data: {
          user: formattedUser,
          tokens: { access_token: accessToken, refresh_token: refreshToken, expires_in: 3600 },
          isNewUser: false,
          redirect_uri: storedState?.redirect_uri
        }
      });
    } else {
      const baseUserId = oauth2User.username ? oauth2User.username.toLowerCase().replace(/[^a-z0-9_]/g, '') : `user${oauth2User.id}`;
      let newUserId = baseUserId;
      let counter = 1;
      while (await prisma.user.findUnique({ where: { user_id: newUserId } })) {
        newUserId = `${baseUserId}${counter}`;
        counter++;
      }
      const newUser = await prisma.user.create({
        data: {
          user_id: newUserId,
          nickname: oauth2User.nickname || oauth2User.username || `用户${oauth2User.id}`,
          password: null,
          email: oauth2User.email || '',
          avatar: oauth2User.avatar || '',
          bio: '',
          location: ipLocation,
          oauth2_id: oauth2Id
        }
      });
      const accessToken = generateAccessToken({ userId: Number(newUser.id), user_id: newUser.user_id });
      const refreshToken = generateRefreshToken({ userId: Number(newUser.id), user_id: newUser.user_id });
      await prisma.userSession.create({
        data: { user_id: newUser.id, token: accessToken, refresh_token: refreshToken, user_agent: userAgent, is_active: true }
      });
      const user = await prisma.user.findUnique({
        where: { id: newUser.id },
        select: { id: true, user_id: true, nickname: true, avatar: true, bio: true, location: true, follow_count: true, fans_count: true, like_count: true, is_active: true, gender: true, zodiac_sign: true, mbti: true, education: true, major: true, interests: true }
      });
      const formattedUser = { ...user, id: Number(user.id) };
      console.log(`OAuth2用户注册成功 - 用户ID: ${newUser.id}, 汐社号: ${newUser.user_id}`);
      res.json({
        code: RESPONSE_CODES.SUCCESS,
        message: '注册成功',
        data: {
          user: formattedUser,
          tokens: { access_token: accessToken, refresh_token: refreshToken, expires_in: 3600 },
          isNewUser: true,
          redirect_uri: storedState?.redirect_uri
        }
      });
    }
  } catch (error) {
    console.error('OAuth2回调处理失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
});

module.exports = router;
