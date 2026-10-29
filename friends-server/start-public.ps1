param([switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$runtimeDir = Join-Path $projectRoot '.runtime'
$localOrigin = 'http://127.0.0.1:8090'
$lockHandle = $null

function Write-Utf8File([string]$Path, [string]$Text) {
    [System.IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding($false)))
}

function Test-GameConfig([string]$Origin) {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri ($Origin + '/api/friends/config') -TimeoutSec 4
        $config = $response.Content | ConvertFrom-Json
        return $response.StatusCode -eq 200 -and $config.version -eq 1 -and $config.relayPath -eq '/relay' -and $config.engineReady -eq $true
    } catch { return $false }
}

function Test-PublicGame([string]$Origin) {
    if (-not (Test-GameConfig $Origin)) { return $false }
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri ($Origin + '/friends/') -TimeoutSec 4
        return $response.StatusCode -eq 200 -and $response.Content -match '<title>[^<]*(无名杀|同袍)[^<]*</title>'
    } catch { return $false }
}

function Get-PublicOrigin([string]$Address) {
    if ($Address -match '^https://([a-z0-9-]+\.trycloudflare\.com)(?:/friends/?)?$') {
        return 'https://' + $Matches[1]
    }
    return $null
}

function Read-TunnelOrigin([string[]]$Logs) {
    foreach ($currentLog in $Logs) {
        # Only the exact log files recorded for this process are considered.
        $logPath = [System.IO.Path]::GetFullPath($currentLog)
        $logParent = [System.IO.Path]::GetDirectoryName($logPath)
        if (-not [string]::Equals($logParent, $runtimeDir, [StringComparison]::OrdinalIgnoreCase)) { continue }
        if ([System.IO.Path]::GetFileName($logPath) -notmatch '^tunnel-\d{8}-\d{6}-\d{3}(?:\.stdout|\.stderr)?\.log$') { continue }
        if (Test-Path -LiteralPath $logPath -PathType Leaf) {
            $text = [System.IO.File]::ReadAllText($logPath)
            if ($text -match 'https://[a-z0-9-]+\.trycloudflare\.com') { return $Matches[0] }
        }
    }
    return $null
}

function Read-SavedProcess([string]$PidFile) {
    if (-not (Test-Path -LiteralPath $PidFile -PathType Leaf)) { return $null }
    $savedId = ([System.IO.File]::ReadAllText($PidFile)).Trim()
    if ($savedId -notmatch '^\d+$') { throw "进程记录格式错误：$PidFile" }
    return Get-Process -Id ([int]$savedId) -ErrorAction SilentlyContinue
}

