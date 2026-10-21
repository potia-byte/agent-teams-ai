[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$MatrixPath,
    [Parameter(Mandatory = $true)][string]$OutputPath
)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$allowed = (Join-Path $root '.local-tools') + [IO.Path]::DirectorySeparatorChar
foreach ($target in @($MatrixPath, $OutputPath)) {
    if (![IO.Path]::GetFullPath($target).StartsWith($allowed, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Diagnostic files must stay inside checkout/.local-tools'
    }
}
$matrix = Get-Content -Raw -LiteralPath $MatrixPath | ConvertFrom-Json
$start = ([DateTimeOffset]::Parse($matrix.startedAt)).LocalDateTime.AddSeconds(-30)
$end = ([DateTimeOffset]::Parse($matrix.endedAt)).LocalDateTime.AddSeconds(30)
$executables = @(@($matrix.host.executable) + @($matrix.results | ForEach-Object { $_.executable }) |
    Where-Object { $_ } | Select-Object -Unique)
$logs = @(
    'Microsoft-Windows-Windows Defender/Operational',
    'Microsoft-Windows-CodeIntegrity/Operational',
    'Microsoft-Windows-AppLocker/EXE and DLL',
    'Microsoft-Windows-Security-Mitigations/UserMode'
)
$reports = foreach ($log in $logs) {
    $availability = $null
    try {
        $info = Get-WinEvent -ListLog $log -ErrorAction Stop
        $availability = @{enabled=$info.IsEnabled;recordCount=$info.RecordCount}
        $events = @(Get-WinEvent -FilterHashtable @{LogName=$log; StartTime=$start; EndTime=$end} -MaxEvents 200 -ErrorAction Stop)
        $matches = foreach ($event in $events) {
            $message = $event.Message
            $matchingPaths = @($executables | Where-Object {
                $message.IndexOf($_, [StringComparison]::OrdinalIgnoreCase) -ge 0
            })
            if ($matchingPaths.Count -gt 0) {
                # Keep only identity/correlation fields, not unrelated command lines or users.
                @{id=$event.Id; recordId=$event.RecordId; time=$event.TimeCreated.ToUniversalTime().ToString('o');
                  provider=$event.ProviderName; matchingExecutables=$matchingPaths}
            }
        }
        @{log=$log; availability=$availability; state='queried'; returnedEvents=$events.Count; matchingEvents=@($matches)}
    } catch {
        $state = if ($_.FullyQualifiedErrorId -like 'NoMatchingEventsFound,*') { 'no_events_in_window' } else { 'unavailable' }
        @{log=$log; availability=$availability; state=$state; errorType=$_.Exception.GetType().FullName;
          errorId=$_.FullyQualifiedErrorId; message=$_.Exception.Message}
    }
}
$report = @{schemaVersion=1; matrixStartedAt=$matrix.startedAt; matrixEndedAt=$matrix.endedAt;
    queryStartedAt=$start.ToUniversalTime().ToString('o'); queryEndedAt=$end.ToUniversalTime().ToString('o');
    logs=@($reports); conclusion='No root-cause attribution; unavailable logs or no matches are not proof of absence.'}
[IO.File]::WriteAllText([IO.Path]::GetFullPath($OutputPath), ($report | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
$reports | ForEach-Object { Write-Output "$($_.log): $($_.state) $($_.errorId)" }
