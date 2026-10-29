$ErrorActionPreference = 'Stop'
$gameRoot = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $gameRoot '.runtime/tunnel.pid'
$tunnelBinary = [System.IO.Path]::GetFullPath((Join-Path $gameRoot '.runtime/tools/cloudflared.exe'))
if (-not (Test-Path -LiteralPath $pidFile)) { Write-Output 'No active game tunnel was recorded.'; exit 0 }
$tunnelPid = [int](Get-Content -LiteralPath $pidFile -Raw).Trim()
$tunnelProcess = Get-Process -Id $tunnelPid -ErrorAction SilentlyContinue
if (-not $tunnelProcess) { Write-Output 'The game tunnel has already stopped.'; exit 0 }
if (-not [string]::Equals($tunnelProcess.Path, $tunnelBinary, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'The recorded process is not this game tunnel. No process was stopped.'
}
Stop-Process -Id $tunnelPid
Write-Output 'The public game address is now closed. The local game server was not stopped.'
