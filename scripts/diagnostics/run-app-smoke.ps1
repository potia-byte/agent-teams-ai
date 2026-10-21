$r='C:\Users\asq\Documents\agent-teams-ai-fork\app-dev'; $t="$r\.local-tools"
$env:AGENT_TEAMS_ELECTRON_USER_DATA_DIR="$t\state\electron-smoke"; $env:TEMP="$t\tmp"; $env:TMP="$t\tmp"
$env:CLAUDE_CONFIG_DIR="$t\state\claude"; $env:CODEX_HOME="$t\state\codex"
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$p=Start-Process "$r\node_modules\electron\dist\electron.exe" -ArgumentList @('"'+$r+'"',"--user-data-dir=`"$t\state\electron-smoke`"") -WorkingDirectory $r -PassThru -RedirectStandardOutput "$t\diagnostics\app-smoke.out" -RedirectStandardError "$t\diagnostics\app-smoke.err"
$h=$p.Handle; $x=$p.WaitForExit(25000); "exited=$x"; if($x){"code=$($p.ExitCode)"}else{Get-Process -Id $p.Id | % {"alive mainWindow='$($_.MainWindowTitle)'"}; & taskkill /PID $p.Id /T /F | Out-Null}
