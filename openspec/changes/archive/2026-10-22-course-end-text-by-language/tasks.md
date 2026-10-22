Зависимость: архивировать после `today-by-language` (MODIFIED «Лист «Чтение» на «Сегодня»» — полным текстом поверх неё); с `english-travel-social`, `english-it-b1plus`, `english-it-b2` не пересекается (они правят `course-content`).

## 1. Текст конца курса из профиля языка

- [x] 1.1 Тесты (красные): `tests/language-client.test.ts` — `PROFILES.el.finished` равен прежнему греческому тексту, `PROFILES.en.finished` — английскому и не содержит «экзамен», «M3»; `tests/today-language-ui.test.tsx` — пройденный греческий курс показывает греческий текст, пройденный английский — английский без «экзамен»/«M3», курс со следующим уроком не показывает `course-finished`, пустой курс не считается пройденным (`tests/course-progress.test.ts:197-199`), курс на паузе уступает основное место следующему курсу. Проверка: `npx vitest run tests/language-client.test.ts tests/today-language-ui.test.tsx` падает до правки.
- [x] 1.2 Поле `finished` в `LanguageProfile` и профилях `el`, `en` (`src/domain/language.ts`); `LanguageToday.tsx` показывает `profile.finished`. Проверка: тесты 1.1 зелёные, `npm run typecheck`.

## 2. Экраны и спека

- [x] 2.1 Скриншот временного e2e-теста пройденного греческого и английского курса на 390 px и на десктопе; тест и снимки удалить. Проверка: текст не обрезан и не вылезает за экран.
- [x] 2.2 `openspec validate course-end-text-by-language --strict`, `npm run spec`, `prettier --check openspec/changes/course-end-text-by-language`. Проверка: без ошибок.
- [x] 2.3 Полный набор CI из feature-flow (кроме e2e и lighthouse). Проверка: всё зелёное.
