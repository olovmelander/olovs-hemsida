/* Drizzle SQLite schema for Cloudflare D1, matching migrations/0001_initial.sql.
   Better Auth reads user/session/account/verification through drizzleAdapter. */
import { integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const session = sqliteTable('session', {
  id: text('id').primaryKey(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  token: text('token').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
});

export const account = sqliteTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp' }),
  refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp' }),
  scope: text('scope'),
  password: text('password'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const verification = sqliteTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
});

export const playerProfile = sqliteTable('player_profile', {
  userId: text('user_id').primaryKey().references(() => user.id, { onDelete: 'cascade' }),
  handicap: integer('handicap'),
  handicapUpdatedAt: integer('handicap_updated_at').notNull().default(0),
  bagJson: text('bag_json'),
  bagUpdatedAt: integer('bag_updated_at').notNull().default(0),
  updatedAt: integer('updated_at').notNull(),
});

export const rounds = sqliteTable('rounds', {
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  courseSlug: text('course_slug').notNull(),
  roundId: integer('round_id').notNull(),
  courseName: text('course_name').notNull(),
  playedDate: text('played_date').notNull(),
  endedAt: integer('ended_at'),
  tee: text('tee'),
  handicap: integer('handicap'),
  holeCount: integer('hole_count').notNull().default(18),
  holesPlayed: integer('holes_played').notNull().default(0),
  strokes: integer('strokes').notNull().default(0),
  toPar: integer('to_par').notNull().default(0),
  points: integer('points'),
  putts: integer('putts').notNull().default(0),
  fairwaysHit: integer('fairways_hit').notNull().default(0),
  fairwaysTried: integer('fairways_tried').notNull().default(0),
  greensHit: integer('greens_hit').notNull().default(0),
  greensTried: integer('greens_tried').notNull().default(0),
  recordJson: text('record_json').notNull(),
  updatedAt: integer('updated_at').notNull(),
  deletedAt: integer('deleted_at'),
}, table => [
  primaryKey({ columns: [table.userId, table.courseSlug, table.roundId] }),
]);

export const roundShotSets = sqliteTable('round_shot_sets', {
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  courseSlug: text('course_slug').notNull(),
  roundId: integer('round_id').notNull(),
  updatedAt: integer('updated_at').notNull(),
  deletedAt: integer('deleted_at'),
}, table => [
  primaryKey({ columns: [table.userId, table.courseSlug, table.roundId] }),
]);

export const shots = sqliteTable('shots', {
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  courseSlug: text('course_slug').notNull(),
  roundId: integer('round_id').notNull(),
  seq: integer('seq').notNull(),
  hole: integer('hole').notNull(),
  club: text('club').notNull(),
  at: integer('at').notNull(),
  lengthM: real('length_m'),
  outcome: text('outcome').notNull(),
  penalty: integer('penalty').notNull().default(0),
  isPutt: integer('is_putt').notNull().default(0),
  suspect: integer('suspect').notNull().default(0),
  fromLie: text('from_lie'),
  toLie: text('to_lie'),
  shotJson: text('shot_json').notNull(),
}, table => [
  primaryKey({ columns: [table.userId, table.courseSlug, table.roundId, table.seq] }),
]);

export const liveRounds = sqliteTable('live_rounds', {
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  course: text('course').notNull(),
  id: integer('round_id').notNull(),
  writer: text('writer').notNull(),
  revision: integer('revision').notNull(),
  status: text('status').notNull(),
  snapshot: text('snapshot'),
  updatedAt: integer('updated_at').notNull(),
  lastOperation: text('last_operation').notNull(),
}, table => [primaryKey({ columns: [table.userId, table.course, table.id] })]);
