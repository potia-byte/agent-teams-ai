# Проверки — 20.10.2026, текущие изменения

| Проверка | Результат |
| --- | --- |
| Начальный HEAD / дерево / origin | 7767fdb6c, совпал с remote, дерево чистое |
| Матрица Node/Git/esbuild, 2 hosts | 24 случая: 12 inherit exit0; 12 pipe EPERM |
| Журналы защиты, 4 канала | Включены, доступны; событий в окнах проверок нет; причина отказа не установлена |
| Runtime0.0.124 | SHA256 совпал с lock, CLI2.777.777; штатный payload-v1 receipt готов |
| Runtime --version через pipe | EPERM; успешный вывод в файл не является launcher smoke |
| electron-rebuild | Не прошёл: fork/pipe EPERM |
| Официальный SQLite prebuilt ABI149 | HTTP404; lockfile не менялся |
| SQLite в Electron Node/main | Не прошёл: ABI137 вместо149 |
| Реальный PTY в Electron Node/main | Не прошёл: open/connect conpty pipe EPERM |
| Дополнительный Electron main stderr | Mojo platform channel access denied0x5 |
| Полный pnpm typecheck | PASS, exit0, все 8 конфигураций после изменений |
| Focused fast lint, 2 TS-файла | PASS, exit0 |
| Launcher PowerShell tests | PASS: прокси сохранены; окружение восстановлено; inherited override блокирует dev-запуск |
| Синтаксис диагностических скриптов | PASS |
| Исходные pure source-size/provisioning policies | 3597 файлов, нарушений0; Git перечислен отдельно, это не исходные CLI guards |
| pnpm build | Не прошёл: esbuild spawn EPERM в prebuild |
| Vitest recovery/install/dev-path tests | Не начались: spawn EPERM загрузки config |
| Полный desktop smoke / fallback tests | Не выполнялись; нет успешной сборки, fallback не реализован |

Пакет и SHA в STATUS.md; исходники scripts/diagnostics, результаты .local-tools/diagnostics.
Воспроизведение из checkout:

```powershell
./scripts/diagnostics/windows-build-context.ps1 -IncludeElectron
./scripts/diagnostics/local-launcher.test.ps1
./scripts/diagnostics/run-native-smoke.ps1 -Mode Main
./scripts/media-company-local.ps1 Typecheck
./scripts/media-company-local.ps1 Build
./scripts/media-company-local.ps1 Test
```

Ранее: git fsck --full PASS, missing0, shallow=false. Старые частично успешные
Node-наборы не являются результатом текущих Vitest tests и не обозначают готовность.

Install boundary test дополнен: stub pnpm подтвердил node-ci, --frozen-lockfile
и восстановление AGENT_TEAMS_INSTALL_PROFILE. Реальная установка в этом тесте не
выполнялась. Это проверка запрета глобального Electron header cache.

## 21.10.2026 - EPERM на pipe больше не воспроизводится; build/Vitest/PTY прошли

