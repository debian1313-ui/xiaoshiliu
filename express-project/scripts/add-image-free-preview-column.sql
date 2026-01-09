-- ============================================
-- 图片免费预览标记迁移脚本
-- 为 post_images 表添加 is_free_preview 列
-- 用于标记每张图片是免费预览还是付费内容
-- ============================================

-- 添加 is_free_preview 列到 post_images 表
ALTER TABLE `post_images` 
ADD COLUMN `is_free_preview` tinyint(1) NOT NULL DEFAULT 1 COMMENT '是否免费预览：1-免费预览，0-付费内容'
AFTER `image_url`;

-- 添加索引以优化查询
ALTER TABLE `post_images`
ADD INDEX `idx_is_free_preview` (`is_free_preview`);

-- 完成
SELECT '图片免费预览标记列添加完成！' AS message;
