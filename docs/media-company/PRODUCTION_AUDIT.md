# PRODUCTION_AUDIT — аудит медиа-активов и первая задача (2026-10-21)

Режим: только чтение. Секреты, архив, .env не открывались. Требования: MASTER_PROMPT_V2.md (разд. 6-11, 13, 17). Метки: [проверено] = видел файл/версию на машине; [из документов] = прочитано, не запускалось.

## 1. Инвентарь активов

| Путь | Что | Статус | Переиспользуемо? |
|---|---|---|---|
| `C:\Users\asq\cf-content\pilot-batch-01\` | 9 пилотных Shorts (1080x1920, дорожки EN+RU, SRT, sources.md, qc.json, qc_sheet.jpg); скрипты fetch_commons.py, finalize.py, qc_sheet.py, make_index.py, render_one.sh | Все 9 отрендерены, авто-QC PASS (только технический); не опубликованы; RU = PREVIEW_ONLY; ASR-проверки не было | ДА: движок, генераторы, шаблон spec.json |
| `...\pilot-batch-01\02_geography\` (video.mp4 11 МБ, 41 с, gen_geo.py, ne_50m_countries.geojson) | «Africa Is Bigger Than Your Map Makes It Look»: собственная процедурная анимация, данные Natural Earth (PD) | авто-QC PASS; права на видео и EN-голос чистые | ДА, кандидат №1 |
| `...\01_space` (Венера, NASA PD), `03_history` (Molasses, PD-фото), `04_science` (Millennium Bridge, numpy-симуляция), `09_inventions` (Turk) | пилоты | авто-QC PASS | ДА как референсы |
| `...\05_runes, 06_dark_romance, 07_true_crime, 08_conspiracy` | пилоты рискованных ниш | авто-QC PASS | НЕ в приоритете (риск платформ) |
| `C:\Users\asq\cf-artifacts\yt-short-carrington-v2\short_v2.mp4` + источники (Petersburg military telegraph, NASA SDO, Blue Marble) | эталон качества, 56 с, горящие субтитры, исправленная версия с настоящим телеграфом | утверждённый референс (по PRODUCTION_STATE) | ДА: стиль, реестр источников |
| `C:\Users\asq\cf-content\launch_short\` | short.mp4 7,5 МБ, script, srt, provenance.json, sources.json | старый тест | частично (формат provenance) |
| `C:\Users\asq\cf-content\media_v2\` | A1_MEDIA_V2.mp4 29 МБ, A1_OLD_vs_NEW, B1_SCREENLIFE_V2, голосовые пробы Joe/Norman, клипы | ждёт APPROVE/REVISE владельца; лицензия голоса Joe с оговоркой | НЕТ, пока не утверждено |
| `C:\Users\asq\cf-content\e1\` (3 mp4), `test1\`, `v11\` | старые тесты | архив | нет |
| `C:\Users\asq\cf-content\storyboards-v2\` | раскадровки 9 направлений, VOICE_STRATEGY.md, ANIMATION_REVIEW.md, PRODUCTION_NOTES.md | документы | ДА |
| `C:\Users\asq\cf-content\first_revenue\` | план первого дохода (Telegram Stars-бот), ресёрч Claude/Codex | планы, ждут решений владельца | справочно |
| `C:\Users\asq\ai-venture-lab\company\tools\asr\` | faster-whisper (venv), asr_compare.py, тестовые WAV | рабочий ASR | ДА: аудио-QA |
| `...\ai-venture-lab\company\production\carrington\build\` | 01_tts.py, 02_timeline.py, 03_words.py | рабочий пример озвучки/таймингов | ДА |
| `...\ai-venture-lab\serial-prod\` | TOOLS_GAP.md, PRODUCTION_PLAN.md, ROLES_AND_ACCEPTANCE.md, SEMANTIC_CHECK.md | документы | ДА |
| `...\ai-venture-lab\company\research\` | MONETIZATION_OWN_CHANNEL_AND_AI_LABELS.md, NICHES_AND_INCOME.md | ресёрч (проверить даты) | ДА |
| `C:\Users\asq\content-factory\` (repo, read-only) и worktree `C:\Users\asq\cf-worktrees\pilot-batch` (ветка feat/pilot-batch, НЕ влита): content_factory/pipeline/produce.py, produce_multilang.py | рендерер: Kokoro + Pillow + ffmpeg + loudnorm | рабочий | ДА (только читать) |
| `C:\Users\asq\Documents\AI-Content-Factory\` (PROGRESS.md, .venv) | venv с kokoro, piper-tts, torch, faster-whisper | рабочее окружение | ДА как интерпретатор |
| `C:\Users\asq\Downloads` (видео) | FILE 2026-04-23 22_21_28.mp4 8 МБ, IMG_4028.MP4 4 МБ, IMG_6852.MP4 ~0, video_2026-10-17_19-19-02.mp4 3 МБ, Pobeg_iz_Shoushenka_1994...mp4 504 МБ | чужие/личные, права неизвестны (фильм - пиратская копия) | НЕТ |

Реестры лицензий: единого реестра нет; per-video sources.md и assets/manifest.json (fetch_commons.py фиксирует страницу Commons, автора, лицензию), cf-media\commons.py, media_v2\registry [из документов].

## 2. Установленные инструменты (только --version / pip list)

| Инструмент | Версия | Примечание |
|---|---|---|
| ffmpeg / ffprobe | 9.0.2 (gyan full) | в PATH |
| Python (системный) | 3.12.6 | numpy 2.1.1, matplotlib 3.9.2, opencv 4.13.0.92, pillow 10.4, faster-whisper 1.2.1, onnxruntime 1.31 |
| venv AI-Content-Factory | Python 3.12.6 | kokoro 0.9.4, misaki 0.9.4, piper-tts 1.8.0, torch 2.14.1, numpy 2.5.4, pillow 12.3, soundfile 0.14, av 19.0.1, spacy 3.8.16 |
| Node | v24.19.0 | |
| git | 2.55.0 | |
| Модели в HF-кэше | Systran faster-whisper-base и -small; hexgrad Kokoro-82M (Apache-2.0) | ASR оффлайн возможен |
| Piper | пакет в venv; CLI в PATH нет; ONNX-голосов Piper на диске не найдено | RU-модель надо скачать |
| ImageMagick, espeak, yt-dlp | отсутствуют | не нужны |
| Windows SAPI | Irina и др. | лицензия на распространение не подтверждена |
| `pip` в PATH | нет (использовать `python -m pip`) | |

## 3. Ограничения

- Железо: Ryzen 5 5500U (6C/12T), RAM 15,3 ГБ (свободно часто около 3 ГБ), Radeon Vega 512 МБ, GPU-ускорения нет, диск C: свободно около 138 ГБ. Только CPU. Один рендер за раз, около 700 МБ RAM, 1-11 минут на ролик; закрыть браузеры (прежняя фоновая очередь упёрлась в low-memory guard).
- Бюджет (V2 разд. 17): никаких платных API, облачных GPU, подписок. Qwen3-TTS на Kaggle/Colab из VOICE_STRATEGY без согласия владельца исключён.
- Права: русская озвучка SAPI Irina - только предпросмотр; чистая RU-озвучка не выбрана. EN Kokoro - Apache-2.0.
- Авто-QC пилотов только технический; ASR, слух и сверка со сценарием не выполнялись - «проверено» объявлять нельзя (V2 разд. 9).
- Известная ошибка: «печатная машинка вместо телеграфа» (Carrington). Правило: визуал смыслово верный объект, иначе карта/схема/маркированная реконструкция; исправлено в short_v2 (фото Petersburg military telegraph). Визуальный контроль до монтажа обязателен.
- Монетизация: владелец - гражданин РФ, резидент Узбекистана. Подтверждённого маршрута выплат НЕТ; ничего не заявляется.
- Не публиковать, не звонить в Telegram, не менять боевой Agent Teams AI.

## 4. Выбранная первая задача: task-001 (География)

Выбор: **«Africa Is Bigger Than Your Map Makes It Look»** - довести пилот 02_geography до производственного уровня.

Обоснование:
- Визуал полностью собственный (процедурная анимация + Natural Earth, public domain): нулевой лицензионный риск и нет риска «не тот объект»; YouTube/соцсети не нужны.
- Факты проверяются расчётом (площади из данных, equal-area), первичные источники.
- Пилот уже есть и прошёл тех. QC; не хватает ASR, слуха, сверки субтитров, EN-only релиза без спорной RU-озвучки, заголовка и обложки.
- Безопасная ниша (не Dark Romance, True Crime, руны). Рендер около 6 минут на CPU.
- Запас: 01_space (Венера, NASA PD).

Карточка (скелет):

| Поле | Значение |
|---|---|
| ID | task-001 |
| Аудитория | англоязычные зрители образовательных Shorts, 16-45, интерес к картам и фактам |
| Язык | EN (Kokoro am_michael, Apache-2.0); RU после решения по голосу, не в первом релизе |
| Платформа | YouTube Shorts первым; 9:16, 1080x1920, 30-62 с; публикация только после одобрения владельца (первые 3 ролика ниши) |
| Тема | Проекция Меркатора искажает площади: Африка около 30,0 млн км2, примерно в 14 раз больше Гренландии (2,15), больше США+Китай+Индия (21,97) |
| Хук | «On most maps, Greenland looks as big as Africa. It is not.» (написать варианты A/B) |
| Источники | Natural Earth 50m admin0 (PD); Mercator 1569 (Wikimedia Commons, PD); расчёт gen_geo.py::area_km2 |
| Раскадровка | сцены mercator_vs_true, tissot, area_bars, finale (preview PNG есть) |
| Аудио | EN Kokoro + сгенерированный pad, loudnorm |
| Субтитры | SRT + вариант с горящими словами (стиль Carrington), тайминги по ASR |
| QA | ffprobe; ASR faster-whisper small против сценария (WER); проверка чисел; осмотр кадров qc_sheet; реестр лицензий; слух владельца |
| Стоимость | $0 |
| Гипотеза монетизации | Серия образовательных Shorts о картах может набирать досмотры; проверка на 10-15 роликах по удержанию, viewed-vs-swiped, подпискам. Монетизация НЕ подтверждена: YouTube Partner Program требует порогов, а работоспособность выплат для резидента Узбекистана с гражданством РФ не проверена. Реальный доход = 0 до подтверждения. |

## 5. Конкретные пробелы

1. ASR-проверка и прослушивание EN-дорожки не выполнялись (faster-whisper small есть - запустить; слух владельца).
2. Нет независимой проверки фактов вторым агентом (формулировка «about fourteen»: 30,0/2,15 = 13,9).
3. Нет RU-озвучки с чистой лицензией: модели Piper ru_RU-denis/dmitri не скачаны (родословная lessac под вопросом), Silero v5_cis_base (MIT) не установлен. RU в первый релиз не включать.
4. Нет варианта с горящими субтитрами (пилот без них, менее «TikTok-native»).
5. Нет обложки, заголовка и описания под YouTube.
6. Нет мультимодального визуального контроля: был только замер яркости; нужен ручной просмотр qc_sheet.
7. Рендерер в невлитой ветке feat/pilot-batch: зафиксировать commit для воспроизводимости.
8. Нет единого реестра лицензий: собрать production/task-001/sources/REGISTER.md из sources.md и manifest.
9. Маршрут монетизации и выплат не подтверждён; каналов и аккаунтов нет (действия только владельца).
10. Музыка (сгенерированный pad): записать лицензию в реестр.

Недостающего ПО для MP4 бесплатными средствами нет: ffmpeg, Python/Pillow/numpy, Kokoro, faster-whisper установлены. Не хватает только входов: решение владельца по RU-голосу (иначе EN-only) и согласование релиза.

## 6. Рабочая зона
`C:\Users\asq\Documents\agent-teams-ai-fork\production\task-001\{sources,assets,audio,render,qa}` создана (вне git-репозитория, пустая).