Реальные результаты (не имитация). Логи: .local-tools/diagnostics/*-20261021T*.log.

| Гипотеза / проверка | Результат |
| --- | --- |
| (a) Start-Process + file redirect, (b) cmd /c + redirect, (c) WMI Win32_Process.Create | Все 3 PASS: node spawnSync с pipe exit0, stdout получен |
| Контроль: тот же probe напрямую из Bash и PowerShell tool shell | Тоже PASS. EPERM сейчас не воспроизводится ни в одном способе запуска; гипотеза job object не подтверждена и не опровергнута (отказ был временным/средовым, причина по-прежнему неизвестна) |
| pnpm build (через scripts/diagnostics/run-detached.ps1) | PASS: main/preload (dist-electron) + renderer (out/renderer), radix verify выполнен. Первый запуск launcher упал только из-за 'pnpm' not on PATH во вложенном скрипте; исправлено shim .local-tools/bin/pnpm.cmd |
| Побочный эффект prebuild | resources/pricing.json перезаписывается fetch-pricing-data; восстановлен из HEAD |
| Vitest test/features/ceo-provider-supervisor + TeamProvisioningServiceFacadeGuard | PASS 2 files, 50 tests |
| Vitest набор launcher Test (team-runtime-recovery, postinstall, ensureElectronInstall, dev path) | PASS 12 files passed, 1 skipped; 119 tests passed, 1 skipped |
| Native smoke Electron main: node-pty/conpty | PASS (MEDIA_NATIVE_PTY_OK) |
| Native smoke: better-sqlite3 | FAIL: ABI137 вместо149 |
| Prebuilt better-sqlite3 для electron-v149 win32-x64 | Нет ни в v12.11.1 (404), ни в v12.12.0 (макс. v148); v13.0.x без ассетов |
| node-gyp configure better-sqlite3 (electron 44.4.5, devdir в .local-tools) | Заголовки скачались (HTTP200); FAIL: "Could not find any Visual Studio installation". Нет VS/Build Tools/cl.exe/Windows SDK |
| Desktop smoke (electron . с изолированным user-data, 25 с) | Окно 'Agent Teams AI' создано, процесс жив, renderer did-finish-load; internal storage откатился на JSON из-за ABI137; node-pty conpty_console_list_agent: AttachConsole failed (скрытый запуск без консоли). Это запуск без тестового проекта, не полный app smoke |

Единственное оставшееся действие пользователя: установить Visual Studio Build Tools
("Desktop development with C++" + Windows SDK), затем выполнить
`corepack pnpm exec node scripts/postinstall-electron.cjs` через run-detached.ps1
(или node-gyp rebuild better-sqlite3 с --devdir в .local-tools). Системные установки мной не выполнялись.

Воспроизведение: `./scripts/diagnostics/run-detached.ps1 -Name build -Command 'corepack pnpm build'`;
smoke: `./scripts/diagnostics/run-app-smoke.ps1`.

## 21.10.2026 (позже) - реальный desktop smoke с CDP на одноразовом проекте

Реальные результаты. Электрон запущен с --remote-debugging-port=9333, изолированные userData и корень Claude в .local-tools/state (AGENT_TEAMS_ELECTRON_USER_DATA_DIR / AGENT_TEAMS_ELECTRON_CLAUDE_ROOT), HOME/USERPROFILE не менялись. Тестовый проект: .local-tools/smoke-project-20261021102942 (новый пустой git-репозиторий), команда smoke-team с одним lead, config.json создан вручную в изолированном корне. Драйвер: .local-tools/diagnostics/cdp.cjs (ws поверх CDP; playwright-core в node_modules нет). Запуск команды (Запустить) НЕ выполнялся, LLM-сессии и квота не использовались.

| Проверка | Результат |
| --- | --- |
| Окно рендерится, window.electronAPI.ceoSupervisor есть | PASS |
| Команда smoke-team видна в списке, TeamDetailView открывается | PASS |
| Панель 'Директор CEO · Выключен', 'Основной провайдер: Codex · резервный: Claude' | PASS на пересобранном renderer; FAIL на исходном out/renderer (см. дефект 1) |
| ceoSupervisor.read('smoke-team') | PASS: status 'disabled', roles primary=codex reserve=anthropic, epoch 0, history [], reason null, без ошибок |
| Ошибки консоли | Нет ошибок CEO. Только 'team:getMessagesPage TEAM_HISTORY_UNAVAILABLE:listing_failed' (вероятно, нет каталога projects у синтетической команды; не относится к CEO) |
| Скриншот | .local-tools/diagnostics/ceo-panel-smoke-20261021.png |

Дефекты:
1. Устаревшая сборка: out/renderer/assets/TeamDetailView-DjJofZAq.js (собрана 10:23:57) содержала литералы '?' вместо кириллицы во всех строках CEO-панели ('???????? CEO ? ????????'). Исходники (mtime 10:24:13, и в HEAD) корректны. Пересборка `electron-vite build` (без prebuild, лог rebuild-ev-20261021T073158.*) дала TeamDetailView-CcKXD9EE.js с правильным русским. Вывод: ранний build был сделан из испорченной по кодировке версии файлов; сборку из того состояния использовать нельзя.
2. Известные, не новые: better-sqlite3 ABI137 vs 149 (откат на JSON), node-pty conpty_console_list_agent 'AttachConsole failed' при запуске без консоли, нет orchestrator CLI ('Runtime adapter bridge disabled').

Не проверено: включение CEO (action enable), запуск команды, реальные сессии провайдеров, переключение на резерв.

## 21.10.2026 (вечер) - runtime 0.0.124 в изолированном app + реальный solo-lead запуск через CDP

Реальные результаты. Коммитов нет. HOME/USERPROFILE не менялись. Установленный Agent Teams AI и реальные проекты не затрагивались. CEO feature не включалась.

### Корень проблемы 'Runtime adapter bridge disabled: orchestrator CLI binary not resolved'
- Сообщение: src/main/index.ts:499 (createOpenCodeRuntimeAdapterRegistry), когда ClaudeBinaryResolver.resolve() вернул null.
- Режим всегда agent_teams_orchestrator (src/main/services/team/cliFlavor.ts). Резолвер (ClaudeBinaryResolver.ts runResolve) ищет по порядку: env CLAUDE_AGENT_TEAMS_ORCHESTRATOR_CLI_PATH (явный путь) -> process.resourcesPath/runtime/claude-multimodel(.exe) (только в упакованной сборке) -> PATH (claude-multimodel) -> 'doctor' fallback; иначе null (fail closed).
- Единственное место, которое выставляет CLAUDE_AGENT_TEAMS_ORCHESTRATOR_CLI_PATH для dev/built - scripts/dev-with-runtime.mjs (строка ~776). Прямой запуск `electron .` (как в cdp.cjs/run-app-smoke.ps1) обходит этот лаунчер, runtime в PATH нет, resourcesPath = node_modules/electron/dist/resources. Дефекта в src нет - не хватало env в нашем лаунчере.
- Фикс (лаунчер, без правок src): scripts/diagnostics/launch-isolated-app.ps1 задаёт CLAUDE_AGENT_TEAMS_ORCHESTRATOR_CLI_PATH=.local-tools/runtime-cache/0.0.124/win32-x64/payload-v1/claude-multimodel.exe (`--version` = 2.777.777 (Claude Code)), AGENT_TEAMS_ELECTRON_USER_DATA_DIR и AGENT_TEAMS_ELECTRON_CLAUDE_ROOT на .local-tools/state/run-<tag>/.
- Проверка: app-smoke.err (старый запуск) содержит 'bridge disabled' 1 раз; app-t1.err (новый) 0 раз; claude-cli-auth-diag.ndjson: binaryPath = payload-v1\claude-multimodel.exe, installed=true, version 2.777.777.

### Реальный запуск команды (проект .local-tools/e2e-project-20261021104748, новый git-репозиторий)
Команды:
```
./scripts/diagnostics/launch-isolated-app.ps1 -Tag t1 -UseRealProviderAuth      # печатает pid
node scripts/diagnostics/team-e2e-run.cjs --project <abs> --provider codex --model gpt-5.6-luna --electron-pid <pid> --claude-root <abs claude-root> --wait-sec 200
node scripts/diagnostics/seed-isolated-claude-auth.cjs seed|clean <abs claude-root>   # только для anthropic
node scripts/diagnostics/team-e2e-run.cjs ... --provider anthropic --model haiku ...
```
Драйвер вызывает window.electronAPI.teams.createTeam({members: [], providerId, model, skipPermissions: true, prompt: 'Reply with exactly: OK...'}) через CDP, опрашивает getProvisioningStatus, процессы (CIM, дерево electron), aliveList, getTeamAgentRuntime, затем teams.stop.

| Провайдер | Результат |
| --- | --- |
| codex (gpt-5.6-luna, team e2e-codex-mvhtcml5) | PASS. runId ee4bc2a0..., lead pid 20140 (claude-multimodel.exe payload-v1, --print --input-format stream-json ...). Реальный провайдер: node codex.js pid 19824 -> codex.exe pid 15476 `exec --json --skip-git-repo-check -C <project> --ignore-user-config --ephemeral -m gpt-5.6-luna -c approval_policy="never" -c forced_login_method="chatgpt" ...` (codex-cli 0.163.0). Транскрипт lead: assistant text 'OK' (07:52:03Z). stop -> ok, aliveList [] , codex/claude-multimodel процессы завершены, остались только процессы самого app (убиты отдельно). |
| anthropic без авторизации в изолированном root | Lead pid 7184 стартовал, ответ 'Not logged in · Please run /login' (authentication_failed, cost 0). UI/статус при этом показал 'ready' (state=ready, 'Team provisioned') - вводит в заблуждение, ошибка видна только в cliLogsTail. Причина: AGENT_TEAMS_ELECTRON_CLAUDE_ROOT изолирует CLAUDE_CONFIG_DIR, там нет .credentials.json. |
| anthropic с временной копией только claudeAiOauth в изолированный root (seed-isolated-claude-auth.cjs, токен >60 мин, после теста удалён) | PASS. haiku, team e2e-anthropic-mvhtoa4j, lead pid 15816, result 'OK.' duration 34.8 s, is_error=false. Для anthropic отдельного процесса провайдера нет: claude-multimodel.exe сам ходит в API. stop -> ok, aliveList []. Замечание: total_cost_usd 0.166, cache_creation_input_tokens 132617 на тривиальный запрос - lead загружает большой контекст (user-level MCP/playwright и т.п. из --setting-sources user,project,local). |

Наблюдения и ограничения (не исправлялись):
1. teams.getMessagesPage для solo-lead возвращает TEAM_HISTORY_UNAVAILABLE:listing_failed: TeamInboxReader.getMessagesWindow (src/main/services/team/TeamInboxReader.ts ~583) делает readdir(<team>/inboxes), а каталога нет (ENOENT). Это зафиксировано как намеренный контракт тестами (TeamMessageHistoryRetrievalGate.test.ts:462), поэтому src не менялся. Ответ lead в драйвере читается из <claude-root>/projects/*/<session>.jsonl.
2. Каталог моделей Codex в app показывает modelCatalogRefreshState='loading' бесконечно (getProviderStatus), createTeam с gpt-5.4-mini отклонён: 'not present in the live Codex model catalog'. `claude-multimodel model list --json --provider codex` напрямую возвращает gpt-6.1-sol, gpt-6-astra, gpt-6-sol, gpt-6-luna, gpt-5.6-sol/terra/luna; с gpt-5.6-luna запуск прошёл.
3. Первая версия детектора ответа дала ложный PASS для anthropic (совпал старый транскрипт codex в том же cwd); исправлено фильтром по времени запуска (startIso), ложный прогон не засчитан.
4. Codex использует реальную авторизацию ~/.codex (CODEX_HOME не переопределялся, -UseRealProviderAuth); сессии ephemeral. Квота: 1 запрос codex (первая попытка с gpt-5.4-mini отклонена до запуска) и 2 запроса anthropic (1 с ошибкой авторизации без токенов, 1 успешный).
5. Дерево процессов app после stop: остаются electron.exe (gpu/network/renderer) и mcp-server node (принадлежат app); убиты `taskkill /PID <electron pid> /T /F`. Процессов payload-v1/run-t1 после этого не осталось.

