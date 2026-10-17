# Tasks

Зависимости: независимо от `question-language` и `release`. Пересекается с #157 (CI) и #156 (e2e) по `tests/e2e` и `.github/workflows/ci.yml`: правки только добавляющие, при конфликте — rebase.

- [x] 1.1 Базовый замер `main` (три прогона Lighthouse по протоколу из design.md), числа в «Реализация». Проверка: числа записаны.
- [x] 1.2 `docs/perf.md`: протокол замера, базовые и итоговые числа, рычаги. Проверка: `prettier --check docs/perf.md`.
- [x] 2.1 Отложить `import("./sync")` и подписку конфликта (`useSyncConflictSeen`) через общий отложенный промис; отмена в `stop()`. Проверка: unit-тесты — чанк не грузится до `afterStartup`, `skip` при закрытой базе, отказ чанка даёт предупреждение, остановленный запуск отменяет загрузку; обновить `tests/deferred-ui.test.tsx` и `tests/app-deferred-wiring.test.tsx`.
- [x] 2.2 Отложить `registerSW` через `afterStartup`, `dropServiceWorker` оставить сразу. Проверка: e2e `startup.spec.ts` (запрос `workbox-window` только после паузы) и `account.spec.ts` со снятием чужого service worker зелёные.
- [x] 2.3 e2e: с начала навигации (`page.on("request")`) до паузы нет запросов `sync-*` и `workbox-window`; позже статус доходит до `synced`; диалог конфликта показывается. Проверка: `npm run test:e2e`, три повтора облачных спеков (`account`, `telegram`).
- [x] 3.1 Разбор стартового графа (`course`, `dexie-react-hooks`, `format`): что убрать с первого экрана без смены поведения; каждый рычаг — медиана LCP до/после, оставить только при выигрыше. Проверка: числа в «Реализация».
- [x] 3.2 `scripts/check-bundle.ts`: нет `sync`, `TelegramNotices`, `workbox-window` в стартовом графе; `INITIAL_LIMIT` — по замеру после 3.1. Проверка: `npm run build && npm run check:bundle` зелёный, красный при искусственном превышении.
- [x] 4.1 Итоговый замер «до/после», числа в design.md, docs/perf.md и PR. Проверка: числа в PR.
- [x] 4.2 Полная проверка: `npm run typecheck && npm run lint && npm run format:check && npm test && npm run build && npm run check:bundle && npm run test:e2e && npm run test:e2e:course`. Проверка: все зелёные.
