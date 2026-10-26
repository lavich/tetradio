export const GREETING =
  "Τετράδιο — греческий с нуля до экзамена A2: уроки по программе и ежедневное повторение слов. Прогресс переносится между устройствами вашего аккаунта Telegram.";
export const UNREAD = "Сообщения боту пока не читаются. Τετράδιο открывается кнопкой ниже.";
export const INVITE = "Напишите сообщение: вопрос, ошибку в уроке или идею. Можно приложить скриншот.";
export const ACK = "Сообщение передано автору, ответ придёт сюда.";
export const FAILED = "Не удалось передать сообщение. Попробуйте позже.";
export const BLOCKED = "Заблокирован: сообщения пользователя не пересылаются. /unblock — вернуть.";
export const UNBLOCKED = "Разблокирован: сообщения пользователя снова пересылаются.";
export const UNKNOWN_COMMAND = "Команда не отправлена пользователю. /block, /unblock — блокировка.";
export const notDelivered = (reason: string) => `Не доставлено: ${reason}`;
export const reportLine = (url: string) => `Отчёт: ${url}`;

const BUTTON = "Открыть Τετράδιο";
export const openButton = (appUrl: string) => ({
  inline_keyboard: [[{ text: BUTTON, web_app: { url: appUrl } }]],
});

export interface Person {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

const fullName = (person: Person) => [person.first_name, person.last_name].filter(Boolean).join(" ");

export function topicName(person: Person) {
  const name = [fullName(person), person.username ? `(@${person.username})` : ""].filter(Boolean).join(" ");
  return (name || `id ${person.id}`).slice(0, 128);
}

export const header = (person: Person) =>
  [
    fullName(person) || "без имени",
    person.username ? `@${person.username}` : "без username",
    `id: ${person.id}`,
    ...(person.language_code ? [`язык: ${person.language_code}`] : []),
  ].join("\n");
