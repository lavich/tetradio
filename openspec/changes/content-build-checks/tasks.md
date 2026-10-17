Зависимости: нет; соседние изменения не архивируются раньше. Пересечение с #158 (`voices.ts`, `answers.ts`, `scripts/voice-dialogues.ts`) — эти файлы не трогаем, `readSources` остаётся терпимым к структуре урока.

## 1. Базовая линия

- [x] 1.1 Снять эталон `public/content` (без `generatedAt` в `catalog.json`) и вывод `npm run content`; `npm test` до правок. Проверка: сохранён хэш каталога файлов, тесты зелёные.

## 2. Ошибки с путём файла и строгие поля

- [x] 2.1 `parseYaml` в `common.ts`, использовать в `load`, `pictures.yaml` и `voices/*.yaml`. Тест: битая кавычка, документ-список, пустой файл (в том числе в `voices/`) → `ContentError` с путём файла.
- [x] 2.2 Шаг `checkSources` в `buildContent` (не в `readSources`): таблицы допустимых полей, `Array.isArray` для списков, элементы-объекты у `examples`/`reading`/`items`; `status`/`targetDate` у урока с прежним пояснением. Тест: `froms:`, `examples: 5`, `examples: [null]`, `lessons: строка`, лишнее поле у фразы, урока, модуля, курса; текущий контент и `tests/fixtures` собираются; `readSources` не бросает на уроке с непонятными `blocks`.
- [x] 2.3 Двойной файл урока (`.yml` рядом с `.yaml`). Тест: ошибка с обоими путями.

## 3. Картинки библиотеки

- [x] 3.1 `forbiddenIn` из `art.ts` в `media.ts` для `pictures/`. Сообщение остаётся «скрипт…» (тест `course-build.test.ts:417`). Тест: `<image href="https://…">`, `onload=`, `url(https://…)`, `<style>` отклоняются; 150 текущих картинок проходят.
- [x] 3.2 Источник по SHA в `scripts/pictures-sync.ts`. Проверка: `grep @main scripts/pictures-sync.ts` пусто; `curl -I` одного файла по обоим зеркалам с SHA отвечает 200; `node scripts/pictures-sync.ts` не меняет `content/pictures` и `pictures.yaml` (`git status` чист).

## 4. Пакеты, каталог, сообщения, исходники

- [x] 4.1 `parsePackage` для каждого пакета, `parseCatalog` для каталога. Тест: `packLessons` с пакетом без разметки и озвучки, не проходящим разбор клиента, бросает `ContentError` с `lessons/<id>.yaml`; текущие 103 пакета и каталог проходят; время сборки до +0,3 с.
- [x] 4.2 Сообщение для урока чернового модуля (`readings.ts`, через `moduleOf`); сводить места одного слова в отчёте спорных мест в одну строку (дублей источника нет — проверено); `throw error` вместо пересоздания `ContentError` (`lessons.ts`, `courses.ts`). Тест: текст для чтения после урока чернового модуля называет модуль.
- [x] 4.3 `checkCardAudio` без мутации: возвращает копию `ContentRoot`, её получают `buildCards` и `buildMedia`. Тест: после сборки с устаревшей записью `BuiltContent.sources` слова сохраняет `audio`, карточка без `audioAssetId`.

## 5. Артикли и проверка

- [x] 5.1 `content/greek.ts` с `ARTICLE_WORDS`; `marks.ts` и `coverage.ts` берут его (`check-lexicon.ts` не трогаем). Тест: `ARTICLES` и начало `GRAMMAR` равны прежним литералам; `public/content` совпадает с эталоном 1.1 побайтово, вывод сборки совпадает, кроме строк спорных мест (их меняет 4.2).
- [x] 5.2 Полная проверка: `npm run typecheck && npm run lint && npm run format:check && npm test && npm run build && npm run test:e2e && npm run test:e2e:course`. Проверка: всё зелёное.
