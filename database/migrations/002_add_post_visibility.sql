-- 添加笔记可见性字段
-- Migration: 002_add_post_visibility
-- Description: 增加可见性设置(公开、私密、仅互关好友可见)，默认为公开

-- 添加 visibility 字段到 posts 表
ALTER TABLE `posts` 
ADD COLUMN `visibility` enum('public','private','friends_only') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'public' AFTER `is_draft`;

-- 添加索引以优化按可见性查询
CREATE INDEX `idx_visibility` ON `posts` (`visibility`);
