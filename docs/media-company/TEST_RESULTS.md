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
