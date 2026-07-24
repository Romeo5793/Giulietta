# Automotive-9/dtc-codes から OEM DTC JSON を生成（Node 不要）
$ErrorActionPreference = "Stop"
$Base = "https://raw.githubusercontent.com/Automotive-9/dtc-codes/main"
$OutDir = Join-Path $PSScriptRoot "..\data\dtc\oem"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$Sources = [ordered]@{
  "alfa-romeo"  = "AlfaRomeo.json"
  "bmw"         = "BMW.json"
  "chrysler"    = "Chrysler.json"
  "fiat"        = "Fiat.json"
  "ford"        = "Ford.json"
  "gm"          = "GM.json"
  "honda"       = "Honda.json"
  "mitsubishi"  = "Mitsubishi.json"
  "nissan"      = "Nissan.json"
  "volkswagen"  = "Volkswagen.json"
}

function Get-Severity([string]$Code, [string]$Desc) {
  $c = $Code.ToUpper()
  $d = $Desc.ToLower()
  if ($d -match 'shut.?off|safety cut|secure breakdown|irreversible|immediate stop|critical') { return 3 }
  if ($c.StartsWith('P03') -or $c.StartsWith('P06') -or $d -match 'misfire|fuel rail|oil pressure|overheat|knock|no power|microprocessor fail') { return 2 }
  if ($c.StartsWith('U') -or $c.StartsWith('C')) { return 2 }
  if ($c.StartsWith('B')) { return 1 }
  return 1
}

$total = 0
$log = @()
foreach ($key in $Sources.Keys) {
  $file = $Sources[$key]
  $url = "$Base/$file"
  Write-Host "Fetching $file..."
  $raw = Invoke-RestMethod -Uri $url -UseBasicParsing
  $codes = @{}
  foreach ($prop in $raw.PSObject.Properties) {
    $code = $prop.Name.ToUpper()
    $desc = [string]$prop.Value
    $name = if ($desc.Length -gt 72) { $desc.Substring(0, 69) + "…" } else { $desc }
    $codes[$code] = @{
      name         = $name
      desc         = $desc
      severity     = (Get-Severity $code $desc)
      is_generic   = $false
      manufacturer = $key
    }
  }
  $out = @{
    manufacturer = $key
    version      = "automotive-9"
    count        = $codes.Count
    codes        = $codes
  }
  $path = Join-Path $OutDir "$key.json"
  $out | ConvertTo-Json -Depth 6 -Compress | Set-Content -Path $path -Encoding UTF8
  $size = (Get-Item $path).Length
  $total += $codes.Count
  $log += "$key : $($codes.Count) codes ($size bytes)"
}

Write-Host "Done. $total OEM codes."
$log | ForEach-Object { Write-Host $_ }
"TOTAL=$total" | Out-File (Join-Path $OutDir "_build-log.txt") -Encoding utf8
$log | Out-File (Join-Path $OutDir "_build-log.txt") -Encoding utf8
