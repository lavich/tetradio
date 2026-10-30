# Τετράδιο

[English](README.en.md)

[![CI](https://github.com/lavich/tetradio/actions/workflows/ci.yml/badge.svg)](https://github.com/lavich/tetradio/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Telegram](https://img.shields.io/badge/Telegram-@TetradioBot-26A5E4?logo=telegram&logoColor=white)](https://t.me/TetradioBot)
[![Сайт](https://img.shields.io/badge/сайт-tetradio.app-1f47b8)](https://tetradio.app)

Тетрадь для тех, кто учит новогреческий с нуля и готовится к экзамену ΚΕΓ A2 на Кипре. Курс из 24 модулей с уроками, чтением, аудированием, письмом и повторением карточек — внутри Telegram.

[Открыть в Telegram](https://t.me/TetradioBot) · [tetradio.app](https://tetradio.app)

<p>
  <img src="docs/images/today.png" alt="«Сегодня» на телефоне: повторение, чтение и следующий урок" width="260">
  <img src="docs/images/lesson.png" alt="Страница урока: объяснение правил чтения" width="260">
</p>

<img src="docs/images/spread.png" alt="«Сегодня» на широком экране: день и разворот модуля" width="820">

## Как устроено

- **Курс по шагам.** Модуль → урок → объяснение → практика → контрольная; карточки повторяют материал пройденных уроков.
- **Работает без сети.** Уроки сохраняются на устройство, ответы — в локальную базу.
- **Без регистрации.** Аккаунт — Telegram; прогресс синхронизируется между устройствами через облако Telegram.
- **Повторение по FSRS.** Сроки карточек считает алгоритм [FSRS](https://github.com/open-spaced-repetition/ts-fsrs).
- **Открытый код.** Лицензия [MIT](LICENSE), сторонние материалы — в [NOTICE](NOTICE).

## Разработка

```sh
npm ci
npm run dev:mock   # приложение с моком Telegram: http://localhost:5173/app/
npm test           # unit-тесты
```

Подробнее — [docs/development.md](docs/development.md): содержание курсов, команды и проверки, переменные окружения, деплой, OpenSpec. Как предложить правку — [CONTRIBUTING.md](CONTRIBUTING.md), уязвимости — [SECURITY.md](SECURITY.md).

## Документация

- [Продукт: пользователь, позиционирование, принципы](PRODUCT.md)
- [PRD: цели и требования](docs/PRD.md)
- [Программа курса](docs/curriculum.md)
- [Формат экзамена A2](docs/exam-a2.md)
- [Telegram Mini App: бот, разработка, проверки на устройствах](docs/telegram.md)
- [Синхронизация прогресса](docs/sync.md)
- [Разработка: запуск, проверки, деплой](docs/development.md)
- [Базовые спецификации](openspec/specs/)
- [Изменения: активные и архив](openspec/changes/)
