<#
.SYNOPSIS
  Sets up FPABench on your own TM1 server in one run: prepares the data, imports the TI processes,
  builds and loads the model, and checks the result.

.DESCRIPTION
  Needs: a licensed IBM Planning Analytics v11 server with the REST API on (HttpPortNumber in tm1s.cfg),
  Node.js 22.15 or later, and a checkout of the FPABench repository (-Repo). The config is the same file
  the harness uses; with WorkDir set, every folder is derived from it (see FPBench.Config.ps1).

      .\scripts\Install-FPBench.ps1 -Config .\scripts\FPBench.config.psd1 -Repo C:\FPABench -WhatIf
      .\scripts\Install-FPBench.ps1 -Config .\scripts\FPBench.config.psd1 -Repo C:\FPABench

  Stages, in order (-From starts at a later one, for example after fixing a failure):
    Data     generate the 10m dataset with the FPABench generator if WorkDir has none; write the three
             load files, the July-close increment and the nine dimension structure files
    Reference  download RAMA's recorded answers for the dataset (expected.json, fetch-expected.mjs) and
             check they belong to it; write the harness plan and W2 cells from them. -SkipReference
             writes the plan from the dataset's picks.json instead, and the Check stage then does not
             compare the L1 answers
    Import   create the 28 processes (Import-FPBench.ps1); stop on any compile error
    Build    z.FPB.Build.All: the 20 dimensions and the four cubes (only adds, never deletes)
    Setup    z.FPB.Setup.Model (pApply = 0 first, then 1), z.FPB.Setup.GroupAttr, z.FPB.Setup.HandlingFactor
    Load     z.FPB.Run.L1: loads everything and attaches the rules (pClear = 1 empties the four cubes first)
    Check    z.FPB.Check.Run (every count must be 0) and compare.mjs on the L1 answers

  Safety. Before any stage runs, a read-only preflight lists the FPB cubes, FPB dimensions and z.FPB
  processes already on the server, whatever -From says. It stops, with nothing changed, when:
    - the Import stage would replace existing z.FPB processes and -ReplaceProcesses is not given;
    - the Load stage would empty existing FPB cubes and -Force is not given.
  -Force covers only emptying and reloading the four FPB cubes; -ReplaceProcesses covers only replacing
  the package's own z.FPB processes. Neither touches anything else. Build only adds to FPB dimensions.
  -WhatIf runs the preflight, prints what each stage would do, and stops.
  Resuming: after a failure, -From <stage> runs the preflight again; at or before Load it needs -Force
  if this install already created the cubes, and at Import it needs -ReplaceProcesses (or -From Build).
  Use an isolated, disposable, non-production TM1 server, and back it up first; the config must set
  DisposableServer = $true to confirm this (not needed for -WhatIf).

  The TM1 server opens the staged files and writes its answers itself, so every folder in the config
  must be reachable by the server: automatic for a server on this machine, a shared folder otherwise.
  TM1 Database 12 (file storage) is not handled yet.

  The TI processes and rules were generated with the help of Claude Opus 5.5 and require validation.
  Provided as is, without warranty (see LICENSE).
#>
param(
  [Parameter(Mandatory = $true)][string]$Config,
  [string]$Repo = '',
  [ValidateSet('Data', 'Reference', 'Import', 'Build', 'Setup', 'Load', 'Check')][string]$From = 'Data',
  [switch]$Force,
  [switch]$ReplaceProcesses,
  [switch]$SkipReference,
  [switch]$WhatIf
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'FPBench.Config.ps1')
$C = Read-FPBenchConfig $Config
if (-not $WhatIf) { Assert-FPBenchDisposable $C }
Assert-FPBenchConfig $C 'RestBaseUrl', 'DatasetDirectory', 'StageDirectory', 'IncrementDirectory', 'StructureDirectory', 'OutDirectory', 'PlanFile', 'ReferenceFile'
$pkg = Split-Path -Parent $PSScriptRoot
$started = Get-Date
function Log($m) { Write-Host ((Get-Date -Format 'HH:mm:ss') + ' ' + $m) }
. (Join-Path $PSScriptRoot 'FPBench.Rest.ps1')

