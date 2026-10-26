import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { Database } from "../../bot/store";

export function sqlite(): Database {
  const database = new DatabaseSync(":memory:");
  for (const file of ["0001_users.sql", "0002_form_at.sql"])
    database.exec(readFileSync(`bot/migrations/${file}`, "utf8"));
  return {
    prepare: (query) => {
      const statement = database.prepare(query);
      return {
        bind: (...values) => ({
          first: async <T>() => (statement.get(...(values as never[])) as T | undefined) ?? null,
          run: async () => ({ meta: { changes: Number(statement.run(...(values as never[])).changes) } }),
        }),
      };
    },
  };
}
