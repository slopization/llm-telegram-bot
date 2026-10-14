import { DatabaseSync } from "node:sqlite";

const MIGRATIONS = [
  `
  CREATE TABLE nodes (
    id INTEGER PRIMARY KEY,
    parent_id INTEGER REFERENCES nodes(id),
    chat_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('prompt', 'answer', 'run', 'error')),
    text TEXT NOT NULL,
    provider TEXT,
    model TEXT,
    transcript TEXT,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    web_searches INTEGER NOT NULL DEFAULT 0,
    sandbox_runs INTEGER NOT NULL DEFAULT 0,
    day TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX nodes_user_day ON nodes (user_id, day);

  CREATE TABLE tg_messages (
    chat_id INTEGER NOT NULL,
    message_id INTEGER NOT NULL,
    node_id INTEGER NOT NULL REFERENCES nodes(id),
    PRIMARY KEY (chat_id, message_id)
  ) WITHOUT ROWID;

  CREATE TABLE pending (
    id TEXT PRIMARY KEY,
    chat_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    node_id INTEGER NOT NULL REFERENCES nodes(id),
    message_id INTEGER NOT NULL,
    thread_id INTEGER,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE user_prefs (
    user_id INTEGER PRIMARY KEY,
    provider TEXT NOT NULL,
    model TEXT NOT NULL
  );
  `,
  `
  ALTER TABLE nodes ADD COLUMN cache_read_tokens INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE nodes ADD COLUMN cache_write_tokens INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE nodes ADD COLUMN cost_usd REAL;
  CREATE INDEX nodes_provider_day ON nodes (provider, day);
  `,
];

export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  const { user_version: version } = db.prepare("PRAGMA user_version").get() as {
    user_version: number;
  };
  for (let index = version; index < MIGRATIONS.length; index++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[index] ?? "");
      db.exec(`PRAGMA user_version = ${index + 1}`);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  return db;
}
