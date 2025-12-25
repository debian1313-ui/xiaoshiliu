/**
 * 余额中心路由
 * 处理用户石榴点的兑入和兑出功能
 */

const express = require('express');
const router = express.Router();
const { HTTP_STATUS, RESPONSE_CODES, ERROR_MESSAGES } = require('../constants');
const { pool, balanceCenter: balanceCenterConfig } = require('../config/config');
const { authenticateToken } = require('../middleware/auth');

// 获取或初始化用户石榴点
const getOrCreateUserPoints = async (userId) => {
  const [rows] = await pool.execute(
    'SELECT points FROM user_points WHERE user_id = ?',
    [userId.toString()]
  );
  
  if (rows.length === 0) {
    // 用户没有积分记录，创建一个
    await pool.execute(
      'INSERT INTO user_points (user_id, points) VALUES (?, 0.00)',
      [userId.toString()]
    );
    return 0.00;
  }
  
  return parseFloat(rows[0].points);
};

// 更新用户石榴点并记录日志
const updateUserPoints = async (userId, amount, type, reason) => {
  const currentPoints = await getOrCreateUserPoints(userId);
  const newPoints = currentPoints + amount;
  
  if (newPoints < 0) {
    throw new Error('石榴点不足');
  }
  
  // 更新积分
  await pool.execute(
    'UPDATE user_points SET points = ? WHERE user_id = ?',
    [newPoints.toFixed(2), userId.toString()]
  );
  
  // 记录日志
  await pool.execute(
    'INSERT INTO points_log (user_id, amount, balance_after, type, reason) VALUES (?, ?, ?, ?, ?)',
    [userId.toString(), amount.toFixed(2), newPoints.toFixed(2), type, reason]
  );
  
  return newPoints;
};

// 获取余额中心配置（前端需要）
router.get('/config', (req, res) => {
  res.json({
    code: RESPONSE_CODES.SUCCESS,
    data: {
      enabled: balanceCenterConfig.enabled,
      exchangeRateIn: balanceCenterConfig.exchangeRateIn,
      exchangeRateOut: balanceCenterConfig.exchangeRateOut
    },
    message: 'success'
  });
});

// 获取用户石榴点余额
router.get('/local-points', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const points = await getOrCreateUserPoints(userId);
    
    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: {
        points: points
      },
      message: 'success'
    });
  } catch (error) {
    console.error('获取石榴点余额失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR
    });
  }
});

// 获取用户外部余额信息
router.get('/user-balance', authenticateToken, async (req, res) => {
  try {
    // 检查余额中心是否启用
    if (!balanceCenterConfig.enabled) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '余额中心功能未启用'
      });
    }

    const userId = req.user.id;

    // 获取用户的oauth2_id和本地石榴点
    const [userRows] = await pool.execute(
      'SELECT oauth2_id FROM users WHERE id = ?',
      [userId.toString()]
    );

    if (userRows.length === 0) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        code: RESPONSE_CODES.NOT_FOUND,
        message: '用户不存在'
      });
    }

    const oauth2Id = userRows[0].oauth2_id;
    if (!oauth2Id) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '用户未绑定OAuth2账号，无法使用余额中心'
      });
    }

    // 获取本地石榴点余额
    const localPoints = await getOrCreateUserPoints(userId);

    // 调用外部API获取用户余额
    const response = await fetch(`${balanceCenterConfig.apiUrl}/api/external/user?user_id=${oauth2Id}`, {
      headers: {
        'X-API-Key': balanceCenterConfig.apiKey
      }
    });

    const result = await response.json();

    if (!result.success) {
      console.error('获取外部用户余额失败:', result);
      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        code: RESPONSE_CODES.ERROR,
        message: '获取余额信息失败'
      });
    }

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: {
        balance: result.data.balance,
        vip_level: result.data.vip_level,
        username: result.data.username,
        localPoints: localPoints
      },
      message: 'success'
    });
  } catch (error) {
    console.error('获取用户余额失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR
    });
  }
});

