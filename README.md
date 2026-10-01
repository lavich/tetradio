# Greek A2

Курс новогреческого A0 → A2 в виде Telegram Mini App — подготовка к экзамену ΚΕΓ A2 на Кипре. Используются Telegram-аккаунт и синхронизация через Telegram CloudStorage; отдельная регистрация не нужна.

Рабочее название — «Τετράδιο» (дизайн-направление, см. [бриф](docs/design/brief.md)). Содержание курса — в `content/`; правила подготовки и происхождения материалов — в [подготовке уроков](docs/lesson-authoring.md) и [формате курса](docs/course/format.md). Демо-курс для разработки — `tests/fixtures/course-demo`.

## Разработка

```sh
npm ci
npm run dev          # сборка контента и Vite dev-сервер
npm test             # unit (Vitest)
npm run test:e2e     # Playwright: механики карточек на тестовом контенте
npm run test:e2e:course  # Playwright: экраны курса на демо-курсе
CONTENT_ROOT=tests/fixtures/course-demo npm run dev  # посмотреть курс локально
npm run typecheck && npm run lint && npm run format:check
npm run build
```

Переменные окружения (все необязательны локально): `VITE_TELEGRAM_BOT` — имя бота Mini App (без неё — заглушка `tetradio_local`, не совпадающая с реальным ботом); `VITE_SENTRY_DSN` и `SENTRY_*` — отчёты о сбоях, без них выключены; `BASE_PATH` — базовый путь при размещении.

Деплой — `.github/workflows/deploy.yml`: каждый push в `main` публикует сборку на GitHub Pages (`https://lavich.github.io/tetradio/`). База берётся из настроек Pages; имя бота и адрес приёма отчётов — переменные репозитория `VITE_TELEGRAM_BOT` и `VITE_SENTRY_DSN`, реквизиты загрузки карт кода — секреты `SENTRY_*`.

## Документация

- [Продукт: пользователь, позиционирование, принципы](PRODUCT.md)
- [PRD: цели и требования](docs/PRD.md)
- [Программа курса](docs/curriculum.md)
- [Формат экзамена A2](docs/exam-a2.md)
- [Базовые спецификации](openspec/specs/)
- [Изменения: активные и архив](openspec/changes/)

## OpenSpec

Локальная dev-зависимость @fission-ai/openspec, версия закреплена в package-lock.json. Установлено по [официальной документации](https://github.com/Fission-AI/OpenSpec).

```sh
npm ci
npm run spec:validate
npm run spec:status
npm run openspec -- list
```

Навыки Codex созданы в `.agents/skills/`: openspec-explore, openspec-propose, openspec-apply-change и другие. Начать обсуждение можно фразой «изучи PRD и уточни план»; реализацию — отдельным запросом после просмотра документов.

Базовые спецификации — в `openspec/specs/`; новые требования предлагаются внутри изменения и становятся базовыми после реализации и архивирования. Галочки в tasks.md относятся к реальной работе, а не к написанию плана.
