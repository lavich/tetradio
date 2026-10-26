# Greek A2

Курс новогреческого A0 → A2 в виде Telegram Mini App [@TetradioBot](https://t.me/TetradioBot) — подготовка к экзамену ΚΕΓ A2 на Кипре. Используются Telegram-аккаунт и синхронизация через Telegram CloudStorage; отдельная регистрация не нужна.

Рабочее название — «Τετράδιο» (дизайн-направление, см. [бриф](docs/design/brief.md)). Содержание курса — в `content/`; правила подготовки и происхождения материалов — в [подготовке уроков](docs/lesson-authoring.md) и [формате курса](docs/course/format.md). Демо-курс для разработки — `tests/fixtures/course-demo`; механики карточек проверяются на маленькой фикстуре `tests/fixtures/mechanics` из слов и фраз лексикона.

Английские курсы («Для IT» и «Для путешествий») скрыты флагом `hidden: true` в `content/courses/*.yaml`: сборка их проверяет, но в каталог и приложение они не попадают; чтобы вернуть курс, уберите эту строку ([формат курса](docs/course/format.md), «Скрытый курс»).

## Разработка

```sh
npm ci
npm run dev          # сборка контента и Vite dev-сервер (вне Telegram — экран «Откройте в Telegram»)
npm run dev:mock     # то же с моком Telegram: тестовый пользователь 1, база tetradio-mock-1
npm test             # unit (Vitest)
npm run test:e2e     # Playwright: механики карточек на фикстуре tests/fixtures/mechanics
npm run test:e2e:course  # Playwright: экраны курса на демо-курсе
CONTENT_ROOT=tests/fixtures/course-demo npm run dev  # посмотреть курс локально
npm run typecheck && npm run lint && npm run format:check
npm run build
```

Переменные окружения (все необязательны локально): `VITE_TELEGRAM_BOT` — имя бота Mini App (без неё — заглушка `tetradio_local`, не совпадающая с реальным ботом); `VITE_SENTRY_DSN` и `SENTRY_*` — отчёты о сбоях, без них выключены; `BASE_PATH` — базовый путь при размещении; `VITE_TELEGRAM_MOCK=<id>` — мок Telegram для разработки и e2e (только явным флагом, в деплое не задаётся). Владелец данных и изоляция аккаунтов — [docs/account.md](docs/account.md).

Живые запросы (`useLiveQuery`): Dexie отслеживает чтения только внутри своей зоны, а `await` нативного промиса вложенной async-функции может её потерять — изменения строк, прочитанных после такого `await`, экран не увидит. Поэтому async-функции чтения, которые вызываются из живых запросов, объявляются через `zoned(...)` (`src/storage/zone.ts`) и возвращают промис Dexie; внутри запроса ждут только их, промисы Dexie или `.then` на них. Результат `zoned` не оставляют без `await` или `catch`: необработанный отказ промиса Dexie не доходит до отчётов о сбоях. Проверка — `tests/live-queries.test.ts`: новый запрос экрана добавляется в его список. То же в транзакциях: чтение или запись после такого `await` может уйти в отдельную транзакцию, поэтому функции, которые ждут внутри транзакции синхронизации, тоже объявлены через `zoned` (проверка — `tests/sync-snapshot-zone.test.ts`).

Деплой — `.github/workflows/deploy.yml`: каждый push в `main` публикует сборку на GitHub Pages: лендинг — `https://tetradio.app/`, Mini App — `https://tetradio.app/app/` (домен в Cloudflare). База берётся из настроек Pages; имя бота (`VITE_TELEGRAM_BOT=TetradioBot`) и адрес приёма отчётов (`VITE_SENTRY_DSN`) — переменные репозитория, реквизиты загрузки карт кода — секреты `SENTRY_*`. Worker бота (`bot/`) выкатывается тем же workflow в окружении `cloudflare` (секреты окружения, не репозитория: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`); вебхук регистрирует владелец скриптом `scripts/bot-webhook.ts` с токеном из `.env.bot` — [docs/telegram.md](docs/telegram.md#бот-и-обратная-связь). Обратная связь — группа поддержки с темами, связи в D1 `tetradio-feedback`, токен бота — секрет Worker `BOT_TOKEN`. Форма «Написать автору» отправляет в Worker (`/feedback`) по адресу из переменной репозитория `VITE_FEEDBACK_URL`; без неё кнопка открывает чат бота.

## Документация

- [Продукт: пользователь, позиционирование, принципы](PRODUCT.md)
- [PRD: цели и требования](docs/PRD.md)
- [Программа курса](docs/curriculum.md)
- [Формат экзамена A2](docs/exam-a2.md)
- [Telegram Mini App: бот, разработка, проверки на устройствах](docs/telegram.md)
- [Синхронизация прогресса](docs/sync.md)
- [Базовые спецификации](openspec/specs/)
- [Изменения: активные и архив](openspec/changes/)

## OpenSpec

Локальная dev-зависимость @fission-ai/openspec, версия закреплена в package-lock.json. Установлено по [официальной документации](https://github.com/Fission-AI/OpenSpec).

```sh
npm ci
npm run spec
npm run spec:status
npm run openspec -- list
```

Навыки Codex созданы в `.agents/skills/`: openspec-explore, openspec-propose, openspec-apply-change и другие. Начать обсуждение можно фразой «изучи PRD и уточни план»; реализацию — отдельным запросом после просмотра документов.

Базовые спецификации — в `openspec/specs/`; новые требования предлагаются внутри изменения и становятся базовыми после реализации и архивирования. Галочки в tasks.md относятся к реальной работе, а не к написанию плана.
