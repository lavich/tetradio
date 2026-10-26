CREATE TABLE users (
  user_id INTEGER PRIMARY KEY,
  thread INTEGER UNIQUE,
  ack_at INTEGER,
  blocked INTEGER NOT NULL DEFAULT 0,
  fb TEXT,
  fb_at INTEGER
);
