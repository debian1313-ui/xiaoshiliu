-- ============================================
-- OAuth2 用户ID列数据库迁移脚本
-- 用于关联OAuth2用户中心的用户ID
-- ============================================

-- 方案1：如果oauth2_id列不存在，直接添加BIGINT类型
-- ALTER TABLE `users` ADD COLUMN `oauth2_id` BIGINT(20) DEFAULT NULL COMMENT 'OAuth2用户中心的用户ID';

-- 方案2：如果oauth2_id列已存在（VARCHAR类型），需要修改为BIGINT类型
-- 注意：这会将现有的字符串ID转换为整数，请确保现有数据都是有效的整数字符串
ALTER TABLE `users` MODIFY COLUMN `oauth2_id` BIGINT(20) DEFAULT NULL COMMENT 'OAuth2用户中心的用户ID';

-- 添加唯一索引（如果不存在，会报错，可以忽略）
-- ALTER TABLE `users` ADD UNIQUE INDEX `uk_oauth2_id` (`oauth2_id`);
-- ALTER TABLE `users` ADD INDEX `idx_oauth2_id` (`oauth2_id`);

-- 完成
SELECT 'OAuth2列升级完成！oauth2_id已改为BIGINT类型' AS message;
