# Препятствия — 20.10.2026

С абсолютными Node/Git/esbuild воспроизводится EPERM при pipe; inherit работает.
Штатные build, Vitest и electron-rebuild требуют pipe/IPC. В реальном Electron PTY
получает EPERM на conpty named pipes; один main stderr содержит Mojo channel
access denied0x5. Конкретная причина отказа НЕ установлена: 4 включённых и доступных
журнала защиты не содержат событий в окнах тестов. Защита, TLS, sandbox и права
не менялись. Доказательства и воспроизведение сохранены в диагностическом пакете.

SQLite12.11.1 сейчас ABI137, Electron44.4.5 требует149. Официальный prebuilt
для electron-v149-win32-x64 вернул404. Штатный rebuild не дошёл до успешной
компиляции из-за fork/pipe EPERM. cl.exe/MSBuild.exe на PATH и vswhere в стандартном
пути при ограниченной проверке не найдены; это не полный аудит всех установок.
Системные Build Tools не устанавливались.

Git уже полностью восстановлен и проверен. Локальные locked зависимости и pnpm
установлены. Runtime0.0.124 скачан, checksum/CLI version проверены, payload-v1 готов.
Повторная загрузка не нужна. Launcher больше не меняет прокси. Пустые изолированные
CLI config dirs не являются авторизацией или доказательством доступности моделей.

Существующий GitHub token не имеет scope workflow; доступ не расширять. Новый CI
workflow сохранён в локальной ветке media-company/ci-workflow-blocked. Унаследованный
CI ранее возвращал404. PR#1 остаётся draft, merge не выполняется.

После успешных build/native/Vitest и desktop smoke можно реализовывать CEO fallback.
Пока нельзя объявлять приложение запускаемым или подменять сборку typecheck/probes.

Header cache @electron/rebuild4.2.0 жёстко задан в ~/.electron-gyp. Launcher Install
теперь принудительно использует node-ci: восстановление locked зависимостей не
запускает desktop postinstall, который пишет туда. Это защитная граница, не
выполненный native rebuild. Требуется локальный header cache для будущей native
сборки без переназначения HOME/USERPROFILE или изменения системных настроек.
