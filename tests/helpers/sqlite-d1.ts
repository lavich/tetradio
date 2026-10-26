import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { Database } from "../../bot/store";

export function sqlite(): Database {
  const database = new DatabaseSync(":memory:");
  database.exec(readFileSync("bot/migrations/0001_users.sql", "utf8"));
  return {
    prepare: (query) => {
      const statement = database.prepare(query);
      return {
        bind: (...values) => ({
          first: async <T>() => (statement.get(...(values as never[])) as T | undefined) ?? null,
          run: async () => statement.run(...(values as never[])),
        }),
      };
    },
  };
}