$stages = 'Data', 'Reference', 'Import', 'Build', 'Setup', 'Load', 'Check'
function Run-Stage([string]$Name) { return ($stages.IndexOf($Name) -ge $stages.IndexOf($From)) }

function Invoke-Node([string[]]$NodeArgs, [string]$What) {
  Log "  $What"
  & node @NodeArgs
  if ($LASTEXITCODE -ne 0) { throw "$What failed (node exit $LASTEXITCODE)" }
}
function Invoke-Step([string]$Process, [hashtable]$Params) {
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $r = Invoke-TI $Process $Params
  if ($r.exit -ne 0) { throw "$Process failed (exit $($r.exit)); see its log in $(if ($C.LogDirectory) { $C.LogDirectory } else { 'the server''s process error folder' })" }
  Log ("  {0} done in {1:N1} s" -f $Process, $sw.Elapsed.TotalSeconds)
}
function With-Log([hashtable]$P) { if ($C.LogDirectory) { $P.pLogDir = $C.LogDirectory }; return $P }

# ---- prerequisites
if ((Run-Stage 'Data') -or (Run-Stage 'Reference') -or (Run-Stage 'Check')) {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 22.15 or later is needed (https://nodejs.org)' }
  $nodeVersion = [version]((& node --version).TrimStart('v'))
  if ($nodeVersion -lt [version]'22.15.0') { throw "Node.js 22.15 or later is needed (found $(& node --version))" }
}

# ---- preflight: read only, before anything is written locally or on the server
Initialize-FPBenchRest
try {
Connect-Rest
Log ("connected to {0}, TM1 version {1}" -f $script:restBase, $script:restServerVersion)
$fpbCubes = 'FPB_Drivers', 'FPB_Reporting', 'FPB_FX', 'FPB_Control'
$cubesOn = @(@((Invoke-FPBRest 'GET' '/Cubes?$select=Name').value) | ForEach-Object { [string]$_.Name } | Where-Object { $fpbCubes -contains $_ })
$dimsOn = @(@((Invoke-FPBRest 'GET' '/Dimensions?$select=Name').value) | ForEach-Object { [string]$_.Name } | Where-Object { $_ -like 'FPB_*' })
$ours = @(Get-ChildItem -Path (Join-Path $pkg 'processes') -Filter '*.ti' | ForEach-Object {
  $m = Select-String -Path $_.FullName -Pattern '^#### PROCESS (.+)$' | Select-Object -First 1
  if ($m) { $m.Matches[0].Groups[1].Value.Trim() } })
$procsOn = @(@((Invoke-FPBRest 'GET' '/Processes?$select=Name').value) | ForEach-Object { [string]$_.Name } | Where-Object { $ours -contains $_ })
Log ("preflight: {0} of 4 FPB cubes, {1} FPB dimensions, {2} of {3} z.FPB processes already on the server" -f $cubesOn.Count, $dimsOn.Count, $procsOn.Count, $ours.Count)
$plan = @(); $blockers = @()
if (Run-Stage 'Data')   { $plan += 'Data:   local files only (' + $C.DatasetDirectory + ', ' + $C.StageDirectory + ', ...)' }
if (Run-Stage 'Reference') {
  $plan += $(if ($SkipReference) { 'Reference: no answers; the plan from picks.json' } else { "Reference: RAMA's answers into " + $C.ReferenceFile + ', and the plan from them' })
}
if (Run-Stage 'Import') {
  $plan += ("Import: create {0} processes{1}" -f ($ours.Count - $procsOn.Count), $(if ($procsOn.Count) { ", replace $($procsOn.Count)" } else { '' }))
  $sample = (@($procsOn | Select-Object -First 3) -join ', ')
  if ($procsOn.Count -and -not $ReplaceProcesses) { $blockers += ("{0} z.FPB processes already exist ({1}...). Add -ReplaceProcesses to replace them with this package's versions, or start with -From Build to keep them." -f $procsOn.Count, $sample) }
}
if (Run-Stage 'Build')  { $plan += $(if ($dimsOn.Count -or $cubesOn.Count) { 'Build:  add to the existing FPB dimensions / cubes (nothing is deleted)' } else { 'Build:  create 20 FPB dimensions and 4 cubes' }) }
if (Run-Stage 'Setup')  { $plan += 'Setup:  add helper elements and attributes (z.FPB.Setup.*)' }
if (Run-Stage 'Load')   {
  $plan += $(if ($cubesOn.Count) { 'Load:   EMPTY and reload ' + ($cubesOn -join ', ') } else { 'Load:   load the 4 new cubes' })
  if ($cubesOn.Count -and -not $Force) { $blockers += ("the Load stage would empty {0}. Add -Force if that is what you want." -f ($cubesOn -join ', ')) }
}
if (Run-Stage 'Check')  { $plan += 'Check:  read only' }
foreach ($l in $plan) { Log ('  ' + $l) }
if ($WhatIf) {
  foreach ($b in $blockers) { Log ('  would stop: ' + $b) }
  Log 'WhatIf: nothing was changed'
  return
}
if ($blockers.Count) { throw ("stopped before any change: " + ($blockers -join ' Also: ')) }

foreach ($d in $C.OutDirectory, $C.LogDirectory, (Join-FPBenchPath $C.OutDirectory 'answers')) {
  if ($d) { New-Item -ItemType Directory -Force -Path $d | Out-Null }
}

# ---- Data
if (Run-Stage 'Data') {
  Log 'Data'
  if (-not $Repo) { throw '-Repo <FPABench repository folder> is needed for the Data stage (model/dimensions and the generator)' }
  $manifest = Join-Path $C.DatasetDirectory 'manifest.json'
  if (-not (Test-Path $manifest)) {
    if ((Test-Path $C.DatasetDirectory) -and (Get-ChildItem $C.DatasetDirectory -Force | Select-Object -First 1)) {
      throw "$($C.DatasetDirectory) has files but no manifest.json: not overwriting it"
    }
    Invoke-Node @((Join-Path (Join-Path $Repo 'data') 'generate.mjs'), '--size', '10m', '--out', $C.DatasetDirectory) 'generating the FPABench 10m dataset (several minutes)'
  }
  Invoke-Node @((Join-Path $PSScriptRoot 'stage-official.mjs'), $C.DatasetDirectory, $C.StageDirectory) 'staging the three load files'
  Invoke-Node @((Join-Path $PSScriptRoot 'stage-official.mjs'), $C.DatasetDirectory, $C.IncrementDirectory, 'close-2026-07') 'staging the July close (L2)'
  Invoke-Node @((Join-Path $PSScriptRoot 'stage-structure.mjs'), $Repo, $C.DatasetDirectory, $C.StructureDirectory) 'writing the dimension structure files'
}

# ---- Reference
if (Run-Stage 'Reference') {
  Log 'Reference'
  $picks = Join-Path $C.DatasetDirectory 'picks.json'
  if (-not (Test-Path $picks)) { throw "$picks not found: this dataset is from an older generator. Generate it again from the FPABench commit named in docs\BENCHMARK_METHODOLOGY.md into an empty folder" }
  if (-not $SkipReference) {
    if (-not $Repo) { throw '-Repo <FPABench repository folder> is needed to download the expected answers (or use -SkipReference)' }
    Invoke-Node @((Join-Path $PSScriptRoot 'fetch-expected.mjs'), $Repo, $C.DatasetDirectory, $C.ReferenceFile) "downloading RAMA's answers for the dataset"
    $picks = $C.ReferenceFile
  }
  Invoke-Node @((Join-Path $PSScriptRoot 'picks-to-tm1.mjs'), $picks, (Split-Path -Parent $C.PlanFile)) 'writing the harness plan and the W2 cells'
}

# ---- Import
if (Run-Stage 'Import') {
  Log 'Import'
  $global:LASTEXITCODE = 0
  $imp = @{ Config = $Config }
  if ($ReplaceProcesses) { $imp.ReplaceExisting = $true }
  & (Join-Path $PSScriptRoot 'Import-FPBench.ps1') @imp
  if ($LASTEXITCODE -ne 0) { throw 'Import-FPBench.ps1 reported failures or compile errors (listed above)' }
}

# ---- Build
if (Run-Stage 'Build') {
  Log 'Build'
  Invoke-Step 'z.FPB.Build.All' (With-Log @{ pDir = $C.StructureDirectory })
}

# ---- Setup
if (Run-Stage 'Setup') {
  Log 'Setup'
  $setupLog = @{}
  if ($C.LogDirectory) { $setupLog.pLog = Join-FPBenchPath $C.LogDirectory 'zFPB_Setup_Model.log' }
  Invoke-Step 'z.FPB.Setup.Model' (@{ pApply = 0 } + $setupLog)      # dry run: stops on any missing prerequisite
  Invoke-Step 'z.FPB.Setup.Model' (@{ pApply = 1 } + $setupLog)
  $master = Join-FPBenchPath $C.DatasetDirectory 'master'
  Invoke-Step 'z.FPB.Setup.GroupAttr' @{ pFile = (Join-FPBenchPath $master 'customer_groups.csv') }
  Invoke-Step 'z.FPB.Setup.HandlingFactor' @{ pFile = (Join-FPBenchPath $master 'handling_factors.csv') }
}

# ---- Load
$answers = Join-FPBenchPath $C.OutDirectory 'answers'
if (Run-Stage 'Load') {
  Log 'Load (FPABench L1: several minutes)'
  Invoke-Step 'z.FPB.Run.L1' (With-Log @{ pPkgDir = $C.PackageDirectory; pDataDir = $C.StageDirectory; pClear = 1; pBulk = 1; pSave = 1
    pOut = (Join-FPBenchPath $answers 'L1_0.csv') })
}

# ---- Check
if (Run-Stage 'Check') {
  Log 'Check'
  $checkFile = Join-FPBenchPath $C.OutDirectory 'install_check.csv'
  if (Test-Path $checkFile) { Remove-Item $checkFile }
  Invoke-Step 'z.FPB.Check.Run' @{ pOut = $checkFile; pVariant = 'BASE'; pTol = 0.01 }
  $ok = $true
  if (Test-Path $checkFile) {
    foreach ($line in Get-Content $checkFile) {
      $f = @($line -split ',' | ForEach-Object { $_.Trim().Trim('"') })
      if ($f.Count -ge 3 -and $f[0] -eq 'SUMMARY') {
        $n = [double]::Parse($f[2], [Globalization.CultureInfo]::InvariantCulture)
        Log ("  {0,-34} {1}" -f $f[1], $f[2])
        if ($n -ne 0) { $ok = $false }
      }
    }
  } else {
    Log "  $checkFile is not readable from here (remote server?): read it on the server"
  }
  if (-not $ok) { throw "z.FPB.Check.Run found differences: see $checkFile" }
  if (Test-Path $C.ReferenceFile) {
    & node (Join-Path $PSScriptRoot 'compare.mjs') $C.ReferenceFile $answers 'L1' --quick
    if ($LASTEXITCODE -ne 0) { throw "the L1 answers differ from RAMA's (listed above)" }
  } else {
    Log "  no reference answers at $($C.ReferenceFile): the L1 answers were not compared"
  }
}

Log ("FPABench is set up ({0:N0} min). Next: .\scripts\Run-FPBench.ps1 -Config {1}" -f ((Get-Date) - $started).TotalMinutes, $Config)
} finally { Close-FPBenchRest }
