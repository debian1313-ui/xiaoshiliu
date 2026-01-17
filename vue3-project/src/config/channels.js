// 默认频道配置（推荐、视频、关注频道始终存在）
const DEFAULT_CHANNELS = [
  { id: 'recommend', label: '推荐', path: '/recommend' },
  { id: 'video', label: '视频', path: '/video' },
  { id: 'following', label: '关注', path: '/following' }
]

// 动态频道列表
let dynamicChannels = [...DEFAULT_CHANNELS]

// 从API加载分类数据并转换为频道格式
// Note: Categories have been removed, so this function now just returns default channels
export const loadChannelsFromAPI = async () => {
  // Categories are no longer used, return default channels only
  return DEFAULT_CHANNELS
}

// 获取当前频道列表
export const getChannels = () => {
  return dynamicChannels
}

// 兼容性：导出CHANNELS（向后兼容）
export const CHANNELS = dynamicChannels

// 获取有效的频道路径（用于路由验证）
export const getValidChannelPaths = () => {
  return dynamicChannels.map(ch => ch.path.substring(1)) // 去掉开头的 '/'
}

// 根据路径获取频道ID
export const getChannelIdByPath = (path) => {
  // 处理 /explore/xxx 格式的路径
  let channelPath = path
  if (path.startsWith('/explore/')) {
    channelPath = path.replace('/explore', '')
  } else if (path === '/explore') {
    return 'recommend' // 默认返回推荐频道
  }

  const channel = dynamicChannels.find(ch => ch.path === channelPath)
  return channel ? channel.id : 'recommend'
}

// 根据频道ID获取路径
export const getChannelPath = (channelId) => {
  const channel = dynamicChannels.find(ch => ch.id === channelId)
  return channel ? channel.path : '/recommend'
}