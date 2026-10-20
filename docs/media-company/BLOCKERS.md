# Препятствия — 20.10.2026

Владелец разрешил бесплатную локальную установку. Corepack подготовил pnpm 11.22.0;
Node 24.19.0 подходит. Все пакеты из lockfile скачаны и связаны. Разрешение на
установку больше не является препятствием.

- Обычный pnpm install --frozen-lockfile остановился на install-скрипте
  better-sqlite3: Node spawn EPERM. Повтор с --ignore-scripts успешно связал
  те же пакеты из локального store; нативные сборки этим не проверены.
- pnpm build остановился в исходном prebuild (tsx scripts/fetch-pricing-data.ts):
  запуск сервиса esbuild получает spawn EPERM. Продуктовый код не модифицирован.
- Vitest не начинает тесты: bundle-loader блокируется запуском esbuild;
  configLoader=runner также получает EPERM на Vite optimizeSafeRealPathSync.
- Прямой postinstall подтвердил EPERM при native Electron rebuild.
  Первоначальный путь кэша Electron вне workspace исправлен процессной переменной
  electron_config_cache; итог загрузки проверяется отдельно.
- Git guards используют Node captured child processes и получают EPERM.
  pnpm typecheck при этом проходит полностью: не все дочерние процессы запрещены.

Логи: .clone-recovery в родительской рабочей области. Не менять sandbox, системные
права или установленные приложения. Успешная исходная сборка остаётся условием
начала реализации fallback согласно прямому приоритету владельца.

Подготовлен .github/workflows/media-company-verify.yml: стандартный бесплатный
Windows runner, без секретов, публикаций и upload артефактов. Push с этим файлом
отклонён GitHub: OAuth App не имеет scope workflow. Права не расширялись.
Ветка media-company/baseline с документами (5ad88af38) отправлена успешно.

Унаследованные workflows пока не зарегистрированы API Actions нового форка:
список пустой; dispatch существующего ci.yml возвращает HTTP 404, хотя файл
существует на main. CI не запускался. В собственном форке задана переменная
CI_LINUX_RUNNER=ubuntu-latest, чтобы унаследованный CI не использовал сторонний
runner ubicloud. Main, разрешения Actions и защита веток не менялись.

- Установленный runtime 0.0.106 не соответствует pin исходников 0.0.124.
  Для dev-запуска нужен закреплённый runtime в .local-tools/runtime-cache;
  боевой runtime не обновлять и не подставлять как проверенную совместимую версию.
- Read-only аудит Windows через Get-CimInstance запрещён средой; SSH представлен
  .sbx-denybin/ssh.bat. VPS не проверен, обход ограничений не выполнялся.
- Telegram, каналы, публикации и коммерческие доступы не настроены. Их подключение
  не предшествует исходной сборке и fallback. Новых расходов нет.

Итог подготовки: Electron 44.4.5 установлен, бинарный файл и версия подтверждены.
SQLite Node ABI 137 установлен штатным prebuild-install, select 1 в :memory:
успешен. Это не Electron ABI 149; нативный Electron rebuild всё ещё не подтверждён.
Git fsck --full прошёл, недостающих объектов нет; Git больше не является препятствием.

Новый workflow сохранён в локальной ветке media-company/ci-workflow-blocked,
коммит 2179a00dc. Рабочая ветка media-company/build-bootstrap не меняет workflows
и может быть отправлена существующим токеном без расширения scope.
