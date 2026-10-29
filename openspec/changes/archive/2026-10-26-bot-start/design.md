## Context

Серверной части нет: приложение — статическая сборка на GitHub Pages (`.github/workflows/deploy.yml`), токен бота хранится только в BotFather (`docs/telegram.md:3`), `/start` никто не обрабатывает (`docs/telegram.md:17`). Домен `tetradio.app` уже в Cloudflare (`docs/telegram.md:7`). В репозитории нет ни `wrangler`, ни кода Workers. Выкатка сайта идёт после зелёного CI на `main` через `workflow_run` и собирает проверенный коммит (`deploy.yml:5-9`, `:21-29`).

## Goals / Non-Goals

**Goals:**

- Ответ на `/start` и на прочие сообщения в личном чате без хранения токена бота на сервере.
- Выкатка без ручных шагов после первоначальной настройки секретов.
- Обработчик проверяется unit-тестами без сети и без Cloudflare.

**Non-Goals:**

- Приём сообщений, пересылка автору, ответы пользователям, хранилище (KV) — следующее изменение.
- Контакт автора в ответе бота — после решения владельца (Б1 в `public-launch-readiness`).
- Передача параметра `/start <параметр>` в приложение: кнопка `web_app` не несёт `start_param` (`src/platform/launch.ts:70`), ссылки внутрь приложения остаются на `?startapp` (`src/platform/share.ts`).
- Отдельный Worker для бота разработки.

## Decisions

**Ответ в теле ответа на вебхук.** Bot API позволяет вернуть вызов метода прямо в ответе на вебхук: JSON с полем `method: "sendMessage"`, статус 200, `Content-Type: application/json`. Worker не обращается к Bot API, поэтому токен бота ему не нужен. Результат такого вызова не виден ни Worker, ни `getWebhookInfo` (`last_error_message` описывает только доставку по HTTP): правильность ответа держат unit-тест формы ответа и проверка на устройстве. Альтернатива — `fetch` к `api.telegram.org` с токеном из секрета Worker: даёт результат вызова, но приносит секрет; понадобится в следующем изменении, когда бот начнёт отправлять сообщения сам.

**Проверка секрета вебхука.** `setWebhook` с `secret_token`; Telegram присылает его в заголовке `X-Telegram-Bot-Api-Secret-Token`. Секрет — только `A-Z a-z 0-9 _ -`, 1–256 символов; генерируется `openssl rand -hex 32`. Worker отвечает 401 без тела, если секрет `WEBHOOK_SECRET` не задан или пуст (окно между первой выкаткой и `wrangler secret put`), если заголовка нет или он не совпадает; сравнение строгое, за постоянное время. Метод, отличный от POST, — 405.

**Что считается обновлением для ответа.** Только `message` в чате `type: "private"`. `/start` распознаётся по первому слову текста: `/start`, `/start@TetradioBot`, `/start <параметр>` — приветствие. Любое другое `message` в личном чате (текст, фото, стикер) — короткий ответ. `edited_message`, `callback_query`, `my_chat_member`, сообщения групп и каналов, тело не JSON — 200 без тела: Telegram не повторяет доставку. При регистрации `allowed_updates: ["message"]`, чтобы лишнее не приходило вовсе.

**Кнопка.** Инлайн-кнопка `web_app` (разрешена только в личных чатах — других и нет) с адресом из переменной Worker `APP_URL` (`https://tetradio.app/app/`, в `wrangler.jsonc`). Альтернатива — кнопка-ссылка `https://t.me/TetradioBot?startapp`: открывает Main Mini App, но лишним переходом. Запуск из инлайн-кнопки по коду совместим: пользователь — из `tgWebAppData` (`launch.ts:69`), `?bot=` нет — профиль `tetradio-tg-TetradioBot-<id>` и CloudStorage те же. Режим окна (полноэкранный у Main Mini App) может отличаться — проверка на устройстве (задача 4.3).

