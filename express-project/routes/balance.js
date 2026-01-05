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
        reason: '汐社社区石榴点兑入'
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
        reason: '汐社社区石榴点兑出'
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

// 购买付费内容
router.post('/purchase-content', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { postId } = req.body;

    console.log(`🔓 [购买内容] 用户 ${userId} 尝试购买帖子 ${postId}`);

    if (!postId) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '缺少帖子ID'
      });
    }

    // 检查帖子是否存在并获取付费设置
    const [postRows] = await pool.execute(
      'SELECT id, user_id, title FROM posts WHERE id = ?',
      [postId.toString()]
    );

    if (postRows.length === 0) {
      console.log(`❌ [购买内容] 帖子 ${postId} 不存在`);
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        code: RESPONSE_CODES.NOT_FOUND,
        message: '帖子不存在'
      });
    }

    const post = postRows[0];

    // 检查是否是自己的帖子
    if (post.user_id.toString() === userId.toString()) {
      console.log(`⚠️ [购买内容] 用户 ${userId} 尝试购买自己的帖子`);
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '不能购买自己的内容'
      });
    }

    // 获取帖子的付费设置
    const [paymentRows] = await pool.execute(
      'SELECT enabled, payment_type, price FROM post_payment_settings WHERE post_id = ?',
      [postId.toString()]
    );

    if (paymentRows.length === 0 || !paymentRows[0].enabled) {
      console.log(`⚠️ [购买内容] 帖子 ${postId} 不是付费内容`);
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '该内容不是付费内容'
      });
    }

    const paymentSettings = paymentRows[0];
    const price = parseFloat(paymentSettings.price);

    console.log(`💰 [购买内容] 帖子价格: ${price} 石榴点`);

    // 检查是否已经购买过
    const [purchaseRows] = await pool.execute(
      'SELECT id FROM user_purchased_content WHERE user_id = ? AND post_id = ?',
      [userId.toString(), postId.toString()]
    );

    if (purchaseRows.length > 0) {
      console.log(`✅ [购买内容] 用户 ${userId} 已购买过帖子 ${postId}`);
      return res.json({
        code: RESPONSE_CODES.SUCCESS,
        data: { alreadyPurchased: true },
        message: '您已经购买过此内容'
      });
    }

    // 检查用户石榴点是否足够
    const currentPoints = await getOrCreateUserPoints(userId);
    console.log(`💎 [购买内容] 用户当前石榴点: ${currentPoints}, 需要: ${price}`);

    if (currentPoints < price) {
      console.log(`❌ [购买内容] 用户 ${userId} 石榴点不足`);
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: `石榴点不足，当前: ${currentPoints.toFixed(2)}，需要: ${price}`
      });
    }

    // 扣除石榴点
    const newPoints = await updateUserPoints(
      userId,
      -price,
      'purchase',
      `购买付费内容: ${post.title} (ID: ${postId})`
    );

    console.log(`✅ [购买内容] 用户 ${userId} 扣除 ${price} 石榴点，剩余: ${newPoints}`);

    // 给作者增加石榴点（扣除平台手续费后）
    const authorEarnings = price * 0.9; // 作者获得90%
    await updateUserPoints(
      post.user_id,
      authorEarnings,
      'earning',
      `付费内容收入: ${post.title} (ID: ${postId})`
    );

    console.log(`💵 [购买内容] 作者 ${post.user_id} 获得 ${authorEarnings} 石榴点`);

    // 记录购买（包含author_id和purchase_type，同时设置created_at和purchased_at）
    await pool.execute(
      'INSERT INTO user_purchased_content (user_id, post_id, author_id, price, purchase_type, created_at, purchased_at) VALUES (?, ?, ?, ?, ?, NOW(), NOW())',
      [userId.toString(), postId.toString(), post.user_id.toString(), price.toFixed(2), paymentSettings.payment_type || 'single']
    );

    console.log(`🎉 [购买内容] 购买记录已保存`);

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: {
        postId: postId,
        price: price,
        newPoints: newPoints,
        authorEarnings: authorEarnings
      },
      message: '购买成功！'
    });
  } catch (error) {
    console.error('❌ [购买内容] 购买失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: error.message || ERROR_MESSAGES.INTERNAL_SERVER_ERROR
    });
  }
});

// 检查用户是否已购买某个帖子
router.get('/check-purchase/:postId', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { postId } = req.params;

    console.log(`🔍 [检查购买] 用户 ${userId} 检查帖子 ${postId}`);

    const [purchaseRows] = await pool.execute(
      'SELECT id, purchased_at FROM user_purchased_content WHERE user_id = ? AND post_id = ?',
      [userId.toString(), postId.toString()]
    );

    const hasPurchased = purchaseRows.length > 0;
    console.log(`📋 [检查购买] 结果: ${hasPurchased ? '已购买' : '未购买'}`);

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: {
        hasPurchased: hasPurchased,
        purchasedAt: hasPurchased ? purchaseRows[0].purchased_at : null
      },
      message: 'success'
    });
  } catch (error) {
    console.error('❌ [检查购买] 检查失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR
    });
  }
});

module.exports = router;
