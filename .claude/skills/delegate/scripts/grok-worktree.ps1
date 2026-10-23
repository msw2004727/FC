# grok-worktree.ps1 — FC 版
# PowerShell 5.1。建 detached worktree、node_modules junction、UTF-8 BOM 卡片、
# info/exclude、隔離用 run.ps1，以及依安全順序拆除。
# -Repo 預設為腳本所在專案根（往上找到 .git 的那一層）。

param(
    [Parameter(Position=0, Mandatory=$true)]
    [ValidateSet('up','down')]
    [string]$Command,

    [string]$Repo,
    [string]$Name,
    [string]$Root,

    [string]$Card,

    # $Input 是自動變數，不能當參數名。-Input 經由別名綁到 $InputPath。
    [Alias('Input')]
    [string[]]$InputPath,

    [int]$MaxTurns = 70,
    [string]$Effort = 'xhigh',
    [switch]$NoRun,
    [string]$Prompt,

    [string]$Save,
    [switch]$Force
)

Set-StrictMode -Version 2
$ErrorActionPreference = 'Continue'

# 在任何子程序隔離之前抓住呼叫端環境。不寫死使用者名稱。
$script:RealUserProfile = [string]$env:USERPROFILE
if (-not [string]::IsNullOrWhiteSpace([string]$env:GROK_HOME)) {
    $script:RealGrokHome = [string]$env:GROK_HOME
} else {
    $script:RealGrokHome = ''
}

function Fail {
    param([string]$Message)
    Write-Error $Message
    exit 1
}

if ([string]::IsNullOrWhiteSpace($script:RealUserProfile)) {
    Fail 'USERPROFILE 未設定，無法決定 GROK_HOME 與 GIT_CONFIG_GLOBAL。'
}
if ([string]::IsNullOrWhiteSpace($script:RealGrokHome)) {
    $script:RealGrokHome = Join-Path $script:RealUserProfile '.grok'
}
$script:RealGitConfig = Join-Path $script:RealUserProfile '.gitconfig'
$script:RealGrokExe = Join-Path $script:RealGrokHome 'bin\grok.exe'

function ConvertTo-PsLiteral {
    param([string]$Text)
    return "'" + $Text.Replace("'", "''") + "'"
}

function Resolve-FullPath {
    param([string]$PathValue)
    if ([string]::IsNullOrWhiteSpace($PathValue)) {
        Fail '路徑是空的。'
    }
    if (-not [System.IO.Path]::IsPathRooted($PathValue)) {
        $PathValue = Join-Path (Get-Location).Path $PathValue
    }
    return [System.IO.Path]::GetFullPath($PathValue)
}

# --- repo resolve: FC ---
function Resolve-RepoParameter {
    param([string]$RepoArg)
    $fallback = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..\..'))
    $dir = $PSScriptRoot
    $found = ''
    while ($true) {
        if (Test-Path -LiteralPath (Join-Path $dir '.git')) {
            $found = $dir
            break
        }
        $parent = Split-Path -Parent $dir
        if ([string]::IsNullOrEmpty($parent) -or $parent -eq $dir) { break }
        $dir = $parent
    }
    if ([string]::IsNullOrWhiteSpace($found)) { $found = $fallback }
    if ([string]::IsNullOrWhiteSpace($RepoArg)) { return $found }
    return (Resolve-FullPath $RepoArg)
}
# --- end repo resolve ---