## 21.10.2026 (поздно) - CEO e2e в собранном app (codex REAL + синтетический квотный сигнал), Claude-часть NOT VERIFIED

Драйвер: scripts/diagnostics/ceo-e2e-run.cjs (прогон `--tag ceo6`, журнал .local-tools/diagnostics/ceo-e2e-ceo6.log). Лаунчер: launch-isolated-app.ps1 получил параметр `-QuotaSignalFile` (создаёт без обрезки <userdata>\e2e-quota-signal.jsonl и ставит AGENT_TEAMS_E2E_QUOTA_SIGNAL_FILE) и пишет pid в <state>\electron.pid. Проект: .local-tools/ceo-e2e-project-ceo6 (новый git). Коммитов нет, HOME/USERPROFILE не менялись, ~/.claude не трогался.
По указанию владельца копирование OAuth/credentials между профилями ЗАПРЕЩЕНО: seed-код из драйвера удалён, seed-isolated-claude-auth.cjs не использовался. Итог проверки: .credentials.json под .local-tools/state не найдено, в логах .local-tools/diagnostics секретов (eyJ/sk-/token/Bearer) нет.

REAL: app, solo-lead codex gpt-5.6-luna (claude-multimodel 0.124 через лаунчер), IPC ceoSupervisor.read/command, stop через TeamProvisioningService, kill/relaunch app, процессы. SYNTHETIC: только JSONL-строки квоты (3 + 2 шт).

