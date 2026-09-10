# Local QA sheets only. Raw photographs and sheets are gitignored.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$referenceDirectory = Join-Path $PSScriptRoot 'reference/photos'
$manifestPath = Join-Path $PSScriptRoot 'photo-reference-manifest.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$font = New-Object System.Drawing.Font('Arial', 16)
$brush = [System.Drawing.Brushes]::White
foreach ($group in @('club', 'estate', 'supplementary')) {
    $records = @($manifest.records | Where-Object { $_.localPath } | Where-Object { if ($group -eq 'supplementary') { -not $_.id.StartsWith('club-') -and -not $_.id.StartsWith('estate-') } else { $_.id.StartsWith($group + '-') } })
    $columns = 3
    $cellWidth = 600
    $cellHeight = 445
    $rows = [int][Math]::Ceiling($records.Count / $columns)
    $sheet = New-Object System.Drawing.Bitmap(($columns * $cellWidth), ($rows * $cellHeight))
    $graphics = [System.Drawing.Graphics]::FromImage($sheet)
    $graphics.Clear([System.Drawing.Color]::FromArgb(26, 29, 29))
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    for ($i = 0; $i -lt $records.Count; $i++) {
        $record = $records[$i]
        $photoPath = Join-Path $PSScriptRoot $record.localPath
        $photo = [System.Drawing.Image]::FromFile($photoPath)
        $scale = [Math]::Min(($cellWidth - 16) / $photo.Width, ($cellHeight - 48) / $photo.Height)
        $width = [int]($photo.Width * $scale)
        $height = [int]($photo.Height * $scale)
        $x = [int](($i % $columns) * $cellWidth + ($cellWidth - $width) / 2)
        $y = [int]([Math]::Floor($i / $columns) * $cellHeight)
        $graphics.DrawImage($photo, $x, $y, $width, $height)
        $labelX = [int](($i % $columns) * $cellWidth + 8)
        $graphics.DrawString($record.id + '  ' + $record.title, $font, $brush, $labelX, ($y + $cellHeight - 40))
        $photo.Dispose()
    }
    $output = Join-Path $referenceDirectory ($group + '-contact-sheet.jpg')
    $sheet.Save($output, [System.Drawing.Imaging.ImageFormat]::Jpeg)
    $graphics.Dispose()
    $sheet.Dispose()
    Write-Output $output
}
$font.Dispose()
