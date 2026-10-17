## Why

`npm run content` занимает ≈4–5 с и до 500 МБ памяти (замеры 17.10.2026 на `main` 4dbf0dc: 3,9–5,6 с). Профиль: ≈1,8 с — `buildMatcher`, `tokenize`, `norm`, `isGreekLetter`. Сопоставитель слов (`content/marks.ts`) и словарь знакомых слов (`coverer`) строятся заново на каждый текст для чтения (дважды: `coverage` и `readings.ts:320`) и на каждый урок с вопросами (`questions.ts`), каждый раз по растущему набору карточек курса. Сборка идёт на каждом запуске e2e и в CI.

## What Changes

Требование пользователя (issue #155): сопоставитель один раз на курс с рангом урока появления карточки и отсечением по рангу; `existing` → `Set`; сборка меньше 2 с.

Предлагаемый объём:

- `MatchCard.at` — индекс урока появления; каждый шаблон и каждая поверхность словаря помнят свой `at`; `candidates` и `coverer` принимают отсечение «до урока N включительно».
- `readings.ts`, `questions.ts` — один сопоставитель и один словарь на курс; текст/урок задают только отсечение.
- `answers.ts`, `readings.ts` (планы озвучки; вызываются скриптами озвучки, не `npm run content`) — `existing` как `Set`.
- Дешёвые резервы токенизации: `isGreekLetter`/`isLetter` без регулярок, `norm` с мемоизацией.
- Результат сборки (`public/content`, кроме `generatedAt` в `catalog.json`, отчёты, предупреждения) прежний: поведения для учащегося и для авторов курса не меняется.

## Capabilities

### New Capabilities

Нет.

### Modified Capabilities

- `course-content`: ADDED «Сборка контента: один сопоставитель на курс» — результат не зависит от способа построения сопоставителя.

## Impact

`content/marks.ts`, `content/coverage.ts`, `content/build/readings.ts`, `content/build/questions.ts`, `content/build/answers.ts`, `content/build.ts` (общий сопоставитель курса); `tests/word-marks.test.ts`, `tests/reading-coverage.test.ts`, `tests/questions.test.ts` и новые тесты равенства. Формат пакетов, приложение, облако не затронуты.
