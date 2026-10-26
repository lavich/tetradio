Зависимость: реализует задачу 1.2 `public-launch-readiness`; задача 1.3 (удаление) обновит раздел «Удаление» политики; 1.4 — срок хранения отчётов.

## 1. Страницы

- [x] 1.1 `privacy/index.html`, `privacy/en/index.html`, `privacy/privacy.css`; входы сборки; `globIgnores` и `check-bundle.ts` — страницы вне service worker; `public/sitemap.xml`. Проверка: сборка отдаёт обе страницы; в них нет `<script>` и внешних ресурсов; ссылки RU ↔ EN с `hreflang`; в `sw.js` нет `privacy`; `check:bundle` без роста стартовых графов.
- [x] 1.2 `REPORT_TAGS` в `reporting.ts`; тест совпадения полей и меток с политикой и одинаковых разделов RU/EN. Проверка: `tags()` и `capture` ставят только ключи `REPORT_TAGS`; тест падает, если убрать из страницы любое поле `ALLOWED_EXTRA` или метку, или раздел из одной версии.
- [x] 1.3 `REPORT_BOUNDARIES` и `docs/telegram.md:17` по фактам. Проверка: `rg "IP-адрес не сохраняется|webhook не нужны|проверки .initData. нет" src docs` пусто.

## 2. Ссылки

- [x] 2.1 Ссылка на лендинге (`lp-close`). Проверка: тест разметки лендинга — ссылка `privacy/`; лендинг по-прежнему не открывает базу (`tests/e2e/account.spec.ts`); скриншот лендинга 390 px.
- [x] 2.2 «Настройки и данные»: ссылка вне свёрнутого раздела, `openLink` при Bot API 6.1+ (тип в `telegram-types.ts`). Проверка: тест экрана — в Telegram вызывается `openLink` с абсолютным адресом, ниже 6.1 и вне Telegram — ссылка с `target="_blank"`; скриншот 390 px.

## 3. Документация и проверка

- [x] 3.1 `docs/telegram.md`: ссылка для BotFather (Privacy Policy), README. Проверка: факты сверены.
- [x] 3.2 Владелец читает обе версии текста до мержа (в том числе тон по PRODUCT.md) и проверяет участие Sentry, Cloudflare, GitHub в DPF. Проверка: ответ владельца записан в design «Реализация» (текст — одобрен 26.10.2026; DPF — открыто, переносится в `public-launch-readiness`).
- [x] 3.3 Полный набор CI. Проверка: все команды зелёные, `check:bundle` без роста.
