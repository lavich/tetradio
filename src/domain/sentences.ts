/**
 * Текст по предложениям для синтеза речи: длинное высказывание синтез может оборвать без ошибки.
 * Конец предложения — `.`, `!`, `?`, `;` (греческий вопрос) или `…` с закрывающими кавычками; строка — тоже граница.
 */
export function sentencesOf(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((line) => line.match(/[^.!?;…]+(?:[.!?;…]+[»"”]?|$)/gu) ?? [])
    .map((sentence) => sentence.trim())
    .filter((sentence) => /\p{L}/u.test(sentence));
}
