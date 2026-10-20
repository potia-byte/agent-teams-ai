# Фактически выполненные проверки — 20.10.2026

| Проверка | Результат |
| --- | --- |
| MASTER_PROMPT.md, чтение всего файла | Содержит launcher PowerShell, не текст мастер-промпта |
| Поиск существующих исходников | В проверенных Git-копиях профиля оригинал не найден; поиск ограничен глубиной/исключёнными cache/venv |
| Git через исходный proxy | Сбой соединения с 127.0.0.1:9 |
| Git напрямую через Schannel | SEC_E_NO_CREDENTIALS 0x8009030e |
| Git напрямую через OpenSSL, sslVerify=true | ls-remote успешен; HEAD 846ed19d… |
| GitHub API user и fork | potia-byte; форк существует, parent=777genius/agent-teams-ai |
| Node | v24.19.0, соответствует engines исходника |
| Corepack | 0.35.0, уже установлен |
| pnpm | Отдельная команда не найдена; загрузка/установка не выполнялась |
| Временный filtered clone | Завершена загрузка commit/tree-истории; is-shallow=false; HEAD содержит 6367 коммитов |
| Полный unfiltered clone | Неуспешен: curl 92 HTTP/2 stream reset, early EOF; переход к дозагрузке объектов сохранённой копии |
| Текущее оригинальное дерево | Все 6745 уникальных blobs получены; 6774 файла восстановлены; git diff --quiet HEAD успешен |
| Build entry point оригинала через Node | MODULE_NOT_FOUND: node_modules/electron-vite/bin/electron-vite.js; зависимости отсутствуют |
| Установленная версия, чтение app.asar | 2.17.10; установленный runtime 0.0.106 отличается от pin исходников 0.0.124 |
| Node → Git, captured stdio | spawnSync git EPERM |
| Node → Git, inherited stdio | Успех, Git 2.55.0 |
| Исторический архив runtime через raw CDN | 28714596 байт за 10,78 с; 28 проверенных диапазонов; Git SHA совпал с 06e9c7f… |
| claude --version | 2.1.304 |
| codex --version | 0.163.0; предупреждения о недоступных alias/temp вне workspace |
| claude auth status | loggedIn=true, подписка Claude Pro; персональные данные не сохранялись |
| codex login status | Logged in using ChatGPT |

**Не выполнялись:** полноценная pnpm-сборка/prebuild оригинала, typecheck/Vitest оригинала,
fallback внутри Electron, имитационный отказ внутри форка, реальные LLM-вызовы,
модифицированный UI, публикации и коммерческие операции. Никаких успешных тестов
отдельного Python-прототипа не переносить в отчёт готовности Agent Teams AI.
