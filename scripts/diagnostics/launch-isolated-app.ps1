<#
Launch the built Electron app fully isolated (own userData + own Claude root) with the
verified runtime 0.0.124 wired in through CLAUDE_AGENT_TEAMS_ORCHESTRATOR_CLI_PATH.
Root cause it fixes: running `electron .` directly bypasses scripts/dev-with-runtime.mjs,
the only place that exports CLAUDE_AGENT_TEAMS_ORCHESTRATOR_CLI_PATH, so
ClaudeBinaryResolver (src/main/services/team/ClaudeBinaryResolver.ts) returns null and
src/main/index.ts:499 logs "Runtime adapter bridge disabled".
Prints the electron PID. No secrets are set; HOME/USERPROFILE untouched.
Usage: ./launch-isolated-app.ps1 -Tag 20261021T1200 [-Port 9333] [-UseRealProviderAuth]
Stop:  taskkill /PID <pid> /T /F
#>
param([Parameter(Mandatory)][string]$Tag,[int]$Port=9333,[switch]$UseRealProviderAuth)
$r=(Resolve-Path "$PSScriptRoot\..\..").Path; $t="$r\.local-tools"
$runtime="$t\runtime-cache\0.0.124\win32-x64\payload-v1\claude-multimodel.exe"
if(-not (Test-Path $runtime)){throw "runtime missing: $runtime"}
$state="$t\state\run-$Tag"; New-Item -ItemType Directory -Force "$state\userdata","$state\claude-root","$t\tmp" | Out-Null
$env:AGENT_TEAMS_ELECTRON_USER_DATA_DIR="$state\userdata"
$env:AGENT_TEAMS_ELECTRON_CLAUDE_ROOT="$state\claude-root"
$env:CLAUDE_AGENT_TEAMS_ORCHESTRATOR_CLI_PATH=$runtime
Remove-Item Env:CLAUDE_CLI_PATH -ErrorAction SilentlyContinue
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$env:TEMP="$t\tmp"; $env:TMP="$t\tmp"
if(-not $UseRealProviderAuth){ $env:CLAUDE_CONFIG_DIR="$state\claude-cfg"; $env:CODEX_HOME="$state\codex" }
$p=Start-Process "$r\node_modules\electron\dist\electron.exe" -ArgumentList @('"'+$r+'"',"--user-data-dir=`"$state\userdata`"","--remote-debugging-port=$Port") -WorkingDirectory $r -PassThru -WindowStyle Minimized -RedirectStandardOutput "$t\diagnostics\app-$Tag.out" -RedirectStandardError "$t\diagnostics\app-$Tag.err"
"pid=$($p.Id) state=$state out=$t\diagnostics\app-$Tag.out"
