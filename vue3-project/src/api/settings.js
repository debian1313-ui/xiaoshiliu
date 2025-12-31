import request from './request.js'

/**
 * 系统设置 API
 */
export const settingsApi = {
  /**
   * 获取所有系统设置
   * @param {string} group - 设置分组（可选）
   * @returns {Promise} 设置数据
   */
  async getSettings(group = '') {
    const params = group ? `?group=${group}` : ''
    return await request.get(`/settings${params}`)
  },

  /**
   * 获取单个设置
   * @param {string} key - 设置键名
   * @returns {Promise} 设置数据
   */
  async getSetting(key) {
    return await request.get(`/settings/${key}`)
  },

  /**
   * 更新单个设置
   * @param {string} key - 设置键名
   * @param {string} value - 设置值
   * @returns {Promise} 更新结果
   */
  async updateSetting(key, value) {
    return await request.put(`/settings/${key}`, { value })
  },

  /**
   * 批量更新设置
   * @param {Object} settings - 设置对象 { key: value, ... }
   * @returns {Promise} 更新结果
   */
  async updateSettings(settings) {
    return await request.put('/settings', { settings })
  },

  /**
   * 获取视频设置状态（包括FFmpeg可用性）
   * @returns {Promise} 视频设置和FFmpeg状态
   */
  async getVideoStatus() {
    return await request.get('/settings/video/status')
  },

  /**
   * 创建新设置
   * @param {Object} data - 设置数据 { key, value, group, description }
   * @returns {Promise} 创建结果
   */
  async createSetting(data) {
    return await request.post('/settings', data)
  },

  /**
   * 删除设置
   * @param {string} key - 设置键名
   * @returns {Promise} 删除结果
   */
  async deleteSetting(key) {
    return await request.delete(`/settings/${key}`)
  }
}

export default settingsApi
