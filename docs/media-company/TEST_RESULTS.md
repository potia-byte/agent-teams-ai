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
