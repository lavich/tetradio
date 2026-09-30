# Greek A2

Полноценный курс новогреческого и отдельное Telegram Mini App на основе Tavelori для подготовки к A2 на Кипре к маю 2027. Используются Telegram-аккаунт и синхронизация через Telegram CloudStorage; отдельная регистрация и Supabase не нужны.

Рабочее название — «Τετράδιο» (дизайн-направление, см. [бриф](docs/design/brief.md)). Механики перенесены из Tavelori (`lavich/lexi`, ревизия `2ccae7d`). Готовы модель курса (схема 4), экраны «Курс», модуль и урок из блоков в стиле «Τετράδιο»; содержание курса (`content/`) пока пусто — следующий шаг — пилотный модуль 01. Демо-курс для разработки — `tests/fixtures/course-demo`.

## Разработка

```sh
npm ci
npm run dev          # сборка контента и Vite dev-сервер
npm test             # unit (Vitest)
npm run test:e2e     # Playwright: механики на фикстуре Tavelori
npm run test:e2e:course  # Playwright: экраны курса на демо-курсе
CONTENT_ROOT=tests/fixtures/course-demo npm run dev  # посмотреть курс локально
npm run typecheck && npm run lint && npm run format:check
npm run build
```

Переменные окружения (все необязательны локально): `VITE_TELEGRAM_BOT` — имя бота Mini App (без неё — заглушка `tetradio_local`, не совпадающая с реальным ботом); `VITE_SENTRY_DSN` и `SENTRY_*` — отчёты о сбоях, без них выключены; `BASE_PATH` — базовый путь при размещении. Бота пока нет.

Деплой — `.github/workflows/deploy.yml`: каждый push в `main` публикует сборку на GitHub Pages (`https://lavich.github.io/tetradio/`). База берётся из настроек Pages; имя бота и адрес приёма отчётов — переменные репозитория `VITE_TELEGRAM_BOT` и `VITE_SENTRY_DSN`, реквизиты загрузки карт кода — секреты `SENTRY_*`.

## Документация

- [PRD: цели и требования](docs/PRD.md)
- [Программа из 24 модулей](docs/curriculum.md)
- Первое изменение (архив): [предложение](openspec/changes/archive/2026-09-30-greek-a2-learning-mvp/proposal.md)
  [архитектура и модель данных](openspec/changes/archive/2026-09-30-greek-a2-learning-mvp/design.md)
  [задачи](openspec/changes/archive/2026-09-30-greek-a2-learning-mvp/tasks.md)
- [Базовые спецификации](openspec/specs/)
- Текущие изменения: [course-a2-modules](openspec/changes/course-a2-modules/tasks.md) — модули 09–24 и пробники; [course-progress-sync](openspec/changes/course-progress-sync/tasks.md) — синхронизация и копия; [release](openspec/changes/release/tasks.md) — бот, хостинг, приёмка

## OpenSpec

Локальная dev-зависимость @fission-ai/openspec 1.13.2, Node.js >=20.19.0. Зависимость закреплена в package-lock.json. Установлено по [официальной документации](https://github.com/Fission-AI/OpenSpec).

```sh
npm ci
npm run spec:validate
npm run spec:status
npm run openspec -- list
```

Навыки Codex созданы в `.agents/skills/`. После обновления списка навыков доступны openspec-explore, openspec-propose, openspec-apply-change и другие установленные навыки. Начать обсуждение можно фразой «изучи PRD и уточни план»; реализацию — отдельным запросом после просмотра документов.

`openspec/specs/` пока пуст: спецификации предложены внутри активного изменения и станут базовыми после реализации и архивирования. Галочки в tasks.md относятся к реальной работе, а не к написанию плана.

## Решения перед разработкой

Аудит Tavelori выполнен ([отчёт](docs/audit/tavelori-audit.md)). Сохранить пригодные движок, FSRS и контентный пайплайн; адаптировать существующую Telegram-интеграцию и синхронизацию под полный курс. Учащийся знает только алфавит, занимается 2–3 раза в неделю без преподавателя (риск по времени описан в PRD). Бот нового приложения и размещение ещё не настроены. Дата экзамена на Кипре требует отдельного подтверждения.
