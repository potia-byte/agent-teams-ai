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
