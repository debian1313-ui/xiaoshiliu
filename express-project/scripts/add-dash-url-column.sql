-- 为 post_videos 表添加 DASH manifest URL 字段
-- 用于存储转码后的 DASH 格式视频 URL

ALTER TABLE `post_videos` 
ADD COLUMN `dash_url` VARCHAR(500) NULL COMMENT 'DASH格式视频URL (manifest.mpd)' AFTER `video_url`;

-- 添加索引以优化查询
ALTER TABLE `post_videos` 
ADD INDEX `idx_dash_url` (`dash_url`);
