<#
Launch the built fork of Agent Teams AI with its own data. Double-click entry point is
"Запустить форк.cmd" next to app-dev. No build step, no typed commands.
Uses: dist-electron + out (already built), locked runtime 0.0.124 from .local-tools.
Data: <fork root>\fork-data (userdata, claude-root, tmp, logs). The installed app is never touched.
Auth: Claude uses its own profile inside fork-data (sign in inside the app, nothing is copied);
Codex uses the standard Codex CLI login of this Windows user (read by the CLI itself, nothing is copied).
Optional: -DataDir <dir> (isolated test data), -DebugPort <n>, -Wait.
Telegram owner adapter stays OFF unless AGENT_TEAMS_TELEGRAM_ENV_FILE is set before launch.
#>
param([string]$DataDir, [int]$DebugPort = 0, [switch]$Wait)
$ErrorActionPreference = 'Stop'
$app = (Resolve-Path "$PSScriptRoot\..").Path
$forkRoot = Split-Path $app -Parent
function Fail([string]$msg) {
  try { Add-Type -AssemblyName System.Windows.Forms; [void][System.Windows.Forms.MessageBox]::Show($msg, 'Agent Teams AI (форк): запуск невозможен', 'OK', 'Error') } catch { Write-Host $msg }
  Write-Host "ОШИБКА: $msg"
  exit 1
}
$electron = Join-Path $app 'node_modules\electron\dist\electron.exe'
$mainJs = Join-Path $app 'dist-electron\main\index.cjs'
$renderer = Join-Path $app 'out\renderer\index.html'
$runtime = Join-Path $app '.local-tools\runtime-cache\0.0.124\win32-x64\payload-v1\claude-multimodel.exe'
if (-not (Test-Path $electron)) { Fail "Не найден Electron:`n$electron`nУстановка зависимостей форка повреждена. Сборку и зависимости заново скачивать не нужно: сообщите об этом в Claude Code." }
if (-not (Test-Path $mainJs) -or -not (Test-Path $renderer)) { Fail "Не найдена готовая сборка форка:`n$mainJs`n$renderer`nСборка не выполнена или удалена. Попросите Claude Code выполнить сборку форка." }
if (-not (Test-Path $runtime)) { Fail "Не найден проверенный runtime 0.0.124:`n$runtime`nПопросите Claude Code восстановить runtime из кэша." }

$data = if ($DataDir) { $DataDir } else { Join-Path $forkRoot 'fork-data' }
$userData = Join-Path $data 'userdata'; $claudeRoot = Join-Path $data 'claude-root'; $tmp = Join-Path $data 'tmp'; $logs = Join-Path $data 'logs'
New-Item -ItemType Directory -Force $userData, $claudeRoot, $tmp, $logs | Out-Null

$env:AGENT_TEAMS_ELECTRON_USER_DATA_DIR = $userData
$env:AGENT_TEAMS_ELECTRON_CLAUDE_ROOT = $claudeRoot
$env:CLAUDE_AGENT_TEAMS_ORCHESTRATOR_CLI_PATH = $runtime
$env:AGENT_TEAMS_PRODUCTION_ROOT = Join-Path $forkRoot 'production'
$env:TEMP = $tmp; $env:TMP = $tmp
Remove-Item Env:CLAUDE_CLI_PATH -ErrorAction SilentlyContinue
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Remove-Item Env:AGENT_TEAMS_E2E_QUOTA_SIGNAL_FILE -ErrorAction SilentlyContinue

$already = Get-CimInstance Win32_Process -Filter "Name='electron.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*$userData*" -and $_.CommandLine -notlike '*--type=*' }
if ($already) { Fail "Форк уже запущен (процесс $($already[0].ProcessId)). Закройте его окно и запустите снова." }

$args = @("`"$app`"", "--user-data-dir=`"$userData`"")
if ($DebugPort -gt 0) { $args += "--remote-debugging-port=$DebugPort" }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$p = Start-Process $electron -ArgumentList $args -WorkingDirectory $app -PassThru -RedirectStandardOutput (Join-Path $logs "fork-$stamp.out.log") -RedirectStandardError (Join-Path $logs "fork-$stamp.err.log")
Set-Content (Join-Path $data 'electron.pid') "pid=$($p.Id)"
Start-Sleep -Seconds 4
if ($p.HasExited) { Fail "Приложение закрылось сразу после запуска (код $($p.ExitCode)).`nЖурнал: $(Join-Path $logs "fork-$stamp.err.log")" }
Write-Host "Форк запущен (pid $($p.Id)). Данные: $data"
if ($Wait) { $p.WaitForExit() }