| Шаг | Результат |
| --- | --- |
| 1 codex lead создан, ready | PASS (REAL) |
| 2 enable -> owner codex/primary, epoch 1; checkpoint с effects op-1 confirmed | PASS (REAL) |
| 3 anthropic available + auth | NOT VERIFIED: нет стандартной auth Claude в изолированном root, копировать секреты запрещено |
| 4 (сокращён) синтетическая codex-квота x2 при резерве UNKNOWN | PASS: старое дерево lead/codex исчезло, epoch 1->2 один раз, status waiting / reason no_available_executor, owner null, history enabled>checkpoint_saved>quota_confirmed>waiting_for_executor, дубль не обработан (handledRuns 1, 2 строки доставлены), новый launch отсутствует, aliveList [] (SYNTHETIC сигнал, REAL остановка) |
| 4 (замещающий Claude lead, транскрипт без старого session id, ровно один запуск), 5, 6 | NOT VERIFIED (нужен живой Claude) |
| 7 kill app (taskkill /T /F по pid), relaunch с тем же userData | PASS: выживших процессов нет; состояние сохранено (epoch 2, checkpoint, history, handledRuns); fail-closed: waiting/no_available_executor, owner null; за 25 с и 3 чтения новых lead не запускалось, history не менялась |
| 7 устаревшие/чужие runId (старый реальный runId и 2 stale) x3 строки | PASS: доставлены (3), состояние не изменилось, запусков нет |
| 8 cleanup | PASS: teams.stop ok, процессов прогона нет, credentials нет |

Примечание: так как owner был снят до рестарта (waiting), проверка blocked/runtime_ownership_unknown и interrupted_handoff в этом сценарии не достигнута (для неё нужен активный owner при kill app); не проверено.

SQLite: JSON-хранилище хватило, ничего не заблокировано. Текст: `[Feature:InternalStorage] internal-storage sqlite backend unavailable; falling back to JSON stores for this session Error: better-sqlite3 native module pin failed: ... better_sqlite3.node was compiled against NODE_MODULE_VERSION 137 ... requires NODE_MODULE_VERSION 149` (src/features/internal-storage/main/infrastructure/internalStorageNativeDriver.ts:41, фолбэк в composition/InternalStorageBackendSelector.ts:62). Нативные модули не пересобирались.

