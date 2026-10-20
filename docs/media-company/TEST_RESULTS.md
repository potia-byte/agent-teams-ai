# Выполненные проверки — 20.10.2026

Исходный Agent Teams AI 2.17.10, baseline 846ed19df0a2459aad59fe6ebb802a7c4b7ab972.
Код src, package.json, pnpm-lock.yaml и electron.vite.config.ts пока совпадает
с исходной версией.

| Проверка | Фактический результат |
| --- | --- |
| Node / Corepack | 24.19.0 / 0.35.0; Node соответствует engines |
| Локальный Corepack pnpm | 11.22.0, соответствует packageManager; без глобальных shims |
| pnpm install --frozen-lockfile | Пакеты скачаны; EPERM на запуске install-скрипта better-sqlite3 |
| pnpm install --frozen-lockfile --ignore-scripts | Успех: 2291 пакет связан, скачано повторно 0; нативный runtime не проверен |
| pnpm typecheck | Успех, exit 0: основная и все семь дополнительных конфигураций |
| pnpm build | Не прошёл: spawn EPERM в esbuild при tsx/prebuild |
| Vitest recovery и install tests | Не начались: EPERM конфигурации; runner-loader также блокируется |
| Node announcements tests, isolation=none | 14 тестов: 9 passed, 5 failed; набор в целом не прошёл |
| Node ciChangeScope + dmgArtwork, isolation=none | 8 тестов: 6 passed, 2 failed; набор в целом не прошёл |
| source-file-size / provisioning guards | Заблокированы: Node spawnSync git EPERM |
| scripts/media-company-local.ps1 Verify | Успех: реальные Node 24.19.0 / pnpm 11.22.0 |
| Push нового workflow | Отклонён: отсутствует OAuth scope workflow; CI не запускался |
| Push media-company/baseline | Успех: 5ad88af38 в собственном форке |
| Унаследованный CI workflow_dispatch | HTTP 404; Actions workflows API возвращает пустой список |
| Claude / Codex CLI, ранее | 2.1.304 / 0.163.0; Claude Pro / ChatGPT авторизованы, LLM не вызывались |

Логи в родительской .clone-recovery: baseline-build.log, baseline-typecheck.log,
baseline-tests.log, baseline-node-tests.log, baseline-native-tests.log,
pnpm-install.log, pnpm-link.log, postinstall-direct.log, electron-install.log.

Не выполнялись: успешная полная сборка, Electron smoke, fallback, его имитационные
или реальные CLI-тесты, публикации, коммерческие операции. Частично пройденные
наборы не являются успешным baseline. Проверки Python-прототипа не относятся
к готовности Electron-форка.

Полнота Git фиксируется отдельно в STATUS.md и .clone-recovery/verification.json;
до state=complete полную офлайн-копию проверенной не считать.

Дополнительно после исправлений:

| Проверка | Результат |
| --- | --- |
| git fsck --full | PASS, exit 0; missing=0, shallow=false, promisor markers/config сняты |
| Electron install с локальным electron_config_cache | PASS, exit 0; бинарный файл 44.4.5 существует |
| Electron Node mode | electron=44.4.5, node=24.21.0, ABI=149; smoke приложения не выполнялся |
| Node из Electron: captured child Git | EPERM воспроизводится |
| SQLite Node prebuild и :memory: select 1 | PASS, официальный prebuilt 12.11.1 для Node ABI 137; не Electron ABI 149 |
| ciChangeScope + dmgArtwork после CRLF fix | 7 passed, 1 failed на spawnSync git EPERM; набор в целом не прошёл |

Исправлена подтверждённая Windows-ошибка теста: regexp YAML ожидал только LF,
теперь допускает CRLF. Утверждение политики CI не ослаблено. Остальные наблюдаемые
сбои этих двух наборов связаны с запуском Git или созданием symlink в среде.

Проверки исходных экспортированных политик на реальном списке файлов Git
(перечисление отдельно, без заблокированного Node child process): source size
3594 файла, нарушений 0; provisioning architecture нарушений 0. Это проверка
тех же pure policies, не успешный запуск исходных CLI guards.
Radix React 19 presence patch verifier: exit 0.
Запускатель Verify: процессные переменные после выхода сравнены с исходными,
все восстановлены. Результат PASS.
