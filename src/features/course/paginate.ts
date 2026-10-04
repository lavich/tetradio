import type { LessonBlock } from "../../content/course";
import { isTask } from "../../domain/course";

/** Страницы урока: каждый блок — страница, а задания к тексту или записи — на странице самого текста. */
export function paginate(blocks: LessonBlock[]) {
  const pages: LessonBlock[][] = [];
  const home = new Map<string, number>();
  for (const block of blocks) {
    const about = block.type === "exercise" ? block.about : undefined;
    if (about && home.has(about)) {
      pages[home.get(about)!].push(block);
      continue;
    }
    pages.push([block]);
    if (block.type === "reading" || block.type === "listening") home.set(block.id, pages.length - 1);
  }
  return pages;
}
/** Первая страница с невыполненным заданием, но с теорией и словами перед ним: иначе новый урок открывался бы на упражнении. */
export function resumePage(pages: LessonBlock[][], done: (block: LessonBlock) => boolean) {
  const hasTask = (page: LessonBlock[]) => page.some(isTask);
  let index = pages.findIndex((page) => page.some((block) => isTask(block) && !done(block)));
  if (index < 0) return index;
  while (index > 0 && !hasTask(pages[index - 1])) index--;
  return index;
}
/** Свайп внутри прокручиваемой вбок таблицы листает таблицу, а не страницу. */
export function scrollsSideways(target: HTMLElement) {
  for (let node: HTMLElement | null = target; node; node = node.parentElement) {
    if (node.scrollWidth > node.clientWidth && /(auto|scroll)/.test(getComputedStyle(node).overflowX)) return true;
  }
  return false;
}

/** Номера заданий — у блоков, которые делают, а не читают. */
export function numberBlocks(blocks: LessonBlock[]) {
  const numbers = new Map<string, number>();
  let n = 0;
  for (const block of blocks)
    if (block.type === "exercise" || block.type === "writing" || block.type === "speaking") numbers.set(block.id, ++n);
  return numbers;
}
export function blockLabel(block: LessonBlock) {
  switch (block.type) {
    case "explanation":
      return block.title ?? "Объяснение";
    case "vocabulary":
      return "Слова урока";
    case "reading":
      return `Чтение: ${block.title}`;
    case "listening":
      return `Аудирование: ${block.title}`;
    case "exercise":
      return block.title ?? block.instruction;
    case "writing":
      return "Письмо";
    case "speaking":
      return "Речь";
  }
}

export const pairs = <T>(items: T[]) =>
  Array.from({ length: Math.ceil(items.length / 2) }, (_, i) => items.slice(i * 2, i * 2 + 2));
