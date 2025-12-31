/**
 * 系统设置 API 路由
 */

const express = require('express');
const router = express.Router();
const { HTTP_STATUS, RESPONSE_CODES } = require('../constants');
const { pool } = require('../config/config');
const { adminAuth } = require('../utils/uploadHelper');
const { 
  checkFfmpegAvailable, 
  getFfmpegConfig, 
  getQueueStatus, 
  getJobStatus, 
  setMaxConcurrent,
  getTranscodeConfig
} = require('../utils/videoTranscode');

/**
 * 获取所有系统设置
 * GET /api/settings
 */
router.get('/', adminAuth, async (req, res) => {
  try {
    const { group } = req.query;
    
    let query = 'SELECT * FROM system_settings';
    const params = [];
    
    if (group) {
      query += ' WHERE setting_group = ?';
      params.push(group);
    }
    
    query += ' ORDER BY setting_group, setting_key';
    
    const [rows] = await pool.execute(query, params);
    
    // 将设置转换为对象格式
    const settings = {};
    rows.forEach(row => {
      if (!settings[row.setting_group]) {
        settings[row.setting_group] = {};
      }
      settings[row.setting_group][row.setting_key] = {
        value: row.setting_value,
        description: row.description
      };
    });
    
    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '获取系统设置成功',
      data: settings
    });
  } catch (error) {
    console.error('获取系统设置失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: '获取系统设置失败'
    });
  }
});

/**
 * 获取单个设置
 * GET /api/settings/:key
 */
router.get('/:key', adminAuth, async (req, res) => {
  try {
    const { key } = req.params;
    
    const [rows] = await pool.execute(
      'SELECT * FROM system_settings WHERE setting_key = ?',
      [key]
    );
    
    if (rows.length === 0) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        code: RESPONSE_CODES.NOT_FOUND,
        message: '设置不存在'
      });
    }
    
    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '获取设置成功',
      data: rows[0]
    });
  } catch (error) {
    console.error('获取设置失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: '获取设置失败'
    });
  }
});

/**
 * 更新单个设置
 * PUT /api/settings/:key
 */
router.put('/:key', adminAuth, async (req, res) => {
  try {
    const { key } = req.params;
    const { value, description } = req.body;
    
    if (value === undefined) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '缺少设置值'
      });
    }
    
    // 检查设置是否存在
    const [existing] = await pool.execute(
      'SELECT id FROM system_settings WHERE setting_key = ?',
      [key]
    );
    
    if (existing.length === 0) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        code: RESPONSE_CODES.NOT_FOUND,
        message: '设置不存在'
      });
    }
    
    // 更新设置
    let updateQuery = 'UPDATE system_settings SET setting_value = ?';
    const params = [String(value)];
    
    if (description !== undefined) {
      updateQuery += ', description = ?';
      params.push(description);
    }
    
    updateQuery += ' WHERE setting_key = ?';
    params.push(key);
    
    await pool.execute(updateQuery, params);
    
    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '更新设置成功',
      data: { key, value: String(value) }
    });
  } catch (error) {
    console.error('更新设置失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: '更新设置失败'
    });
  }
});

/**
 * 批量更新设置
 * PUT /api/settings
 */
router.put('/', adminAuth, async (req, res) => {
  try {
    const { settings } = req.body;
    
    if (!settings || typeof settings !== 'object') {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '无效的设置数据'
      });
    }
    
    const updatedKeys = [];
    const errors = [];
    
    for (const [key, value] of Object.entries(settings)) {
      try {
        // 检查设置是否存在
        const [existing] = await pool.execute(
          'SELECT id FROM system_settings WHERE setting_key = ?',
          [key]
        );
        
        if (existing.length === 0) {
          // 如果不存在，创建新设置
          await pool.execute(
            'INSERT INTO system_settings (setting_key, setting_value, setting_group) VALUES (?, ?, ?)',
            [key, String(value), key.split('_')[0] || 'general']
          );
        } else {
          // 更新现有设置
          await pool.execute(
            'UPDATE system_settings SET setting_value = ? WHERE setting_key = ?',
            [String(value), key]
          );
        }
        
        updatedKeys.push(key);
      } catch (err) {
        errors.push({ key, error: err.message });
      }
    }
    
    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: `成功更新 ${updatedKeys.length} 个设置`,
      data: {
        updated: updatedKeys,
        errors: errors
      }
    });
  } catch (error) {
    console.error('批量更新设置失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: '批量更新设置失败'
    });
  }
});

/**
 * 获取视频设置（包括FFmpeg状态）
 * GET /api/settings/video/status
 */
router.get('/video/status', adminAuth, async (req, res) => {
  try {
    // 获取视频相关设置
    const [rows] = await pool.execute(
      'SELECT * FROM system_settings WHERE setting_group = ?',
      ['video']
    );
    
    const settings = {};
    rows.forEach(row => {
      settings[row.setting_key] = row.setting_value;
    });
    
    // 检查FFmpeg是否可用
    const ffmpegAvailable = await checkFfmpegAvailable();
    
    // 获取FFmpeg配置路径
    const ffmpegConfig = getFfmpegConfig();
    
    // 获取转码队列状态
    const queueStatus = getQueueStatus();
    
    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '获取视频设置成功',
      data: {
        settings,
        ffmpegAvailable,
        ffmpegConfig,
        queueStatus
      }
    });
  } catch (error) {
    console.error('获取视频设置失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: '获取视频设置失败'
    });
  }
});

