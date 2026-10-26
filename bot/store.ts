export interface Row {
  userId: number;
  thread: number | null;
  ackAt: number | null;
  blocked: boolean;
  fb: string | null;
  fbAt: number | null;
}

export interface Store {
  byUser(userId: number): Promise<Row | null>;
  byThread(thread: number): Promise<Row | null>;
  save(row: Row): Promise<void>;
}

export interface Database {
  prepare(query: string): {
    bind(...values: unknown[]): { first<T>(): Promise<T | null>; run(): Promise<unknown> };
  };
}

interface Record {
  user_id: number;
  thread: number | null;
  ack_at: number | null;
  blocked: number;
  fb: string | null;
  fb_at: number | null;
}

const toRow = (record: Record | null): Row | null =>
  record && {
    userId: record.user_id,
    thread: record.thread,
    ackAt: record.ack_at,
    blocked: Boolean(record.blocked),
    fb: record.fb,
    fbAt: record.fb_at,
  };

export const emptyRow = (userId: number): Row => ({
  userId,
  thread: null,
  ackAt: null,
  blocked: false,
  fb: null,
  fbAt: null,
});

export const databaseStore = (database: Database): Store => ({
  byUser: async (userId) =>
    toRow(await database.prepare("SELECT * FROM users WHERE user_id = ?").bind(userId).first<Record>()),
  byThread: async (thread) =>
    toRow(await database.prepare("SELECT * FROM users WHERE thread = ?").bind(thread).first<Record>()),
  save: async (row) => {
    await database
      .prepare(
        `INSERT INTO users (user_id, thread, ack_at, blocked, fb, fb_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id) DO UPDATE SET thread = excluded.thread, ack_at = excluded.ack_at,
         blocked = excluded.blocked, fb = excluded.fb, fb_at = excluded.fb_at`,
      )
      .bind(row.userId, row.thread, row.ackAt, row.blocked ? 1 : 0, row.fb, row.fbAt)
      .run();
  },
});
