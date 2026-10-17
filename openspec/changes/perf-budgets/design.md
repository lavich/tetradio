# Design

## Контекст

- `scripts/check-bundle.ts` (#151): стартовый граф = модуль из `<script type="module">` плюс `modulepreload` из `app/index.html`; `INITIAL_LIMIT` 620 000; проверка исключений отложенных чанков, SDK, карт кода, precache вне области.
- CI (`.github/workflows/ci.yml`, #157): задачи `static`, `unit`, `unit-heavy`, `build`, `e2e` (3 шарда), `e2e-course` (матрица); итог — `checks` с `needs`. Сборка в `build` — как deploy (`BASE_PATH=/tetradio/`, без мока).
- `docs/perf.md`: протокол Lighthouse (`npx lighthouse`, три прогона вручную).
- `content/build.ts`: `buildContent` — чистая сборка (используется тестами на фикстурах), `writeContent` пишет `public/content`; CLI-ветка печатает отчёты.
- `tests/perf/install.perf.ts` + `playwright.perf.config.ts` (`npm run perf`): установка курса с CPU ×N, длинные задачи; сервер — `scripts/e2e-server.ts perf content <порт>` на настоящем контенте.
- vitest 5, проекты `unit` и `heavy` (`vite.config.ts`).

Замеры 17.10.2026 (основа порогов): стартовый JS gzip 202 122, brotli 177 271; CSS старта 93 975 / 19 085 gzip; precache 87 файлов, 1 479 087 байт, из них девять woff2 — 250 952 (все woff2 в `dist` — 427 604, остальные вне precache); пакет max 32 724 gzip; каталог 18 526 gzip; пакеты курсов 1 430 464 gzip вместе (греческий — 1 406 076); mp3: 32 кбит/с, max 186 624 байта.

## Goals / Non-Goals

**Goals:** пороги сборки с запасом ≈4–5% над измеренным (CSS gzip +10% из-за малой базы), пороги контента — из issue (запас 22–35%); цель — ловить рост, а не шум; каждая проверка воспроизводима локально одной командой; новая нагрузка в PR — минуты, не десятки.

**Non-Goals:** снижать размеры (только фиксировать); блокировать PR ночным замером; замер на реальном устройстве.

## Решения

### check:bundle

- Метрики вычисляются функцией, а печать/проверка отделены: `--json <путь>` пишет `{initialRaw, initialGzip, initialBrotli, cssRaw, cssGzip, precacheBytes, fontBytes}`. gzip — `zlib.gzipSync` уровень 9, brotli — `brotliCompressSync` с параметрами по умолчанию (то есть качество 11, как у большинства CDN; GitHub Pages отдаёт gzip, brotli — ориентир).
- Пределы: JS gzip 210 000, brotli 185 000, CSS старта 100 000 / gzip 21 000, precache 1 550 000, шрифты в precache 265 000. Базу снимать окружением CI (`SENTRY_DEBUG_IDS=1`, DSN), как `ci.yml`. Растут вместе с измеренной базой, как `INITIAL_LIMIT`; история замеров — в комментарии у констант, как сейчас.
- «Ленивые чанки, которые первый экран грузит сразу» статически не определяются (зависят от маршрута и состояния), поэтому меряются в Lighthouse-прогоне по списку сетевых запросов: JS, которого нет в `modulepreload`/`script` HTML. Предел — базовый замер плюс 10% (число записывается в «Реализация»); `scripts/lighthouse.ts` падает при превышении.
- Сравнение с `main` в PR: задача `build` на `pull_request` собирает базовый коммит во втором каталоге (`git worktree add ../base origin/<base>`, `npm ci`, та же сборка, `check:bundle --json`), затем `scripts/bundle-diff.ts base.json head.json` пишет таблицу в `$GITHUB_STEP_SUMMARY`. База берётся как `github.event.pull_request.base.sha` (`git fetch --depth=1 origin <sha>`), а не по имени ветки: checkout по умолчанию неглубокий. Метрики базы снимает скрипт из HEAD над `dist` базы (`check-bundle.ts` принимает `--dist`): база без `--json` (первый PR) тоже сравнивается. Отказ базовой сборки — запись «сравнения нет», задача не падает. Таймаут `build` поднимается с 10 до 15 минут. Альтернатива — комментарий в PR: нужны права `pull-requests: write`, сводка задачи их не требует.

### Lighthouse

- Новая devDependency `lighthouse` (закреплённая версия) + `scripts/lighthouse.ts`: поднимает `vite preview` mock-сборки (`VITE_TELEGRAM_MOCK=1`, `BASE_PATH=/`), запускает Lighthouse API три раза с Chromium из Playwright (`chromium.executablePath()`, флаги `--no-sandbox --headless=new`: контейнер идёт от root), берёт медиану LCP, TBT, `total-byte-weight`, печатает таблицу, пишет JSON, `::warning::` на LCP > 3 с, код возврата 1 при LCP > 4 с, TBT > 200 мс, вес > 460 800 байт (450 КиБ; «КБ» в issue читается как КиБ — так число отдаёт Lighthouse). Базовый вес снять в 1.1 до установки порога. Встроенное «симулированное» замедление Lighthouse = профиль 150 мс / 1,6 Мбит/с / CPU ×4, как в `docs/perf.md`.
- Отдельная задача `lighthouse` в `ci.yml` в контейнере Playwright (как `e2e`; браузер уже есть) и в `checks.needs`. Альтернатива «не блокирующая» отвергнута: issue требует падения при > 4 с; текущий LCP 3,45 с — запас 0,5 с, что больше разброса медианы (≈0,1–0,2 с на локальных замерах). Если на раннере медиана плавает, порог падения остаётся, а число прогонов растёт (не пороги).
- `docs/perf.md` получает раздел «В CI» вместо «В CI не входит».

### Бюджеты контента

- `content/build/budgets.ts`: `checkBudgets(files, catalog)` → список нарушений; вызывается из CLI-ветки `content/build.ts` (корень там — `defaultRoot()` без `CONTENT_ROOT`), а не из `writeContent`: `e2e-server.ts` и `tests/setup/real-content.ts` вызывают его с относительным `"content"`, сравнение корней хрупко, чтобы фикстуры (e2e-фикстуры, тесты) пределами не связывались. Модуль чистый, тесты — на малых искусственных входах с подменяемыми пределами.
- Пакет и каталог меряются `gzipSync(body, {level: 9})`; курс — сумма gzip пакетов его `lessonIds` (пакеты и их версии берутся из каталога).
- mp3: битрейт из заголовка первого аудиокадра (если это кадр Xing/Info у VBR — размер ÷ длительность) (пропуск ID3v2, таблица MPEG-1/2 Layer III), без ffprobe — в CI его нет. Если заголовок не разобран — ошибка с именем файла. Размер ≤ 250 000 байт (макс. сейчас 186 624). Пределы: пакет 40 000, каталог 25 000, курс 1 600 000 (на греческий приходится почти весь вес, ≈1,39 МБ), битрейт 32 000.
- Отчёт: строка «Бюджеты: пакет max X / 40 000 …» в обычном выводе `npm run content`.

### Ночной замер

- Workflow `perf-nightly.yml`: `schedule` (03:00 UTC) и `workflow_dispatch`; контейнер Playwright; `PERF_RATE=4`, `PERF_RUNS=3`.
- Все прогоны p98 — один тест с циклом по трём прогонам (`workers: 1`), итог пишется в файл.
- `install.perf.ts` печатает JSON и дополнительно пишет итог в `test-results/perf/install.json`; установка и TBT публикуются в сводку без порога (issue порога не называет).
- Новый `tests/perf/session.perf.ts`: после установки пакетов открыть урок и пройти упражнения, собирая записи Event Timing (`PerformanceObserver` `type: "event"`, `durationThreshold: 16` — минимально допустимый). Записи группируются по `interactionId` (одно нажатие — `pointerdown`/`pointerup`/`click`), берётся максимум; число нажатий — `performance.interactionCount`, нажатия без записи (быстрее 16 мс) считаются 8 мс. p98 по всем нажатиям трёх прогонов, `expect(p98).toBeLessThanOrEqual(100)`. Нажатия — по первой подходящей кнопке (`role=button` с названием «Проверить»/«Дальше»/варианты ответа). Какие именно экраны — уточняется при реализации по e2e-помощникам; число нажатий (`interactionCount`) ≥ 30, иначе тест падает (не доверять p98 по трём точкам).
- Замер не в `ci.yml` и не в `checks`. Падение ночного прогона видно в Actions и письмом GitHub; вне объёма — уведомления.

### Отчёт vitest

- Репортёр `tests/setup/slow-files-reporter.ts` (`onTestRunEnd`: длительность модуля — сумма полей `diagnostic()` (`duration`, `collectDuration`, `setupDuration`, `environmentSetupDuration`, `prepareDuration`), а не только `duration` тестов и хуков: импорт и окружение тоже считаются): список файлов > 10 с в stdout (`::warning file=…::`) и в `$GITHUB_STEP_SUMMARY`, если переменная задана. Подключается в `vite.config.ts` через `reporters: ["default", "./tests/setup/slow-files-reporter.ts", ...(GITHUB_ACTIONS ? ["github-actions"] : [])]` (явный список заменяет умолчание vitest, где аннотации включены в CI) — сам репортёр не ломает прогон. Локально печатает те же строки, без записи в сводку. Проект `heavy` (`scale` 30–38 с, `sync-size` ≈11 с) идёт с порогом 60 с, чтобы предупреждение значило рост, а не норму.

## Реализация

Базовые замеры 17.10.2026 (окружение CI): стартовый JS 595 789 / gzip 202 122 / brotli 177 271; CSS 93 975 / gzip 19 085; precache 1 479 087, шрифты 250 952. Lighthouse (локально, три прогона): LCP 3 917 / 3 455 / 3 454 мс (медиана 3 455), TBT 0, вес 410 159 байт; ленивые чанки первого экрана — 5, 32 750 байт передачи (`workbox-window`, `sync`, `TelegramNotices`, `alert-dialog`, `status-text`); предел 36 000 (+10%).

Отклонения: `check:bundle` разбит на `scripts/bundle-metrics.ts` (чистые функции, тесты) и сам скрипт; Lighthouse — `scripts/lighthouse.ts` + `scripts/lighthouse-report.ts` (решение по порогам, тесты); `chrome-launcher` добавлен devDependency вместе с `lighthouse` — запуск Chromium из Playwright.

## Риски / компромиссы

- [Lighthouse на раннере шумит] → медиана из трёх, пороги по issue; при флейках увеличиваем число прогонов, а не пороги.
- [Сборка `main` в PR удлиняет `build` на ≈1–2 мин] → собирается после основной проверки, отказ не ломает задачу; задача `build` не критический путь (e2e дольше).
- [Новая зависимость `lighthouse` тяжёлая (десятки пакетов)] → только devDependency; в `npm ci` задач без Lighthouse добавляет секунды благодаря кешу npm. Альтернатива — `npx lighthouse@<версия>` в CI: версия вне lock-файла, локально воспроизводится так же; выбран lock-файл.
- [Пределы mp3 зафиксируют 32 кбит/с] → намеренно: при смене голоса/кодека предел поднимается явным решением.
- [Event Timing даёт 0 записей в headless] → проверяется в реализации; запасной вариант — `performance.now()` вокруг `click()` до `requestAnimationFrame`×2 внутри страницы.

## Миграция

Чисто аддитивно, без изменений формата данных; откат — revert. Защита `main` требует только `checks`: новая задача `lighthouse` входит в его `needs`, ночной замер — нет.
