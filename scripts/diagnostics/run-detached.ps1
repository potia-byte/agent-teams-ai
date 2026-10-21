<#
Runs a command line detached from the caller's job/handles: Start-Process (or WMI
Win32_Process.Create) with stdout/stderr redirected to files, polled until exit.
Applies the same isolated .local-tools environment as media-company-local.ps1 and
prepends .local-tools/bin (pnpm.cmd shim -> corepack pnpm) to PATH so nested
"pnpm ..." calls inside package scripts resolve. Does not change HOME/USERPROFILE.
Example: ./scripts/diagnostics/run-detached.ps1 -Name build -Command 'corepack pnpm build'
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Name,
    [Parameter(Mandatory)][string]$Command,
    [ValidateSet('StartProcess', 'Cim')][string]$Method = 'StartProcess',
    [int]$TimeoutSec = 900,
    [int]$Tail = 40
)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$tools = Join-Path $root '.local-tools'
$diag = Join-Path $tools 'diagnostics'
[IO.Directory]::CreateDirectory($diag) | Out-Null
$stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmss')
$out = Join-Path $diag "$Name-$stamp.stdout.log"
$err = Join-Path $diag "$Name-$stamp.stderr.log"
$overrides = [ordered]@{
    COREPACK_HOME = Join-Path $tools 'corepack'
    COREPACK_ENABLE_DOWNLOAD_PROMPT = '0'
    electron_config_cache = Join-Path $tools 'electron-cache'
    npm_config_cache = Join-Path $tools 'npm-cache'
    npm_config_devdir = Join-Path $tools 'node-gyp'
    TEMP = Join-Path $tools 'tmp'
    TMP = Join-Path $tools 'tmp'
    CLAUDE_DEV_RUNTIME_CACHE_ROOT = Join-Path $tools 'runtime-cache'
    PATH = (Join-Path $tools 'bin') + ';' + $env:PATH
}
$saved = @{}
foreach ($k in $overrides.Keys) { $saved[$k] = [Environment]::GetEnvironmentVariable($k, 'Process') }
try {
    foreach ($k in $overrides.Keys) { [Environment]::SetEnvironmentVariable($k, $overrides[$k], 'Process') }
    $wrapped = "cd /d `"$root`" && $Command"
    $cmdline = "cmd.exe /c `"$wrapped`""
    if ($Method -eq 'StartProcess') {
        $p = Start-Process cmd.exe -ArgumentList @('/c', "`"$wrapped`"") -WorkingDirectory $root -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput $out -RedirectStandardError $err
        $h = $p.Handle
        $done = $p.WaitForExit($TimeoutSec * 1000)
        if (!$done) { & taskkill.exe /PID $p.Id /T /F | Out-Null }
        $code = if ($done) { $p.ExitCode } else { 'TIMEOUT' }
    } else {
        $inner = "cmd.exe /c `"$wrapped > `"`"$out`"`" 2> `"`"$err`"`"`""
        $r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine = $inner; CurrentDirectory = $root}
        if ($r.ReturnValue -ne 0) { throw "Win32_Process.Create rv=$($r.ReturnValue)" }
        $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSec)
        while ((Get-Process -Id $r.ProcessId -ErrorAction SilentlyContinue) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep 2 }
        $code = if (Get-Process -Id $r.ProcessId -ErrorAction SilentlyContinue) { 'TIMEOUT' } else { 'unknown (CIM does not return exit code; read logs)' }
    }
} finally {
    foreach ($k in $saved.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k], 'Process') }
}
Write-Output "method=$Method exit=$code"
Write-Output "stdout=$out"
Write-Output "stderr=$err"
Get-Content -LiteralPath $out -Tail $Tail -ErrorAction SilentlyContinue
Get-Content -LiteralPath $err -Tail $Tail -ErrorAction SilentlyContinue
