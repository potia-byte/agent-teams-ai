<#
Launch the built Electron app fully isolated (own userData + own Claude root) with the
verified runtime 0.0.124 wired in through CLAUDE_AGENT_TEAMS_ORCHESTRATOR_CLI_PATH.
Root cause it fixes: running `electron .` directly bypasses scripts/dev-with-runtime.mjs,
the only place that exports CLAUDE_AGENT_TEAMS_ORCHESTRATOR_CLI_PATH, so
ClaudeBinaryResolver (src/main/services/team/ClaudeBinaryResolver.ts) returns null and
src/main/index.ts:499 logs "Runtime adapter bridge disabled".
-QuotaSignalFile: pre-creates (never truncates) <userdata>\e2e-quota-signal.jsonl and sets
AGENT_TEAMS_E2E_QUOTA_SIGNAL_FILE (test-only synthetic quota adapter, src/main/testing/e2eQuotaSignalInjector.ts).
Prints the electron PID. No secrets are set; HOME/USERPROFILE untouched.
-ClaudeRoot <dir>: reuse an existing isolated Claude root (already logged in by the owner via standard CLI login); nothing is copied.
Usage: ./launch-isolated-app.ps1 -Tag 20261021T1200 [-Port 9333] [-UseRealProviderAuth]
Stop:  taskkill /PID <pid> /T /F
#>
param([Parameter(Mandatory)][string]$Tag,[int]$Port=9333,[switch]$UseRealProviderAuth,[switch]$QuotaSignalFile,[string]$ClaudeRoot)
$r=(Resolve-Path "$PSScriptRoot\..\..").Path; $t="$r\.local-tools"
$runtime="$t\runtime-cache\0.0.124\win32-x64\payload-v1\claude-multimodel.exe"
if(-not (Test-Path $runtime)){throw "runtime missing: $runtime"}
$state="$t\state\run-$Tag"; New-Item -ItemType Directory -Force "$state\userdata","$state\claude-root","$t\tmp" | Out-Null
$env:AGENT_TEAMS_ELECTRON_USER_DATA_DIR="$state\userdata"
if($ClaudeRoot){ if(-not (Test-Path $ClaudeRoot)){throw "ClaudeRoot missing: $ClaudeRoot"}; $env:AGENT_TEAMS_ELECTRON_CLAUDE_ROOT=(Resolve-Path $ClaudeRoot).Path } else { $env:AGENT_TEAMS_ELECTRON_CLAUDE_ROOT="$state\claude-root" }
$env:CLAUDE_AGENT_TEAMS_ORCHESTRATOR_CLI_PATH=$runtime
Remove-Item Env:CLAUDE_CLI_PATH -ErrorAction SilentlyContinue
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
if($QuotaSignalFile){ $qf="$state\userdata\e2e-quota-signal.jsonl"; if(-not (Test-Path $qf)){ New-Item -ItemType File $qf | Out-Null }; $env:AGENT_TEAMS_E2E_QUOTA_SIGNAL_FILE=$qf } else { Remove-Item Env:AGENT_TEAMS_E2E_QUOTA_SIGNAL_FILE -ErrorAction SilentlyContinue }
$env:TEMP="$t\tmp"; $env:TMP="$t\tmp"
if(-not $UseRealProviderAuth){ $env:CLAUDE_CONFIG_DIR="$state\claude-cfg"; $env:CODEX_HOME="$state\codex" }
$p=Start-Process "$r\node_modules\electron\dist\electron.exe" -ArgumentList @('"'+$r+'"',"--user-data-dir=`"$state\userdata`"","--remote-debugging-port=$Port") -WorkingDirectory $r -PassThru -WindowStyle Minimized -RedirectStandardOutput "$t\diagnostics\app-$Tag.out" -RedirectStandardError "$t\diagnostics\app-$Tag.err"
Set-Content "$state\electron.pid" "pid=$($p.Id)"   # lets a parent process read the pid without holding the stdout pipe
"pid=$($p.Id) state=$state out=$t\diagnostics\app-$Tag.out"
