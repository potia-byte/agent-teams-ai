# Build and launch only this checkout; never enable global Corepack shims.
[CmdletBinding()]
param(
    [ValidateSet('Verify', 'Install', 'Build', 'Typecheck', 'Test', 'Dev', 'DevMcp')]
    [string]$Action = 'Verify'
)

$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$toolRoot = Join-Path $projectRoot '.local-tools'
$previousDirectory = Get-Location
$previousEnvironment = @{}
$environmentOverrides = @{
    COREPACK_HOME = Join-Path $toolRoot 'corepack'
    COREPACK_ENABLE_DOWNLOAD_PROMPT = '0'
    electron_config_cache = Join-Path $toolRoot 'electron-cache'
    npm_config_cache = Join-Path $toolRoot 'npm-cache'
    CLAUDE_DEV_RUNTIME_CACHE_ROOT = Join-Path $toolRoot 'runtime-cache'
    AGENT_TEAMS_ELECTRON_USER_DATA_DIR = Join-Path $toolRoot 'state/electron'
    AGENT_TEAMS_ELECTRON_CLAUDE_ROOT = Join-Path $toolRoot 'state/claude'
}

function Invoke-ProjectPnpm {
    param([string[]]$PnpmArguments)
    & corepack pnpm @PnpmArguments
    if ($LASTEXITCODE -ne 0) {
        throw "pnpm command failed with exit code $LASTEXITCODE"
    }
}

try {
    Set-Location -LiteralPath $projectRoot
    foreach ($name in $environmentOverrides.Keys) {
        $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
        [Environment]::SetEnvironmentVariable($name, $environmentOverrides[$name], 'Process')
    }
    # The owner's inherited localhost:9 proxy is broken. Preserve all other proxies.
    foreach ($name in @('HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY')) {
        $value = [Environment]::GetEnvironmentVariable($name, 'Process')
        if ($value -match '^http://127\.0\.0\.1:9/?$') {
            $previousEnvironment[$name] = $value
            [Environment]::SetEnvironmentVariable($name, $null, 'Process')
        }
    }
    $nodeVersion = & node -p 'process.versions.node'
    if ($LASTEXITCODE -ne 0) { throw 'Node.js is unavailable' }
    $parsedNode = [version]$nodeVersion
    if (!(($parsedNode.Major -eq 24 -and $parsedNode -ge [version]'24.15.0') -or
          $parsedNode.Major -eq 26)) {
        throw "Unsupported Node.js $nodeVersion; use 24.15+ (24.x) or 26.x"
    }
    $pnpmVersion = & corepack pnpm --version
    if ($LASTEXITCODE -ne 0 -or $pnpmVersion -ne '11.22.0') {
        throw "Expected project pnpm 11.22.0; received $pnpmVersion"
    }
    switch ($Action) {
        'Verify' { Write-Output "Node $nodeVersion; pnpm $pnpmVersion; checkout $projectRoot" }
        'Install' { Invoke-ProjectPnpm -PnpmArguments @('install', '--frozen-lockfile', '--store-dir', (Join-Path $toolRoot 'pnpm-store')) }
        'Build' { Invoke-ProjectPnpm -PnpmArguments @('build') }
        'Typecheck' { Invoke-ProjectPnpm -PnpmArguments @('typecheck') }
        'Test' { Invoke-ProjectPnpm -PnpmArguments @('exec', 'vitest', 'run', '--maxWorkers=1', 'test/features/team-runtime-recovery', 'test/scripts/postinstallElectron.test.ts', 'test/scripts/ensureElectronInstall.test.ts') }
        'Dev' { Invoke-ProjectPnpm -PnpmArguments @('dev') }
        'DevMcp' { Invoke-ProjectPnpm -PnpmArguments @('dev:mcp') }
    }
} finally {
    foreach ($name in $previousEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], 'Process')
    }
    Set-Location -LiteralPath $previousDirectory
}
