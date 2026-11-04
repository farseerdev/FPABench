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
      ReferenceFile       <WorkDir>\tm1_reference\answers-duckdb-10m.json  reference answers, written by the installer

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
    if (-not $c.ReferenceFile) { $c.ReferenceFile = Join-FPBenchPath (Join-FPBenchPath $c.WorkDir 'tm1_reference') 'answers-duckdb-10m.json' }
  }
  return $c
}

function Assert-FPBenchConfig([hashtable]$C, [string[]]$Keys) {
  $missing = @($Keys | Where-Object { -not $C[$_] })
  if ($missing.Count -gt 0) { throw ("config: set {0} (or WorkDir, from which the folders are derived)" -f ($missing -join ', ')) }
}

function Write-FPBenchReference([string]$DatasetDirectory, [string]$ReferenceFile, [string]$Repo) {
  # Writes the reference answers with the FPABench runner's DuckDB entry. W8 is left out: at the FPABench
  # commit this package was built against, that test stops with an error in this entry when recording.
  $tests = 'L1,L2,L3,W1,W2,W3,W4,W5,W6a,W6b,W7,R1,R2a,R2b,R2c,R3,R4,R5,R6,R7,R8,M1,M2,M3,M4,C1,C2,C3'
  $dir = Split-Path -Parent $ReferenceFile
  $work = Join-Path $dir 'work'
  $out = Join-Path $dir 'out'
  $entryDir = Join-Path (Join-Path $Repo 'systems') 'duckdb-tables'
  $nodeArgs = @()
  $savedPath = $env:PATH
  $savedPref = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    if ($env:OS -eq 'Windows_NT') {
      # the runner calls the Unix command "sync" around load tests; it only flushes files before timing
      $bin = Join-Path $dir 'bin'
      New-Item -ItemType Directory -Force -Path $bin | Out-Null
      Set-Content -Path (Join-Path $bin 'sync.cmd') -Value '@exit /b 0' -Encoding ASCII
      $env:PATH = $bin + ';' + $env:PATH
      $nodeArgs += @('--import', ([Uri](Join-Path $PSScriptRoot 'windows-import-hook.mjs')).AbsoluteUri)
    }
    if (-not (Test-Path (Join-Path $entryDir 'node_modules'))) {
      Push-Location $entryDir
      try {
        & npm install --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw "npm install failed (exit $LASTEXITCODE)" }
      } finally { Pop-Location }
    }
    & node @nodeArgs (Join-Path (Join-Path $Repo 'runner') 'run.mjs') --entry duckdb-tables --dataset $DatasetDirectory --work $work --out $out --record (Join-Path $dir 'expected.json') --tests $tests
    if ($LASTEXITCODE -ne 0) { throw "the FPABench runner failed (exit $LASTEXITCODE); see $out\duckdb-tables.log" }
    Copy-Item -Path (Join-Path $out 'duckdb-tables.answers.json') -Destination $ReferenceFile
    Remove-Item -Path $work -Recurse -Force
  } finally {
    $env:PATH = $savedPath
    $ErrorActionPreference = $savedPref
  }
}

function Assert-FPBenchDisposable([hashtable]$C) {
  # These scripts stop and start services, mirror folders and empty cubes: they need the user's confirmation
  if ($C.DisposableServer -ne $true) {
    throw 'config: set DisposableServer = $true to confirm this server is an isolated, disposable benchmark environment holding nothing you need to keep (see Safety and operational risks in README.md)'
  }
}
