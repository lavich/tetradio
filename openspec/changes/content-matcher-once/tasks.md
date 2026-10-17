# Tasks

Зависимостей от других изменений нет; порядок архивации свободный. Пересечений с `question-language` и `release` нет.

## 1. База

- [x] 1.1 Эталон: хеш `public/content` и вывод `npm run content`, время и память до правок (≈4–5 с; ≤500 МБ, допуск ±50 МБ). Проверка: файл хешей без `generatedAt` в scratch, сравнение после каждой группы задач

## 2. Сопоставитель

- [x] 2.0 `isGreekLetter`/`isLetter` по диапазонам кодов, `norm` с мемоизацией. Проверка: `tests/word-marks.test.ts` зелёный, хеш не изменился

- [x] 2.1 `MatchCard.at`, `Pattern.at`, `candidates(..., upto)`; `buildMatcher` сохраняет `at`. Проверка: `tests/word-marks.test.ts` зелёный без правок; новый тест — карточка с `at` больше отсечения не находится, порядок и спорные места равны сборке по префиксу; `lessonMarks` с `upto` не размечает карточку из будущего урока
- [x] 2.2 `coverer` с отсечением (`surfaces`/`stems` с `at`). Проверка: тест равенства `Coverage` на синтетическом и реальном курсе по всем урокам

## 3. Вызывающий код

- [x] 3.1 `build.ts`/`readings.ts`: один сопоставитель и словарь на курс, отсечение по `after`, `rank` не пускает будущие уроки; убрать повторный `buildMatcher` (`:320`). Проверка: тест — слово урока N+1 не размечено в тексте после урока N; хеш `public/content` и отчёт чтения не изменились
- [x] 3.2 `questions.ts`: один `coverer` на курс. Проверка: список «непройденных слов» вопросов совпадает с эталоном
- [x] 3.3 `existing` → `Set` в `answers.ts` и `readings.ts`. Проверка: `tests/reading-voices.test.ts` и `tests/course-build.test.ts` зелёные, план озвучки совпадает

## 4. Проверка

- [x] 4.1 `npm run content` ≤ 2,5 с (цель 2 с; медиана трёх запусков), память не выше базы с допуском, хеш `public/content` равен эталону. Проверка: цифры в PR
- [x] 4.2 Полная проверка: `npm run typecheck && npm run lint && npm run format:check && npm test && npm run build && npm run test:e2e && npm run test:e2e:course && npm run test:e2e:courses`. Проверка: все команды зелёные
