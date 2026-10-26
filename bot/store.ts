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
}

export interface Database {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T>(): Promise<T | null>;
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
  };
}
