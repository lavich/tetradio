/**
 * Текст по предложениям для синтеза и записей: длинное высказывание синтез может оборвать без ошибки.
 * Конец предложения — `.`, `!`, `?`, `;` (греческий вопрос) с закрывающими кавычками и конец строки; многоточие
 * внутри строки границей не считается: «Πόσων… χρονών…» звучит одной фразой. Общая для сборки и клиента:
 * записи текста сопоставляются предложениям по номеру.
 */
export function sentenceRanges(text: string): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  for (const line of text.matchAll(/[^\n]+/g))
    for (const part of line[0].matchAll(/.+?(?:[.!?;]+[»"”]?(?=\s|$)|$)/gu)) {
      const sentence = part[0].trim();
      if (!/\p{L}/u.test(sentence)) continue;
      const start = line.index + part.index + part[0].length - part[0].trimStart().length;
      ranges.push({ start, end: start + sentence.length });
    }
  return ranges;
}

export const sentencesOf = (text: string) => sentenceRanges(text).map(({ start, end }) => text.slice(start, end));
