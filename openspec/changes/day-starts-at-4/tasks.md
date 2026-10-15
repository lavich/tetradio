# Tasks

Зависимостей от других изменений нет; порядок архивации свободный. Пересечений с `question-language` и `release` нет. MODIFIED «Планирование и прогресс» (`learning-session`) и «Полка «Чтение»» (`app-sections`) написаны поверх базовых спек; в `app-sections` меняется только формулировка, кода под неё нет. Номера «п. N» — строки таблицы мест в design.md.

## 1. Домен

- [ ] 1.1 `studyDay(at, timezone)` и `DAY_STARTS_AT` в `src/domain/time.ts`; реэкспорт из `plan.ts` и `learning.ts` (п. 3, 6, 10). Проверка: `tests/time.test.ts` — 03:59 и 04:00 по Asia/Nicosia в обычный день; 25.10.2026 — второе прохождение 03:30 даёт 24-е, граница 02:00Z; 29.03.2026 — граница 01:00Z, 28.03 длится 23 ч; 00:00 в Europe/Athens и UTC — предыдущий день; America/Havana 08.03.2026 (переход в полночь) — граница 08:00Z
- [ ] 1.2 `reviewCutoff` через `studyDay`, `makePlan` пишет `today = studyDay(now)` (п. 7, 8). Проверка: существующие таблицы `reviewCutoff` в `tests/plan.test.ts` (:448-451) и `tests/plan-golden.test.ts` зелёные без правок; новый тест — план в 01:30 16-го имеет `today = 15-е`, `makeSession` пишет `planDate = 15-е`
- [ ] 1.3 `progress()` в `src/domain/stats.ts`: `today = studyDay`, граница сроков `zonedStart(addDays(date, 1), tz, DAY_STARTS_AT)` (п. 18, 19). Проверка: переписать `tests/plan.test.ts:491-502` (срок 22:00Z 15-го — 01:00 16-го в Никосии — теперь входит в `due.today`, ожидание 2) и `:503-520` (фикстура `localDate` через `studyDay`, ответ 16-го в 00:30 — в столбце 15-го)

## 2. Хранилище

- [ ] 2.1 `recordAnswer` пишет `localDate = studyDay(now, timezone)` (п. 11). Проверка: unit-тест — ответ в 00:20 16-го даёт `localDate = 15-е`, `reviewedOn("15-е")` считает карточку, `reviewedOn("16-е")` — нет
- [ ] 2.2 `lessonDays` (с отсечкой строк по `updatedAt`, п. 12) и дни завершения уроков в `courseProgress` — по `studyDay`; `today` и `monday` в `courseProgress` — от учебного дня (п. 12, 14, 15). Проверка: в `tests/two-courses.test.ts` или `tests/live-queries.test.ts` (там уже вызываются `courseProgress` и `lessonDays`) — задание урока в понедельник 00:30 даёт день воскресенья прошлой недели; в понедельник 01:00 `week.monday` — прошлый понедельник, `lessonDays` и `reviewDays` с воскресеньем; урок, завершённый в 02:00, попадает в `completedDays` воскресеньем (`tests/progress-pace.test.ts` для темпа)

## 3. Интерфейс

- [ ] 3.1 `CourseToday`: `today = studyDay(now, deviceTimezone())`; заголовок, галочка, неделя и `ModulePage` от него (п. 24–27). Проверка: e2e с `page.clock` на 01:30 по зоне браузера — заголовок показывает вчерашнюю дату, после повторения видна отметка «повторение сделано» и счёт карточек; при переводе часов на 04:01 отметка пропадает не позже чем через минуту
- [ ] 3.2 `ProgressScreen`: зависимость живого запроса `courseProgress` — ключ учебного дня вместо `now.toDateString()` (п. 30). Проверка: e2e с `page.clock` — в понедельник 03:59 → 04:01 строка недели переходит на новую неделю («На этой неделе занятий ещё не было»), в воскресенье 23:59 → понедельник 00:01 остаётся прежней
- [ ] 3.3 `ResultScreen`: день возврата ошибки — `studyDay(due)`, `today = studyDay(now)`, `tomorrow = addDays(today, 1)` (п. 32–34); группировку возвратов по дням и подпись «сегодня / завтра / дата» вынести в экспортируемую чистую функцию. Проверка: `tests/results.test.ts` — в 23:50 срок 00:00 даёт «сегодня», срок 04:30 — «завтра»; 28.03.2026 в Никосии в 23:00 срок 29-го в 10:00 даёт «завтра»
- [ ] 3.4 Даты фактов по учебному дню: `LessonSummary` («Урок пройден · …») и `readDay` (п. 36, 37); выполнять после ответа пользователя на открытый вопрос 2. Проверка: unit-тест `readDay` для 00:30 и 04:30; e2e итога урока с часами 00:30 показывает предыдущую дату

## 4. Тесты и фикстуры

- [ ] 4.1 e2e-фикстуры с `localDate: at.slice(0, 10)` (`tests/e2e/helpers.ts:96`, `tests/e2e/assembly.spec.ts:48`, `tests/e2e/session-notebook.spec.ts:108`) не зависят от часа запуска; фикстуры `results.test.ts:41,125-140` с `localDate` по полуночи переведены на `studyDay`. Проверка: `npm run test:e2e` зелёный при системных часах 01:00 UTC (например, `faketime` или `page.clock` в общем `beforeEach`)
- [ ] 4.2 Полная проверка: `npm run typecheck && npm run lint && npm run format:check && npm test && npm run build && npm run test:e2e && npm run test:e2e:course && npm run test:e2e:courses`. Проверка: все команды зелёные
- [ ] 4.3 Проверка на устройстве после выпуска: занятие после полуночи отмечено вчерашним днём, в 04:00 «Сегодня» переходит на новый день; запись итога — в PR. Проверка: подтверждение пользователя