Наблюдения: приложение запускает много кратковременных claude-multimodel (пробы без --input-format); lead определяется по --input-format. Запросы к провайдеру: 1 (codex).

### 21.10.2026 — финальная проверка (Codex-часть, перезапуск, русский интерфейс)

- seed-isolated-claude-auth.cjs удалён из репозитория по указанию владельца: копирование OAuth между профилями запрещено. Записи выше о временной копии для anthropic — исторические; код копирования больше не существует, `.credentials.json` под `.local-tools` не найден.
- Финальная сборка `pnpm build` (HEAD c0d43c828 + правки диагностики) запущена повторно с профилем ceo6: окно создаётся, панель «Директор CEO · Ожидание исполнителя» читает сохранённое после перезапуска состояние (поколение 2, Codex: «Квота исчерпана», Claude: «Доступность не проверена»), роли «Основной провайдер: Codex · резервный: Claude», история переключений на русском, строк с «????» нет. РЕАЛЬНАЯ проверка (UI через CDP).
- Сигнал квоты СИНТЕТИЧЕСКИЙ (инжектор); процессы Codex РЕАЛЬНЫЕ. Переходы с участием живого Claude (Codex→Claude, Claude→Codex) НЕ ПРОВЕРЕНЫ: нет штатной авторизации Claude в изолированном профиле.

## 21.10.2026 - CEO e2e с живым Claude (тег ceo8, Claude-root профиля ceo6): шаги 1-4 частично PASS, дефект запуска замены

Драйвер: scripts/diagnostics/ceo-e2e-run.cjs (--tag ceo8 --claude-root <run-ceo6\claude-root>), лаунчер получил параметр -ClaudeRoot (только передаёт путь в AGENT_TEAMS_ELECTRON_CLAUDE_ROOT). Код драйвера не читает и не копирует credentials. Журнал: .local-tools/diagnostics/ceo-e2e-ceo8.log. Проект: .local-tools/ceo-e2e-project-ceo8. Первая попытка (ceo7) остановлена: общий Claude-root уже был привязан к старой команде ("One logical CEO already belongs to another team in this context", JsonCeoRepository.bindRole); драйвер теперь переносит старый .ceo-supervisor в .local-tools/tmp (бэкап). Запросов к провайдерам: codex 2 (ceo7+ceo8), claude 1 (opus).

| Шаг | Метка | Результат |
| --- | --- | --- |
| 1 codex solo lead gpt-5.6-luna ready | REAL | PASS |
| 2 enable (codex/primary, epoch 1) + checkpoint (op-1 confirmed) | REAL | PASS |
| 3 anthropic AVAILABLE | REAL (IPC) | PASS |
| 4 синтетическая codex-квота x2 | SYNTHETIC строка, остальное REAL | PASS: старое дерево lead gone за 1.4 с, новый Claude lead стартовал через 9.6 с (старое ушло ДО нового); ровно один новый lead; доставлено 2 строки, quota_confirmed 1, handledRuns 1; транскрипт нового lead содержит текст checkpoint и НЕ содержит старый session id/runId; Claude lead реально авторизован из изолированного root (assistant "OK", без Not logged in). FAIL: owner НЕ закоммичен - status blocked / launch_outcome_unknown, epoch 2, owner null; история quota_confirmed > starting_fresh_session > launch_outcome_unknown (нет owner_committed) |
| 5 codex available при активном Claude | REAL | FAIL/не проверено по смыслу: owner отсутствует; Claude pid 26096 не менялся и fail-back не было, но владельца в supervisor нет |
| 6 checkpoint Claude + синтетическая anthropic-квота | - | НЕ ПРОВЕРЕНО: checkpoint невозможен (нет owner), состояние blocked |
| 7 kill app, relaunch тем же userData | REAL | Частично: состояние сохранено (epoch, history, checkpoint, handledRuns), нового запуска нет, но статус остался launch_outcome_unknown (не runtime_ownership_unknown/interrupted_handoff), т.к. активного owner не было. Блок stale runId не выполнен (драйвер упал на owner=null; исправлено null-безопасностью, прогон не повторён) |
| 8 cleanup | REAL | PASS: процессов прогона нет, .credentials.json только в изолированном claude-root, в новых логах/транскриптах нет eyJ / sk-ant- / Bearer / refreshToken (6 файлов) |

