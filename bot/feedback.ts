import { emptyRow, type Row, type Store } from "./store";
import {
  ACK,
  BLOCKED,
  FAILED,
  GREETING,
  INVITE,
  UNBLOCKED,
  UNKNOWN_COMMAND,
  UNREAD,
  formText,
  header,
  notDelivered,
  openButton,
  reportLine,
  topicName,
  type Person,
} from "./texts";

export interface Message {
  message_id: number;
  chat: { id: number; type: string };
  from?: Person & { is_bot?: boolean };
  sender_chat?: { id: number };
  text?: unknown;
  message_thread_id?: number;
  is_topic_message?: boolean;
  [key: string]: unknown;
}
export interface Update {
  message?: Message | null;
}
export type Reply = { method: string } & Record<string, unknown>;

export interface Answer {
  ok: boolean;
  result?: unknown;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
}
export interface Deps {
  api(method: string, body: object): Promise<Answer>;
  store: Store;
  supportChatId: string;
  sentryEventUrl: string;
  appUrl: string;
  now(): number;
  sleep(ms: number): Promise<void>;
}

const DAY = 24 * 60 * 60 * 1000;
const REPORT_ID = /^[0-9a-f]{32}$/;
const SERVICE = [
  "new_chat_members",
  "left_chat_member",
  "new_chat_title",
  "new_chat_photo",
  "delete_chat_photo",
  "group_chat_created",
  "supergroup_chat_created",
  "pinned_message",
  "forum_topic_created",
  "forum_topic_edited",
  "forum_topic_closed",
  "forum_topic_reopened",
  "general_forum_topic_hidden",
  "general_forum_topic_unhidden",
  "message_auto_delete_timer_changed",
  "migrate_from_chat_id",
  "video_chat_scheduled",
  "video_chat_started",
  "video_chat_ended",
  "video_chat_participants_invited",
  "chat_background_set",
  "write_access_allowed",
  "users_shared",
  "chat_shared",
];
const isService = (message: Message) => SERVICE.some((key) => key in message);

class BotApiError extends Error {}

async function call(deps: Deps, method: string, body: object): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    const answer = await deps.api(method, body);
    if (answer.ok) return answer.result;
    const wait = answer.parameters?.retry_after;
    if (answer.error_code === 429 && attempt === 0 && wait !== undefined && wait <= 5) {
      await deps.sleep(wait * 1000);
      continue;
    }
    throw new BotApiError(answer.description ?? `ошибка ${answer.error_code ?? "Bot API"}`);
  }
}

const words = (text: unknown) => (typeof text === "string" ? text.trim().split(/\s+/) : []);
const command = (text: unknown) => {
  const first = words(text)[0] ?? "";
  return first.startsWith("/") ? first.replace(/@\w+$/, "").toLowerCase() : null;
};

const say = (chatId: number, text: string, extra: object = {}): Reply => ({
  method: "sendMessage",
  chat_id: chatId,
  text,
  ...extra,
});

export function legacyReply(update: Update | null, appUrl: string): Reply | null {
  const message = update?.message;
  if (message?.chat?.type !== "private" || typeof message.chat.id !== "number") return null;
  const text = command(message.text) === "/start" ? GREETING : UNREAD;
  return say(message.chat.id, text, { reply_markup: openButton(appUrl) });
}

export async function handle(update: Update | null, deps: Deps): Promise<Reply | null> {
  const message = update?.message;
  if (!message || typeof message.chat?.id !== "number") return null;
  if (message.chat.type === "private") return fromUser(message, deps);
  if (String(message.chat.id) === deps.supportChatId) return fromAuthor(message, deps);
  return null;
}

async function fromUser(message: Message, deps: Deps): Promise<Reply | null> {
  const chatId = message.chat.id;
  if (command(message.text) === "/start") {
    const parameter = words(message.text)[1] ?? "";
    const report = parameter.startsWith("fb_") && REPORT_ID.test(parameter.slice(3)) ? parameter.slice(3) : null;
    if (parameter !== "feedback" && !report) return say(chatId, GREETING, { reply_markup: openButton(deps.appUrl) });
    if (report) await rememberReport(chatId, report, deps).catch(() => undefined);
    return say(chatId, INVITE);
  }

  if (isService(message)) return null;
  let row: Row | null;
  try {
    row = await deps.store.byUser(chatId);
  } catch {
    return say(chatId, FAILED);
  }
  if (row?.blocked) return null;
  const current = row ?? emptyRow(chatId);
  const report = current.fb && current.fbAt !== null && deps.now() - current.fbAt < DAY ? current.fb : null;
  try {
    await intoTopic(current, { ...message.from, id: chatId }, report, (thread) => copyTo(thread, message, deps), deps);
  } catch {
    return say(chatId, FAILED);
  }

  const textual = current.ackAt === null || deps.now() - current.ackAt >= DAY;
  if (textual) await deps.store.setAck(chatId, deps.now()).catch(() => undefined);
  if (current.fb !== null) await deps.store.setFb(chatId, null, null).catch(() => undefined);
  return textual
    ? say(chatId, ACK)
    : {
        method: "setMessageReaction",
        chat_id: chatId,
        message_id: message.message_id,
        reaction: [{ type: "emoji", emoji: "👍" }],
      };
}

