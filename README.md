# Greek A2

Полноценный курс новогреческого и отдельное Telegram Mini App на основе Tavelori для подготовки к A2 на Кипре к маю 2027. Используются Telegram-аккаунт и синхронизация через Telegram CloudStorage; отдельная регистрация и Supabase не нужны.

Рабочее название — «Τετράδιο» (дизайн-направление, см. [бриф](docs/design/brief.md)). Код приложения перенесён из Tavelori (`lavich/lexi`, ревизия `2ccae7d`) и пока работает как Tavelori под новыми идентификаторами; модель курса и пилотный модуль — следующий этап. Контент в `content/` — временная фикстура из Tavelori для тестов, он будет заменён модулями курса.

## Разработка

```sh
npm ci
npm run dev          # сборка контента и Vite dev-сервер
npm test             # unit (Vitest)
npm run test:e2e     # Playwright по production-сборке
npm run typecheck && npm run lint && npm run format:check
npm run build
```

Переменные окружения (все необязательны локально): `VITE_TELEGRAM_BOT` — имя бота Mini App (без неё — заглушка `tetradio_local`, не совпадающая с реальным ботом); `VITE_SENTRY_DSN` и `SENTRY_*` — отчёты о сбоях, без них выключены; `BASE_PATH` — базовый путь при размещении. Бота, хостинга и деплоя пока нет.

## Документация

- [PRD: цели и требования](docs/PRD.md)
- [Программа из 24 модулей](docs/curriculum.md)
- [Предложение нового продукта](openspec/changes/greek-a2-learning-mvp/proposal.md)
- [Архитектура и модель данных](openspec/changes/greek-a2-learning-mvp/design.md)
- [Задачи реализации](openspec/changes/greek-a2-learning-mvp/tasks.md)
- [Проверяемые спецификации](openspec/changes/greek-a2-learning-mvp/specs/)

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
