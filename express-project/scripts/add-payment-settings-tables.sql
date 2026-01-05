-- ============================================
-- 付费设置表迁移脚本
-- 用于在现有数据库中添加帖子付费设置相关表
-- ============================================

-- 1. 帖子付费设置表
CREATE TABLE IF NOT EXISTS `post_payment_settings` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT COMMENT 'ID',
  `post_id` bigint(20) NOT NULL COMMENT '笔记ID',
  `enabled` tinyint(1) NOT NULL DEFAULT 0 COMMENT '是否启用付费',
  `payment_type` varchar(20) NOT NULL DEFAULT 'single' COMMENT '付费类型：single-单篇付费，multi-多篇付费',
  `price` decimal(10,2) NOT NULL DEFAULT 0.00 COMMENT '价格（石榴点）',
  `free_preview_count` int(11) NOT NULL DEFAULT 0 COMMENT '免费预览数量',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_post_id` (`post_id`),
  KEY `idx_post_id` (`post_id`),
  CONSTRAINT `post_payment_settings_ibfk_1` FOREIGN KEY (`post_id`) REFERENCES `posts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='帖子付费设置表';

-- 2. 用户付费内容购买记录表
CREATE TABLE IF NOT EXISTS `user_purchased_content` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT COMMENT 'ID',
  `user_id` bigint(20) NOT NULL COMMENT '购买用户ID',
  `post_id` bigint(20) NOT NULL COMMENT '购买的笔记ID',
  `author_id` bigint(20) NOT NULL COMMENT '作者ID',
  `price` decimal(10,2) NOT NULL COMMENT '购买价格',
  `purchase_type` varchar(20) NOT NULL DEFAULT 'single' COMMENT '购买类型：single-单篇购买，multi-多篇订阅',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `purchased_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '购买时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_post` (`user_id`, `post_id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_post_id` (`post_id`),
  KEY `idx_author_id` (`author_id`),
  CONSTRAINT `user_purchased_content_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `user_purchased_content_ibfk_2` FOREIGN KEY (`post_id`) REFERENCES `posts` (`id`) ON DELETE CASCADE,
  CONSTRAINT `user_purchased_content_ibfk_3` FOREIGN KEY (`author_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户付费内容购买记录表';

-- 3. 作者多篇订阅表（用于存储用户订阅某作者所有付费内容的记录）
CREATE TABLE IF NOT EXISTS `user_author_subscriptions` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT COMMENT 'ID',
  `user_id` bigint(20) NOT NULL COMMENT '订阅用户ID',
  `author_id` bigint(20) NOT NULL COMMENT '被订阅作者ID',
  `price` decimal(10,2) NOT NULL COMMENT '订阅价格',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '订阅时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_author` (`user_id`, `author_id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_author_id` (`author_id`),
  CONSTRAINT `user_author_subscriptions_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `user_author_subscriptions_ibfk_2` FOREIGN KEY (`author_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户作者订阅表';

-- 完成
SELECT '付费设置表创建完成！' AS message;