Дефекты (src не менялся):
1. Replacement Claude lead запущен, но supervisor ставит launch_outcome_unknown: CeoSupervisor.continueHandoff (src/features/ceo-provider-supervisor/core/application/CeoSupervisor.ts ~стр. 244-268) глотает исключение пустым catch, причина не логируется. Ошибка возникла ~5 с после старта; вероятная причина (гипотеза, не подтверждена) - runtime.inspect сразу после launchTeam (TeamProvisioningCeoRuntime.ts стр. 18-31) не видит run как alive (getAliveRunId выставляется после завершения bootstrap) -> 'Replacement ownership unproven'. Следствие: живой Claude lead остаётся без владельца в supervisor, автоматический fail-back/дальнейшие шаги блокируются. Воспроизведение: tag ceo8, шаг 4.
2. Замена запускается без выбора модели: lead использует claude-opus-4-8 / opus[1m] по умолчанию (TeamProvisioningCeoRuntime.start не передаёт model), нельзя запросить haiku.
3. Общий Claude-root: одна логическая CEO на контекст (role-binding.json) - повторное использование root для новой команды требует очистки привязки.

## 21.10.2026 - CEO e2e, тег ceo9 (после фикса ожидания run в TeamProvisioningCeoRuntime.start): шаги 1-8 PASS

Команда: `node scripts\diagnostics\ceo-e2e-run.cjs --tag ceo9 --port 9335 --claude-root ...\run-ceo6\claude-root` (запуск с редиректом в файлы). Журнал: .local-tools/diagnostics/ceo-e2e-ceo9.log, вывод .local-tools/tmp/run-ceo9.out. Credentials драйвер не читает. Запросов к провайдерам: codex 2 (старт + замена Codex), claude 1 (+1 лёгкий старт), квота-строки СИНТЕТИЧЕСКИЕ (2+1+5).

| Шаг | Метка | Результат |
| --- | --- | --- |
| 1 codex solo lead ready | REAL | PASS |
| 2 enable (epoch 1) + checkpoint op-1 confirmed | REAL | PASS |
| 3 anthropic AVAILABLE | REAL (IPC) | PASS |
| 4 codex-квота x2 -> Claude lead | SYNTHETIC строка, остальное REAL | PASS: старое дерево ушло за 1.5 с до старта нового (8.9 с); один Claude lead; owner anthropic/reserve, epoch 2 один раз; quota_confirmed 1, handledRuns 1, доставлено 2; history ...quota_confirmed>starting_fresh_session>owner_committed; checkpoint-текст в транскрипте нового lead, старого session id/runId нет; Claude авторизован (assistant, без Not logged in). Дефект ceo8 устранён |
| 5 codex available при активном Claude | REAL | PASS: pid 16780/runId/epoch без изменений, fail-back нет |
| 6 checkpoint на Claude run + синтетическая anthropic-квота | SYNTHETIC строка | PASS по состоянию: Claude (16780) исчез, один новый lead (27784), owner codex/primary, epoch 3 один раз, active, quota_confirmed>starting_fresh_session>owner_committed. Проверка "exactly one new Codex lead" в драйвере дала FAIL из-за условия providers()>=1: дочерний codex-процесс per-turn и в простое отсутствует (так же в шаге 1); условие в драйвере убрано, команда lead логируется в следующих прогонах. Что 27784 именно codex-lead подтверждено только supervisor-состоянием (owner codex), не cmdline |
| 7 taskkill app с АКТИВНЫМ owner (codex/primary, сразу после шага 6), relaunch того же userData | REAL | PASS: выживших нет; epoch/history/checkpoint/handledRuns сохранены; status blocked / runtime_ownership_unknown (owner сохранён), нового запуска нет, history стабильна 20+ с; 5 stale/дубль строк (старый run1, дубль anthropic x2, stale-id, прежний live runId) доставлены, состояние не изменилось, запусков нет |
| 8 cleanup | REAL | PASS: .credentials.json только в isolated claude-root владельца, токен-паттернов 0 (7 файлов), процессов прогона нет |

Не проверено: interrupted_handoff (kill посреди передачи); что owner=Codex lead после relaunch действительно жив/мёртв (app убит вместе с деревом); cmdline Codex lead шага 6.

## 21.10.2026 - task-001: первое реальное вертикальное видео (production\task-001, вне git)

Факт: собран ролик "Africa Is Bigger Than Your Map Makes It Look" 49.4 с, 1080x1920, 30 fps, H.264/AAC, два файла: render\task-001_final.mp4 (горящие субтитры) и render\task-001_nosubs.mp4. Визуал процедурный на Natural Earth 50m (проекции Меркатор/Equal Earth/LAEA посчитаны и проверены численно), один внешний ассет - скан карты Меркатора 1569 (PD). Голос Kokoro am_michael, loudnorm до -14.1 LUFS, TP -3.5.
QA (qa\QA_REPORT.md): ffprobe все проверки True; WER faster-whisper small 0.0%, base 0.95%; субтитры против ASR медиана 0.01-0.02 с; прогон 1 нашёл 5 замечаний (наложение текста S7, плашка S8, плашка S1, глиф умножения, громкость -14.9), исправлено, прогон 2: PASS_WITH_NOTES.
Не проверено: естественность голоса человеком, плавность анимации в движении, поведение в интерфейсе Shorts, метки синтетического контента, первичные источники площадей.
Найдена ошибка пилота: area_km2 игнорировал дырки полигонов (Африка 30.017 вместо 29.986). Ничего не опубликовано, канал не определён, доход $0.

