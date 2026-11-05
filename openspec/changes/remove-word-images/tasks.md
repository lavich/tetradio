# Tasks

Зависимость: нет. Требование «Картинки слов» не правит ни одно открытое изменение; архивировать можно в любом порядке. При архивации поправить вручную строку Purpose в `openspec/specs/course-content/spec.md` («…стабильные идентификаторы карточек и картинки слов»).

## 1. Сборка контента

- [x] 1.1 Тест: сборка отклоняет `image:` в YAML слова, `pictures.yaml`, каталоги `pictures/` и `art/` в корне контента. Проверка: тест падает до правки и проходит после.
- [x] 1.2 Одним шагом с фикстурой (иначе `npm test` красный между задачами): `tests/fixtures/mechanics` без `art/`, `pictures/`, `pictures.yaml`, `image:` у шести слов, с записью звука двух-трёх слов (`audio/`, `voices/el.yaml`, манифест озвучки), README; список копирования в `tests/helpers/mixed-fixture.ts`. Убрать картинки из сборки: `image` из разрешённых ключей и типа источника слова, `pictures` из `sources.ts`, ветки `art`/`pictures` и отчёт иллюстраций из `media.ts` и `build.ts`, `imageAssetId` из `cards.ts` и `lessons.ts`; удалить `content/art.ts`, `content/art/`, экспорт `ART_SOURCE` и `imageAssetId`. Проверка: `npm run content` проходит, в `public/content/packages` нет `imageAssetId`, в `public/content/media` нет `img-*`.
- [x] 1.3 Удалить `content/pictures/`, `content/pictures.yaml`, `scripts/pictures-sync.ts`, скрипт `pictures:sync`, `docs/course/pictures-map.tsv`, `docs/course/fluent-flat-index.txt`. Проверка: `npm run lexicon:check` и `npm run check:config` проходят.

## 2. Клиент

- [x] 2.1 Тест совместимости: старый пакет с `imageAssetId` и медиа `img-*` разбирается, слово без поля; после установки нового пакета `pruneMedia` удаляет `img-*`; ревизия слова без картинки совпадает с прежней, у слова с картинкой — новая, `cardStates` сохраняется. Проверка: тест проходит.
- [x] 2.2 Убрать `imageAssetId` из `src/content/schema.ts` (разбор, проверка ссылок, `SHIPPED_FIELDS`) и `src/domain/types.ts`. Проверка: `npm run typecheck`.
- [x] 2.3 Удалить `WordArt`, `Thumb`, проп `art` у `TaskHead`, стили `.art`, `.thumb`, `.cardRow > .pic`, `useAssetUrl`; подпись в «Настройках и данных» — только голоса; комментарии про картинки; поправить вёрстку экрана слова, листа слова, карточки знакомства, «Написания», «Сборки» и словарика. Проверка: скриншоты временного e2e на 390 px, затем тест удалить.

## 3. Тесты

- [x] 3.1 Перенести проверки, где картинка была средством (`asset-source`, `content-delivery`, `first-run-install`, `schema`, `writing-reveal`, e2e `app`, `share`, `backup`, `offline`), на запись звука слова или текст карточки, с проверкой, что медиа не пусто; `hidden-course-build` — английские слова с записью звука вместо `image:`; из `content.test.ts`, `course-build.test.ts`, `content-checks.test.ts` удалить только блоки картинок. Проверка: полный набор CI.

## 4. Документы

- [x] 4.1 Удалить `docs/art-standard.md`, `docs/design/word-art*.html`, `docs/design/art-samples/`; убрать `docs/art-sheet.html` из `.gitignore`, `.prettierignore`, `.oxlintrc.json`, `content/art` из `.prettierignore`. Проверка: `npm run format:check`, `npm run lint`.
- [x] 4.2 `NOTICE` без блока Fluent Emoji с текстом MIT; `DESIGN.md` — строка словарика без картинки; `docs/course/format.md` без палитры; шаблон `.github/ISSUE_TEMPLATE/content.yml` без «картинка»; в `public-launch-readiness` отметить снятыми вопрос 3 и строки о картинках в `design.md`, задачу о `NOTICE` в `tasks.md`. Проверка: `git grep -n -E "imageAssetId|pictures\.yaml|pictures/|art-standard|palette\.json|WordArt|word-art|useAssetUrl|Fluent" -- ':!openspec' ':!docs/course/review'` пуст.

## 5. Выпуск

- [x] 5.1 Полный набор CI локально и в PR. Проверка: все проверки `pass`.
- [ ] 5.2 После деплоя на устройстве: урок с бывшей картинкой (08-1) открывается без неё, прогресс карточек на месте. Проверка: запись в `docs/telegram.md`.
