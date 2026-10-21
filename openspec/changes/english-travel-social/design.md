## Context

Мотивация — proposal.md, «Why». Состояние кода и контента, на которое опирается план (проверено 21.10.2026 на `main` после #231):

- **Модуль публикуется только полным** (`publicationGaps`, `src/content/course.ts:583-604`): чтение и аудирование с заданиями, письмо, речь, контрольная `kind: test` с `graded`. Урок вне модулей и карточка вне уроков роняют сборку (`content/build/lessons.ts:125`, `content/build/lessons.ts:274-279`), поэтому карточки модуля, его уроки и запись в `lessons` модуля появляются в одном шаге. Модуль-черновик `t08`…`t14` сейчас — только `number`, `title`, `goal`, `grammar`, `sessions` (`content/modules/t08.yaml`).
- **Контрольная точка не зависит от языка и календаря**: `checkpoint:` у модуля принимается сборкой (`content/build/courses.ts:94-104`), требует `kind: test` с оцениваемыми заданиями (`content/build/lessons.ts:283-288`); следующий шаг после уроков модуля — его точка, и только потом следующий модуль (`nextStep`, `src/storage/course.ts:250-258`: перебор модулей по порядку). Итог по навыкам — от `passShare` курса (`src/domain/course.ts:123-150`, `content/courses/english-travel.yaml`: `passShare: 0.6`). Образец точки — `content/lessons/t07-c1.yaml` (пять пар «аудио → `roleplay`»).
- **Регистры письма** — только `friendly` и `formal` (`src/content/course.ts:104,523`); вся ступень 2 — `friendly`.
- **Голоса.** Карта `content/voices/en.yaml` содержит 24 персонажа и диктора Kore. Женский пул (13 голосов) занят целиком, из мужского (14) свободны Fenrir и Zubenelgenubi. Сборка проверяет только то, что голос персонажа есть в пуле его пола и что в одном диалоге голоса разные (`content/build/voices.ts:96-98`, `content/build/voices.ts:105-123`); уникальность голоса на весь курс не требуется.
- **Бюджет.** `npm run content` на `main`: каталог 23 429 из 25 000 байт gzip, пакет max 32 973 из 40 000, курс 1 412 024 из 1 600 000, mp3 max 183 264 из 250 000 (`content/build/budgets.ts:19-24`). Ступень 1 подняла каталог с 20,7 до 22,4 KB при шести с половиной модулях — около 0,26 KB на модуль; семь модулей и точка добавят около 1,8–2,0 KB.
- **Карточки.** `tw001…tw105`, `tp001…tp105` — ступень 1; формат — `content/words/english-travel/tw001.yaml`, `content/phrases/english-travel/tp001.yaml`. Сборка отклоняет текст карточки, совпавший с карточкой другого курса того же языка («Карточки курсов одного языка»).

## Goals / Non-Goals

**Goals:**

- Каждый модуль `t08`–`t14` проходится целиком, четыре навыка и контрольная, как модуль ступени 1.
- «Вечер» после `t14` собирает ступень в одну проверку с итогом по навыкам.
- Каждый модуль — законченный шаг и отдельный PR; `main` после любого PR собирается и проходит тесты.
- Чувствительные темы (знакомства, алкоголь, флирт, согласие) — спокойно, уважительно, без стереотипов; все персонажи — взрослые.

**Non-Goals:**

- Правка сборки, формата каталога и пакетов, базы, облака, клиента (кроме предела `catalogGzip`, решение 4); текст «Сегодня» в конце курса (`today-by-language`).
- Американские и другие варианты языка у персонажа; запись живых голосов; паузы между репликами собеседника в сцене; тексты для беглого чтения.

## Decisions

### 1. Контент; проверки — тестами на настоящем контенте

Как в `english-travel-trip` (решение 1): код сборки не меняется, поведение закрепляется в `tests/course-content.test.ts`, один параметризованный тест на модуль ступени. `STAGE` — список опубликованных модулей: каждый PR добавляет свой модуль первой строкой и делает тест красным до контента. Дополнения к правилам ступени 1:

- `WRITING` (границы слов и `register`) для модулей ступени 2: `t08` 20–40, `t09` 40–80, `t10` 20–40, `t11` 60–100, `t12` 60–100, `t13` 40–80, `t14` 60–100, везде `friendly`; образец письма укладывается в свои границы.
- В `tNN-3` не меньше двух устных заданий и хотя бы одна `roleplay`; перед каждой `roleplay` — аудирование без задания (решение 9 ступени 1).
- Модули после `STAGE` — черновики; когда `STAGE` дошёл до `t14`, черновиков в курсе нет.
- Точка: у `t14` `checkpointId: t14-c2`; пакет `t14-c2` — `kind: test`, не меньше 10 оцениваемых пунктов на чтение и на аудирование, не меньше пяти пар «аудирование без задания → `roleplay`», письмо `friendly`, заголовок «Вечер» без «C2».
- Говорящие всех уроков — в карте `en` и не из имён IT-курса (тест `tests/course-content.test.ts:211`).
- Карточки ступени 2 нигде не повторяют карточки IT-курса и `t01`–`t07`: сборка отклоняет повтор текста между курсами одного языка (`content/build/cards.ts:198`) и повтор слова или фразы внутри курса (`content/build/cards.ts:221`, `content/build/cards.ts:243`); отдельный тест не нужен.

### 2. Порядок и нарезка PR

Один модуль — один PR (решение пользователя 21.10.2026): `t08` → `t09` → … → `t14` → «Вечер» → документы → озвучка. Внутри модуля: тест (красный) → сверка карточек → карточки, уроки и персонажи одним шагом → `npm run content` и `npm test` → языковая рецензия субагентом (только чтение) → полная проверка CI → PR → мерж по зелёному CI. Модуль опирается на пройденную лексику предыдущих: тексты используют карточки прошлых модулей без глосс, глоссы — для нового. Перед `t08` архивируется `english-travel-trip` (группа 0).

### 3. Устройство уроков модуля

Как в ступени 1 (`english-travel-trip`, решение 3): `tNN-1` — 1–2 объяснения грамматики с таблицей и типичной ошибкой, объяснение лексики, `vocabulary`, 4–6 заданий, 8 слов и 8 фраз; `tNN-2` — «как слушать / читать», чтение с заданием, 1–2 аудирования `plays: 2` с заданиями, 7 слов и 7 фраз; `tNN-3` — подготовка по банку фраз, сборка реплик, письмо с образцом, критериями и `register`, 2–3 устных задания, `items: []`; `tNN-test` — вступление на 10–15 минут, чтение и аудирование с `graded`, грамматика и карточки с `graded`. Объяснения и пояснения ошибок — по-русски, вопросы к текстам и аудио — по-английски, разметка `words` у своих примеров.

Регистр: мягкий сленг и редукции (*gonna, wanna, dunno, mate, cheers*) — в карточках и в текстах с `t09`; в `t08` — нейтрально-дружелюбный. Грубый и бранный сленг — только в аудио и чатах для понимания, с пометкой и переводом в тексте урока, без карточек (программа, «Исходные условия»).

| Модуль | Грамматика (`tNN-1`) | Чтение / аудирование (`tNN-2`) | Письмо (`tNN-3`) | Речь (`tNN-3`) |
| --- | --- | --- | --- | --- |
| t08 | present perfect для опыта (*Have you ever been to…?*), *So do I / Neither do I*, короткие ответы | посты путешественников / знакомства в хостеле, три акцента | первое сообщение новому знакомому, 20–40 слов | о себе за 30–60 с и встречные вопросы; сцена знакомства с аудио перед ней |
| t09 | разделительные (*It's great, isn't it?*) и эхо-вопросы (*Did you?*), опущения (*Sounds good, Been there*), редукции (*gonna, wanna, dunno*) | групповой чат / быстрый разговор с перебиваниями, задание «что имели в виду» | ответы в групповом чате, 40–80 слов | история из поездки 1–2 мин; сцена с переспросом и выходом из разговора |
| t10 | решения на месте (*I'll get this, Shall I…?, Let me…*), *would rather / prefer* | меню бара и афиша / заказ в шумном баре, разговор у стойки | сообщение друзьям: где вы и что заказать, 20–40 слов | заказ на компанию; заговорить у стойки и отказаться от следующего раунда |
| t11 | будущее: present continuous для договорённостей, *going to*, *will*; *Are you up for…?, How about…?* | приглашение и чат вечеринки / вечеринка и голосовое с приглашением | переписка: пригласить, договориться, перенести, 60–100 слов | пригласить и обменяться контактами; перенести встречу |
| t12 | герундий и инфинитив (*I love hiking, I'd love to*), вопросы, продолжающие переписку | анкеты и переписки (включая безопасность первой встречи) / голосовое сообщение в приложении | анкета, 60–100 слов; отказ и приглашение — задания `text` | голосовое 30 с; ответ на голосовое с аудио перед сценой |
| t13 | second conditional (*If you could live anywhere…*), смягчение (*kind of, a bit, I guess*), *would rather* | статья о первых свиданиях / свидание, согласие и мягкий отказ | сообщение после свидания (продолжить или вежливо закончить), 40–80 слов | беседа 3 мин; сказать «нет» и ответить на «нет» — две сцены с аудио перед ними |
| t14 | past simple и present perfect в новостях (*What have you been up to?*), разговорный пересказ (*She was like…*), будущее в планах | длинная дружеская переписка / голосовые и видеозвонок с плохой связью | переписка после поездки, 60–100 слов | голосовое с новостями 1–2 мин; видеозвонок с плохой связью (сцена) |

Шпаргалки `crib` (черновик, уточняется с уроком): t08 «знакомство» — `Is this seat taken?`, `Have you ever been to…?`, `So do I.`, `Neither have I.`; t09 «разговор» — `No way!`, `Fair enough.`, `Sorry, what?`, `Anyway, I'd better…`; t10 «бар» — `What are you having?`, `I'll get this.`, `It's my round.`, `I'm good, thanks.`; t11 «планы» — `Are you up for…?`, `How about…?`, `I'm meeting…`, `I'll swing by…`; t12 «переписка» — `I love + -ing`, `I'd love to + inf`, `tbh`, `hbu`; t13 «свидание» — `If you could…, where would you…?`, `I'd rather not.`, `Let's take it slow.`; t14 «на связи» — `What have you been up to?`, `I've just got back…`, `She was like…`.

### 4. Бюджет каталога

Каталог в 23 429 из 25 000: ступень 2 его превысит. Предел растёт «только явным решением» (`content/build/budgets.ts`, комментарий над `BUDGETS`). Решение: в PR первого модуля, на котором строка «Бюджеты» отчёта сборки перестаёт проходить (ожидается `t11`–`t12`), `catalogGzip` поднимается до 28 000; замер и причина — в «Реализация», в комментарии над `BUDGETS` — дата и замер одной строкой (он называет замер 17.10.2026 и устарел). Пакеты (max 32 973 из 40 000) и курс укладываются: пакет урока растёт только у самых больших уроков. Альтернатива — сжать каталог (убрать поля, дубли целей и шпаргалок) — правка формата, вне объёма.

### 5. Карточки t08–t14 — черновой список

Отбор — по программе: B2+ по EVP / Oxford 5000, мягкий сленг и сокращения переписки, устойчивые сочетания; базовые слова (*party, date, message, friend*) — в текстах без карточек; британское написание, американская пара — в `note` (*queue / line*, *a lift / a ride*, *fancy / feel like*, *knackered / beat*, *mate / dude*, *cheers / thanks*). Перед записью список модуля сверяется с `content/words/english-it`, `content/phrases/english-it`, программой IT-курса и карточками `t01`–`t07`; черновой список ниже проверен по тексту на точные совпадения 21.10.2026 — совпадений нет (замены при ручной сверке — в «Реализация»).

| Модуль | `tNN-1` слова (8) | `tNN-1` фразы (8) | `tNN-2` слова (7) | `tNN-2` фразы (7) |
| --- | --- | --- | --- | --- |
| t08 `tw106–120`, `tp106–120` | a fellow traveller, a hostel dorm, a bunk, a local, off the beaten track, a hidden gem, touristy, a day trip | Is this seat taken? · Where are you from originally? · What brings you to Edinburgh? · How long have you been travelling? · Have you ever been to Lisbon? · I've never been, but I'd love to. · Neither have I. · Are you travelling on your own? | a gap year, a short break, head to, be based in, settle down, laid-back, a must-see | Do you have any recommendations? · I'm here for a long weekend. · I'm on a gap year. · We're heading to Glasgow tomorrow. · Mind if I join you? · Are you doing the walking tour tomorrow? · It was nice meeting you. |
| t09 `tw121–135`, `tp121–135` | mate, cheers, keen, knackered, gutted, chuffed, dodgy, banter | No way! · Fair enough. · That's wild. · Sorry, what? · You lost me. · Come again? · Been there. · Sounds good. | random, sorted, a heads-up, bump into, hang out, a nightmare, sketchy | Anyway, I'd better get going. · Don't worry about it. · I'm gonna grab a drink. · I dunno, to be honest. · Hang on, say that again. · It was great chatting to you. · Catch you later. |
| t10 `tw136–150`, `tp136–150` | a pint, on tap, a round, last orders, a tab, a bouncer, a soft drink, alcohol-free | What are you having? · It's my round. · I'll get this. · Shall I get you another? · Two pints of lager, please. · I'm good, thanks. · Can I open a tab? · Just a soft drink for me. | tipsy, a hangover, a lager, a cocktail, a bar snack, a designated driver, the cloakroom | Are you being served? · I'd rather stick to water. · Could we get some menus? · Is there a cover charge? · Last orders at eleven. · I'll pass on the next round. · Mind if I squeeze in here? |
| t11 `tw151–165`, `tp151–165` | come along, swing by, a plus-one, a rain check, bail, running late, a house party, a gig | Are you up for it? · How about Friday? · Do you fancy coming along? · I'll swing by around eight. · Can I bring a plus-one? · Can we take a rain check? · I'm running late. · Sorry, I have to bail. | RSVP, a guest list, BYOB, pre-drinks, a lift, a dress code, a nightcap | Are you on Instagram? · I'll add you. · What's the dress code? · Is it OK if I bring something? · Let's make a plan. · I'll let you know by Thursday. · Text me when you get there. |
| t12 `tw166–180`, `tp166–180` | a match, swipe, a bio, ghost, a red flag, a catfish, a dealbreaker, a conversation starter | I love hiking and trying new food. · What do you do for fun? · What's your go-to karaoke song? · Fancy a drink sometime? · tbh I'm not sure what I'm looking for. · hbu? · wyd tonight? · I'd love to hear about it. | a spark, chemistry, left on read, unmatch, block, a first move, casual | I'm up for coffee. · I don't think we're a match, but good luck. · I'm not feeling a spark, sorry. · Thanks for the chat, but I'm going to pass. · Let's meet somewhere busy. · I'll text a friend where I am. · Could you send me a voice message? |
| t13 `tw181–195`, `tp181–195` | a compliment, awkward, cheesy, open up, a pet peeve, a bucket list, a good listener, down-to-earth | If you could live anywhere, where would it be? · You've got a great laugh. · I reckon it's worth a try. · Fair point. · I'm kind of a morning person. · I'd rather stay in than go out. · What's the best trip you've ever taken? · I'm a bit nervous, to be honest. | consent, boundaries, pushy, pressure, respectful, mutual, overstep | Is this okay? · I'd rather not. · Let's take it slow. · No worries, totally fine. · I'm not comfortable with that. · I had a really nice time. · Can I walk you to the station? |
| t14 `tw196–210`, `tp196–210` | a voice note, a catch-up, a screenshot, a group chat, patchy, a glitch, buffer, a thread | What have you been up to? · It's been ages! · You're breaking up. · I can't hear you — the signal's bad. · Let's catch up properly soon. · I've just got back from Portugal. · She was like, "No way!" · He goes, "I'm not joking." | sarcasm, a wind-up, tease, deadpan, understatement, a throwback, a reunion | I'm kidding! · Just joking. · Not bad, actually. · Send me the photos! · Let me know when you're next in town. · I'll book flights this week. · Miss you already. |

Заметки по списку. `Neither have I.` и `So do I.` — `t08` учит парой в одном объяснении, карточка у второго; `hbu` и `wyd` — сокращения переписки, фраза-карточка читается словом целиком (*how about you?*, *what are you doing?*) в `note`. Грубые выражения — не в списке: *t09*, *t10*, *t12*, *t14* показывают их только в аудио и чатах с пометкой (решение 3). Слова одного корня со своей фразой допустимы (*a catch-up* и *Let's catch up properly soon.*): разные карточки разного вида. В `t13` слова *consent*, *boundaries*, *pressure* вместе с фразами образуют часть оцениваемого содержания: тест модуля содержит `graded`-задания на распознавание отказа и на ответ на него. Тексты `t13-2` показывают согласие как постоянное: вопрос → ответ → уважение ответа; без нажима, без «перелома» отказа.

### 6. Персонажи

Все персонажи — взрослые, носители и неносители вперемешку (акцентный микс из программы): неносители говорят проще — короткие фразы, переспросы, без нарочных ошибок в каждой реплике и без акцента в написании. Имена — свободные, не из `IT_NAMES` теста (Sarah, Daniel, Mark, Elena, Tom, Priya, Sharma, Fischer, Andrei, Aisha, Marco, Rory, Inês) и не из карты ступени 1. Свободных голосов нет (Context), поэтому правило: персонажу выбирается голос своего пола, не занятый его собеседниками ни в одном диалоге; повтор голоса у персонажа другой ступени допустим. Черновик:

| Персонаж | Где | Голос (повтор у…) |
| --- | --- | --- |
| Ben — сосед по хостелу, британец | t08, t09, t14-c2 | Fenrir (свободный) |
| Sofia — путешественница из Италии, неноситель | t08, t09 | Despina (Elena, IT-курс) |
| Mei — путешественница из Сингапура | t08, t14-c2 | Leda (Aisha, IT-курс) |
| Jack — друг в групповом чате, американец | t09 | Zubenelgenubi (свободный) |
| Zoe — подруга, быстрая речь | t09, t11 | Gacrux (Inês) |
| Dave — бармен | t10, t14-c2 | Charon (Daniel, IT-курс) |
| Nina — подруга в баре | t10 | Aoede (Sarah, IT-курс) |
| Leo — хозяин вечеринки | t11, t14-c2 | Iapetus (Mark, IT-курс) |
| Tess — гостья вечеринки | t11, t14-c2 | Callirrhoe (Fiona) |
| Maya — пара в приложении, голосовое | t12 | Achernar (Lúcia) |
| Alex — пара в приложении | t12 | Algenib (Kwame) |
| Lena — свидание | t13, t14-c2 | Laomedeia (Grace) |
| Will — свидание | t13, t14-c2 | Sadachbia (Callum) |
| Hugo — друг из Франции, неноситель | t14 | Alnilam (Jonas) |
| Anika — подруга из Германии | t14 | Vindemiatrix (Megan) |

Объявления и тексты без говорящего — диктор Kore. Реплики собеседника перед ролевой сценой говорит персонаж сцены. Сцены точки собираются из персонажей разных модулей; различие голосов внутри сцены проверяет сборка. Имена и голоса уточняются при подготовке модуля.

### 7. Без пересечений с IT-курсом и ступенью 1

- Сборка отклоняет совпадение текста карточки между курсами одного языка и повтор внутри курса (решение 1).
- Ручная сверка перед карточками модуля — со `docs/curriculum-english-it.md`, где у будущих модулей IT-курса карточек ещё нет: переспрос (e05 — *Could you say that again?*, *Do you mean…*) — в `t09` только разговорные (*Sorry, what?*, *You lost me*, *Come again?*); мнение и несогласие (e15 — *I see your point, but…*) — в `t13` только разговорные (*I reckon*, *Fair point*); работа и профессия (e01) — в small talk `t08` без карточек; планы и мотивация (e07 — *going to*, *will*) — `t11` учит грамматику без карточек-рамок, фразы только приглашений; условия (e08 — модальные) — `t10`/`t13` *would rather* без карточки-рамки.
- Совпавшее слово или фраза остаётся за курсом, где оно уже есть, здесь — текст с глоссой.

### 8. Контрольная точка «Вечер»

Модуль `t14`: `checkpoint: t14-c2`. Урок `t14-c2`, `kind: test`, заголовок «Вечер», одно занятие около 60 минут, по образцу `t07-c1`: один вечер — бар с друзьями, знакомство, приглашение, свидание, переписка на следующий день:

| Часть | Блоки | Навык в итоге |
| --- | --- | --- |
| Вступление | как устроена точка: сцены подряд, без словаря, порог 60 % по чтению и аудированию, письмо и речь — самопроверка по критериям; что повторить при слабом навыке; решение о темпе (программа, «Объём и темп») | — |
| Бар | аудирование: разговор в шумном баре, Dave и Nina — `graded`; аудио реплик Dave → `roleplay` заказ на компанию и отказ от раунда | аудирование |
| Знакомство | чтение: пост и чат хостела — `graded`; аудио реплик Ben и Mei (по очереди) → `roleplay` small talk с переспросом | чтение |
| Приглашение | аудирование: голосовое Leo с приглашением и быстрые реплики Tess — `graded`; аудио реплик Tess → `roleplay` пригласить и обменяться контактами | аудирование |
| Свидание | чтение: анкета и переписка с Lena — `graded`; аудирование: разговор на свидании с мягким отказом (Lena, Will) — `graded`; аудио реплик Will → `roleplay` сказать «нет» вежливо; аудио реплик Lena → `roleplay` ответить на «нет» | чтение, аудирование |
| Следующий день | чтение: переписка — `graded`; письмо: сообщение после вечера (продолжить или вежливо закончить), 60–100 слов, `friendly` | чтение |
| Язык | задание `gap` на грамматику ступени — `graded`, в общий итог без навыка | — |

Чтение и аудирование — по 10–12 оцениваемых пунктов: один пункт меняет долю навыка не больше чем на 10 %. Персонажи и ситуации — знакомые по модулям, новых карточек нет, слова вне ступени — глоссы. Сцена свидания и отказа сохраняет правила `t13`: отказ звучит и принимается без нажима.

### 9. Ролевая сцена — «аудио перед сценой»

Как в `english-travel-trip` (решение 9): `listening` с `id` вида `<сцена>-lines` (заголовок «Реплики собеседника», `plays: 2`, только реплики собеседника, без задания) и затем `speaking` с `part: roleplay` (в `prompt` — роль и указание слушать реплики и отвечать по порядку, в `model` — весь диалог, в `criteria` — что проверить). В `t08`–`t14` и `t14-c2` сцена всегда такая; `monologue` и голосовое сообщение — без аудио перед ними.

### 10. Проверки сверх тестов

- `npm run content` после каждого модуля: нет пробелов публикации, строка «Бюджеты» без нарушений (до решения 4).
- Языковая рецензия модуля независимым субагентом (только чтение): английский, регистр, сленг и сокращения, однозначность ключей, переводы карточек, уровень отбора, согласие и границы без нажима, неносители без карикатуры, пересечения по смыслу. Замечания и решения — в «Реализация».
- Вид — временный e2e-скриншот на 390 px по настоящей сборке (приём из `english-travel-trip`, решение 10): полка с «Вечер» после `t14`, пара «аудио → сцена» в `t10-3`, итог `t14-c2`; конфиг и тест удаляются, снимки — в `/tmp`.
- Озвучка — после ревью кода и окончательных текстов: `npm run voices -- <уроки> words phrases --course=english-travel`, затем `--check`.

## Risks / Trade-offs

- [Объём: 29 уроков и 210 карточек сгенерированы моделью, без носителя; сленг и стиль переписки — самое рискованное] → рецензия субагентом после каждого модуля; программа просит показать сленг носителю перед публикацией второй ступени — выносится пользователю как открытый вопрос; сленг только мягкий, грубый — с пометкой и без карточек.
- [Чувствительные темы: знакомства, алкоголь, флирт] → программа и требование спеки: уважительно, согласие и границы в `t13`, безопасность в `t12`, взрослые персонажи; тесты `t12`/`t13` содержат оцениваемые задания по этим частям.
- [Повтор голоса у разных персонажей: учащийся может принять Sofia за Elena IT-курса] → разные курсы и диалоги; другие варианты — отдельное изменение (больше голосов или `en-US`).
- [Каталог выходит за 25 000] → решение 4: явный подъём предела до 28 000 с записью замера.
- [Аудио перед сценой звучит целиком, без пауз на ответ] → как в ступени 1: `prompt` объясняет порядок, текст реплик открыт после двух прослушиваний.
- [Параллельные PR английского курса конфликтуют по `content/voices/en.yaml` и `tests/course-content.test.ts`] → PR по модулям идут последовательно; озвучка ступени 1 (#232) трогает только `content/audio/` и записи в уроках и карточках; перед каждым модулем — `git rebase origin/main`.

## Migration Plan

Только контент и, возможно, предел бюджета: формат каталога и пакетов, база и облако не меняются. Опубликованные уроки ступени 1 не меняются. Откат модуля — вернуть его в черновик (убрать `lessons`, `crib`, `status: published`); пройденные уроки останутся в базе учащегося, как у снятого модуля. После выпуска `courseFinished` для курса (`src/storage/course.ts:266-267`) становится правдой: в «Сегодня» текст конца курса — правка `today-by-language`.

## Open Questions

- Показать ли сленг и переписку носителю до публикации второй ступени (программа, «Что не входит и открытые вопросы»)? По умолчанию план публикует по рецензии моделью и просит носителя после; решение — за пользователем.
- Поднять `catalogGzip` до 28 000 или сжать каталог (решение 4)? По умолчанию — поднять.
- Нужны ли для второй ступени американские голоса (программа обещает международный микс, голоса — только `en-GB`)? Вне объёма; остаётся отдельным изменением.

## Реализация