export interface Form {
  user: Person;
  text: string;
  version: string;
  platform: string;
  reportId: string | null;
  canReply: boolean;
}
export const FORM_INTERVAL = 10_000;

export async function fromForm(form: Form, deps: Deps): Promise<"ok" | "rate" | "failed"> {
  const userId = form.user.id;
  try {
    const row = await deps.store.byUser(userId);
    if (row?.blocked) return "ok";
    if (!(await deps.store.claimForm(userId, deps.now(), FORM_INTERVAL))) return "rate";
    const text = formText(form.version, form.platform, form.canReply, form.text);
    await intoTopic(row ?? emptyRow(userId), form.user, form.reportId, (thread) => post(deps, thread, text), deps);
  } catch {
    return "failed";
  }
  return "ok";
}

async function rememberReport(userId: number, report: string, deps: Deps) {
  const row = await deps.store.byUser(userId);
  if (row?.blocked || row?.fb === report) return;
  await deps.store.setFb(userId, report, deps.now());
}

async function intoTopic(
  row: Row,
  person: Person,
  report: string | null,
  payload: (thread: number) => Promise<unknown>,
  deps: Deps,
) {
  const deliver = async (thread: number) => {
    if (report) await post(deps, thread, reportLine(deps.sentryEventUrl ? `${deps.sentryEventUrl}${report}/` : report));
    await payload(thread);
  };
  const thread = row.thread ?? (await openTopic(row.userId, person, deps));
  try {
    await deliver(thread);
  } catch (error) {
    if (!(error instanceof BotApiError) || !/thread not found/i.test(error.message)) throw error;
    await deliver(await openTopic(row.userId, person, deps));
  }
}

async function openTopic(userId: number, person: Person, deps: Deps): Promise<number> {
  const topic = (await call(deps, "createForumTopic", {
    chat_id: Number(deps.supportChatId),
    name: topicName(person),
  })) as { message_thread_id: number };
  await deps.store.setThread(userId, topic.message_thread_id);
  await post(deps, topic.message_thread_id, header(person));
  return topic.message_thread_id;
}

const post = (deps: Deps, thread: number, text: string) =>
  call(deps, "sendMessage", { chat_id: Number(deps.supportChatId), message_thread_id: thread, text });

const copyTo = (thread: number, message: Message, deps: Deps) =>
  call(deps, "copyMessage", {
    chat_id: Number(deps.supportChatId),
    message_thread_id: thread,
    from_chat_id: message.chat.id,
    message_id: message.message_id,
  });

async function fromAuthor(message: Message, deps: Deps): Promise<Reply | null> {
  const thread = message.message_thread_id;
  if (!message.is_topic_message || typeof thread !== "number") return null;
  if (isService(message)) return null;
  const anonymous = message.sender_chat?.id === message.chat.id;
  if (message.from?.is_bot && !anonymous) return null;
  const inThread = (text: string) => say(message.chat.id, text, { message_thread_id: thread });
  let row: Row | null;
  try {
    row = await deps.store.byThread(thread);
  } catch {
    return inThread(notDelivered("хранилище связей недоступно"));
  }
  if (!row) return null;

  const name = command(message.text);
  if (name === "/block" || name === "/unblock") {
    try {
      await deps.store.setBlocked(row.userId, name === "/block");
    } catch {
      return inThread(notDelivered("не удалось сохранить блокировку"));
    }
    return inThread(name === "/block" ? BLOCKED : UNBLOCKED);
  }
  if (name) return inThread(UNKNOWN_COMMAND);
  try {
    await call(deps, "copyMessage", {
      chat_id: row.userId,
      from_chat_id: message.chat.id,
      message_id: message.message_id,
    });
  } catch (error) {
    // Сообщение исключения fetch может содержать адрес запроса с токеном бота.
    return inThread(notDelivered(error instanceof BotApiError ? error.message : "Bot API недоступен"));
  }
  return null;
}
