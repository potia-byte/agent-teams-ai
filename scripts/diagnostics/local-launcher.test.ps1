$ErrorActionPreference = 'Stop'
$launcher = Join-Path $PSScriptRoot '../media-company-local.ps1'
$saved = @{}
$names = @('HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'COREPACK_HOME', 'TEMP', 'TMP',
    'CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'CLAUDE_DEV_RUNTIME_CACHE_ROOT',
    'AGENT_TEAMS_ELECTRON_USER_DATA_DIR', 'AGENT_TEAMS_ELECTRON_CLAUDE_ROOT',
    'CLAUDE_AGENT_TEAMS_ORCHESTRATOR_CLI_PATH', 'AGENT_TEAMS_INSTALL_PROFILE')
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
    # Test the install boundary without running an installer or accessing the network.
    $installCalls = [Collections.Generic.List[object]]::new()
    function corepack {
        & node --version > $null
        if ($args.Count -eq 2 -and $args[1] -eq '--version') { '11.22.0'; return }
        if ($args.Count -gt 2 -and $args[0] -eq 'pnpm' -and $args[1] -eq 'install') {
            $installCalls.Add(@{profile=$env:AGENT_TEAMS_INSTALL_PROFILE;arguments=@($args)})
            return
        }
        throw 'Unexpected command in stubbed install boundary test'
    }
    & $launcher Install
    if ($installCalls.Count -ne 1 -or $installCalls[0].profile -ne 'node-ci' -or
        $installCalls[0].arguments -notcontains '--frozen-lockfile') {
        throw 'Install did not preserve the isolated node-ci/frozen-lockfile boundary'
    }
    if ([Environment]::GetEnvironmentVariable('AGENT_TEAMS_INSTALL_PROFILE', 'Process') -cne $saved['AGENT_TEAMS_INSTALL_PROFILE']) {
        throw 'Install profile was not restored'
    }
    Write-Output 'PASS: proxy/environment preservation; override rejection; node-ci/frozen install boundary (pnpm stub, no installation)'
} finally {
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
}
