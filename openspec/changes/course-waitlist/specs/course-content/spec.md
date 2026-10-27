## ADDED Requirements

### Requirement: Курсы в работе в каталоге
Файл курса SHALL допускать пометку `upcoming: true` — курс в работе. У такого курса допускаются только `title`, `language` (обязателен), `level`, `goal`, `after`, `hidden` и `upcoming`; любое другое поле (`modules`, `lessons`, `calendar`, `exam`, `passShare`, `order`, `short`, `palette`, `entry`, `pace`, `source`) MUST отклоняться сборкой с `ContentError`, в сообщении — путь файла и имя поля. `after` MUST быть id поставляемого курса (не скрытого), а у языка курса в работе MUST быть поставляемый курс с уроками. Сборка SHALL класть курс в работе в список каталога `upcoming` (`id`, `title`, `language` и заданные `level`, `goal`, `after`), а не в `courses`; id курса в работе MUST NOT совпадать с id курса. Курс в работе с `hidden: true` в каталог не попадает. Клиент SHALL читать `upcoming` без отказа каталога: неверная запись отбрасывается, остальной каталог применяется; каталог без `upcoming` очищает список. Прежний клиент MUST читать каталог с `upcoming` без ошибки и без курса в работе на экранах.

#### Scenario: Курс B1 в каталоге
- **WHEN** в `courses/greek-b1.yaml` заданы `title: Греческий`, `language: el`, `level: A2 → B1`, `after: greek-a2`, `upcoming: true`
- **THEN** в `catalog.json` в `upcoming` запись `greek-b1` с этими полями, в `courses` её нет, первый экран «Сегодня» — по требованию «Первый экран одного курса»

#### Scenario: Уроки у курса в работе
- **WHEN** у курса с `upcoming: true` задано `modules`
- **THEN** сборка падает с `ContentError`, в сообщении `courses/greek-b1.yaml` и `modules`

#### Scenario: Предыдущий курс скрыт или неизвестен
- **WHEN** `after` — скрытый курс или курс, которого нет
- **THEN** сборка падает с `ContentError`, в сообщении путь файла и `after`

#### Scenario: Прежний клиент
- **WHEN** клиент прежней версии получает каталог с `upcoming`
- **THEN** каталог применяется, на «Курсе» и «Сегодня» курса в работе нет

#### Scenario: Неверная запись на клиенте
- **WHEN** в `upcoming` запись без `title`
- **THEN** клиент её отбрасывает, остальные курсы в работе и каталог применяются
