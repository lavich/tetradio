# Proposal

## Why

Навыки и документы процесса разошлись с приложением и CI (#159): `prepare-lesson` отклоняет задания с пропуском, которые в курсе есть; полная проверка в `feature-flow` пропускает четыре проверки CI; OpenSpec `release` висит с 30.09.

## Требование пользователя

- Решение 17.10.2026: изменение `release` разбить и архивировать — спецификацию `delivery` перенести в основные, пункт 1.6 «Публичный выпуск» вынести в отдельный issue.
- Три пункта #159 закрыть вместе.

## Предлагаемый объём

- `prepare-lesson` (`.agents/skills/prepare-lesson/SKILL.md`): убрать утверждение «заданий с пропуском в приложении нет»; сказать, что задания уроков (`choice`, `text`, `gap`, `match`) пишутся по `docs/course/format.md`, а навык делает слова, фразы и состав урока.
- `feature-flow` (обе копии): раздел 4 повторяет набор CI: `check:config`, `spec`, `lexicon:check`; сборка с окружением CI (`BASE_PATH=/tetradio/`, `SENTRY_DEBUG_IDS=1`, пустой `VITE_TELEGRAM_MOCK`, DSN-заглушка) и `check:bundle` после неё; `test:e2e:course` и `test:e2e:courses` — всегда, как в CI.
- Тест `tests/process-docs.test.ts`: копии навыков идентичны; каждая npm-команда шагов `.github/workflows/ci.yml` (разобранного YAML-парсером) названа в разделе 4 `feature-flow`.
- `release`: пункт 1.6 переносится в новый issue, изменение архивируется, `delivery` попадает в `openspec/specs` с настоящим Purpose.

## Capabilities

### New Capabilities

- `agent-process`: согласованность навыков и документов процесса с кодом и CI.

## Impact

Только документы, навыки и один тест; код приложения и поведение учащегося не меняются. Пересечения: `package.json` и `.github/workflows` не трогаются; соседние изменения (#188, #154, #158) файлов навыков не правят.
