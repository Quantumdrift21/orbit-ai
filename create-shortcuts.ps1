$repo = 'C:\Users\Kiran\orbit-ai-repo'
$electron = Join-Path $repo 'node_modules\electron\dist\electron.exe'
$ws = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')
$startup = [Environment]::GetFolderPath('Startup')
foreach ($target in @($desktop, $startup)) {
    $lnk = Join-Path $target 'Orbit AI.lnk'
    $sc = $ws.CreateShortcut($lnk)
    $sc.TargetPath = $electron
    $sc.Arguments = '.'
    $sc.WorkingDirectory = $repo
    $sc.IconLocation = $electron
    $sc.Description = 'Orbit AI desktop robot'
    $sc.Save()
    Write-Host "Created: $lnk"
}