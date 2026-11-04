<#
  FPBench.Config.ps1 - reads FPBench.config.psd1 and fills in the folders that are not set, so a config
  can name just RestBaseUrl, the sign-in and WorkDir. Shared by Install-FPBench.ps1, Import-FPBench.ps1
  and Run-FPBench.ps1. A key set in the config always wins over the derived one.

    PackageDirectory    this package (the folder above scripts\)
    from WorkDir:
      DatasetDirectory    <WorkDir>\official_10m             the FPABench 10m dataset
      StageDirectory      <WorkDir>\tm1_load                 FPB_Leaf / FPB_Drivers / FPB_FX
      IncrementDirectory  <WorkDir>\tm1_load_close-2026-07   the same three files for the July close (L2)
      StructureDirectory  <WorkDir>\tm1_structure            FPB_<dimension>.csv for z.FPB.Build.All
      OutDirectory        <WorkDir>\tm1_results              answers, journals, results
      SnapshotDirectory   <WorkDir>\tm1_snapshot             file snapshot for R8 / -FromSnapshot
      LogDirectory        <WorkDir>\tm1_logs                 the processes' own logs (pLogDir)
      PlanFile            <WorkDir>\tm1_plan\plan.json        the harness plan, written by the installer
      ReferenceFile       <WorkDir>\tm1_reference\expected.json       RAMA's recorded answers, downloaded by the installer

  Every folder must be readable (and OutDirectory / LogDirectory writable) by the TM1 server, because
  the TI processes open these files themselves.

  Generated with the help of Claude Opus 5.5; requires validation. Provided as is (see LICENSE).
#>
function Join-FPBenchPath([string]$Dir, [string]$Name) {
  # keeps the separator style of the folder: '/' for names such as file storage paths, '\' otherwise
  if ($Dir -match '/' -and $Dir -notmatch '\\') { return ($Dir.TrimEnd('/') + '/' + $Name) }
  return ($Dir.TrimEnd('\') + '\' + $Name)
}

function Read-FPBenchConfig([string]$Path) {
  $raw = Import-PowerShellDataFile -Path $Path
  $c = @{}
  foreach ($k in $raw.Keys) { $c[$k] = $raw[$k] }
  if (-not $c.PackageDirectory) { $c.PackageDirectory = Split-Path -Parent $PSScriptRoot }
  if ($c.WorkDir) {
    $derived = [ordered]@{
      DatasetDirectory = 'official_10m'; StageDirectory = 'tm1_load'; IncrementDirectory = 'tm1_load_close-2026-07'
      StructureDirectory = 'tm1_structure'; OutDirectory = 'tm1_results'; SnapshotDirectory = 'tm1_snapshot'; LogDirectory = 'tm1_logs'
    }
    foreach ($k in $derived.Keys) { if (-not $c[$k]) { $c[$k] = Join-FPBenchPath $c.WorkDir $derived[$k] } }
    if (-not $c.PlanFile) { $c.PlanFile = Join-FPBenchPath (Join-FPBenchPath $c.WorkDir 'tm1_plan') 'plan.json' }
    if (-not $c.ReferenceFile) { $c.ReferenceFile = Join-FPBenchPath (Join-FPBenchPath $c.WorkDir 'tm1_reference') 'expected.json' }
  }
  return $c
}

function Assert-FPBenchConfig([hashtable]$C, [string[]]$Keys) {
  $missing = @($Keys | Where-Object { -not $C[$_] })
  if ($missing.Count -gt 0) { throw ("config: set {0} (or WorkDir, from which the folders are derived)" -f ($missing -join ', ')) }
}

function Assert-FPBenchDisposable([hashtable]$C) {
  # These scripts stop and start services, mirror folders and empty cubes: they need the user's confirmation
  if ($C.DisposableServer -ne $true) {
    throw 'config: set DisposableServer = $true to confirm this server is an isolated, disposable benchmark environment holding nothing you need to keep (see Safety and operational risks in README.md)'
  }
}