**Код без зависимостей и без журналов.** `bot/worker.ts` ничего не импортирует, экспортирует чистую функцию ответа на обновление и обработчик `fetch`; в нём только Web API (`Request`, `Response`, `crypto`), без `process` и `import.meta.env`, которые корневой `tsconfig.json` (`types: ["vite/client", "node"]`) пропустил бы. Тело обновления не логируется; `observability` в `wrangler.jsonc` выключено явно — тексты пользователей не оседают в Workers Logs. Сообщения при этом проходят через Cloudflare — это попадает в политику (Б2 в `public-launch-readiness`).

**Зависимость `wrangler` — отдельно от приложения.** `bot/package.json` со своим `package-lock.json`: `wrangler` тянет `workerd` и `esbuild` с install-скриптами, в корневом lock-файле их сейчас нет; в корне они попали бы в каждую из девяти задач CI и в Dependabot приложения. Корневые `typecheck`, `lint`, `format:check` и `vitest` покрывают `bot/worker.ts` без установки `bot/` (импортов нет). `.wrangler/` — в `.gitignore`: иначе сгенерированный бандл уронит `format:check` и `lint`.

**Проверка сборки Worker в CI.** Job `worker` в `ci.yml`: `npm ci --prefix bot`, `npx --prefix bot wrangler deploy --dry-run --config bot/wrangler.jsonc` — ловит ошибки сборки до мержа; выполняется параллельно с остальными.

**Выкатка.** Job `worker` в `deploy.yml`:

- условие как у `build` (`deploy.yml:21-23`: `workflow_run` после зелёного CI на push), а `workflow_dispatch` — только с `refs/heads/main`;
- `actions/checkout` с `ref: ${{ github.event.workflow_run.head_sha || github.sha }}` — выкатывается проверенный CI коммит;
- GitHub Environment `cloudflare` с правилом ветки `main`; секреты `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` — секреты этого окружения и передаются в `env` только шага `wrangler deploy`, не всей задачи: install-скрипты `npm ci` их не видят;
- без токена шаги пропускаются: `env: HAS_CF: ${{ secrets.CLOUDFLARE_API_TOKEN != '' }}` на уровне задачи и `if: env.HAS_CF == 'true'` на шагах (контекст `secrets` в `if:` задачи недоступен, такой workflow не разобрался бы и сломал выкатку сайта);
- `WRANGLER_SEND_METRICS=false`;
- общая `concurrency: pages` отменяет и выкатку Worker при новом запуске — следующая выкатка того же `main` её повторит.

Альтернатива — `cloudflare/wrangler-action`: ещё одно стороннее действие с доступом к токену; `wrangler` из lock-файла проще проверить.

**Регистрация вебхука.** `scripts/bot-webhook.ts` — запуск владельцем: `node --env-file=.env.bot scripts/bot-webhook.ts` (`.env.*` уже в `.gitignore`, токен не остаётся в истории оболочки). Читает `BOT_TOKEN`, `WEBHOOK_URL`, `WEBHOOK_SECRET`; проверяет формат секрета до запроса; вызывает `setWebhook` с `secret_token`, `allowed_updates: ["message"]`, `drop_pending_updates: true`, с `--delete` — `deleteWebhook`; затем `getWebhookInfo` и печатает адрес, число ожидающих обновлений и последнюю ошибку доставки. Токен не попадает в вывод ни при успехе, ни при сбое сети или `ok: false` (адрес запроса с токеном в сообщения не включается). Выполняется только при прямом запуске (`process.argv[1]?.endsWith(...)`, как `scripts/bundle-diff.ts:16`), чтобы тест мог импортировать функции.

## Risks / Trade-offs

