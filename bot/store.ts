export interface Row {
  userId: number;
  thread: number | null;
  ackAt: number | null;
  blocked: boolean;
  fb: string | null;
  fbAt: number | null;
  formAt: number | null;
}

/** Каждая запись меняет только свои столбцы: форма и вебхук пишут одну строку параллельно. */
export interface Store {
  byUser(userId: number): Promise<Row | null>;
  byThread(thread: number): Promise<Row | null>;
  setThread(userId: number, thread: number): Promise<void>;
  setAck(userId: number, at: number): Promise<void>;
  setFb(userId: number, fb: string | null, at: number | null): Promise<void>;
  setBlocked(userId: number, blocked: boolean): Promise<void>;
  claimForm(userId: number, now: number, interval: number): Promise<boolean>;
  /** Заблокированному остаётся только отметка: иначе удаление снимало бы блокировку. */
  forgetUser(userId: number): Promise<void>;
  blockedWithoutTopic(): Promise<number[]>;
  unblock(userId: number): Promise<boolean>;
}

export interface Database {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T>(): Promise<T | null>;
      all<T>(): Promise<{ results: T[] }>;
      run(): Promise<{ meta?: { changes?: number } }>;
    };
  };
}

interface Record {
  user_id: number;
  thread: number | null;
  ack_at: number | null;
  blocked: number;
  fb: string | null;
  fb_at: number | null;
  form_at: number | null;
}

const toRow = (record: Record | null): Row | null =>
  record && {
    userId: record.user_id,
    thread: record.thread,
    ackAt: record.ack_at,
    blocked: Boolean(record.blocked),
    fb: record.fb,
    fbAt: record.fb_at,
    formAt: record.form_at,
  };

export const emptyRow = (userId: number): Row => ({
  userId,
  thread: null,
  ackAt: null,
  blocked: false,
  fb: null,
  fbAt: null,
  formAt: null,
});

export function databaseStore(database: Database): Store {
  const upsert = async (userId: number, columns: string[], values: unknown[]) => {
    await database
      .prepare(
        `INSERT INTO users (user_id, ${columns.join(", ")}) VALUES (?, ${columns.map(() => "?").join(", ")})
         ON CONFLICT (user_id) DO UPDATE SET ${columns.map((column) => `${column} = excluded.${column}`).join(", ")}`,
      )
      .bind(userId, ...values)
      .run();
  };
  return {
    byUser: async (userId) =>
      toRow(await database.prepare("SELECT * FROM users WHERE user_id = ?").bind(userId).first<Record>()),
    byThread: async (thread) =>
      toRow(await database.prepare("SELECT * FROM users WHERE thread = ?").bind(thread).first<Record>()),
    setThread: (userId, thread) => upsert(userId, ["thread"], [thread]),
    setAck: (userId, at) => upsert(userId, ["ack_at"], [at]),
    setFb: (userId, fb, at) => upsert(userId, ["fb", "fb_at"], [fb, at]),
    setBlocked: (userId, blocked) => upsert(userId, ["blocked"], [blocked ? 1 : 0]),
    claimForm: async (userId, now, interval) => {
      const result = await database
        .prepare(
          `INSERT INTO users (user_id, form_at) VALUES (?, ?)
           ON CONFLICT (user_id) DO UPDATE SET form_at = excluded.form_at
           WHERE users.form_at IS NULL OR users.form_at <= ?`,
        )
        .bind(userId, now, now - interval)
        .run();
      return (result.meta?.changes ?? 0) > 0;
    },
    forgetUser: async (userId) => {
      await database
        .prepare(
          `UPDATE users SET thread = NULL, ack_at = NULL, fb = NULL, fb_at = NULL, form_at = NULL
           WHERE user_id = ? AND blocked = 1`,
        )
        .bind(userId)
        .run();
      await database.prepare("DELETE FROM users WHERE user_id = ? AND blocked = 0").bind(userId).run();
    },
    blockedWithoutTopic: async () =>
      (
        await database
          .prepare("SELECT user_id FROM users WHERE blocked = 1 AND thread IS NULL ORDER BY user_id")
          .bind()
          .all<{ user_id: number }>()
      ).results.map((record) => record.user_id),
    unblock: async (userId) => {
      const row = toRow(await database.prepare("SELECT * FROM users WHERE user_id = ?").bind(userId).first<Record>());
      if (!row?.blocked) return false;
      if (row.thread === null) await database.prepare("DELETE FROM users WHERE user_id = ?").bind(userId).run();
      else await upsert(userId, ["blocked"], [0]);
      return true;
    },
  };
}
