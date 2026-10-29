CREATE TABLE waitlist (
  user_id INTEGER NOT NULL,
  course TEXT NOT NULL,
  at INTEGER NOT NULL,
  notified_at INTEGER,
  PRIMARY KEY (user_id, course)
);
CREATE TABLE waitlist_users (
  user_id INTEGER PRIMARY KEY,
  write_at INTEGER,
  line_at INTEGER
);
CREATE TABLE bot_state (
  key TEXT PRIMARY KEY,
  value TEXT
);
