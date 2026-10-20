[CmdletBinding()]
param([switch]$IncludeElectron)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$output = Join-Path $root '.local-tools/diagnostics'
[IO.Directory]::CreateDirectory($output) | Out-Null
$node = (Get-Command node.exe -ErrorAction Stop).Source
$git = (Get-Command git.exe -ErrorAction Stop).Source
$previousDirectory = Get-Location
try {
    Set-Location -LiteralPath $root
    $head = & $git rev-parse HEAD
    if ($LASTEXITCODE -ne 0) { throw 'Cannot resolve Git HEAD' }
    $changes = @(& $git status --porcelain)
    if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect Git working tree' }
    $overrides = foreach ($name in @('CLAUDE_DEV_RUNTIME_ROOT', 'CLAUDE_AGENT_TEAMS_ORCHESTRATOR_CLI_PATH',
            'CLAUDE_DEV_RUNTIME_CACHE_ROOT', 'CLAUDE_CLI_PATH', 'CLAUDE_TERMINAL_PLATFORM_ROOT',
            'TERMINAL_PLATFORM_ROOT', 'CLAUDE_TERMINAL_DAEMON_BINARY', 'CLAUDE_TERMINAL_PLATFORM_STAGE_DIR',
            'CLAUDE_TERMINAL_PLATFORM_DOWNLOAD_ROOT', 'ELECTRON_OVERRIDE_DIST_PATH', 'ELECTRON_RUN_AS_NODE',
            'AGENT_TEAMS_ELECTRON_USER_DATA_DIR', 'AGENT_TEAMS_ELECTRON_CLAUDE_ROOT',
            'CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'TEMP', 'TMP')) {
        @{name=$name;value=[Environment]::GetEnvironmentVariable($name, 'Process')}
    }
    $proxies = foreach ($name in @('HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY')) {
        $value = [Environment]::GetEnvironmentVariable($name, 'Process')
        $endpoint = $null
        if ($value) {
            try { $uri = [Uri]$value; $endpoint = "$($uri.Scheme)://$($uri.Host):$($uri.Port)" }
            catch { $endpoint = '[unparseable; value omitted]' }
        }
        @{name=$name;present=[bool]$value;endpoint=$endpoint}
    }
    $manifest = @{schemaVersion=1;at=[DateTime]::UtcNow.ToString('o');head=$head;changes=$changes;
        node=$node;git=$git;runtimeOverrides=@($overrides);proxies=@($proxies);
        nodeOptionsPresent=[bool]$env:NODE_OPTIONS;nodePathPresent=[bool]$env:NODE_PATH;
        proxyEnvironmentModified=$false;rootCause='not established'}
    [IO.File]::WriteAllText((Join-Path $output 'context.json'), ($manifest | ConvertTo-Json -Depth 6), [Text.UTF8Encoding]::new($false))
    & $node (Join-Path $PSScriptRoot 'spawn-matrix.mjs') --git-path $git --output (Join-Path $output 'spawn-node.json')
    if ($LASTEXITCODE -ne 0) { throw 'Node diagnostic runner failed before completing the matrix' }
    if ($IncludeElectron) {
        $previousElectronMode = [Environment]::GetEnvironmentVariable('ELECTRON_RUN_AS_NODE', 'Process')
        try {
            $env:ELECTRON_RUN_AS_NODE = '1'
            & (Join-Path $root 'node_modules/electron/dist/electron.exe') (Join-Path $PSScriptRoot 'spawn-matrix.mjs') --git-path $git --output (Join-Path $output 'spawn-electron-node.json')
        } finally {
            [Environment]::SetEnvironmentVariable('ELECTRON_RUN_AS_NODE', $previousElectronMode, 'Process')
        }
    }
    & (Join-Path $PSScriptRoot 'collect-protection-events.ps1') -MatrixPath (Join-Path $output 'spawn-node.json') -OutputPath (Join-Path $output 'protection-events.json')
    $matrix = Get-Content -Raw -Encoding UTF8 (Join-Path $output 'spawn-node.json') | ConvertFrom-Json
    $hashes = @($matrix.results | Select-Object -ExpandProperty executable -Unique | ForEach-Object {
        $hash = Get-FileHash -LiteralPath $_ -Algorithm SHA256
        @{path=$hash.Path;sha256=$hash.Hash}
    })
    [IO.File]::WriteAllText((Join-Path $output 'executable-hashes.json'), ($hashes | ConvertTo-Json -Depth 3), [Text.UTF8Encoding]::new($false))
    Write-Output "Diagnostic context saved to $output; proxy environment preserved."
} finally { Set-Location -LiteralPath $previousDirectory }