// 兑入石榴点（从用户中心转入本站）
router.post('/exchange-in', authenticateToken, async (req, res) => {
  try {
    // 检查余额中心是否启用
    if (!balanceCenterConfig.enabled) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '余额中心功能未启用'
      });
    }

    const userId = req.user.id;
    const { amount } = req.body;

    // 验证金额
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '请输入有效的兑换金额'
      });
    }

    // 获取用户的oauth2_id
    const [userRows] = await pool.execute(
      'SELECT oauth2_id FROM users WHERE id = ?',
      [userId.toString()]
    );

    if (userRows.length === 0) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        code: RESPONSE_CODES.NOT_FOUND,
        message: '用户不存在'
      });
    }

    const oauth2Id = userRows[0].oauth2_id;
    if (!oauth2Id) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '用户未绑定OAuth2账号，无法使用余额中心'
      });
    }

    // 计算实际扣除的外部余额（负数表示减少）
    const externalAmount = -numAmount;

    // 调用外部API扣除余额
    const response = await fetch(`${balanceCenterConfig.apiUrl}/api/external/balance`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': balanceCenterConfig.apiKey
      },
      body: JSON.stringify({
        user_id: oauth2Id,
        amount: externalAmount,
        reason: '小石榴社区石榴点兑入'
      })
    });

    const result = await response.json();

    if (!result.success) {
      console.error('外部余额扣除失败:', result);
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.ERROR,
        message: result.message || '余额不足或操作失败'
      });
    }

    // 计算本站获得的石榴点
    const localPoints = numAmount * balanceCenterConfig.exchangeRateIn;

    // 更新本站石榴点
    const newLocalPoints = await updateUserPoints(
      userId, 
      localPoints, 
      'exchange_in', 
      `从用户中心兑入 ${numAmount} 余额`
    );

    console.log(`用户 ${userId} 兑入成功: 外部余额 -${numAmount}, 石榴点 +${localPoints}`);

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: {
        exchangedAmount: numAmount,
        receivedPoints: localPoints,
        newBalance: result.data.balance,
        newLocalPoints: newLocalPoints
      },
      message: '兑入成功'
    });
  } catch (error) {
    console.error('兑入石榴点失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: error.message || ERROR_MESSAGES.INTERNAL_SERVER_ERROR
    });
  }
});

// 兑出石榴点（从本站转出到用户中心）
router.post('/exchange-out', authenticateToken, async (req, res) => {
  try {
    // 检查余额中心是否启用
    if (!balanceCenterConfig.enabled) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '余额中心功能未启用'
      });
    }

    const userId = req.user.id;
    const { amount } = req.body;

    // 验证金额
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '请输入有效的兑换金额'
      });
    }

    // 获取用户的oauth2_id
    const [userRows] = await pool.execute(
      'SELECT oauth2_id FROM users WHERE id = ?',
      [userId.toString()]
    );

    if (userRows.length === 0) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        code: RESPONSE_CODES.NOT_FOUND,
        message: '用户不存在'
      });
    }

    const oauth2Id = userRows[0].oauth2_id;
    if (!oauth2Id) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '用户未绑定OAuth2账号，无法使用余额中心'
      });
    }

    // 检查本站石榴点是否足够
    const currentPoints = await getOrCreateUserPoints(userId);
    if (currentPoints < numAmount) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: `石榴点不足，当前石榴点: ${currentPoints.toFixed(2)}`
      });
    }

    // 计算增加的外部余额
    const externalAmount = numAmount * balanceCenterConfig.exchangeRateOut;

    // 调用外部API增加余额
    const response = await fetch(`${balanceCenterConfig.apiUrl}/api/external/balance`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': balanceCenterConfig.apiKey
      },
      body: JSON.stringify({
        user_id: oauth2Id,
        amount: externalAmount,
        reason: '小石榴社区石榴点兑出'
      })
    });

    const result = await response.json();

    if (!result.success) {
      console.error('外部余额增加失败:', result);
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.ERROR,
        message: result.message || '操作失败'
      });
    }

    // 扣除本站石榴点
    const newLocalPoints = await updateUserPoints(
      userId, 
      -numAmount, 
      'exchange_out', 
      `兑出到用户中心 ${externalAmount} 余额`
    );

    console.log(`用户 ${userId} 兑出成功: 石榴点 -${numAmount}, 外部余额 +${externalAmount}`);

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: {
        exchangedPoints: numAmount,
        receivedBalance: externalAmount,
        newBalance: result.data.balance,
        newLocalPoints: newLocalPoints
      },
      message: '兑出成功'
    });
  } catch (error) {
    console.error('兑出石榴点失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: error.message || ERROR_MESSAGES.INTERNAL_SERVER_ERROR
    });
  }
});

module.exports = router;
