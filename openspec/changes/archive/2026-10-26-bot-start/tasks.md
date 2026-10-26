Зависимость: реализует задачу 3.1 изменения `public-launch-readiness` (PR #286) и меняет её задачу 1.5 («сообщение боту оставлено без ответа»). Порядок архивации свободный; кто архивируется позже, тот приводит 1.5 и 3.1 в соответствие (задача 4.2).

## 1. Worker

- [x] 1.1 `bot/worker.ts`: чистая функция ответа на обновление и обработчик `fetch` (POST, секрет вебхука, личный чат, `/start` и прочие сообщения, кнопка `web_app` с `APP_URL`), только Web API, без журналирования тела. Проверка: `tests/bot-worker.test.ts` — `/start`, `/start@TetradioBot`, `/start w_x` дают приветствие; текст и фото — короткий ответ; у обоих статус 200, `Content-Type: application/json`, `method: "sendMessage"`, `chat_id` из сообщения, `reply_markup.inline_keyboard[0][0].web_app.url` равен `APP_URL`; секрет не задан — 401 и с заголовком, и без; неверный и отсутствующий заголовок — 401 без тела; GET — 405; группа, канал, `edited_message`, `callback_query`, тело не JSON — 200 без тела.
- [x] 1.2 `bot/wrangler.jsonc` (имя, `main`, `compatibility_date`, `workers_dev: true`, `observability` выключено, `send_metrics: false`, переменная `APP_URL`); `bot/package.json` и `bot/package-lock.json` с `wrangler`; `bot/worker.ts` в `include` корневого `tsconfig.json`; `bot/` в `.github/dependabot.yml`; `.wrangler/` в `.gitignore`. Проверка: `npm run typecheck`, `npm run lint`, `npm run format:check`; `npx --prefix bot wrangler deploy --dry-run --config bot/wrangler.jsonc` собирает Worker, после него `git status` чистый; корневой `package-lock.json` не изменился.

## 2. Регистрация вебхука

- [x] 2.1 `scripts/bot-webhook.ts`: проверка формата секрета, `setWebhook` с `secret_token`, `allowed_updates: ["message"]`, `drop_pending_updates: true`; `--delete` — `deleteWebhook`; затем `getWebhookInfo`; запуск только при прямом вызове. Проверка: unit-тест с подменённым `fetch` — параметры запросов; токен не попадает в вывод при успехе, сбое сети и `ok: false` (функция возвращает вывод, а не печатает его); без переменных окружения и с секретом недопустимого формата — понятная ошибка, код выхода 1, запросов нет.

## 3. CI и выкатка

- [x] 3.1 Job `worker` в `.github/workflows/ci.yml`: `npm ci --prefix bot`, `wrangler deploy --dry-run`, в `needs` итоговой `checks`. Проверка: `actionlint` без замечаний; локально `wrangler deploy --dry-run` собирает Worker.
- [x] 3.1.1 Проверка: job `worker` зелёный на PR.
- [x] 3.2 Job `worker` в `.github/workflows/deploy.yml`: условие как у `build`, `workflow_dispatch` только с `main`; `checkout` с `ref` проверенного коммита; Environment `cloudflare`; секреты только в `env` шага выкатки; без токена — пропуск шагов через `HAS_CF` и предупреждение в Actions; `WRANGLER_SEND_METRICS=false`. Проверка: `actionlint` по обоим workflow без замечаний.
- [x] 3.2.1 Владелец: окружение `cloudflare` с правилом ветки `main`, секреты Cloudflare перенесены в него и удалены из секретов репозитория. Проверка: `gh secret list` не показывает `CLOUDFLARE_*`, `gh secret list --env cloudflare` показывает оба.
- [x] 3.2.2 Проверка: после мержа job `worker` в Actions зелёный, Worker выкачен, выкатка сайта не изменилась.

## 4. Документация и проверка

- [x] 4.1 `docs/telegram.md`: раздел «Вебхук бота» — что отвечает, Environment и секреты, генерация секрета, регистрация, откат, что сообщения проходят через Cloudflare; исправить строки 3 и 17; `README.md` — секреты и `.env.bot`. Проверка: `rg -n "webhook не нужны|токен бота живёт только" docs README.md` пусто.
- [x] 4.2 Согласовать с `public-launch-readiness`: задача 1.5 (Description не обещает молчания), 3.1 закрыта этим изменением, в политике (1.2) — Cloudflare как обработчик сообщений боту. Проверка: при архивации второго из двух изменений `rg -n "оставлено без ответа" openspec` не находит устаревшего требования.
- [x] 4.3 Проверка на устройстве владельцем после регистрации вебхука: `/start`, произвольное сообщение, кнопка открывает «Сегодня» с прежним прогрессом; режим окна при запуске из кнопки; iPhone, Android, Desktop; строка в таблице проверок `docs/telegram.md`. Проверка: строка заполнена.
- [x] 4.4 Полный набор CI (feature-flow, раздел 4). Проверка: все команды зелёные, `check:bundle` без изменений.
