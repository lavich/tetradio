/**
 * Логика урока курса без хранения: проверка ответа по ключу, счёт задания, завершённость урока и итог контрольной.
 * Письменный ввод проверяется той же нормализацией, что и фразы (регистр, пробелы, конечная ς, «почти» без
 * ударения); выбор, пропуск и соединение сравниваются с вариантом из ключа точно.
 */
import {
  SKILLS,
  skillOf,
  type ExerciseBlock,
  type ExerciseItem,
  type LessonBlock,
  type Skill,
} from "../content/course";
import type { BlockProgress } from "./types";
import { checkTextAnswer, type TextAnswerStatus } from "./text-answer";

export interface ItemResult {
  status: TextAnswerStatus;
  /** Ответ из ключа для показа: совпавший вариант или первый допустимый. */
  expected: string;
}

export function checkItem(block: ExerciseBlock, item: ExerciseItem, given: string): ItemResult {
  if (block.format === "text") {
    const result = checkTextAnswer(given, item.answer);
    return { status: result.status, expected: result.expected };
  }
  const expected = item.answer[0];
  return { status: given.normalize("NFC") === expected.normalize("NFC") ? "correct" : "wrong", expected };
}

export interface ExerciseScore {
  correct: number;
  almost: number;
  total: number;
  results: Record<string, ItemResult>;
}
/** Неотвеченный пункт считается неверным: задание проверяют целиком, как на экзамене. */
export function scoreExercise(block: ExerciseBlock, answers: Record<string, string>): ExerciseScore {
  const results: Record<string, ItemResult> = {};
  let correct = 0,
    almost = 0;
  for (const item of block.items) {
    const result = checkItem(block, item, answers[item.id] ?? "");
    results[item.id] = result;
    if (result.status === "correct") correct++;
    if (result.status === "almost") almost++;
  }
  return { correct, almost, total: block.items.length, results };
}

/** Блоки, которые нужно выполнить, чтобы урок считался пройденным: задания, письмо и речь. Чтение и объяснение — через свои задания. */
export const isTask = (block: LessonBlock) =>
  block.type === "exercise" || block.type === "writing" || block.type === "speaking";

export function lessonDone(blocks: LessonBlock[], progress: Map<string, BlockProgress>): boolean {
  const tasks = blocks.filter(isTask);
  return tasks.length > 0 && tasks.every((block) => progress.get(block.id)?.done);
}

export interface LessonTally {
  done: number;
  total: number;
}
export const lessonTally = (blocks: LessonBlock[], progress: Map<string, BlockProgress>): LessonTally => {
  const tasks = blocks.filter(isTask);
  return { done: tasks.filter((block) => progress.get(block.id)?.done).length, total: tasks.length };
};

/** Порог сдачи навыка на экзамене КΕΓ A2 — 60 % в каждом навыке. */
export const PASS_SHARE = 0.6;
export interface SkillResult {
  skill: Skill;
  correct: number;
  total: number;
  share: number;
  passed: boolean;
}
/**
 * Итог контрольной по навыкам: оцениваются только задания `graded`, «почти» засчитывается как верный ответ
 * (на экзамене A2 орфографии уделяют немного внимания). Задания без навыка (грамматика, лексика) входят в общий
 * итог, но не в навыки. Письмо и речь — самопроверка и в итог не входят.
 */
export function testResult(blocks: LessonBlock[], progress: Map<string, BlockProgress>) {
  const bySkill = new Map<Skill, { correct: number; total: number }>();
  let correct = 0,
    total = 0;
  for (const block of blocks) {
    if (block.type !== "exercise" || !block.graded) continue;
    const score = progress.get(block.id)?.score;
    const got = score ? score.correct + score.almost : 0;
    correct += got;
    total += block.items.length;
    const skill = skillOf(block, blocks);
    if (!skill) continue;
    const entry = bySkill.get(skill) ?? { correct: 0, total: 0 };
    entry.correct += got;
    entry.total += block.items.length;
    bySkill.set(skill, entry);
  }
  const skills: SkillResult[] = SKILLS.filter((skill) => bySkill.has(skill)).map((skill) => {
    const entry = bySkill.get(skill)!;
    const share = entry.total ? entry.correct / entry.total : 0;
    return { skill, ...entry, share, passed: share >= PASS_SHARE };
  });
  const share = total ? correct / total : 0;
  return { correct, total, share, passed: share >= PASS_SHARE, skills };
}

/** Число слов письменного ответа — по пробелам, как считает экзаменатор; пунктуация не слово. */
export const wordCount = (text: string) => text.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