function Open-Game([string]$Address, [string]$Shortcut) {
    if ($NoBrowser) { return }
    $edgeCandidates = @(
        (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
        (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
        (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\Application\msedge.exe')
    )
    $edgePath = $edgeCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    if ($edgePath) {
        Start-Process -FilePath $edgePath -ArgumentList $Address -WindowStyle Normal | Out-Null
    } else {
        Start-Process -FilePath $Shortcut -WindowStyle Normal | Out-Null
    }
}

try {
    New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
    try {
        $lockHandle = [System.IO.File]::Open((Join-Path $runtimeDir 'start-public.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
    } catch { throw '另一个公网启动器正在工作，请等待它完成后再试。' }

    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    if (Test-GameConfig $localOrigin) {
        Write-Host '本地游戏服务正常，复用现有服务。'
    } else {
        $savedServer = Read-SavedProcess (Join-Path $runtimeDir 'server.pid')
        if ($savedServer) {
            throw "已记录的本地服务进程仍在运行（PID $($savedServer.Id)），但游戏尚未就绪。请稍后重试并查看 .runtime 中的服务日志；不会重复启动。"
        }
        if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'apps/core/dist/index.html') -PathType Leaf)) {
            throw '游戏尚未构建，请先按 README.md 运行准备并启动好友版.cmd 或 node scripts/setup-friends.mjs --prepare-only。'
        }
        $nodeCommand = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $nodeCommand) { throw '未找到 Node.js，请先安装 Node.js 22.12 或更新版本。' }
        $nodePath = (Resolve-Path -LiteralPath $nodeCommand.Source).Path
        $serverScript = Join-Path $PSScriptRoot 'server.mjs'
        $serverOut = Join-Path $runtimeDir ("server-$stamp.stdout.log")
        $serverErr = Join-Path $runtimeDir ("server-$stamp.stderr.log")
        $previousPort = $env:PORT
        $previousHost = $env:HOST
        try {
            $env:PORT = '8090'
            $env:HOST = '0.0.0.0'
            $serverProcess = Start-Process -FilePath $nodePath -ArgumentList ('"' + $serverScript + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $serverOut -RedirectStandardError $serverErr -PassThru
        } finally {
            $env:PORT = $previousPort
            $env:HOST = $previousHost
        }
        Write-Utf8File (Join-Path $runtimeDir 'server.pid') ([string]$serverProcess.Id)
        $serverDeadline = [DateTime]::UtcNow.AddSeconds(20)
        do {
            if (Test-GameConfig $localOrigin) { break }
            $serverProcess.Refresh()
            if ($serverProcess.HasExited) { throw "本地服务启动失败，请查看 $serverErr" }
            Start-Sleep -Milliseconds 500
        } while ([DateTime]::UtcNow -lt $serverDeadline)
        if (-not (Test-GameConfig $localOrigin)) { throw "本地服务未能在等待时间内就绪，请查看 $serverErr 后重试。" }
        Write-Host '本地游戏服务已启动。'
    }

    $tunnelExecutable = Join-Path $runtimeDir 'tools/cloudflared.exe'
    if (-not (Test-Path -LiteralPath $tunnelExecutable -PathType Leaf)) {
        throw "缺少 Cloudflare 通道程序：$tunnelExecutable"
    }
    $tunnelExecutable = (Resolve-Path -LiteralPath $tunnelExecutable).Path
    $tunnelPidFile = Join-Path $runtimeDir 'tunnel.pid'
    $publicUrlFile = Join-Path $runtimeDir 'public-url.txt'
    $candidateFile = Join-Path $runtimeDir 'tunnel-candidate.json'
    $tunnelProcess = Read-SavedProcess $tunnelPidFile
    $publicOrigin = $null

    if ($tunnelProcess) {
        if (-not [string]::Equals($tunnelProcess.Path, $tunnelExecutable, [StringComparison]::OrdinalIgnoreCase)) {
            throw "tunnel.pid 指向的进程与本项目通道程序不一致（PID $($tunnelProcess.Id)），请检查进程记录；不会操作该进程。"
        }
        if (Test-Path -LiteralPath $publicUrlFile -PathType Leaf) {
            $publicOrigin = Get-PublicOrigin (([System.IO.File]::ReadAllText($publicUrlFile)).Trim())
        }
        if (Test-Path -LiteralPath $candidateFile -PathType Leaf) {
            try {
                $candidate = [System.IO.File]::ReadAllText($candidateFile) | ConvertFrom-Json
                if ([int]$candidate.pid -eq $tunnelProcess.Id) {
                    $candidateOrigin = Get-PublicOrigin ([string]$candidate.origin)
                    if (-not $candidateOrigin -and $candidate.logs) {
                        $candidateOrigin = Read-TunnelOrigin @($candidate.logs)
                    }
                    if ($candidateOrigin) { $publicOrigin = $candidateOrigin }
                }
            } catch { Write-Warning '无法读取上次候选地址，将检查已发布的网址。' }
        }
        if (-not $publicOrigin -or -not (Test-PublicGame $publicOrigin)) {
            throw "通道进程仍在运行（PID $($tunnelProcess.Id)），但公网入口暂不可用。请稍后重新运行本启动器；不会重复开启通道。"
        }
        Write-Host '现有公网通道正常，继续使用原网址。'
    } else {
        $tunnelLog = Join-Path $runtimeDir ("tunnel-$stamp.log")
        $tunnelOut = Join-Path $runtimeDir ("tunnel-$stamp.stdout.log")
        $tunnelErr = Join-Path $runtimeDir ("tunnel-$stamp.stderr.log")
        $tunnelArguments = 'tunnel --url http://127.0.0.1:8090 --no-autoupdate --protocol http2 --logfile "' + $tunnelLog + '"'
        $tunnelProcess = Start-Process -FilePath $tunnelExecutable -ArgumentList $tunnelArguments -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $tunnelOut -RedirectStandardError $tunnelErr -PassThru
        Write-Utf8File $tunnelPidFile ([string]$tunnelProcess.Id)
        $currentLogs = @($tunnelLog, $tunnelOut, $tunnelErr)
        Write-Utf8File $candidateFile (@{ pid = $tunnelProcess.Id; origin = $null; logs = $currentLogs } | ConvertTo-Json -Compress)
        Write-Host '正在建立临时公网通道，最多等待 30 秒获取新网址……'
        $tunnelDeadline = [DateTime]::UtcNow.AddSeconds(30)
        do {
            $tunnelProcess.Refresh()
            if ($tunnelProcess.HasExited) { throw "公网通道启动失败，请查看 $tunnelErr" }
            $publicOrigin = Read-TunnelOrigin $currentLogs
            if ($publicOrigin) { break }
            Start-Sleep -Milliseconds 500
        } while ([DateTime]::UtcNow -lt $tunnelDeadline)
        if (-not $publicOrigin) { throw "30 秒内未取得公网网址，通道进程仍保留。请稍后重试，启动器仅从本次通道日志恢复地址。详情见 $tunnelErr" }
        Write-Utf8File $candidateFile (@{ pid = $tunnelProcess.Id; origin = $publicOrigin; logs = $currentLogs } | ConvertTo-Json -Compress)
        Write-Host '新网址已取得，正在检查游戏页面……'
        $publicReady = $false
        $publicDeadline = [DateTime]::UtcNow.AddSeconds(25)
        do {
            if (Test-PublicGame $publicOrigin) { $publicReady = $true; break }
            $tunnelProcess.Refresh()
            if ($tunnelProcess.HasExited) { throw "公网通道已退出，请查看 $tunnelErr" }
            Start-Sleep -Milliseconds 800
        } while ([DateTime]::UtcNow -lt $publicDeadline)
        if (-not $publicReady) { throw '新公网地址尚未就绪。已保留本次通道及候选地址，请稍后重新运行启动器验证；不会覆盖原分享入口。' }
    }

    $publicAddress = $publicOrigin + '/friends/'
    $shortcutFile = Join-Path $projectRoot '本次公网联机.url'
    Write-Utf8File $publicUrlFile ($publicAddress + "`r`n")
    Write-Utf8File $shortcutFile ("[InternetShortcut]`r`nURL=" + $publicAddress + "`r`n")
    Write-Host "游戏已就绪：$publicAddress" -ForegroundColor Green
    Write-Host '可以关闭此启动窗口；游玩期间请保持电脑开机联网且不休眠。'
    Write-Host '临时网址在重建通道后会改变，请从游戏内重新分享房间邀请。'
    Open-Game $publicAddress $shortcutFile
} catch {
    Write-Host ('启动未完成：' + $_.Exception.Message) -ForegroundColor Red
    exit 1
} finally {
    if ($lockHandle) { $lockHandle.Dispose() }
}
