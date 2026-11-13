<#
Mede RAM (Working Set + Private) e CPU média do Token Pets.
Uso: pwsh scripts/measure.ps1 -Minutes 10 [-Label "so-bandeja"]
Rode uma vez com o app só na bandeja e outra com o popup/pet aberto, e anote no README.
#>
param(
  [int]$Minutes = 10,
  [int]$IntervalSeconds = 5,
  [string]$Label = "medicao"
)

$procs = Get-Process | Where-Object { $_.ProcessName -match '^(token-pets|msedgewebview2)$' }
$app = Get-Process -Name 'token-pets' -ErrorAction SilentlyContinue
if (-not $app) { Write-Error "token-pets não está rodando."; exit 1 }

# o app + os processos do WebView2 que ele criou (filhos diretos ou descendentes)
function Get-Tree($rootPid) {
  $all = Get-CimInstance Win32_Process
  $ids = [System.Collections.Generic.HashSet[int]]::new()
  [void]$ids.Add($rootPid)
  do {
    $before = $ids.Count
    foreach ($p in $all) { if ($ids.Contains([int]$p.ParentProcessId)) { [void]$ids.Add([int]$p.ProcessId) } }
  } while ($ids.Count -ne $before)
  $ids
}

$ncpu = [Environment]::ProcessorCount
$samples = @()
$end = (Get-Date).AddMinutes($Minutes)
$prev = @{}
while ((Get-Date) -lt $end) {
  $ids = Get-Tree $app.Id
  $ws = 0; $priv = 0; $cpuNow = 0.0
  foreach ($id in $ids) {
    $p = Get-Process -Id $id -ErrorAction SilentlyContinue
    if (-not $p) { continue }
    $ws += $p.WorkingSet64; $priv += $p.PrivateMemorySize64
    $cpuNow += $p.TotalProcessorTime.TotalSeconds
  }
  $t = Get-Date
  $cpuPct = $null
  if ($prev.ContainsKey('t')) {
    $dt = ($t - $prev.t).TotalSeconds
    if ($dt -gt 0) { $cpuPct = [Math]::Max(0, ($cpuNow - $prev.cpu) / $dt / $ncpu * 100) }
  }
  $prev = @{ t = $t; cpu = $cpuNow }
  $samples += [pscustomobject]@{ WorkingSetMB = [Math]::Round($ws / 1MB, 1); PrivateMB = [Math]::Round($priv / 1MB, 1); CpuPct = $cpuPct; Procs = $ids.Count }
  Start-Sleep -Seconds $IntervalSeconds
}

$cpu = $samples | Where-Object { $null -ne $_.CpuPct } | Measure-Object CpuPct -Average -Maximum
$ws = $samples | Measure-Object WorkingSetMB -Average -Maximum
$priv = $samples | Measure-Object PrivateMB -Average -Maximum
"[$Label] $Minutes min, $($samples.Count) amostras, $ncpu CPUs lógicas, processos (média): $([Math]::Round(($samples | Measure-Object Procs -Average).Average,1))"
"  RAM Working Set: média $([Math]::Round($ws.Average,1)) MB, máx $($ws.Maximum) MB"
"  RAM Private:     média $([Math]::Round($priv.Average,1)) MB, máx $($priv.Maximum) MB"
"  CPU:             média $([Math]::Round($cpu.Average,2)) %, máx $([Math]::Round($cpu.Maximum,2)) %"
