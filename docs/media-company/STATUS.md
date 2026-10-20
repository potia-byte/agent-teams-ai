# Состояние — 20.10.2026, Windows-диагностика

Форк potia-byte/agent-teams-ai, media-company/build-bootstrap, draft PR #1.
Начальный HEAD 7767fdb6c совпал с origin; рабочее дерево было чистым.
AGENTS.md, CLAUDE.md, guardrails и Git policy прочитаны.

## Код

- 536f96169: scripts/diagnostics — матрица процессов, контекст и события защиты,
  реальные Electron native probes, воспроизводимые запускатели, exact runtime bootstrap.
- dad6b81ef: launcher сохраняет прокси, восстанавливает окружение, отклоняет
  inherited runtime overrides до dev-запуска, изолирует TMP/TEMP, CLI/XDG/config/cache.
  Native stderr в Windows PowerShell больше не подменяет фактический exit code.
- electronDevPathOverrides.ts: при явном dev userData изолируются sessionData,
  logs и crashDumps; ошибка создания этих каталогов останавливает запуск.
  Поведение без override сохранено. Unit cases расширены.

## Проверенный результат

Матрица из 24 случаев в Node 24.19.0 / Electron Node 24.21.0: абсолютные
Node/Git/esbuild, spawn/spawnSync, shell=false. 12 inherit запусков exit 0;
12 pipe запусков EPERM. Runtime --version через pipe также получает EPERM.

Defender, CodeIntegrity, AppLocker EXE and DLL, Security-Mitigations/UserMode
включены и доступны; событий в окнах матрицы и Electron main нет. Причина отказа
не установлена. Ни Defender, ни sandbox не названы доказанной причиной.

Runtime 0.0.124 полностью готов в .local-tools/runtime-cache: штатные helpers,
payload-v1 с receipt; CLI 2.777.777. SHA-256 архива совпал с runtime.lock.json:
22b79b02bcf31c8364124cbbe5553ebdfab0e3fcbc364ea0926b0fa4f690231c.

После изменений прошли полный typecheck, focused fast lint, launcher tests,
синтаксис скриптов и исходные pure architecture policies (3597 файлов, 0 нарушений).
Build и Vitest не прошли: esbuild spawn EPERM. Native rebuild не прошёл: fork/pipe
EPERM. Официальный SQLite prebuilt Electron ABI149 вернул HTTP404. Реальные native
probes в Electron Node/main: SQLite ABI137 вместо149; PTY open/connect conpty pipe
EPERM. Один main запуск также записал Mojo platform channel access denied 0x5.
Это проверки компонентов, не smoke приложения.

## Пакет и продолжение

.local-tools/diagnostics/windows-build-diagnostics-dad6b81ef.zip (96236 байт).
SHA256: 3967b12f6a8a4935b4079907e6a26a59ebd30e05171279c715338c9b420011e8.
Внутри REPRODUCE.txt, исходники проверок с SHA, JSON и логи. Нет бинарников,
зависимостей, профилей, crash dumps и секретов.

Нужны разрешённое pipe/IPC выполнение, native rebuild, штатная сборка/Vitest,
desktop smoke на новом тестовом проекте. Защиту и права не менять. Git и runtime
перекачивать не нужно: fsck уже прошёл ранее, missing=0, shallow=false.

CEO fallback, checkpoints/fencing/dedup и русский UI переключений ещё не реализованы:
они следуют после успешной исходной сборки. Typecheck и probes её не заменяют.
Установленная версия, фабрика, боевые данные, системные настройки и GitHub scopes
не менялись. Расходов, платных API, LLM-вызовов и merge нет.
