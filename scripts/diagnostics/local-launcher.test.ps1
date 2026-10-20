$ErrorActionPreference = 'Stop'
$launcher = Join-Path $PSScriptRoot '../media-company-local.ps1'
$saved = @{}
$names = @('HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'COREPACK_HOME', 'TEMP', 'TMP',
    'CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'CLAUDE_DEV_RUNTIME_CACHE_ROOT',
    'AGENT_TEAMS_ELECTRON_USER_DATA_DIR', 'AGENT_TEAMS_ELECTRON_CLAUDE_ROOT',
    'CLAUDE_AGENT_TEAMS_ORCHESTRATOR_CLI_PATH')
foreach ($name in $names) { $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
try {
    foreach ($name in @('HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY')) {
        [Environment]::SetEnvironmentVariable($name, 'http://127.0.0.1:9', 'Process')
    }
    & $launcher Verify
    foreach ($name in $names) {
        $expected = if ($name -in @('HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY')) { 'http://127.0.0.1:9' } else { $saved[$name] }
        if ([Environment]::GetEnvironmentVariable($name, 'Process') -cne $expected) {
            throw "Environment not preserved: $name"
        }
    }
    [Environment]::SetEnvironmentVariable('CLAUDE_AGENT_TEAMS_ORCHESTRATOR_CLI_PATH', 'C:\outside-test-only\untrusted.exe', 'Process')
    $blocked = $false
    try { & $launcher DevMcp } catch {
        if ($_.Exception.Message -like 'Inherited * conflicts with the isolated pinned-runtime launch*') {
            $blocked = $true
        } else { throw }
    }
    if (!$blocked) { throw 'An inherited runtime override was not blocked before launch' }
    Write-Output 'PASS: proxy preservation, environment restoration, inherited runtime override rejected before launch'
} finally {
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
}
