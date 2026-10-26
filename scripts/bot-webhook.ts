/**
 * Регистрация вебхука @TetradioBot: `node --env-file=.env.bot scripts/bot-webhook.ts [--delete]`.
 * Токен — из файла, а не из командной строки, чтобы не оставаться в истории оболочки.
 */
type Env = Record<string, string | undefined>;
interface Result {
  code: number;
  out: string[];
  err: string[];
}
interface Answer {
  ok: boolean;
  description?: string;
  result?: { url?: string; pending_update_count?: number; last_error_message?: string };
}

const SECRET_FORMAT = /^[A-Za-z0-9_-]{1,256}$/;

export async function webhook(args: string[], env: Env, request: typeof fetch = fetch): Promise<Result> {
  const result: Result = { code: 0, out: [], err: [] };
  const unknown = args.filter((arg) => arg !== "--delete");
  if (unknown.length) return { ...result, code: 1, err: [`Неизвестные аргументы: ${unknown.join(" ")}.`] };
  const remove = args.includes("--delete");
  const token = env.BOT_TOKEN;
  const missing = ["BOT_TOKEN", ...(remove ? [] : ["WEBHOOK_URL", "WEBHOOK_SECRET"])].filter((key) => !env[key]);
  if (missing.length) return { ...result, code: 1, err: [`Не заданы переменные: ${missing.join(", ")}.`] };
  if (!remove && !SECRET_FORMAT.test(env.WEBHOOK_SECRET!))
    return {
      ...result,
      code: 1,
      err: ["WEBHOOK_SECRET: только A-Z, a-z, 0-9, _ и -, до 256 символов (openssl rand -hex 32)."],
    };

  // Адрес запроса содержит токен, а сообщения fetch и Telegram могут его повторить.
  const hide = (text: string) => text.replaceAll(token!, "<BOT_TOKEN>");
  const call = async (method: string, body: object = {}): Promise<Answer | null> => {
    try {
      const response = await request(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const answer = (await response.json().catch(() => null)) as Answer | null;
      if (answer?.ok) return answer;
      result.err.push(hide(`${method}: ${answer?.description ?? `HTTP ${response.status}`}`));
    } catch (error) {
      const cause = error instanceof Error && error.cause instanceof Error ? ` (${error.cause.message})` : "";
      result.err.push(hide(`${method}: ${error instanceof Error ? error.message : String(error)}${cause}`));
    }
    result.code = 1;
    return null;
  };

  const changed = remove
    ? await call("deleteWebhook")
    : await call("setWebhook", {
        url: env.WEBHOOK_URL,
        secret_token: env.WEBHOOK_SECRET,
        allowed_updates: ["message"],
        drop_pending_updates: true,
      });
  if (!changed) return result;
  const info = (await call("getWebhookInfo"))?.result;
  if (!info) return result;
  result.out.push(`Вебхук: ${info.url || "не задан"}`, `Ожидают доставки: ${info.pending_update_count ?? 0}`);
  if (info.last_error_message) result.out.push(hide(`Последняя ошибка доставки: ${info.last_error_message}`));
  return result;
}

if (process.argv[1]?.endsWith("bot-webhook.ts")) {
  const { code, out, err } = await webhook(process.argv.slice(2), process.env);
  for (const line of out) console.log(line);
  for (const line of err) console.error(line);
  process.exit(code);
}
