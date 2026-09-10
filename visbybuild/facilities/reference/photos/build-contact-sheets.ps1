$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$referenceDir = $PSScriptRoot
$manifestPath = Join-Path $referenceDir 'source-manifest.json'
$referenceManifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$photos = @($referenceManifest.assets | Where-Object { $_.status -eq 'downloaded' -and $_.contentType -match 'image/(jpeg|png)' })
$sheetColumns = 3
$cellWidth = 500
$cellHeight = 380
for ($offset = 0; $offset -lt $photos.Count; $offset += 12) {
    $sheetPhotos = @($photos | Select-Object -Skip $offset -First 12)
    $rows = [Math]::Ceiling($sheetPhotos.Count / $sheetColumns)
    $bitmap = New-Object System.Drawing.Bitmap ($cellWidth * $sheetColumns), ($cellHeight * $rows)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.Clear([System.Drawing.Color]::FromArgb(22,27,27))
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $font = New-Object System.Drawing.Font 'Arial', 12
    for ($i=0; $i -lt $sheetPhotos.Count; $i++) {
        $photo = $sheetPhotos[$i]
        $img = [System.Drawing.Image]::FromFile((Join-Path $referenceDir $photo.localFile))
        $photo | Add-Member -NotePropertyName dimensions -NotePropertyValue @($img.Width,$img.Height) -Force
        $left = ($i % $sheetColumns) * $cellWidth
        $top = [Math]::Floor($i / $sheetColumns) * $cellHeight
        $scale = [Math]::Min(($cellWidth-10)/$img.Width,($cellHeight-58)/$img.Height)
        $graphics.DrawImage($img,[int]($left+5),[int]($top+5),[int]($img.Width*$scale),[int]($img.Height*$scale))
        $labelRect = New-Object System.Drawing.RectangleF ($left+6),($top+$cellHeight-50),($cellWidth-12),48
        $graphics.DrawString($photo.localFile,$font,[System.Drawing.Brushes]::White,$labelRect)
        $img.Dispose()
    }
    $outputFile = Join-Path $referenceDir ('contact-sheet-{0:D2}.jpg' -f ([int]($offset/12)+1))
    $bitmap.Save($outputFile,[System.Drawing.Imaging.ImageFormat]::Jpeg)
    $graphics.Dispose()
    $font.Dispose()
    $bitmap.Dispose()
    Write-Output $outputFile
}
$referenceManifest | ConvertTo-Json -Depth 15 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
