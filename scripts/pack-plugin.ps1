$ErrorActionPreference = 'Stop'

$src = 'E:\Git\ClassScheduleViewer\YangtzU_course_plugin\plugin-packages\yangtzeu-eams'
$manifest = Get-Content -LiteralPath (Join-Path $src 'manifest.json') -Raw | ConvertFrom-Json
$version = $manifest.version

$checksumsRel = 'checksums.json'
$signatureRel = 'signature.json'
$checksumsPath = Join-Path $src $checksumsRel
$existing = Get-Content -LiteralPath $checksumsPath -Raw | ConvertFrom-Json
$algorithm = if ($existing.algorithm) { $existing.algorithm } else { 'SHA-256' }
$hashAlg = $algorithm -replace '-', ''

$files = [ordered]@{}
foreach ($entry in Get-ChildItem -LiteralPath $src -Recurse -File) {
    $rel = (Resolve-Path -LiteralPath $entry.FullName -Relative -RelativeBasePath $src) -replace '^\.[\\/]', '' -replace '\\', '/'
    if ($rel -eq $checksumsRel -or $rel -eq $signatureRel) { continue }
    $files[$rel] = (Get-FileHash -LiteralPath $entry.FullName -Algorithm $hashAlg).Hash.ToLowerInvariant()
}

$payload = [ordered]@{ algorithm = $algorithm; files = $files }
$json = ($payload | ConvertTo-Json -Depth 4)
[System.IO.File]::WriteAllText($checksumsPath, $json + "`n", (New-Object System.Text.UTF8Encoding($false)))
Write-Output "Regenerated $checksumsRel with $($files.Count) entries"

$zipName = "yangtzeu-eams-$version.zip"
$outDir = 'E:\Git\ClassScheduleViewer\YangtzU_course_plugin\dist'
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }
$zipPath = Join-Path $outDir $zipName
if (Test-Path $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
Compress-Archive -Path (Join-Path $src '*') -DestinationPath $zipPath -Force
Get-Item $zipPath | Format-List FullName, Length