function Test-ReparsePoint {
    param([string]$LiteralPath)
    $item = Get-Item -LiteralPath $LiteralPath -Force
    return ([int]($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)
}

function Get-JunctionTarget {
    param([System.IO.FileSystemInfo]$Item)
    $prop = $Item.PSObject.Properties['Target']
    if ($null -eq $prop -or $null -eq $prop.Value) { return '' }
    $values = @($prop.Value)
    if ($values.Count -lt 1 -or $null -eq $values[0]) { return '' }
    return [string]$values[0]
}

function Expand-InputList {
    param($Raw)
    $result = New-Object System.Collections.Generic.List[string]
    if ($null -eq $Raw) {
        $script:ExpandedInputs = $result
        return
    }
    foreach ($item in @($Raw)) {
        if ($null -eq $item) { continue }
        $text = [string]$item
        if ([string]::IsNullOrWhiteSpace($text)) { continue }
        $pieces = @($text)
        # powershell.exe -File 會把 a.md,b.md 收成一個字串。路徑本身含逗號且檔案存在時不拆。
        if ($text.Contains(',') -and -not (Test-Path -LiteralPath $text)) {
            $pieces = $text.Split(',')
        }
        foreach ($piece in @($pieces)) {
            if ($null -eq $piece) { continue }
            $trim = ([string]$piece).Trim()
            if (-not [string]::IsNullOrWhiteSpace($trim)) {
                [void]$result.Add($trim)
            }
        }
    }
    # 直接放進 script scope，避免函數回傳 List 時被 PowerShell 展開成 $null。
    $script:ExpandedInputs = $result
}

function Assert-SafeName {
    param([string]$Leaf)
    if ([string]::IsNullOrWhiteSpace($Leaf) -or $Leaf -eq '.' -or $Leaf -eq '..') {
        Fail "Name 不合法: $Leaf"
    }
    $invalid = [System.IO.Path]::GetInvalidFileNameChars()
    foreach ($ch in $invalid) {
        if ($Leaf.IndexOf($ch) -ge 0) {
            Fail "Name 含非法字元: $Leaf"
        }
    }
    if ($Leaf.EndsWith(' ') -or $Leaf.EndsWith('.')) {
        Fail "Name 不可以空白或點結尾: $Leaf"
    }
}

function Invoke-GitChecked {
    param([string[]]$GitArgs, [string]$What)
    $script:GitLines = New-Object System.Collections.Generic.List[string]
    $output = & git @GitArgs 2>&1
    $code = $LASTEXITCODE
    if ($null -ne $output) {
        foreach ($line in @($output)) {
            if ($null -ne $line) { [void]$script:GitLines.Add([string]$line) }
        }
    }
    if ($code -ne 0) {
        $detail = ''
        if ($script:GitLines.Count -gt 0) {
            $detail = ' ' + ($script:GitLines -join ' | ')
        }
        Fail ($What + " 失敗 (exit $code)。" + $detail)
    }
}

function Add-ExcludeLines {
    param([string]$ExcludePath, [string[]]$Needed)
    $dir = Split-Path -Parent $ExcludePath
    if (-not (Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Path $dir | Out-Null
    }
    $text = ''
    if (Test-Path -LiteralPath $ExcludePath) {
        $bytes = [System.IO.File]::ReadAllBytes($ExcludePath)
        $text = [System.Text.Encoding]::ASCII.GetString($bytes)
    }
    $existing = New-Object 'System.Collections.Generic.HashSet[string]'
    foreach ($part in ($text -split "`r`n|`n|`r")) {
        [void]$existing.Add($part)
    }
    $append = ''
    foreach ($line in $Needed) {
        if (-not $existing.Contains($line)) {
            $append = $append + $line + "`n"
        }
    }
    if ($append.Length -eq 0) { return }
    if ($text.Length -gt 0 -and -not ($text.EndsWith("`n") -or $text.EndsWith("`r"))) {
        $append = "`n" + $append
    }
    $ascii = New-Object System.Text.ASCIIEncoding
    $addBytes = $ascii.GetBytes($append)
    $fs = New-Object System.IO.FileStream($ExcludePath, [System.IO.FileMode]::Append, [System.IO.FileAccess]::Write, [System.IO.FileShare]::Read)
    try {
        $fs.Write($addBytes, 0, $addBytes.Length)
    } finally {
        $fs.Close()
    }
}

function Copy-IntoGrokInput {
    param([string]$Source, [string]$DestDir)
    $leaf = Split-Path -Leaf $Source
    $dest = Join-Path $DestDir $leaf
    $ext = [System.IO.Path]::GetExtension($Source).ToLowerInvariant()
    $binary = @('.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf', '.ico')
    $isBinary = $false
    foreach ($one in $binary) {
        if ($ext -eq $one) { $isBinary = $true }
    }
    if ($isBinary) {
        [System.IO.File]::Copy($Source, $dest, $true)
        return
    }
    $text = [System.IO.File]::ReadAllText($Source, [System.Text.Encoding]::UTF8)
    $utf8Bom = New-Object System.Text.UTF8Encoding $true
    [System.IO.File]::WriteAllText($dest, $text, $utf8Bom)
}

function Test-ExcludedArea {
    param([string]$RelativePath)
    $norm = ($RelativePath -replace '\\', '/').TrimEnd('/')
    if ($norm -eq '.grok-input' -or $norm.StartsWith('.grok-input/')) { return $true }
    if ($norm -eq 'out' -or $norm.StartsWith('out/')) { return $true }
    return $false
}

function Get-PorcelainEntries {
    param([string]$Worktree)
    # quotepath=false 只影響這次呼叫，不改 git config。
    $output = & git -C $Worktree -c core.quotepath=false status --porcelain
    if ($LASTEXITCODE -ne 0) {
        Fail "git status --porcelain 失敗 (exit $LASTEXITCODE)。"
    }
    $script:Porcelain = New-Object System.Collections.Generic.List[object]
    if ($null -eq $output) { return }
    foreach ($line in @($output)) {
        if ($null -eq $line) { continue }
        $text = [string]$line
        if ($text.Length -lt 4) { continue }
        $xy = $text.Substring(0, 2)
        $path = $text.Substring(3)
        $arrow = ' -> '
        $idx = $path.LastIndexOf($arrow)
        if ($idx -ge 0) { $path = $path.Substring($idx + $arrow.Length) }
        if ($path.StartsWith('"') -and $path.EndsWith('"') -and $path.Length -ge 2) {
            $path = $path.Substring(1, $path.Length - 2).Replace('\"', '"').Replace('\\', '\')
        }
        $path = $path.TrimEnd('/', '\')
        $entry = New-Object psobject
        $entry | Add-Member NoteProperty XY $xy
        $entry | Add-Member NoteProperty Path $path
        [void]$script:Porcelain.Add($entry)
    }
}

function Copy-TreeSafe {
    param([string]$Source, [string]$Destination)
    $item = Get-Item -LiteralPath $Source -Force
    if (Test-ReparsePoint $Source) {
        if (-not $item.PSIsContainer) {
            Fail "不支援檔案型 reparse point，拒絕複製: $Source"
        }
        $target = Get-JunctionTarget $item
        if ([string]::IsNullOrWhiteSpace($target)) {
            Fail "讀不到 junction 目標，拒絕複製: $Source"
        }
        $parent = Split-Path -Parent $Destination
        if (-not [string]::IsNullOrWhiteSpace($parent) -and -not (Test-Path -LiteralPath $parent)) {
            New-Item -ItemType Directory -Path $parent -Force | Out-Null
        }
        if (Test-Path -LiteralPath $Destination) {
            Fail "儲存位置已存在，拒絕覆蓋: $Destination"
        }
        # 只重建連結，不跟著複製目標內容（避免把 node_modules 整包複製或刪掉）。
        New-Item -ItemType Junction -Path $Destination -Target $target | Out-Null
        return
    }
    if ($item.PSIsContainer) {
        if (-not (Test-Path -LiteralPath $Destination)) {
            New-Item -ItemType Directory -Path $Destination -Force | Out-Null
        }
        $children = @(Get-ChildItem -LiteralPath $Source -Force)
        foreach ($child in $children) {
            if ($null -eq $child) { continue }
            Copy-TreeSafe $child.FullName (Join-Path $Destination $child.Name)
        }
        return
    }
    $parent = Split-Path -Parent $Destination
    if (-not [string]::IsNullOrWhiteSpace($parent) -and -not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    Copy-Item -LiteralPath $Source -Destination $Destination -Force
}

function Save-WorktreeChanges {
    param([string]$Worktree, [string]$SaveDir)
    $saveFull = Resolve-FullPath $SaveDir
    $wtFull = [System.IO.Path]::GetFullPath($Worktree)
    $saveCmp = $saveFull.TrimEnd('\')
    $wtCmp = $wtFull.TrimEnd('\')
    if ($saveCmp.Equals($wtCmp, [System.StringComparison]::OrdinalIgnoreCase) -or $saveCmp.StartsWith($wtCmp + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
        Fail "-Save 不可放在工作樹裡面: $saveFull"
    }
    if (-not (Test-Path -LiteralPath $saveFull)) {
        New-Item -ItemType Directory -Path $saveFull -Force | Out-Null
    }
    Get-PorcelainEntries $Worktree
    foreach ($entry in $script:Porcelain) {
        if ($null -eq $entry) { continue }
        $rel = [string]$entry.Path
        if ([string]::IsNullOrWhiteSpace($rel)) { continue }
        $src = Join-Path $Worktree ($rel -replace '/', '\')
        if (-not (Test-Path -LiteralPath $src)) { continue }
        # 路徑在 junction 裡面時只重建那個連結，不把目標檔複製出來，也不寫回目標。
        $reparseRoot = ''
        $acc = $wtFull
        foreach ($part in ($rel -split '[\\/]')) {
            if ([string]::IsNullOrWhiteSpace($part)) { continue }
            $acc = Join-Path $acc $part
            if ((Test-Path -LiteralPath $acc) -and (Test-ReparsePoint $acc)) {
                $reparseRoot = [System.IO.Path]::GetFullPath($acc)
                break
            }
        }
        if (-not [string]::IsNullOrWhiteSpace($reparseRoot)) {
            $prefix = $wtCmp + '\'
            if (-not $reparseRoot.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
                Fail "junction 不在工作樹內，拒絕複製: $reparseRoot"
            }
            $relRoot = $reparseRoot.Substring($prefix.Length)
            # 不在 Save 重建 junction。之後若對該資料夾 Remove-Item -Recurse，會跟著刪掉真正的 node_modules。
            $notePath = Join-Path $saveFull ($relRoot + '.junction.txt')
            $noteParent = Split-Path -Parent $notePath
            if (-not [string]::IsNullOrWhiteSpace($noteParent) -and -not (Test-Path -LiteralPath $noteParent)) {
                New-Item -ItemType Directory -Path $noteParent -Force | Out-Null
            }
            if (-not (Test-Path -LiteralPath $notePath)) {
                $linkItem = Get-Item -LiteralPath $reparseRoot -Force
                $linkTarget = Get-JunctionTarget $linkItem
                $utf8BomNote = New-Object System.Text.UTF8Encoding $true
                [System.IO.File]::WriteAllText($notePath, ($linkTarget + "`r`n"), $utf8BomNote)
            }
            continue
        }
        $dst = Join-Path $saveFull ($rel -replace '/', '\')
        Copy-TreeSafe $src $dst
    }
    $diffOut = & git -C $Worktree -c core.quotepath=false diff
    if ($LASTEXITCODE -ne 0) { Fail "git diff 失敗 (exit $LASTEXITCODE)。" }
    $statusOut = & git -C $Worktree -c core.quotepath=false status --short
    if ($LASTEXITCODE -ne 0) { Fail "git status --short 失敗 (exit $LASTEXITCODE)。" }
    $utf8Bom = New-Object System.Text.UTF8Encoding $true
    $diffText = ''
    if ($null -ne $diffOut) { $diffText = (@($diffOut) -join "`n") + "`n" }
    $statusText = ''
    if ($null -ne $statusOut) { $statusText = (@($statusOut) -join "`n") + "`n" }
    [System.IO.File]::WriteAllText((Join-Path $saveFull 'git-diff.txt'), $diffText, $utf8Bom)
    [System.IO.File]::WriteAllText((Join-Path $saveFull 'git-status-short.txt'), $statusText, $utf8Bom)
    Write-Output ("已儲存變更: " + $saveFull)
}

function New-JunctionRecord {
    param([string]$Link, [string]$Target)
    $obj = New-Object psobject
    $obj | Add-Member NoteProperty path ([System.IO.Path]::GetFullPath($Link))
    $obj | Add-Member NoteProperty target ([System.IO.Path]::GetFullPath($Target))
    return $obj
}

function ConvertTo-JunctionArray {
    param($Raw)
    $list = New-Object System.Collections.Generic.List[object]
    if ($null -ne $Raw) {
        foreach ($item in @($Raw)) {
            if ($null -ne $item) { [void]$list.Add($item) }
        }
    }
    $script:JunctionList = $list
}

function Read-StateFile {
    param([string]$Path)
    $raw = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
    try {
        return ($raw | ConvertFrom-Json)
    } catch {
        Fail ("狀態檔無法解析: " + $Path + " " + $_.Exception.Message)
    }
}

function Get-StateProp {
    param($Object, [string]$PropName)
    $prop = $Object.PSObject.Properties[$PropName]
    if ($null -eq $prop) { return $null }
    return $prop.Value
}

function Remove-HomeFolder {
    param([string]$RootFull, [string]$HomeFull)
    if (-not (Test-Path -LiteralPath $HomeFull)) {
        Write-Output ("HOME 不存在，略過: " + $HomeFull)
        return
    }
    $rootCmp = [System.IO.Path]::GetFullPath($RootFull).TrimEnd('\')
    $homeCmp = [System.IO.Path]::GetFullPath($HomeFull)
    if (-not $homeCmp.StartsWith($rootCmp + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
        Fail "拒絕刪除 Root 之外的 HOME: $homeCmp"
    }
    $leaf = Split-Path -Leaf $homeCmp
    if (-not $leaf.EndsWith('-home')) {
        Fail "拒絕刪除名稱不是 -home 結尾的資料夾: $homeCmp"
    }
    if (Test-ReparsePoint $homeCmp) {
        Fail "HOME 是 reparse point，拒絕 Remove-Item: $homeCmp"
    }
    Remove-Item -LiteralPath $homeCmp -Recurse -Force
    if (Test-Path -LiteralPath $homeCmp) {
        Fail "HOME 刪除後仍存在: $homeCmp"
    }
    Write-Output ("已刪除 HOME: " + $homeCmp)
}

function New-RunScript {
    param(
        [string]$RunPath,
        [string]$Worktree,
        [string]$HomeFull,
        [string]$PromptText,
        [string]$EffortText,
        [int]$Turns,
        [string]$OutJson,
        [string]$ErrTxt,
        [string]$ExitTxt
    )
    $deny = @(
        'Bash(curl*)',
        'Bash(*https://*)',
        'Bash(git push*)',
        'Bash(git checkout*)',
        'Bash(git reset*)',
        'Bash(git stash*)',
        'Bash(git commit*)',
        'Bash(git rebase*)',
        'Bash(rm -rf*)',
        'Bash(gh *)',
        'Bash(gcloud*)',
        'Bash(firebase*)',
        'Bash(ssh*)',
        'Bash(npm*)',
        'Bash(*vite build*)'
    )
    $grokHomeForChild = Join-Path $script:RealUserProfile '.grok'
    $promptArg = '"' + $PromptText.Replace('"', '\"') + '"'
    $cwdArg = '"' + $Worktree + '"'
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.AppendLine('# Generated by grok-worktree.ps1. Isolated HOME, fixed GROK_HOME, deny list.')
    [void]$sb.AppendLine('$ErrorActionPreference = ''Continue''')
    [void]$sb.AppendLine('$wt = ' + (ConvertTo-PsLiteral $Worktree))
    [void]$sb.AppendLine('$home2 = ' + (ConvertTo-PsLiteral $HomeFull))
    [void]$sb.AppendLine('$env:GROK_HOME = ' + (ConvertTo-PsLiteral $grokHomeForChild))
    [void]$sb.AppendLine('$env:GIT_CONFIG_GLOBAL = ' + (ConvertTo-PsLiteral $script:RealGitConfig))
    [void]$sb.AppendLine('$env:USERPROFILE = $home2')
    [void]$sb.AppendLine('$env:HOME = $home2')
    [void]$sb.AppendLine('New-Item -ItemType File -Force -Path (Join-Path $home2 ''nul.txt'') | Out-Null')
    [void]$sb.AppendLine('$deny = @(')
    $denyLiterals = @(foreach ($rule in $deny) {
        ConvertTo-PsLiteral $rule
    })
    [void]$sb.AppendLine('  ' + ($denyLiterals -join ",`r`n  "))
    [void]$sb.AppendLine(')')
    [void]$sb.AppendLine('$a = @(')
    [void]$sb.AppendLine("  '-p', " + (ConvertTo-PsLiteral $promptArg) + ',')
    [void]$sb.AppendLine("  '--cwd', " + (ConvertTo-PsLiteral $cwdArg) + ',')
    [void]$sb.AppendLine("  '-m', 'grok-4.7',")
    [void]$sb.AppendLine("  '--effort', " + (ConvertTo-PsLiteral $EffortText) + ',')
    [void]$sb.AppendLine("  '--disable-web-search', '--no-subagents', '--always-approve', '--allow', 'Bash'")
    [void]$sb.AppendLine(')')
    [void]$sb.AppendLine('foreach ($d in $deny) { $a += ''--deny''; $a += "`"$d`"" }')
    [void]$sb.AppendLine('$a += @(''--output-format'', ''json'', ''--max-turns'', ' + (ConvertTo-PsLiteral ([string]$Turns)) + ')')
    [void]$sb.AppendLine(
        '$p = Start-Process -FilePath ' + (ConvertTo-PsLiteral $script:RealGrokExe) +
        ' -ArgumentList $a -NoNewWindow -Wait -PassThru' +
        ' -RedirectStandardInput (Join-Path $home2 ''nul.txt'')' +
        ' -RedirectStandardOutput ' + (ConvertTo-PsLiteral $OutJson) +
        ' -RedirectStandardError ' + (ConvertTo-PsLiteral $ErrTxt)
    )
    [void]$sb.AppendLine('Set-Content -LiteralPath ' + (ConvertTo-PsLiteral $ExitTxt) + ' -Value $p.ExitCode -Encoding ASCII')
    $utf8Bom = New-Object System.Text.UTF8Encoding $true
    [System.IO.File]::WriteAllText($RunPath, $sb.ToString(), $utf8Bom)
    $tokens = $null
    $errors = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile($RunPath, [ref]$tokens, [ref]$errors)
    if ($errors.Count -gt 0) {
        foreach ($parseError in $errors) {
            [Console]::Error.WriteLine(
                ('{0}:{1}: {2}' -f $RunPath, $parseError.Extent.StartLineNumber, $parseError.Message)
            )
        }
        exit 1
    }
}

function Format-CmdPath {
    param([string]$PathValue)
    if ($PathValue -match '[\s"]') {
        return '"' + $PathValue.Replace('"', '\"') + '"'
    }
    return $PathValue
}

function Write-UpBanner {
    param([string]$ScriptPath)
    $manual = 'powershell -NoProfile -File ' + (Format-CmdPath $script:RunPath)
    $wait = "while (-not (Test-Path -LiteralPath " + (ConvertTo-PsLiteral $script:ExitTxt) + ")) { Start-Sleep -Seconds 2 }; Get-Content -LiteralPath " + (ConvertTo-PsLiteral $script:ExitTxt)
    $down = 'powershell -NoProfile -File ' + (Format-CmdPath $ScriptPath) + ' down -Name ' + (Format-CmdPath $script:BaseName) + ' -Root ' + (Format-CmdPath $script:RootFull) + ' -Repo ' + (Format-CmdPath $script:RepoFull)
    Write-Output '--- grok-worktree up ---'
    Write-Output ("工作樹: " + $script:Wt)
    Write-Output ("run.ps1: " + $script:RunPath)
    Write-Output ("stdout: " + $script:OutJson)
    Write-Output ("stderr: " + $script:ErrTxt)
    Write-Output ("exit: " + $script:ExitTxt)
    Write-Output ("狀態檔: " + $script:StatePath)
    Write-Output ("HOME: " + $script:EmptyHome)
    Write-Output ("手動啟動: " + $manual)
    Write-Output ("等待完成: " + $wait)
    Write-Output ("拆除: " + $down)
    if ($NoRun) {
        Write-Output '未啟動 grok（-NoRun）。'
    }
}

function Start-GrokUp {
    if ([string]::IsNullOrWhiteSpace($Card)) { Fail 'up 需要 -Card（主卡路徑）。' }
    $cardFull = Resolve-FullPath $Card
    if (-not (Test-Path -LiteralPath $cardFull -PathType Leaf)) { Fail "找不到主卡: $cardFull" }
    Expand-InputList $InputPath
    $seen = New-Object 'System.Collections.Generic.HashSet[string]'
    [void]$seen.Add((Split-Path -Leaf $cardFull).ToLowerInvariant())
    $inputFull = New-Object System.Collections.Generic.List[string]
    foreach ($one in $script:ExpandedInputs) {
        $full = Resolve-FullPath ([string]$one)
        if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { Fail "找不到 -Input 檔: $full" }
        $leaf = (Split-Path -Leaf $full).ToLowerInvariant()
        if (-not $seen.Add($leaf)) { Fail "輸入檔檔名重複: $leaf" }
        [void]$inputFull.Add($full)
    }
    if ([string]::IsNullOrWhiteSpace($Prompt)) {
        $leafName = Split-Path -Leaf $cardFull
        $script:PromptText = "Read .grok-input/$leafName (UTF-8 with BOM) and do exactly what it says. Keep .grok-input/REPORT.md updated after each finished item."
    } else {
        $script:PromptText = $Prompt
    }
    if ($MaxTurns -lt 1) { Fail "-MaxTurns 必須 >= 1" }
    if ([string]::IsNullOrWhiteSpace($Effort)) { Fail '-Effort 是空的。' }

    Invoke-GitChecked @('-C', $script:RepoFull, 'rev-parse', '--is-inside-work-tree') '確認 git repo'
    if (Test-Path -LiteralPath $script:Wt) { Fail "工作樹路徑已存在: $($script:Wt)" }
    if (Test-Path -LiteralPath $script:StatePath) { Fail "狀態檔已存在: $($script:StatePath)" }
    if (Test-Path -LiteralPath $script:EmptyHome) { Fail "HOME 路徑已存在: $($script:EmptyHome)" }

    Invoke-GitChecked @('-C', $script:RepoFull, 'worktree', 'add', '--detach', $script:Wt, 'HEAD') 'git worktree add'

    $script:JunctionList = New-Object System.Collections.Generic.List[object]
    $relTargets = @('node_modules', 'functions\node_modules')
    foreach ($rel in $relTargets) {
        $target = Join-Path $script:RepoFull $rel
        if (-not (Test-Path -LiteralPath $target)) {
            Write-Warning ("略過 junction，目標不存在: " + $target)
            Write-Output ("略過 junction，目標不存在: " + $target)
            continue
        }
        $link = Join-Path $script:Wt $rel
        $parent = Split-Path -Parent $link
        if (-not (Test-Path -LiteralPath $parent)) {
            New-Item -ItemType Directory -Path $parent -Force | Out-Null
        }
        if (Test-Path -LiteralPath $link) { Fail "junction 路徑已存在: $link" }
        New-Item -ItemType Junction -Path $link -Target $target | Out-Null
        if (-not (Test-ReparsePoint $link)) { Fail "建立後不是 reparse point: $link" }
        [void]$script:JunctionList.Add((New-JunctionRecord $link $target))
        Write-Output ("junction: " + $link + " -> " + $target)
    }

    $grokIn = Join-Path $script:Wt '.grok-input'
    New-Item -ItemType Directory -Path $grokIn -Force | Out-Null
    Copy-IntoGrokInput $cardFull $grokIn
    foreach ($full in @($inputFull)) {
        Copy-IntoGrokInput ([string]$full) $grokIn
    }

    Invoke-GitChecked @('-C', $script:Wt, 'rev-parse', '--git-common-dir') 'git rev-parse --git-common-dir'
    if ($script:GitLines.Count -lt 1) { Fail 'git rev-parse --git-common-dir 沒有輸出。' }
    $common = [string]$script:GitLines[0]
    if (-not [System.IO.Path]::IsPathRooted($common)) {
        $common = Join-Path $script:Wt $common
    }
    $common = [System.IO.Path]::GetFullPath($common)
    $excludePath = Join-Path (Join-Path $common 'info') 'exclude'
    Add-ExcludeLines $excludePath @('.grok-input/', '/out/')

    New-Item -ItemType Directory -Path $script:EmptyHome -Force | Out-Null
    $nulFile = Join-Path $script:EmptyHome 'nul.txt'
    New-Item -ItemType File -Force -Path $nulFile | Out-Null
    # Test-Path 對 nul.txt 會誤判（Windows 保留裝置名）。用 File.Exists。
    if (-not [System.IO.File]::Exists($nulFile)) { Fail "無法建立 nul.txt: $nulFile" }

    $junctionCopy = @()
    foreach ($j in $script:JunctionList) {
        if ($null -ne $j) { $junctionCopy += $j }
    }
    $stateObj = New-Object psobject
    $stateObj | Add-Member NoteProperty repo $script:RepoFull
    $stateObj | Add-Member NoteProperty worktree $script:Wt
    $stateObj | Add-Member NoteProperty junctions $junctionCopy
    $stateObj | Add-Member NoteProperty home $script:EmptyHome
    $stateObj | Add-Member NoteProperty createdAt ([DateTime]::Now.ToString('o'))
    $json = ConvertTo-Json -InputObject $stateObj -Depth 5
    $utf8Bom = New-Object System.Text.UTF8Encoding $true
    [System.IO.File]::WriteAllText($script:StatePath, $json, $utf8Bom)

    New-RunScript $script:RunPath $script:Wt $script:EmptyHome $script:PromptText $Effort $MaxTurns $script:OutJson $script:ErrTxt $script:ExitTxt

    if (-not $NoRun) {
        $quotedRun = Format-CmdPath $script:RunPath
        try {
            Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-File', $quotedRun) -WindowStyle Hidden | Out-Null
        } catch {
            Fail ("背景啟動失敗: " + $_.Exception.Message)
        }
    }

    $self = $PSCommandPath
    if ([string]::IsNullOrWhiteSpace($self)) { $self = $MyInvocation.MyCommand.Path }
    Write-UpBanner $self
}

function Stop-GrokDown {
    $state = $null
    if (Test-Path -LiteralPath $script:StatePath) {
        $state = Read-StateFile $script:StatePath
        $repoFromState = [string](Get-StateProp $state 'repo')
        $wtFromState = [string](Get-StateProp $state 'worktree')
        $homeFromState = [string](Get-StateProp $state 'home')
        if ([string]::IsNullOrWhiteSpace($repoFromState) -or [string]::IsNullOrWhiteSpace($wtFromState) -or [string]::IsNullOrWhiteSpace($homeFromState)) {
            Fail "狀態檔缺少 repo、worktree 或 home: $($script:StatePath)"
        }
        $script:RepoFull = [System.IO.Path]::GetFullPath($repoFromState)
        $script:Wt = [System.IO.Path]::GetFullPath($wtFromState)
        $script:EmptyHome = [System.IO.Path]::GetFullPath($homeFromState)
        ConvertTo-JunctionArray (Get-StateProp $state 'junctions')
        if (-not [string]::IsNullOrWhiteSpace($Repo)) {
            $given = Resolve-RepoParameter $Repo
            if (-not $given.Equals($script:RepoFull, [System.StringComparison]::OrdinalIgnoreCase)) {
                Write-Warning ("提供的 -Repo 與狀態檔不同，以狀態檔為準: " + $script:RepoFull)
            }
        }
    } else {
        $script:RepoFull = Resolve-RepoParameter $Repo
        $script:Wt = Join-Path $script:RootFull $script:BaseName
        $script:EmptyHome = Join-Path $script:RootFull ($script:BaseName + '-home')
        if (-not (Test-Path -LiteralPath $script:Wt)) {
            Fail "狀態檔已不存在，且工作樹不存在，無法拆除: $($script:StatePath)"
        }
        Write-Warning ("找不到狀態檔，改用 -Repo 與 -Name 推算: " + $script:Wt)
        $inferred = New-Object System.Collections.Generic.List[object]
        foreach ($rel in @('node_modules', 'functions\node_modules')) {
            $link = Join-Path $script:Wt $rel
            if (-not (Test-Path -LiteralPath $link)) { continue }
            if (-not (Test-ReparsePoint $link)) { continue }
            $item = Get-Item -LiteralPath $link -Force
            $target = Get-JunctionTarget $item
            if ([string]::IsNullOrWhiteSpace($target)) { $target = Join-Path $script:RepoFull $rel }
            [void]$inferred.Add((New-JunctionRecord $link $target))
        }
        $script:JunctionList = $inferred
    }

    if (-not (Test-Path -LiteralPath $script:Wt)) {
        Fail "工作樹不存在，停止拆除: $($script:Wt)"
    }

    # ① 有 -Save 就先存，失敗不往下拆。
    if (-not [string]::IsNullOrWhiteSpace($Save)) {
        Save-WorktreeChanges $script:Wt $Save
    }

    # ② 未排除的變更且沒有 -Save / -Force 就停。
    Get-PorcelainEntries $script:Wt
    $dirty = New-Object System.Collections.Generic.List[string]
    foreach ($entry in $script:Porcelain) {
        if ($null -eq $entry) { continue }
        $rel = [string]$entry.Path
        if (Test-ExcludedArea $rel) { continue }
        [void]$dirty.Add($rel)
    }
    if ($dirty.Count -gt 0 -and [string]::IsNullOrWhiteSpace($Save) -and -not $Force) {
        Write-Warning ("工作樹有未儲存變更，已停止。請改用 -Save 或 -Force。路徑: " + $script:Wt)
        foreach ($rel in @($dirty)) { Write-Warning ("未儲存: " + $rel) }
        Fail '工作樹有未儲存變更，已停止。'
    }

    # ③ 只刪 junction 連結。
    $removedLinks = New-Object System.Collections.Generic.List[string]
    foreach ($j in $script:JunctionList) {
        if ($null -eq $j) { continue }
        $link = [string](Get-StateProp $j 'path')
        if ([string]::IsNullOrWhiteSpace($link)) { Fail '狀態檔的 junction 缺少 path。' }
        if (-not (Test-Path -LiteralPath $link)) { Fail "junction 不存在，停止: $link" }
        if (-not (Test-ReparsePoint $link)) { Fail "不是 reparse point，拒絕刪除: $link" }
        [System.IO.Directory]::Delete($link)
        if (Test-Path -LiteralPath $link) { Fail "junction 刪除後仍存在: $link" }
        [void]$removedLinks.Add($link)
    }

    # ④ 目標必須還在。沒有的話不移除 worktree。
    $targetsOk = New-Object System.Collections.Generic.List[string]
    foreach ($j in $script:JunctionList) {
        if ($null -eq $j) { continue }
        $target = [string](Get-StateProp $j 'target')
        if ([string]::IsNullOrWhiteSpace($target)) { Fail '狀態檔的 junction 缺少 target。' }
        if (-not (Test-Path -LiteralPath $target)) {
            Write-Host ("目標已被刪除: " + $target) -ForegroundColor Red
            Write-Output ("目標已被刪除: " + $target)
            Fail "junction 目標不存在，停止拆除: $target"
        }
        [void]$targetsOk.Add($target)
    }

    # ⑤ 這時才移工作樹。
    Invoke-GitChecked @('-C', $script:RepoFull, 'worktree', 'remove', '--force', $script:Wt) 'git worktree remove'
    Invoke-GitChecked @('-C', $script:RepoFull, 'worktree', 'prune') 'git worktree prune'
    if (Test-Path -LiteralPath $script:Wt) { Fail "worktree remove 後路徑仍存在: $($script:Wt)" }

    # ⑥ HOME
    Remove-HomeFolder $script:RootFull $script:EmptyHome

    # ⑦ 保留 out/err/exit，刪狀態檔與 run.ps1
    if (Test-Path -LiteralPath $script:StatePath) {
        Remove-Item -LiteralPath $script:StatePath -Force
    }
    if (Test-Path -LiteralPath $script:StatePath) { Fail "狀態檔刪除後仍存在: $($script:StatePath)" }
    if (Test-Path -LiteralPath $script:RunPath) {
        Remove-Item -LiteralPath $script:RunPath -Force
    }
    if (Test-Path -LiteralPath $script:RunPath) { Fail "run.ps1 刪除後仍存在: $($script:RunPath)" }

    Write-Output '--- grok-worktree down ---'
    Write-Output ("已拆除工作樹: " + $script:Wt)
    if ($removedLinks.Count -eq 0) {
        Write-Output '已拆除 junction: （無）'
    } else {
        foreach ($link in @($removedLinks)) { Write-Output ("已拆除 junction: " + $link) }
    }
    if ($targetsOk.Count -eq 0) {
        Write-Output '目標 node_modules 完好: （此次沒有 junction）'
    } else {
        foreach ($target in @($targetsOk)) { Write-Output ("目標 node_modules 完好: " + $target) }
    }
    Write-Output ("保留: " + $script:OutJson)
    Write-Output ("保留: " + $script:ErrTxt)
    Write-Output ("保留: " + $script:ExitTxt)
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Fail '找不到 git。'
}

if ([string]::IsNullOrWhiteSpace($Root)) {
    if (-not [string]::IsNullOrWhiteSpace([string]$env:CLAUDE_SCRATCHPAD)) {
        $Root = [string]$env:CLAUDE_SCRATCHPAD
    } else {
        $Root = Join-Path $env:TEMP 'grok-wt'
    }
}
$script:RootFull = Resolve-FullPath $Root
if (Test-Path -LiteralPath $script:RootFull) {
    if (-not (Test-Path -LiteralPath $script:RootFull -PathType Container)) {
        Fail "Root 不是資料夾: $($script:RootFull)"
    }
} else {
    New-Item -ItemType Directory -Path $script:RootFull -Force | Out-Null
}

if ([string]::IsNullOrWhiteSpace($Name)) {
    if ($Command -eq 'down') { Fail 'down 需要 -Name。' }
    $Name = 'grok-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
}
$Name = $Name.Trim()
Assert-SafeName $Name
$script:BaseName = $Name
$script:Wt = Join-Path $script:RootFull $script:BaseName
$script:EmptyHome = Join-Path $script:RootFull ($script:BaseName + '-home')
$script:StatePath = Join-Path $script:RootFull ($script:BaseName + '.state.json')
$script:RunPath = Join-Path $script:RootFull ($script:BaseName + '-run.ps1')
$script:OutJson = Join-Path $script:RootFull ($script:BaseName + '-out.json')
$script:ErrTxt = Join-Path $script:RootFull ($script:BaseName + '-err.txt')
$script:ExitTxt = Join-Path $script:RootFull ($script:BaseName + '-exit.txt')

if ($Command -eq 'up') {
    $script:RepoFull = Resolve-RepoParameter $Repo
    Start-GrokUp
} else {
    Stop-GrokDown
}

exit 0
