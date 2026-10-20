# Состояние — 20.10.2026

Настоящий форк: https://github.com/potia-byte/agent-teams-ai.
Рабочая копия: app-dev, ветка media-company/build-bootstrap.
Baseline: 846ed19df0a2459aad59fe6ebb802a7c4b7ab972, Agent Teams AI 2.17.10.
Origin — собственный форк, upstream — 777genius/agent-teams-ai.

## Подтверждённые результаты

- Полностью восстановлены оригинальные исходники и Git-история, включая все
  исторические blobs. git fsck --full завершился с exit 0; missing objects=0;
  shallow=false. Promisor markers и partial-clone config сняты после проверки.
  Доказательства в родительской .clone-recovery/verification.json и fsck.txt.
  История исходного HEAD содержит 6367 коммитов. Все ветки/теги сохранены.
- Крупные исторические объекты получены через официальный raw CDN с проверкой
  Git SHA; архив 28 714 596 байт и runtime-blob 86 167 456 байт не запускались.
  Последние 869 объектов получены по точным commit/path с проверкой каждого SHA.
  Повторная докачка исключала уже сохранённые объекты.
- Node 24.19.0 подходит требованиям. Corepack 0.35.0 подготовил pnpm 11.22.0
  локально в .local-tools/corepack, без глобальных shims.
- Владелец разрешил локальную бесплатную установку. Все зависимости lockfile
  скачаны. После EPERM install-скриптов выполнен frozen install --ignore-scripts:
  связаны 2291 пакет, скачано повторно 0. package.json и lockfile не менялись.
- Electron 44.4.5 установлен в node_modules, бинарный файл существует; запуск
  Electron в Node-режиме подтвердил electron=44.4.5, node=24.21.0, ABI=149.
  Это не smoke приложения и не доказательство совместимости всех native modules.
- better-sqlite3 12.11.1 для Node ABI 137 установлен штатным prebuild-install
  из официального GitHub-релиза. Проверка SQLite :memory: select 1 успешна.
  Electron ABI 149 ещё не собран/проверен; cpu-features/pty rebuild не подтверждён.
- Полный pnpm typecheck прошёл (exit 0, основная и семь дополнительных конфигураций).

## Реальные изменения этой итерации

- scripts/media-company-local.ps1: локальный Corepack, кэши, dev userData и Claude root;
  процессное окружение восстанавливается после завершения. Verify проверен.
- .gitignore: исключены .local-tools, загруженные пакеты и исполняемые файлы не коммитятся.
- test/scripts/ciChangeScope.test.mts: исправлена Windows-совместимость утверждения
  YAML (допускает CRLF и LF). Исправленный тест прошёл.
- .github/workflows/media-company-verify.yml подготовлен и сохранён в отдельной
  локальной ветке media-company/ci-workflow-blocked (2179a00dc). Его push заблокирован
  scope workflow; в текущую рабочую ветку он не включён, существующие workflows неизменны.
- Обновлены компактные журналы. Изменений src, интерфейса, package.json,
  pnpm-lock.yaml и electron.vite.config.ts нет.

## Что блокирует следующий этап

Исходная сборка не прошла. pnpm build остановился на esbuild в prebuild с
spawn EPERM. Vitest и Node-вызовы Git с захватом вывода также блокируются;
проверка через Node из Electron воспроизводит тот же EPERM.
Нативный Electron rebuild получает EPERM. Системные права и sandbox не менялись.

Новый workflow сохранён локально коммитом 2179a00dc, но GitHub отверг его push
из-за отсутствия OAuth scope workflow. Права не расширялись. Dispatch исходного
ci.yml возвращает 404: Actions API нового форка пока не зарегистрировал workflows.
CI не запускался. Ветка media-company/baseline с 5ad88af38 отправлена успешно.

## Следующая безопасная точка продолжения

1. В среде с разрешёнными build subprocesses выполнить из app-dev:
   ./scripts/media-company-local.ps1 Install, затем Build и Test.
   Не менять системный Node, глобальные инструменты или рабочую установку приложения.
2. Получить успешную исходную сборку; подготовить exact runtime 0.0.124 локально.
   Установленный runtime 0.0.106 не подставлять вместо pin.
3. Проверить DevMcp в изолированных каталогах .local-tools/state с тестовым проектом.
4. Только после успешной исходной сборки расширить существующие recovery,
   provider и lifecycle механизмы для CEO Claude/Codex; проверить checkpoints,
   fencing, дедупликацию, restart, UNKNOWN и оба недоступны; затем добавить UI состояния.

Fallback пока не реализован и не тестировался. Модифицированное приложение
не запущено. Фабрика, установленный Agent Teams AI и другие проекты не менялись.
Расходов, платных API, публикаций и коммерческих операций нет.
Самостоятельный Python company остановлен; файлы сохранены в .abandoned-prototype.

## Доставка

Коммит реализации подготовки: 3fd2809 (scripts/media-company-local.ps1,
CRLF-исправление теста, .gitignore и журнал). Ветка отправлена в origin.
Черновик PR: https://github.com/potia-byte/agent-teams-ai/pull/1.
Main не менялся; merge не выполнялся. Требуемые независимый review и CI
пока не получены. После создания PR Actions workflows/runs API также пусты.
Подготовленный новый workflow остаётся только в локальной ветке
media-company/ci-workflow-blocked, 2179a00dc.
