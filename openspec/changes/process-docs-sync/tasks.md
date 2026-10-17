# Tasks

Порядок: 3.1 до 3.2 (после архивации `release/tasks.md` уезжает в `archive/`). `release` архивируется в рамках этого изменения.

## 1. prepare-lesson

- [x] 1.1 Заменить в `.agents/skills/prepare-lesson/SKILL.md` пункт про задания с пропуском на отсылку к `docs/course/format.md`. Проверка: в файле нет «Заданий с пропуском в приложении нет»; `tests/authoring.test.ts` зелёный.

## 2. feature-flow

- [x] 2.1 Раздел 4 в обеих копиях: `check:config`, `spec`, `lexicon:check`; сборка с окружением CI и `check:bundle` после неё; `test:e2e:course` и `test:e2e:courses` всегда. Проверка: `diff -r .claude/skills/feature-flow .agents/skills/feature-flow` пуст.
- [x] 2.2 Тест `tests/process-docs.test.ts`: копии идентичны; имена из `steps[].run` разобранного `ci.yml` (с раскрытием `matrix`, без `--`-аргументов) названы токеном `npm run <имя>` в разделе 4. Проверка: тест проходит; падает при удалении из навыка `lexicon:check`, `spec` (подстрока «openspec» не спасает), `test:e2e:courses` и при правке одной копии; `prettier --check tests/process-docs.test.ts`.

## 3. release

- [x] 3.1 Создать issue «Публичный выпуск Mini App» (пункт 1.6); в `openspec/changes/release/tasks.md` пункт 1.6 остаётся `- [ ]` с пометкой «вынесено в #N». Проверка: `gh issue view N` открывается.
- [x] 3.2 `openspec archive release --yes`, затем вписать Purpose в `openspec/specs/delivery/spec.md`. Проверка: `npm run spec` зелёный, в `openspec/specs/delivery/spec.md` нет «TBD».
- [ ] 3.3 При архивации этого изменения вписать Purpose в `openspec/specs/agent-process/spec.md`. Проверка: после архивации `npm run spec` зелёный.

## 4. Проверка

- [x] 4.1 Набор CI по обновлённому разделу 4 целиком. Проверка: всё зелёное.
- [x] 4.2 Проверка на устройстве не нужна: поведение приложения не меняется.
