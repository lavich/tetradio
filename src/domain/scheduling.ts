import { createEmptyCard, fsrs, generatorParameters, Rating, type Card, type Grade } from "ts-fsrs";
import type { TextAnswerStatus } from "./text-answer";
import { unitKey } from "./refs";
import type { ExerciseType, LearningRef, LearningState } from "./types";

/**
 * Разброс интервалов включён: без него карточки, введённые в один день, возвращаются одной группой.
 * Случайности он не вносит — сид `ts-fsrs` строится из момента ответа, числа повторений и произведения
 * сложности на стабильность, поэтому для одной карточки, состояния и момента интервал воспроизводим.
 */
export const scheduler = fsrs(generatorParameters({ enable_fuzz: true }));

/**
 * Задания с готовыми вариантами: только у них длительность ответа говорит о лёгкости вспоминания.
 * В сборке, написании и пропуске она определяется длиной ответа и скоростью набора, поэтому там не читается.
 */
export const FAST_TYPES: readonly ExerciseType[] = ["recognition", "listening", "comprehension"];
/**
 * Порог быстрого ответа. Общий для трёх типов, хотя у аудирования и понимания на слух в него входит
 * воспроизведение: перекос сознательно в консервативную сторону — `Easy` там выпадает реже,
 * и ни одна карточка не получает завышенный интервал из-за короткого аудио.
 */
export const FAST_ANSWER_MS = 3500;
/**
 * Оценка объективного ответа. `status` отвечает на вопрос «насколько подвинуть срок», а поле `correct`
 * события — на вопрос «что показать и чему учить дальше»: «Почти» остаётся ошибкой навыка и поводом
 * для дополнительной попытки, но полного сброса интервала не заслуживает.
 */
export function gradeFor(status: TextAnswerStatus, type: ExerciseType, responseTimeMs: number): Grade {
  if (status === "almost") return Rating.Hard;
  if (status !== "correct") return Rating.Again;
  return FAST_TYPES.includes(type) && responseTimeMs < FAST_ANSWER_MS ? Rating.Easy : Rating.Good;
}

/** Practice сюда не попадает: ручная тренировка не должна двигать интервалы. */
export function nextState(state: LearningState | undefined, ref: LearningRef, rating: Grade, now: Date): LearningState {
  const card: Card = state
    ? {
        ...state.card,
        due: new Date(state.card.due),
        last_review: state.card.last_review ? new Date(state.card.last_review) : undefined,
      }
    : createEmptyCard(now);
  const next = scheduler.next(card, now, rating).card;
  return {
    unitKey: unitKey(ref),
    ref,
    card: next,
    introducedAt: state?.introducedAt ?? now.toISOString(),
    version: (state?.version ?? 0) + 1,
  };
}
