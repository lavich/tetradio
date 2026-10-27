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
      await waitlistStore(database).forget(userId);
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

export interface CourseCount {
  course: string;
  total: number;
  pending: number;
}

export interface WaitlistStore {
  joined(userId: number, course: string): Promise<boolean>;
  join(userId: number, course: string, at: number): Promise<boolean>;
  leave(userId: number, course: string): Promise<void>;
  forget(userId: number): Promise<void>;
  claimWrite(userId: number, now: number, interval: number): Promise<boolean>;
  claimLine(userId: number, now: number, interval: number): Promise<boolean>;
  total(course: string): Promise<number>;
  counts(): Promise<CourseCount[]>;
  pending(course: string, limit: number): Promise<number[]>;
  remaining(course: string): Promise<number>;
  markNotified(userId: number, course: string, at: number): Promise<void>;
  /** Повторная доставка того же обновления не должна рассылать снова. */
  claimNotify(messageId: number): Promise<boolean>;
  prune(notifiedBefore: number, idleBefore: number): Promise<void>;
}

const PENDING = `FROM waitlist w LEFT JOIN users u ON u.user_id = w.user_id
  WHERE w.course = ? AND w.notified_at IS NULL AND COALESCE(u.blocked, 0) = 0`;

export function waitlistStore(database: Database): WaitlistStore {
  const run = (query: string, ...values: unknown[]) =>
    database
      .prepare(query)
      .bind(...values)
      .run();
  const claim = async (column: "write_at" | "line_at", userId: number, now: number, interval: number) => {
    const result = await run(
      `INSERT INTO waitlist_users (user_id, ${column}) VALUES (?, ?)
       ON CONFLICT (user_id) DO UPDATE SET ${column} = excluded.${column}
       WHERE waitlist_users.${column} IS NULL OR waitlist_users.${column} <= ?`,
      userId,
      now,
      now - interval,
    );
    return (result.meta?.changes ?? 0) > 0;
  };
  return {
    joined: async (userId, course) =>
      (await database
        .prepare("SELECT 1 AS found FROM waitlist WHERE user_id = ? AND course = ?")
        .bind(userId, course)
        .first()) !== null,
    join: async (userId, course, at) =>
      ((
        await run(
          "INSERT INTO waitlist (user_id, course, at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
          userId,
          course,
          at,
        )
      ).meta?.changes ?? 0) === 1,
    leave: async (userId, course) => {
      await run("DELETE FROM waitlist WHERE user_id = ? AND course = ?", userId, course);
    },
    forget: async (userId) => {
      await run("DELETE FROM waitlist WHERE user_id = ?", userId);
      await run("DELETE FROM waitlist_users WHERE user_id = ?", userId);
    },
    claimWrite: (userId, now, interval) => claim("write_at", userId, now, interval),
    claimLine: (userId, now, interval) => claim("line_at", userId, now, interval),
    total: async (course) =>
      (await database
        .prepare("SELECT COUNT(*) AS total FROM waitlist WHERE course = ?")
        .bind(course)
        .first<{ total: number }>())!.total,
    counts: async () =>
      (
        await database
          .prepare(
            `SELECT course, COUNT(*) AS total, SUM(notified_at IS NULL) AS pending
             FROM waitlist GROUP BY course ORDER BY course`,
          )
          .bind()
          .all<CourseCount>()
      ).results.map((row) => ({ course: row.course, total: Number(row.total), pending: Number(row.pending) })),
    pending: async (course, limit) =>
      (
        await database
          .prepare(`SELECT w.user_id ${PENDING} ORDER BY w.at, w.user_id LIMIT ?`)
          .bind(course, limit)
          .all<{ user_id: number }>()
      ).results.map((row) => row.user_id),
    remaining: async (course) =>
      (await database.prepare(`SELECT COUNT(*) AS total ${PENDING}`).bind(course).first<{ total: number }>())!.total,
    markNotified: async (userId, course, at) => {
      await run("UPDATE waitlist SET notified_at = ? WHERE user_id = ? AND course = ?", at, userId, course);
    },
    claimNotify: async (messageId) =>
      ((
        await run(
          `INSERT INTO bot_state (key, value) VALUES ('notify', ?)
           ON CONFLICT (key) DO UPDATE SET value = excluded.value
           WHERE CAST(bot_state.value AS INTEGER) < CAST(excluded.value AS INTEGER)`,
          String(messageId),
        )
      ).meta?.changes ?? 0) > 0,
    prune: async (notifiedBefore, idleBefore) => {
      await run("DELETE FROM waitlist WHERE notified_at < ?", notifiedBefore);
      // Заблокированным автором рассылка не уходит, поэтому срок по рассылке до них не дошёл бы никогда.
      await run("DELETE FROM waitlist WHERE user_id IN (SELECT user_id FROM users WHERE blocked = 1)");
      await run(
        `DELETE FROM waitlist_users WHERE user_id NOT IN (SELECT user_id FROM waitlist)
         AND COALESCE(write_at, 0) < ? AND COALESCE(line_at, 0) < ?`,
        idleBefore,
        idleBefore,
      );
    },
  };
}
