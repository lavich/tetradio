Зависимость: нет. Активные изменения не меняют требования learning-session; `sync-compression` правит `docs/sync.md` и `tests/sync-size.test.ts` — порядок архивации любой, при слиянии `docs/sync.md` сверить вручную. Формат облака не меняется.

## 1. Спецификация и документы

- [x] 1.1 Обновить `docs/sync.md` (ошибки уроков больше не создаются, вид `e` читается и игнорируется) и `docs/design/multi-course.md` (убрать «ошибки» из «Прогресса»). Проверка: `openspec validate drop-lesson-mistakes --strict`, `prettier --check`.

## 2. Домен

- [x] 2.1 `KindSpec.ignored` вместо `vanishes` и `reviewShare`; `mistake` — `ignored: true`, `exercise` возвращает `null`; `makePlan` отбрасывает ignored-виды до срока и `wakeAt`; удалить `shareReviews`, `itemExercise` (остаётся `instructionOf`). Проверка: тест `language-session` — 300 просроченных ошибок, ошибка с коротким шагом и 12 слов дают 12 повторений и тот же `wakeAt`, что без ошибок; занятие — только слова и фразы.
- [x] 2.2 Удалить `mistakesOf`. Проверка: типизация, тест домена.

## 3. Хранилище

- [x] 3.1 `saveBlockProgress` без `mistakes` и без записи `cardStates`; удалить `lessonMistakes`, `mistakeCount`, `mistakeItems`, `mistakeId`, `mistakeIdsOf`, `reviewable`, `LessonOutline.mistakes`, `StoredKind.coursesOf`, `ownCourses`, `vanishedKeys`; `STORED_KINDS.mistake`: `tables: []`, всегда «присутствует», без содержимого, `count` 0, `packageIds` пуст. `dueStates`, `dueStatesOf` не читают ignored-виды, их `rest/own/home` сводится к домашнему курсу; `dueKeysBefore`, `eachState` пропускают их. Проверка: тесты `kinds` и `lesson-mistakes` — состояния ошибок не входят в `dueStates`, `dueStatesOf`, `cardCount`, `dueKeysBefore`, `eachState`, `reviewedOn`, но остаются в базе.
- [x] 3.2 Совместимость данных. Проверка: тест применения снимка с состояниями ошибок и предзаполненным `cardStash` — состояния в `cardStates`, следующий снимок содержит их; тест, что копия переживает восстановление; `tests/sync-size.test.ts` проходит без изменений.
- [x] 3.3 `dropIgnoredItems` в `ops.ts` и вызов при запуске после `ensureDefaults` (`main.tsx`). Проверка: тест — занятие из слов и ошибок: невыполненные ошибки убраны, ответы и события целы, позиция и состояние пересчитаны; все оставшиеся отвечены — «done»; ничего не осталось — «ended»; завершённое занятие и повторный вызов не меняются.

## 4. Интерфейс

- [x] 4.1 Убрать строки об ошибках на итоге урока и «Прогрессе» (`LessonSummary`, `LessonScreen`, `ProgressScreen`, фильтр `kind !== "mistake"`), `mistakes: mistakesOf(...)` в блоке «Задание». Проверка: типизация (проп `mistakes` удалён), e2e `course.spec.ts` — на итоге урока строки нет; e2e `lesson-mistakes.spec.ts` — после проверки задания состояния ошибки в базе нет.
- [x] 4.2 Итог занятия отбрасывает ссылки ignored-видов при «Вернутся…» и «Повторить ошибки»; `makeSession` по `refs` отбрасывает их тоже. Проверка: тест итога занятия со словом и ошибкой урока — «Вернутся…» и кнопка только по слову, полоса считает оба ответа; тест `makeSession` с `refs` из ошибки урока — карточка не создаётся.
- [x] 4.3 Страховка показа (`LessonTask`, `ops.ts:119`) остаётся с комментарием «почему». Проверка: существующий `lesson-task-answer` проходит без удаляемых фикстур.

## 5. Тесты и e2e

- [x] 5.1 Удалить или переписать тесты ошибок урока: `mistake-cards` (оставить сохранение без состояния, `scoreExercise`), `course-outlines`, `live-queries`, `language-session` (доля ошибок), `kinds` (поле `vanishes`), `lesson-summary-day` (проп `mistakes`); хелперы `tests/helpers/*` с фикстурами ошибок оставлены: они нужны тестам «накопленные ошибки не занимают мест»; `today-language` — только проверить. e2e `mistakes.spec.ts` заменить проверкой «ошибка не создаёт карточку и не меняет „К повторению“»; в `course.spec.ts` убрать строку итога. Проверка: `npm test`, `npm run test:e2e:course`.

## 6. Полная проверка

- [x] 6.1 Полный набор CI из `feature-flow` (формат, lint, typecheck, config, spec, lexicon, `npm test`, сборки, размеры, Lighthouse, e2e). Проверка на устройстве: после обновления в «Сегодня» только слова и фразы, ошибка в задании не добавляет повторений, на итоге урока и «Прогрессе» строк об ошибках нет, незавершённое занятие прежней версии больше не содержит ошибок.
