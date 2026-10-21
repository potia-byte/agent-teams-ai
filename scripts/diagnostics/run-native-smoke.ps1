[CmdletBinding()]
param([ValidateSet('Main', 'Node')][string]$Mode = 'Main')
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$diagnostics = Join-Path $root '.local-tools/diagnostics'
$runName = 'native-' + $Mode.ToLowerInvariant() + '-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfff')
$reportPath = Join-Path $diagnostics ($runName + '.json')
$stdout = Join-Path $diagnostics ($runName + '.stdout.log')
$stderr = Join-Path $diagnostics ($runName + '.stderr.log')
$state = Join-Path $diagnostics 'native-electron-state'
$saved = @{}
foreach ($name in @('ELECTRON_RUN_AS_NODE', 'TEMP', 'TMP')) {
    $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
$failed = $true
try {
    if ($Mode -eq 'Main' -and $saved['ELECTRON_RUN_AS_NODE']) {
        throw 'Main probe refuses an inherited ELECTRON_RUN_AS_NODE override'
    }
    if ($Mode -eq 'Node') { $env:ELECTRON_RUN_AS_NODE = '1' }
    $env:TEMP = Join-Path $state 'tmp'
    $env:TMP = $env:TEMP
    [IO.Directory]::CreateDirectory($env:TEMP) | Out-Null
    $node = (Get-Command node.exe -ErrorAction Stop).Source
    $electron = Join-Path $root 'node_modules/electron/dist/electron.exe'
    $script = Join-Path $PSScriptRoot 'electron-native-smoke.cjs'
    $userData = Join-Path $state 'user-data'
    $arguments = @('"'+$script+'"', '--node-path', '"'+$node+'"', '--output', '"'+$reportPath+'"', '--user-data-dir="'+$userData+'"')
    $process = Start-Process -FilePath $electron -ArgumentList $arguments -WorkingDirectory $root -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    # Retain the handle so Windows PowerShell can retrieve ExitCode after GUI exit.
    $handle = $process.Handle
    $exited = $process.WaitForExit(20000)
    if (!$exited) { Stop-Process -Id $process.Id }
    $report = if (Test-Path -LiteralPath $reportPath) {
        Get-Content -Raw -Encoding UTF8 -LiteralPath $reportPath | ConvertFrom-Json
    } else { $null }
    $failed = !$exited -or $process.ExitCode -ne 0 -or !$report -or !$report.passed
    $summary = @{mode=$Mode;pid=$process.Id;exited=$exited;exitCode=$process.ExitCode;
        reportPath=$reportPath;reportPassed=[bool]$report.passed;applicationSmoke=$false}
    [IO.File]::WriteAllText((Join-Path $diagnostics ($runName + '.launch.json')), ($summary | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
    $summary | ConvertTo-Json
} finally {
    foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
}
if ($failed) { exit 1 }
