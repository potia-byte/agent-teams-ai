# Состояние — 20.10.2026

Приоритет владельца: настоящий форк Agent Teams AI → успешная исходная сборка Electron →
Claude/Codex fallback внутри приложения → функции медиакомпании. Отдельное Python-приложение исключено.

## Подтверждено

- На GitHub создан настоящий форк: https://github.com/potia-byte/agent-teams-ai.
  GitHub API подтверждает `fork: true`, родитель — `777genius/agent-teams-ai`.
- Оригинальный HEAD при проверке: `846ed19df0a2459aad59fe6ebb802a7c4b7ab972`, версия package.json — 2.17.10.
- Сеть Git восстановлена для отдельных процессов: удалены HTTP_PROXY/HTTPS_PROXY/ALL_PROXY,
  переданы `-c http.proxy= -c https.proxy= -c http.sslBackend=openssl -c http.sslVerify=true`.
  Проверка сертификатов включена. Глобальные настройки не менялись.
- Ошибка Schannel при прямом подключении: SEC_E_NO_CREDENTIALS (0x8009030e).
  С OpenSSL `ls-remote` успешен.
- GitHub CLI авторизован как potia-byte. Первое сообщение о недействительном токене
  было следствием недоступного прокси; прямой `gh api user` успешен.
- Локальные исходники Agent Teams AI при ограниченном поиске Git-копий в профиле пользователя
  не найдены. Установленное приложение и другие проекты не менялись.
- Ранее созданные `company/`, pyproject.toml, .gitignore и пустой .git сохранены в
  `.abandoned-prototype/`; их разработка прекращена.
- MASTER_PROMPT.md прочитан полностью: фактически содержит PowerShell-скрипт запуска,
  а не текст задания. Требования взяты из двух сообщений владельца.

## В процессе

- `app/`: неотфильтрованный clone оборвался после получения десятков MiB:
  `RPC failed; curl 92 HTTP/2 stream 5 reset by server (error 0x8 CANCEL)`,
  `64340 bytes of body are still expected`, `early EOF`, `invalid index-pack output`.
  Git автоматически удалил свою неудачную папку. Успешным clone это не является.
- `app-dev/`: настоящая рабочая копия оригинала, первоначально полученная через
  `--filter=blob:none --no-checkout`: HEAD `846ed19d…`, 6367 коммитов в истории HEAD,
  все удалённые ветки, shallow=false. Создана ветка `media-company/provider-fallback`.
  Настроены origin на форк владельца и upstream на оригинал.
  Batch-fetch всех 6745 уникальных blobs текущего дерева завершился успешно.
  Восстановлены все 6774 отслеживаемых файла; `git diff --quiet HEAD` успешен,
  исходное рабочее дерево до добавления журнала чистое.
  Старый index.lock отменённого restore проверен: пустой, активных владельцев нет;
  он перемещён в `.clone-recovery/index.lock.cancelled-restore` без удаления.
  Выполняется дозагрузка 55889 исторических blobs группами по пути через HTTP/1.1.
  Нужно дождаться нулевого списка missing objects,
  снять partial-clone markers/config и выполнить полный fsck. До этого копию полной не считать.
- `app-retry/`: остановленная повторная попытка HTTP/1.1; не использовать как рабочий репозиторий.

## Продолжение

1. Завершить докачку всех объектов в app-dev; проверить `git fsck --full`, `rev-parse --is-shallow-repository`,
   отсутствие partialClone/promisor, наличие веток/тегов и чистоту исходного checkout.
2. Remotes и рабочая ветка уже настроены; не создавать репозиторий заново.
3. Локальные AGENTS.md, CLAUDE.md, guardrails и Git delivery policy прочитаны.
4. Восстановление отсутствующих pnpm/зависимостей требует отдельного разрешения по пунктам 16/P1
   MASTER PROMPT V2. Запрос уже отправлен; отсутствие ответа не считается разрешением.
5. Выполнить сборку оригинала и проверки; только после успешной сборки реализовывать fallback.

Штатная build entry point проверена напрямую через Node: MODULE_NOT_FOUND для
`node_modules/electron-vite/bin/electron-vite.js`. Полная pnpm-сборка и prebuild не выполнялись.

Установленное приложение подтверждено read-only чтением package.json из app.asar: 2.17.10.
Но его runtime/VERSION — 0.0.106, тогда как исходный runtime.lock.json требует 0.0.124.
Не подставлять старый runtime как доказательство совместимости.

Пока не выполнены: успешная исходная сборка, fallback в Electron, запуск модифицированной версии,
производственный и коммерческий MVP. Новых расходов нет.