/**
 * 获取视频播放器公开设置（无需认证）
 * GET /api/settings/video/player
 */
router.get('/video/player', async (req, res) => {
  try {
    // 获取视频播放器相关设置
    const [rows] = await pool.execute(
      `SELECT setting_key, setting_value FROM system_settings 
       WHERE setting_key IN ('video_player_show_center_play_button', 'video_player_autoplay', 'video_player_loop', 'video_player_show_controls')`
    );
    
    const settings = {
      showCenterPlayButton: false,
      autoplay: false,
      loop: false,
      showControls: true
    };
    
    rows.forEach(row => {
      switch (row.setting_key) {
        case 'video_player_show_center_play_button':
          settings.showCenterPlayButton = row.setting_value === 'true';
          break;
        case 'video_player_autoplay':
          settings.autoplay = row.setting_value === 'true';
          break;
        case 'video_player_loop':
          settings.loop = row.setting_value === 'true';
          break;
        case 'video_player_show_controls':
          settings.showControls = row.setting_value !== 'false';
          break;
      }
    });
    
    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '获取播放器设置成功',
      data: settings
    });
  } catch (error) {
    console.error('获取播放器设置失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: '获取播放器设置失败'
    });
  }
});

/**
 * 获取转码队列状态
 * GET /api/settings/video/queue
 */
router.get('/video/queue', adminAuth, async (req, res) => {
  try {
    const queueStatus = getQueueStatus();
    
    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '获取转码队列状态成功',
      data: queueStatus
    });
  } catch (error) {
    console.error('获取转码队列状态失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: '获取转码队列状态失败'
    });
  }
});

/**
 * 获取单个转码任务状态
 * GET /api/settings/video/queue/:taskId
 */
router.get('/video/queue/:taskId', adminAuth, async (req, res) => {
  try {
    const { taskId } = req.params;
    const jobStatus = getJobStatus(taskId);
    
    if (!jobStatus) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        code: RESPONSE_CODES.NOT_FOUND,
        message: '任务不存在'
      });
    }
    
    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '获取任务状态成功',
      data: jobStatus
    });
  } catch (error) {
    console.error('获取任务状态失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: '获取任务状态失败'
    });
  }
});

/**
 * 设置最大并发转码任务数
 * PUT /api/settings/video/queue/concurrent
 */
router.put('/video/queue/concurrent', adminAuth, async (req, res) => {
  try {
    const { maxConcurrent } = req.body;
    
    if (typeof maxConcurrent !== 'number' || maxConcurrent < 1 || maxConcurrent > 10) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '并发数必须是1-10之间的数字'
      });
    }
    
    setMaxConcurrent(maxConcurrent);
    
    // 同时更新数据库中的设置
    await pool.execute(
      `INSERT INTO system_settings (setting_key, setting_value, setting_group, description) 
       VALUES (?, ?, ?, ?) 
       ON DUPLICATE KEY UPDATE setting_value = ?`,
      [
        'video_transcode_max_concurrent', 
        String(maxConcurrent), 
        'video', 
        '最大并发转码任务数',
        String(maxConcurrent)
      ]
    );
    
    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '设置并发数成功',
      data: { maxConcurrent }
    });
  } catch (error) {
    console.error('设置并发数失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: '设置并发数失败'
    });
  }
});

/**
 * 创建新设置
 * POST /api/settings
 */
router.post('/', adminAuth, async (req, res) => {
  try {
    const { key, value, group, description } = req.body;
    
    if (!key || value === undefined) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '缺少必要参数'
      });
    }
    
    // 检查是否已存在
    const [existing] = await pool.execute(
      'SELECT id FROM system_settings WHERE setting_key = ?',
      [key]
    );
    
    if (existing.length > 0) {
      return res.status(HTTP_STATUS.CONFLICT).json({
        code: RESPONSE_CODES.CONFLICT,
        message: '设置键名已存在'
      });
    }
    
    // 创建设置
    const [result] = await pool.execute(
      'INSERT INTO system_settings (setting_key, setting_value, setting_group, description) VALUES (?, ?, ?, ?)',
      [key, String(value), group || 'general', description || null]
    );
    
    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '创建设置成功',
      data: {
        id: result.insertId,
        key,
        value: String(value),
        group: group || 'general'
      }
    });
  } catch (error) {
    console.error('创建设置失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: '创建设置失败'
    });
  }
});

/**
 * 删除设置
 * DELETE /api/settings/:key
 */
router.delete('/:key', adminAuth, async (req, res) => {
  try {
    const { key } = req.params;
    
    const [result] = await pool.execute(
      'DELETE FROM system_settings WHERE setting_key = ?',
      [key]
    );
    
    if (result.affectedRows === 0) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        code: RESPONSE_CODES.NOT_FOUND,
        message: '设置不存在'
      });
    }
    
    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '删除设置成功'
    });
  } catch (error) {
    console.error('删除设置失败:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      code: RESPONSE_CODES.ERROR,
      message: '删除设置失败'
    });
  }
});

module.exports = router;
