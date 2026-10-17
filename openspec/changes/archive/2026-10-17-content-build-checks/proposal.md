## Why

Сборщик контента (`content/build/*`) принимает исходники мягче, чем должен: опечатка в имени поля, битый YAML или второй файл урока молча меняют то, что увидит учащийся, а ошибки приходят без пути файла. Замеры 17.10.2026 на `main` a4deb24: в `content/` 956 слов, 348 фраз, 103 урока, 40 модулей, 150 SVG из `pictures/`; `.yml`-файлов нет; ключи YAML во всех папках входят в интерфейсы `WordSource`, `PhraseSource`, `LessonSource`, `ModuleSource`, `CourseSource` — строгая проверка полей текущий контент не ломает. Все 150 картинок библиотеки проходят набор запретов своих иллюстраций (`content/art.ts` `FORBIDDEN`): совпадений — 0 по каждому правилу, `url(#…)` встречается только внутренний.

## What Changes

Требование пользователя (issue #154, пункты 1–8) и решение по пункту 8 (17.10.2026): «Только артикли, без смены поведения» — окончания и `inflected` не трогать, остальное из пункта 8 — не в этом изменении.

Предлагаемый объём:

- Ошибки разбора YAML и неверная форма документа/списков — `ContentError` с путём файла; поля-списки проверяются через `Array.isArray`.
- Список допустимых полей для `WordSource`, `PhraseSource`, `LessonSource`, `ModuleSource`, `CourseSource`; неизвестное поле — ошибка сборки.
- Два файла урока с одним именем и разным расширением (`x.yml`/`x.yaml`) — ошибка, как повтор id у карточек.
- SVG из `pictures/` проверяется общим набором запретов с иллюстрациями; `scripts/pictures-sync.ts` берёт библиотеку по SHA коммита, а не `@main`.
- `parsePackage` в сборке — для каждого пакета, `parseCatalog` — для каталога.
- Сообщения: чернового модуля урок не «нет в курсе»; повторы спорных мест сводятся; перебросы `ContentError` без смысла убираются.
- Сборка не меняет исходники: `checkCardAudio` не делает `delete src.audio`.
- Один набор греческих артиклей для `marks.ts`, `coverage.ts`, `scripts/check-lexicon.ts`.
- Результат сборки (`public/content`, кроме `generatedAt`) на текущем контенте прежний: поведения для учащегося не меняется.

## Capabilities

### New Capabilities

Нет.

### Modified Capabilities

- `course-content`: ADDED «Сборка контента — строгая проверка исходников» (ошибки с путём файла, неизвестные поля, двойные файлы, SVG библиотеки, пакеты и каталог проверяются всегда, исходники не меняются).

## Impact

`content/build/sources.ts`, `common.ts`, `media.ts`, `card-audio.ts`, `output.ts`, `readings.ts`, `lessons.ts`, `courses.ts`, `mark-courses.ts`, `content/art.ts`, `content/marks.ts`, `content/coverage.ts`, `content/build.ts`, `scripts/pictures-sync.ts`, `scripts/check-lexicon.ts`; тесты `tests/course-build.test.ts`, `tests/authoring.test.ts` и новый `tests/content-checks.test.ts`. Пересечение с соседним изменением #158 (`voice-script-drafts` правит `content/build/voices.ts` и `answers.ts`): эти файлы здесь не трогаются. Формат пакетов, приложение, облако не затронуты.
