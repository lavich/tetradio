# Как предложить правку

Спасибо, что хотите помочь. Проект небольшой, и автор отвечает сам, поэтому начните с обсуждения.

## Сначала — issue

- **Ошибка в приложении, ошибка в уроке или идея** — [новый issue](https://github.com/lavich/tetradio/issues/new/choose) по шаблону.
- **Вопрос или сообщение автору** — «Написать автору» в приложении или [чат с ботом](https://t.me/TetradioBot?start=feedback).
- **Уязвимость** — по [SECURITY.md](SECURITY.md), закрыто.

Для крупной правки дождитесь ответа в issue: так проще договориться об объёме до кода.

## Ветка и проверки

1. Форк и ветка от свежего `main`.
2. Запуск и подробности — [docs/development.md](docs/development.md). Для e2e один раз: `npx playwright install chromium`.
3. Перед PR — тот же набор, что в CI (`.github/workflows/ci.yml`):

   ```sh
   npm run format:check && npm run lint && npm run typecheck && npm run check:config && npm run check:licenses && npm run spec && npm run lexicon:check && npm test
   npm run build && npm run check:bundle
   npm run test:e2e && npm run test:e2e:course && npm run test:e2e:courses
   ```

4. Экран, который вы меняете, — проверьте на ширине 360 px и на широком окне; если можете — в Telegram на телефоне.

## Требования и OpenSpec

Поведение приложения описано требованиями в [`openspec/specs/`](openspec/specs/).

- **Крупное изменение** (новая возможность, формат данных, облака или базы) — сначала план: изменение в `openspec/changes/<имя>` с proposal, design, specs и tasks ([OpenSpec](https://github.com/Fission-AI/OpenSpec), `npm run openspec -- …`). Код — после согласования плана.
- **Мелкая правка** (убрать или поправить элемент, текст, вид в рамках существующего требования; что правка мелкая, подтверждает автор в issue) — без отдельного изменения: требование правится прямо в `openspec/specs/` в том же PR.

Процесс целиком — в навыке [`feature-flow`](.claude/skills/feature-flow/SKILL.md).

## Стиль

- Код объясняется именами функций, переменных и тестов. Комментарий — только там, где из кода не видно «почему»: неочевидная причина, обход бага, ограничение внешней системы. Тесты не комментируются: их смысл — в названии.
- Тексты интерфейса и документация — по-русски, тон — [PRODUCT.md](PRODUCT.md) и [DESIGN.md](DESIGN.md).
- Коммиты — по-русски, в формате `тип(область): что изменилось` (`content` — уроки и тексты курса, `feat`, `fix`, `refactor`, `perf`, `docs`, `test`, `build`, `ci`), как в истории репозитория.

Присылая правку, вы соглашаетесь, что она распространяется по лицензии проекта ([MIT](LICENSE)).
