import { eq } from 'drizzle-orm';
import { db, sqlite, type DbOrTx } from './client';
import { kv, outbox } from './schema';

const TABLES = [
  'users',
  'projects',
  'project_members',
  'channels',
  'channel_members',
  'messages',
  'tasks',
  'task_history',
  'checkins',
  'activity',
  'outbox',
  'kv',
] as const;

const DDL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, phone TEXT NOT NULL, company_role TEXT NOT NULL,
  avatar_color TEXT NOT NULL, is_active INTEGER NOT NULL, online INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY NOT NULL, company_id TEXT NOT NULL, name TEXT NOT NULL, client TEXT NOT NULL,
  address TEXT NOT NULL, stage TEXT NOT NULL, start_date TEXT NOT NULL, planned_finish TEXT NOT NULL,
  baseline_finish TEXT, baseline_locked INTEGER NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS project_members (
  project_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, job_title TEXT NOT NULL,
  PRIMARY KEY (project_id, user_id)
);
CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY NOT NULL, company_id TEXT NOT NULL, project_id TEXT, name TEXT NOT NULL,
  kind TEXT NOT NULL, is_private INTEGER NOT NULL, posting_policy TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS channel_members (
  channel_id TEXT NOT NULL, user_id TEXT NOT NULL, last_read_message_id TEXT,
  PRIMARY KEY (channel_id, user_id)
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY NOT NULL, channel_id TEXT NOT NULL, sender_id TEXT NOT NULL, type TEXT NOT NULL,
  body TEXT, data TEXT, thread_parent_id TEXT, reactions TEXT NOT NULL, status TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS messages_channel_created ON messages (channel_id, created_at);
CREATE INDEX IF NOT EXISTS messages_thread ON messages (thread_parent_id);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL, phase TEXT NOT NULL, name TEXT NOT NULL,
  description TEXT, owner_id TEXT, planned_start TEXT NOT NULL, planned_finish TEXT NOT NULL,
  baseline_start TEXT, baseline_finish TEXT, actual_start TEXT, actual_finish TEXT, status TEXT NOT NULL,
  percent INTEGER NOT NULL, channel_id TEXT, updated_at TEXT NOT NULL, deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS tasks_project_phase ON tasks (project_id, phase);
CREATE TABLE IF NOT EXISTS task_history (
  id TEXT PRIMARY KEY NOT NULL, task_id TEXT NOT NULL, user_id TEXT NOT NULL, field TEXT NOT NULL,
  from_value TEXT, to_value TEXT, via TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS task_history_task ON task_history (task_id);
CREATE TABLE IF NOT EXISTS checkins (
  id TEXT PRIMARY KEY NOT NULL, task_id TEXT NOT NULL, user_id TEXT NOT NULL, asked_at TEXT NOT NULL, answer TEXT
);
CREATE TABLE IF NOT EXISTS activity (
  id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL, kind TEXT NOT NULL, actor_id TEXT NOT NULL,
  project_id TEXT, channel_id TEXT, message_id TEXT, task_ids TEXT NOT NULL, text TEXT NOT NULL,
  lines TEXT NOT NULL, created_at TEXT NOT NULL, read_at TEXT
);
CREATE TABLE IF NOT EXISTS outbox (
  id TEXT PRIMARY KEY NOT NULL, kind TEXT NOT NULL, lane TEXT NOT NULL, entity_id TEXT NOT NULL,
  payload TEXT NOT NULL, depends_on TEXT, status TEXT NOT NULL, attempts INTEGER NOT NULL,
  next_attempt_at INTEGER NOT NULL, last_error_code TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS outbox_status_next ON outbox (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS outbox_lane_created ON outbox (lane, created_at);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
`;

let initialised = false;

/**
 * Runs once per app launch.
 * Outbox rule 5: anything left in `sending` by a killed app goes back to `pending`.
 * Demo only: the mock server lives in memory and is gone after a reload, so local data from
 * the previous run is dropped as well. With a real backend, delete the `dropAll()` call.
 */
export function initDb(): void {
  if (initialised) return;
  initialised = true;
  sqlite.execSync('PRAGMA journal_mode = WAL;');
  sqlite.execSync(DDL);
  recoverInterruptedSends();
  dropAll();
  sqlite.execSync(DDL);
}

export function recoverInterruptedSends(): void {
  db.update(outbox).set({ status: 'pending' }).where(eq(outbox.status, 'sending')).run();
}

function dropAll(): void {
  for (const t of TABLES) sqlite.execSync(`DROP TABLE IF EXISTS ${t};`);
}

/**
 * Removes every row (logout, user switch, "Wipe local DB").
 * `WHERE 1` matters: a bare `DELETE FROM t` uses SQLite's truncate optimisation, which skips
 * the change hook, so live queries would keep showing the previous user's rows.
 */
export function wipeLocalDb(): void {
  sqlite.withTransactionSync(() => {
    for (const t of TABLES) sqlite.execSync(`DELETE FROM ${t} WHERE 1;`);
  });
}

export function kvGet(key: string, conn: DbOrTx = db): string | null {
  return conn.select().from(kv).where(eq(kv.key, key)).get()?.value ?? null;
}

export function kvSet(key: string, value: string, conn: DbOrTx = db): void {
  conn.insert(kv).values({ key, value }).onConflictDoUpdate({ target: kv.key, set: { value } }).run();
}
