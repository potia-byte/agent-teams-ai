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
    npm_config_devdir = Join-Path $toolRoot 'node-gyp'
    TEMP = Join-Path $toolRoot 'tmp'
    TMP = Join-Path $toolRoot 'tmp'
    CLAUDE_DEV_RUNTIME_CACHE_ROOT = Join-Path $toolRoot 'runtime-cache'
    CLAUDE_TERMINAL_PLATFORM_STAGE_DIR = Join-Path $projectRoot 'resources/terminal-platform'
    CLAUDE_TERMINAL_PLATFORM_DOWNLOAD_ROOT = Join-Path $toolRoot 'terminal-platform-download'
    AGENT_TEAMS_ELECTRON_USER_DATA_DIR = Join-Path $toolRoot 'state/electron'
    AGENT_TEAMS_ELECTRON_CLAUDE_ROOT = Join-Path $toolRoot 'state/claude'
    CLAUDE_CONFIG_DIR = Join-Path $toolRoot 'state/claude'
    CODEX_HOME = Join-Path $toolRoot 'state/codex'
    XDG_CONFIG_HOME = Join-Path $toolRoot 'state/xdg/config'
    XDG_CACHE_HOME = Join-Path $toolRoot 'state/xdg/cache'
    XDG_DATA_HOME = Join-Path $toolRoot 'state/xdg/data'
    XDG_STATE_HOME = Join-Path $toolRoot 'state/xdg/state'
}

function Invoke-ProjectPnpm {
    param([string[]]$PnpmArguments)
    # Windows PowerShell can turn ordinary native stderr into a terminating error
    # under Stop when the caller redirects output. Use the actual process exit code.
    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & corepack pnpm @PnpmArguments
        $commandExitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousPreference
    }
    if ($commandExitCode -ne 0) {
        throw "pnpm command failed with exit code $commandExitCode"
    }
}

try {
    Set-Location -LiteralPath $projectRoot
    if ($Action -in @('Dev', 'DevMcp')) {
        foreach ($name in @('CLAUDE_DEV_RUNTIME_ROOT', 'CLAUDE_AGENT_TEAMS_ORCHESTRATOR_CLI_PATH',
                'CLAUDE_CLI_PATH', 'CLAUDE_TERMINAL_PLATFORM_ROOT', 'TERMINAL_PLATFORM_ROOT',
                'CLAUDE_TERMINAL_DAEMON_BINARY', 'ELECTRON_OVERRIDE_DIST_PATH', 'ELECTRON_RUN_AS_NODE',
                'AGENT_TEAMS_ORG_DEMO')) {
            if ([Environment]::GetEnvironmentVariable($name, 'Process')) {
                throw "Inherited $name conflicts with the isolated pinned-runtime launch. No launch performed."
            }
        }
    }
    foreach ($name in $environmentOverrides.Keys) {
        $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
        [Environment]::SetEnvironmentVariable($name, $environmentOverrides[$name], 'Process')
        if ([IO.Path]::IsPathRooted($environmentOverrides[$name])) {
            [IO.Directory]::CreateDirectory($environmentOverrides[$name]) | Out-Null
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
        'Test' { Invoke-ProjectPnpm -PnpmArguments @('exec', 'vitest', 'run', '--maxWorkers=1', 'test/features/team-runtime-recovery', 'test/scripts/postinstallElectron.test.ts', 'test/scripts/ensureElectronInstall.test.ts', 'src/main/utils/electronDevPathOverrides.test.ts') }
        'Dev' { Invoke-ProjectPnpm -PnpmArguments @('dev') }
        'DevMcp' { Invoke-ProjectPnpm -PnpmArguments @('dev:mcp') }
    }
} finally {
    foreach ($name in $previousEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], 'Process')
    }
    Set-Location -LiteralPath $previousDirectory
}
