import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/** 账号权限仅存服务端；浏览器提交的角色不会用于授权。 */
export const authUsers = sqliteTable('auth_users', {
  id: text('id').primaryKey(),
  username: text('username').notNull(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['SUPER_ADMIN', 'USER'] }).notNull(),
  createdAt: text('created_at').notNull(),
}, table => [
  uniqueIndex('auth_users_username_unique').on(table.username),
  check('auth_users_role_check', sql`${table.role} IN ('SUPER_ADMIN', 'USER')`),
]);

/** 只保存随机会话令牌的 SHA-256 摘要，不保存可直接登录的令牌。 */
export const authSessions = sqliteTable('auth_sessions', {
  tokenHash: text('token_hash').primaryKey(),
  userId: text('user_id').notNull().references(() => authUsers.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
}, table => [index('auth_sessions_expires_at_idx').on(table.expiresAt)]);

/** 失败次数持久化，避免 Worker 重启或切换实例后绕过登录限流。 */
export const authLoginAttempts = sqliteTable('auth_login_attempts', {
  attemptKey: text('attempt_key').primaryKey(),
  failureCount: integer('failure_count').notNull(),
  windowStart: integer('window_start').notNull(),
  blockedUntil: integer('blocked_until').notNull(),
});