### 21.10.2026 - task-001 v2 (правки после обзора ведущего ревьюера)
Исправлено: контур карты и белый контур Гренландии в сценах Equal Earth (Гренландия фактически не была обрезана, bbox внутри кадра, но плоская форма у края проекции выглядела срезанной); убран счётчик лет 1500-1569 в сцене карты Меркатора (показан сразу 1569); субтитры опущены на y=1500 (в сценах S1/S3 хвост Африки местами всё ещё частично закрыт). Повторный QA: ffprobe все проверки True, -14.1 LUFS, WER 0.0%/0.95%, синхронизация медиана 0.01-0.02 с, вердикт PASS_WITH_NOTES. Ревьюер - та же сессия; прослушивание человеком не выполнялось. Предыдущая версия: production\task-001\render\v1_backup\.

## 21.10.2026 - fork smoke: запуск через scripts\launch-fork.ps1 + цикл производства task-001 (данные: .local-tools/state/fork-smoke-20261021-142754, скриншоты: .local-tools/diagnostics/fork-smoke-20261021-142754)

Метки: REAL = реальное собранное приложение; IPC = window.electronAPI.mediaProduction через CDP, НЕ через клики UI (панель падает, см. дефект 2). Провайдеры/LLM/Telegram не использовались.

| Шаг | Результат |
| --- | --- |
| Лаунчер как есть (powershell.exe 5.1, -File) | FAIL: файл без UTF-8 BOM, парсер 5.1 читает его как ANSI, ParserError (строки 24, 48). Дальнейшие проверки лаунчера - на временной копии с BOM |
| Лаунчер с BOM: запуск, каталоги userdata/claude-root/tmp/logs, electron.pid | PASS |
| Второй экземпляр | PASS: окно MessageBox "запуск невозможен", второй процесс не стартовал (порт 9341 пуст). Окно модальное, в безголовом запуске будет висеть |
| Отсутствие сборки/Electron | PASS (на копии скрипта в временной папке без electron\dist): MessageBox, каталог данных не создан. Реальные папки не трогались |
| 1 Открытие панели Производство (Ещё действия > Производство) | FAIL: React error #306, экран ошибки (01-crash.png). Причина: двойной lazy |
| 2 Создание task-001 (IPC) | PASS: cap 3; провайдер UNKNOWN не считается доступным: activations 0, deferred no-available-executor |
| 3 Артефакты (IPC) | PASS: путь вне корня, '..', относительный, не-MP4 для render отклонены; MP4 1080x1920, 49.38 с, звук есть; реальный QA_REPORT.md отклонён (формат), копия в формате протокола принята: PASS_WITH_NOTES + 7 непроверенных критериев |
| 4 Согласование (IPC) | PASS: id, текст действия, expiresAt (ttl 24 ч); approve один раз; повтор approve/reject без второго эффекта (история 20/2 не изменилась); чужой/пустой id отклонены. Просроченный путь через UI/IPC недоступен: не проверено |
| 5 Очередь | PASS: операция создана один раз, повтор = та же запись (JSON идентичен); "нет канала публикации", task state=blocked только на publication_queue, остальные этапы completed; finance zeroRevenue=true (UI-строка не проверена из-за дефекта 2) |
| 6 Перезапуск (taskkill /T /F, тот же DataDir) | PASS: list/get/summary до и после побайтно идентичны; повторные advance/approve дублей не создали. Состояние publishing - покрыто юнит-тестами, не проверялось |
| 7 Cleanup | PASS: процессов electron/claude-multimodel нет, credentials-файлов нет |

