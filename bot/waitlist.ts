import type { Answer, Deps, Message } from "./feedback";
import type { WaitlistBody } from "./form";
import {
  noWaitlistFor,
  NO_WAITLIST,
  NOTIFY_TOO_LONG,
  NOTIFY_USAGE,
  notifyReport,
  notifyStopped,
  waitlistCount,
  waitlistLine,
} from "./texts";

export const WRITE_INTERVAL = 5_000;
export const LINE_INTERVAL = 10 * 60 * 1000;
export const NOTIFY_BATCH = 30;
export const MAX_NOTIFY = 4096;
const DAY = 24 * 60 * 60 * 1000;
export const KEEP_NOTIFIED = 30 * DAY;

export interface Outcome {
  result: "ok" | "rate" | "failed";
  body?: { joined: boolean };
  line?: () => Promise<void>;
}

export async function fromWaitlist(userId: number, body: WaitlistBody, deps: Deps): Promise<Outcome> {
  const { waitlist } = deps;
  try {
    if (body.action === "forget") {
      await waitlist.forget(userId);
      return { result: "ok" };
    }
    const { course } = body;
    if (body.action === "status") return { result: "ok", body: { joined: await waitlist.joined(userId, course) } };
    if (!(await waitlist.claimWrite(userId, deps.now(), WRITE_INTERVAL))) return { result: "rate" };
    if (body.action === "leave") {
      await waitlist.leave(userId, course);
      return { result: "ok", body: { joined: false } };
    }
    const added = await waitlist.join(userId, course, deps.now());
    return { result: "ok", body: { joined: true }, ...(added && { line: () => announce(userId, course, deps) }) };
  } catch {
    return { result: "failed" };
  }
}

async function announce(userId: number, course: string, deps: Deps) {
  if (deps.waitlistThread === null) return;
  if ((await deps.store.byUser(userId))?.blocked) return;
  if (!(await deps.waitlist.claimLine(userId, deps.now(), LINE_INTERVAL))) return;
  await deps.api("sendMessage", {
    chat_id: Number(deps.supportChatId),
    message_thread_id: deps.waitlistThread,
    text: waitlistLine(course, await deps.waitlist.total(course)),
  });
}

export async function waitlistSummary(deps: Deps): Promise<string> {
  const counts = await deps.waitlist.counts();
  const empty = deps.waitlistCourses
    .filter((course) => !counts.some((count) => count.course === course))
    .map((course) => ({ course, total: 0, pending: 0 }));
  const all = [...counts, ...empty].sort((a, b) => (a.course < b.course ? -1 : 1));
  return all.length
    ? all.map((count) => waitlistCount(count.course, count.total, count.pending)).join("\n")
    : NO_WAITLIST;
}

const NOTIFY = /^\/notify(?:@\w+)?\s+(\S+)\s+([\s\S]+)$/i;
const UNDELIVERABLE = /chat not found|user is deactivated/i;

/** null — то же обновление доставлено повторно. */
export async function notify(message: Message, deps: Deps): Promise<string | null> {
  if (!(await deps.waitlist.claimNotify(message.message_id))) return null;
  const match = NOTIFY.exec(typeof message.text === "string" ? message.text.trim() : "");
  if (!match) return NOTIFY_USAGE;
  const [, course, text] = match;
  if (text.length > MAX_NOTIFY) return NOTIFY_TOO_LONG;
  if (!(await deps.waitlist.total(course))) return noWaitlistFor(course);
  let [sent, failed] = [0, 0];
  let stopped: string | null = null;
  for (const userId of await deps.waitlist.pending(course, NOTIFY_BATCH)) {
    let answer: Answer;
    try {
      answer = await deps.api("sendMessage", { chat_id: userId, text });
    } catch {
      // Сообщение исключения fetch может содержать адрес запроса с токеном бота.
      stopped = "Bot API недоступен";
      break;
    }
    if (answer.ok) sent++;
    else if (answer.error_code === 403 || (answer.error_code === 400 && UNDELIVERABLE.test(answer.description ?? "")))
      failed++;
    else {
      stopped = answer.description ?? `ошибка ${answer.error_code ?? "Bot API"}`;
      break;
    }
    try {
      await deps.waitlist.markNotified(userId, course, deps.now());
    } catch {
      stopped = "хранилище недоступно, последний получатель может получить текст повторно";
      break;
    }
  }
  const left = await deps.waitlist.remaining(course).catch(() => null);
  const report = left === null ? `Отправлено ${sent}, не доставлено ${failed}.` : notifyReport(sent, failed, left);
  return stopped === null ? report : `${notifyStopped(stopped)}\n${report}`;
}