- [Worker упал или выкатка сломана] → Mini App от вебхука не зависит; Telegram копит обновления до 24 часов и повторяет доставку. Откат — `npx --prefix bot wrangler rollback --config bot/wrangler.jsonc` или `deleteWebhook` (скрипт с `--delete`), после чего бот снова молчит, как сейчас.
- [Ответ в теле вебхука не подтверждается] → ошибка в форме ответа (адрес кнопки, `chat_id`) нигде не видна; держится unit-тестом формы ответа и проверкой на устройстве после каждой правки текстов.
- [Утечка токена Cloudflare] → подменённый Worker получает все входящие сообщения бота и через ответ на вебхук вызывает любой метод Bot API от имени бота: фишинг пользователям, `setWebhook` на чужой адрес, смена описания. Меры: токен только с `Workers Scripts: Edit` на один аккаунт; секреты в Environment `cloudflare` с правилом ветки `main` и только в шаге выкатки; при подозрении — отозвать токен Cloudflare и перерегистрировать вебхук скриптом (вебхук привязан к адресу, а не к токену Cloudflare).
- [Первая выкатка в аккаунт без поддомена `workers.dev`] → неинтерактивный `wrangler deploy` падает; поддомен создаётся один раз в дашборде, `workers_dev: true` задаётся явно; права токена проверяются локально тем же токеном до мержа (`wrangler whoami`, `deploy --dry-run`).
- [Лимиты бесплатного тарифа Workers] → 100 000 запросов в сутки и 10 мс CPU на запрос; одно сообщение — один запрос, обработчик без внешних вызовов.

## Migration Plan

1. Владелец до мержа: поддомен `workers.dev` в дашборде Cloudflare; API-токен с `Workers Scripts: Edit`; GitHub Environment `cloudflare` с правилом ветки `main` и секретами `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
2. Мерж → job `worker` выкатывает Worker; до секрета он отвечает 401 на всё. Владелец задаёт секрет: `openssl rand -hex 32`, `npx --prefix bot wrangler secret put WEBHOOK_SECRET --config bot/wrangler.jsonc`.
3. Владелец запускает `scripts/bot-webhook.ts` с токеном бота из `.env.bot` — вебхук зарегистрирован, `getWebhookInfo` без ошибок.
4. Проверка на устройстве (задача 4.3); Description в BotFather не обещает молчания бота.

Откат: `wrangler rollback` к предыдущей версии Worker или `deleteWebhook` — бот возвращается к прежнему поведению.

## Реализация

- `scripts/bot-webhook.ts`: функция `webhook` возвращает код и строки вывода, печатает только прямой запуск — тест проверяет вывод без `takeConsole`. Токен скрывается во всех строках вывода заменой, а не только в известных местах: сообщение `fetch` и описание Telegram тоже могут его содержать.
- `tsconfig.json` включает `bot/worker.ts`, а не весь `bot/`: иначе в проверку попали бы `bot/node_modules`.
- `compatibility_date` — `2026-10-19`: последняя дата, которую поддерживает `workerd` из `wrangler` 4.152.0.
- Задача `worker` добавлена в `needs` итоговой задачи `checks` в `ci.yml`.
- Job `worker` в `deploy.yml` после мержа ещё не запускался. На момент реализации секреты Cloudflare заведены на уровне репозитория, окружения `cloudflare` нет: job их увидит, но секрет репозитория читает любой workflow любой ветки, и правило ветки окружения его не защищает. Перенос в окружение — задача 3.2.1; выполнен владельцем 26.10.2026: окружение `cloudflare` с правилом ветки `main`, в секретах репозитория `CLOUDFLARE_*` нет.
- 26.10.2026: job `worker` выкатил Worker `tetradio-bot` (версия `38e6c9a3`), секрет `WEBHOOK_SECRET` задан, вебхук зарегистрирован скриптом без ошибок доставки; владелец проверил `/start`, сообщение и кнопку на iPhone и ноутбуке. Android по решению владельца 26.10.2026 не проверяется («Android не важен»).
- Задача 4.2 передана `public-launch-readiness` (#286): оно архивируется позже и по правилу из tasks.md приводит свою задачу 1.5 и политику (1.2) в соответствие с ответом бота и Cloudflare как обработчиком сообщений.
- Без токена job не молчит: шаг с `::notice::` в Actions.
- Зависимости `bot/` — отдельная запись Dependabot (`/bot`, раз в месяц): `wrangler` закреплён точно.
- Общая `concurrency: pages`: ручной запуск не с `main` отменяет идущую выкатку `main` и сам Worker не выкатывает; Worker остаётся на прежней версии до следующего push (сайт вёл себя так и раньше). `wrangler deploy` загружает Worker одним запросом — отмена не оставляет его наполовину выкаченным.
- Worker не падает на теле `null`, массиве, строке и `text` не строкой: 500 заставил бы Telegram повторять доставку.