Дефекты (src не менялся):
1. scripts/launch-fork.ps1: нет UTF-8 BOM, под Windows PowerShell 5.1 (как вызывает "Запустить форк.cmd") не парсится. Фикс: сохранить с BOM или ASCII-безопасные строки.
2. src/renderer/components/layout/PaneContent.tsx:88-92 делает lazy(() => import('@features/media-operations/renderer').then(m => ({default: m.ProductionPanel}))), а src/features/media-operations/renderer/index.ts:14 экспортирует уже lazy-объект - вложенный lazy, React error #306, вкладка Производство падает. Воспроизведение: Ещё действия > Производство. Фикс: в PaneContent импортировать компонент напрямую из ./ui/ProductionPanel или убрать внешний lazy.
3. src/features/media-operations/core/domain/production.ts:131,143 + productionIpc.ts: сообщения парсера QA начинаются с латиницы ('QA: ...'), фильтр /^[А-Яа-яЁё]/ заменяет их общим "Не удалось выполнить действие производства", владелец не узнаёт причину. Реальный production\task-001\qa\QA_REPORT.md не в формате протокола (нужны строка "VERDICT: PASS_WITH_NOTES" и заголовок UNVERIFIED_CRITERIA с маркированным списком) - приложение его закономерно отклоняет, но пользователю этого не сказано.
4. Любой существующий файл внутри корня принимается на любой этап (script, fact_check и т.д. без проверки содержимого); этапы завершаются при deferred-ролях (план не запускает процессы) - так задумано, но не очевидно в UI.

## 21.10.2026 - fork smoke 2: реальные клики UI через CDP (данные: .local-tools/state/fork-smoke2-20261021-144110, скриншоты: .local-tools/diagnostics/fork-smoke2-20261021-144110)

Метки: REAL = собранное приложение, запуск `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\launch-fork.ps1 -DataDir ... -DebugPort 9341`; ввод и клики - Input.dispatchMouseEvent / Input.insertText; IPC только для чтения состояния. `Запустить форк.cmd` не запускался (данные владельца); по тексту он вызывает `"%~dp0app-dev\scripts\launch-fork.ps1"` без аргументов, то есть корректно.

| Шаг | Результат |
| --- | --- |
| Запуск лаунчера (BOM) | PASS: парсится, окно и порт 9341 поднялись, electron.pid записан |
| 1 Ещё действия > Производство | PASS: без падения, русский текст, "????" нет (01b-production.png) |
| 2 Создание task-001 (short-video-v1 зашит в форме, выбора шаблона в UI нет) | PASS: задача создана, лимит 3; сотрудники выбраны 0 - причина "Нет доступного провайдера; неизвестная доступность не даёт права запуска" (как и задумано) |
| 3 Артефакты через поле пути + кнопки | PASS: CARD.md, subtitles.srt, FACTCHECK.md, каталог assets, sources/LICENSES.md, master.wav, task-001_final.mp4 (ffprobe 1080x1920, 49.38 с, звук есть), QA_REPORT.md (PASS_WITH_NOTES, 7 непроверенных критериев), PUBLISH_PACK.md. Внешние/относительные/".." пути: русское отклонение "Артефакт должен находиться внутри разрешённого корня производства" |
| 4 Согласование | PASS: Утвердить с двойным кликом - одно событие (история 19 записей, статус approved, кнопки исчезли), повторно нажать нельзя |
| 5 Очередь | PASS: этап 10 "Заблокирован", detail "нет канала публикации", этапы 1-9 завершены; "доход: 0, фактических поступлений нет"; публикация одна (Согласовано - ожидает выбора канала) |
| 6 taskkill /T /F + повторный запуск того же DataDir | PASS: list/get/summary JSON побайтно идентичны до/после, approval id тот же, публикаций 1, дублей нет; UI показывает то же |
| Cleanup | PASS: electron/claude-multimodel 0, порт закрыт |

Дефекты/замечания (src не менялся):
1. renderer/hooks/useProduction.ts (select, ~стр. 80): повторный клик по уже выбранной задаче делает setDetail(null) и не перезапрашивает деталь (effect не срабатывает при том же ключе) - карточка пропадает до следующего опроса (5 с; при document.hidden - пока не нажать "Обновить"). Воспроизведение: выбрать задачу, кликнуть её снова.
2. Тексты ошибок в панели содержат шум Electron: "Error: Error invoking remote method 'media-production:attach': Error: ..." (useProduction: String(failure)). Лучше показывать только failure.message без префикса.
3. Для существующего пути внутри корня, но несуществующего файла - общее "Не удалось выполнить действие производства" (причина не названа).
4. Текст согласования (actionText) показывает сырой JSON QA на английских ключах ({"verdict":...}) владельцу - лучше человекочитаемо.
5. Повторный "Выполнить этап" на заблокированном этапе 10 добавляет запись истории каждый раз (24->25), эффектов (операций/согласований) нет.
6. Отложенные роли в UI: "Отложено: <причина>" без названия роли.
7. Окно под CDP/без видимого рабочего стола сообщает document.hidden=true, из-за чего опрос панели не работает; при тесте включён Emulation.setFocusEmulationEnabled. Не дефект приложения, но подтверждает п.1.
8. Лаунчер, вызванный из родительского процесса с перехватом stdout, не возвращается, пока жив Electron (дочерний процесс наследует дескриптор): для двойного клика не критично.
