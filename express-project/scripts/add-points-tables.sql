-- ============================================
-- 石榴点（用户积分）表迁移脚本
-- 用于在现有数据库中添加石榴点相关表
-- ============================================

-- 1. 石榴点余额表（用户积分）
CREATE TABLE IF NOT EXISTS `user_points` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT COMMENT 'ID',
  `user_id` bigint(20) NOT NULL COMMENT '用户ID',
  `points` decimal(10,2) NOT NULL DEFAULT 0.00 COMMENT '石榴点余额',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_id` (`user_id`),
  KEY `idx_user_id` (`user_id`),
  CONSTRAINT `user_points_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='石榴点余额表';

-- 2. 石榴点变动记录表
CREATE TABLE IF NOT EXISTS `points_log` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT COMMENT 'ID',
  `user_id` bigint(20) NOT NULL COMMENT '用户ID',
  `amount` decimal(10,2) NOT NULL COMMENT '变动金额（正数增加，负数减少）',
  `balance_after` decimal(10,2) NOT NULL COMMENT '变动后余额',
  `type` varchar(50) NOT NULL COMMENT '变动类型：exchange_in-兑入，exchange_out-兑出',
  `reason` varchar(255) DEFAULT NULL COMMENT '变动原因',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_type` (`type`),
  KEY `idx_created_at` (`created_at`),
  CONSTRAINT `points_log_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='石榴点变动记录表';

-- 完成
SELECT '石榴点表创建完成！' AS message;
