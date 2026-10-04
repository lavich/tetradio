# Tasks

## 1. Голоса

- [x] 1.1 Прослушивание: 10 реплик курса голосами Google Chirp 3 HD и Azure; выбор сервиса; цены и условия — в `docs/voices.md`. Выбран Google Chirp 3 HD, MP3; женские голоса: Aoede, Callirrhoe, Achernar, Autonoe, Despina, Erinome, Gacrux, Kore, Laomedeia, Leda, Sulafat, Vindemiatrix, Zephyr; мужские: Algenib, Algieba, Alnilam, Charon, Enceladus, Fenrir, Iapetus, Puck, Rasalgethi, Sadachbia, Sadaltager, Schedar, Umbriel, Zubenelgenubi.
- [x] 1.2 `content/voices.yaml`: голос каждого персонажа и диктора; сборка проверяет полноту и разные голоса внутри диалога.

## 2. Формат и сборка

- [x] 2.1 Схема реплики: необязательная ссылка на файл; источник у файла обязателен.
- [x] 2.2 Сборка отдаёт файлы реплик как медиа пакета с версией в имени.
- [x] 2.3 Скрипт `scripts/voice-dialogues.ts` (`npm run voices`, `--check`): синтез недостающих и изменившихся реплик в `content/audio/`.

## 3. Воспроизведение

- [x] 3.1 `playDialogue`: файл реплики, иначе системный голос; медленный режим через `playbackRate`; предзагрузка следующей реплики.
- [x] 3.2 Уборка `db.assets`, на которые не ссылается ни один пакет.
- [x] 3.3 Тесты: воспроизведение с файлом и без, медленный режим, уборка; e2e аудирования с файлами.

## 4. Озвучка курса

- [ ] 4.1 Озвучить модуль 01, проверить на iPhone, iPad, Mac, Android и Windows. Озвучено: 20 реплик, 646 символов, 216 КБ; осталась проверка на устройствах.
- [ ] 4.2 Озвучить остальные модули.
