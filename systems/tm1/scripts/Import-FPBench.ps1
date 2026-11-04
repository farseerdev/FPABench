<#
.SYNOPSIS
  Creates or updates the FPABench TI processes on a TM1 server through its REST API, from the readable
  sources in processes\*.ti, and asks the server to compile each one.

.DESCRIPTION
  Uses the same config file as Run-FPBench.ps1 (RestBaseUrl and the sign-in keys; see FPBench.Rest.ps1).
  Needs a TM1 server with the REST API: IBM Planning Analytics v11 or TM1 Database 12.

      .\scripts\Import-FPBench.ps1 -Config .\scripts\FPBench.config.psd1
      .\scripts\Import-FPBench.ps1 -Config .\scripts\FPBench.config.psd1 -Process z.FPB.Build.*
      .\scripts\Import-FPBench.ps1 -Config .\scripts\FPBench.config.psd1 -WhatIf
      .\scripts\Import-FPBench.ps1 -Config .\scripts\FPBench.config.psd1 -ReplaceExisting

  Before writing anything it lists which of the selected processes already exist on the server (read
  only). A process that does not exist is created (POST /Processes). If any of them already exists, the
  script stops without changing anything, unless -ReplaceExisting is given: then each existing one is
  replaced with the source's definition (PATCH /Processes('<name>')): parameters, data source, variables
  and the four tabs. -WhatIf only reports what would be created or replaced.
  Nothing else on the server is changed: no cube, dimension, rule or data. The rules are loaded later by
  the processes themselves (z.FPB.Run.L1, z.FPB.Rules.Load), from the folder passed to them.
  After each import the server compiles the process (tm1.Compile) and any error is listed with its tab
  and line. The script exits with 1 if any process failed to import or compile.

  A .ti source holds one process:
    #### PROCESS <name>
    #### PARAMETERS     one line each: <name>  String|Numeric  <default>   (strings in single quotes)
    #### DATASOURCE     None | ASCII '<file>' | View '<cube>' '<view>'
    #### VARIABLES      one line each: <name>  String|Numeric
    #### PROLOG / #### METADATA / #### DATA / #### EPILOG   the code of each tab

  The TI processes were generated with the help of Claude Opus 5.5 and require validation.
  Provided as is, without warranty (see the repository's LICENSE).
#>
param(
  [Parameter(Mandatory = $true)][string]$Config,
  [string]$Source = (Join-Path (Split-Path -Parent $PSScriptRoot) 'processes'),
  [string[]]$Process = @('*'),
  [switch]$NoCompile,
  [switch]$ReplaceExisting,
  [switch]$WhatIf
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'FPBench.Config.ps1')
$C = Read-FPBenchConfig $Config
if (-not $WhatIf) { Assert-FPBenchDisposable $C }
$Process = @($Process | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
function Log($m) { Write-Host ((Get-Date -Format 'HH:mm:ss') + ' ' + $m) }
. (Join-Path $PSScriptRoot 'FPBench.Rest.ps1')

$sections = 'PROCESS', 'PARAMETERS', 'DATASOURCE', 'VARIABLES', 'PROLOG', 'METADATA', 'DATA', 'EPILOG'
$tabs = 'PROLOG', 'METADATA', 'DATA', 'EPILOG'

function Read-TISource([string]$Path) {
  $text = [IO.File]::ReadAllText($Path, [Text.Encoding]::UTF8)
  $lines = $text -split "`r?`n"
  if ($lines.Count -gt 0 -and $lines[-1] -eq '') { $lines = $lines[0..($lines.Count - 2)] }
  $p = [ordered]@{ Name = ''; Params = @(); Source = $null; Vars = @(); Code = @{} }
  foreach ($t in $tabs) { $p.Code[$t] = New-Object System.Collections.Generic.List[string] }
  $sec = $null
  foreach ($l in $lines) {
    $m = [regex]::Match($l, '^#### (PROCESS|PARAMETERS|DATASOURCE|VARIABLES|PROLOG|METADATA|DATA|EPILOG)\b ?(.*)$')
    if ($m.Success) {
      $sec = $m.Groups[1].Value
      if ($sec -eq 'PROCESS') { $p.Name = $m.Groups[2].Value.Trim() }
      continue
    }
    if ($tabs -contains $sec) { $p.Code[$sec].Add($l); continue }
    if (-not $sec -or $l.Trim() -eq '') { continue }
    switch ($sec) {
      'PARAMETERS' {
        $m = [regex]::Match($l, '^(\S+)\s+(Numeric|String)\s+(.*)$')
        if (-not $m.Success) { throw "$Path : bad parameter line: $l" }
        $n = $m.Groups[1].Value; $t = $m.Groups[2].Value; $v = $m.Groups[3].Value.Trim()
        if ($t -eq 'String') {
          $q = [regex]::Match($v, "^'((?:[^']|'')*)'$")
          if (-not $q.Success) { throw "$Path : string default of $n must be in single quotes" }
          $v = $q.Groups[1].Value -replace "''", "'"
        } else {
          $v = [double]::Parse($v, [Globalization.CultureInfo]::InvariantCulture)
        }
        $p.Params += , @($n, $t, $v)
      }
      'DATASOURCE' {
        $q = @([regex]::Matches($l, "'((?:[^']|'')*)'") | ForEach-Object { $_.Groups[1].Value -replace "''", "'" })
        $p.Source = @(($l.Trim() -split '\s+')[0]) + $q
      }
      'VARIABLES' {
        $f = $l.Trim() -split '\s+'
        if ($f.Count -ne 2 -or ($f[1] -ne 'String' -and $f[1] -ne 'Numeric')) { throw "$Path : bad variable line: $l" }
        $p.Vars += , @($f[0], $f[1])
      }
    }
  }
  if (-not $p.Name) { throw "$Path : no '#### PROCESS <name>' line" }
  if (-not $p.Source) { throw "$Path : no data source" }
  return $p
}

function Get-TabText($Lines) {
  # the generated-statements marker TM1 keeps at the top of every tab, then the code
  $t = "`r`n#****Begin: Generated Statements***`r`n#****End: Generated Statements****"
  if ($Lines.Count -gt 0) { $t += "`r`n`r`n" + ($Lines -join "`r`n") }
  return $t
}

function New-ProcessBody($p) {
  $src = $p.Source
  switch ($src[0]) {
    'None'  { $ds = [ordered]@{ Type = 'None' } }
    'ASCII' {
      $ds = [ordered]@{ Type = 'ASCII'; asciiDecimalSeparator = '.'; asciiDelimiterChar = ','; asciiDelimiterType = 'Character'
        asciiHeaderRecords = 1; asciiQuoteCharacter = '"'; asciiThousandSeparator = ','
        dataSourceNameForClient = $src[1]; dataSourceNameForServer = $src[1] }
    }
    'View'  { $ds = [ordered]@{ Type = 'TM1CubeView'; dataSourceNameForClient = $src[1]; dataSourceNameForServer = $src[1]; view = $src[2] } }
    default { throw "$($p.Name): unknown data source type $($src[0])" }
  }
  $params = @(); foreach ($x in $p.Params) { $params += [ordered]@{ Name = $x[0]; Prompt = ''; Value = $x[2]; Type = $x[1] } }
  $vars = @(); $ui = @(); $i = 0
  foreach ($x in $p.Vars) {
    $i++
    $vars += [ordered]@{ Name = $x[0]; Type = $x[1]; Position = $i; StartByte = 0; EndByte = 0 }
    $ui += ('VarType={0}' + [char]12 + 'ColType=827' + [char]12) -f $(if ($x[1] -eq 'Numeric') { 33 } else { 32 })
  }
  return [ordered]@{
    Name = $p.Name
    HasSecurityAccess = $false
    PrologProcedure   = Get-TabText $p.Code['PROLOG']
    MetadataProcedure = Get-TabText $p.Code['METADATA']
    DataProcedure     = Get-TabText $p.Code['DATA']
    EpilogProcedure   = Get-TabText $p.Code['EPILOG']
    DataSource        = $ds
    Parameters        = $params
    Variables         = $vars
    VariablesUIData   = $ui
  }
}

# ---- read every source first, so a broken file stops the import before anything is changed
$files = @(Get-ChildItem -Path $Source -Filter '*.ti' | Sort-Object Name)
if ($files.Count -eq 0) { throw "no .ti files in $Source" }
$procs = @()
foreach ($f in $files) {
  $p = Read-TISource $f.FullName
  $match = $false; foreach ($w in $Process) { if ($p.Name -like $w) { $match = $true } }
  if ($match) { $procs += , $p }
}
if ($procs.Count -eq 0) { throw "no process matches $($Process -join ', ')" }
Log ("{0} process sources read from {1}" -f $procs.Count, $Source)

Initialize-FPBenchRest
try {
Connect-Rest
Log ("connected to {0}, TM1 version {1}" -f $script:restBase, $script:restServerVersion)

# ---- read-only check: which of these processes exist already
$onServer = @{}
foreach ($x in @((Invoke-FPBRest 'GET' '/Processes?$select=Name').value)) { $onServer[[string]$x.Name] = $true }
$existing = @($procs | Where-Object { $onServer.ContainsKey($_.Name) } | ForEach-Object { $_.Name })
foreach ($p in $procs) {
  $what = if ($onServer.ContainsKey($p.Name)) { if ($ReplaceExisting) { 'replace' } else { 'EXISTS' } } else { 'create' }
  if ($WhatIf -or $what -eq 'EXISTS') { Log ("  {0,-7} {1}" -f $what, $p.Name) }
}
if ($WhatIf) { Log ("WhatIf: {0} to create, {1} already on the server{2}; nothing was changed" -f ($procs.Count - $existing.Count), $existing.Count, $(if ($existing.Count -and -not $ReplaceExisting) { ' (would need -ReplaceExisting)' } else { '' })); exit 0 }
if ($existing.Count -gt 0 -and -not $ReplaceExisting) {
  Log ("STOPPED: {0} of these processes already exist on the server (marked EXISTS). Nothing was changed. Rerun with -ReplaceExisting to replace them with the package's versions." -f $existing.Count)
  exit 1
}

$failed = 0; $created = 0; $updated = 0; $compileErrors = 0
foreach ($p in $procs) {
  $path = Get-ProcessPath $p.Name
  $body = New-ProcessBody $p
  try {
    if ($onServer.ContainsKey($p.Name)) { Invoke-FPBRest 'PATCH' $path $body | Out-Null; $updated++; $what = 'replaced' }
    else { Invoke-FPBRest 'POST' '/Processes' $body | Out-Null; $created++; $what = 'created' }
  } catch {
    $failed++
    Log ("FAILED {0}: {1}" -f $p.Name, $_.Exception.Message)
    continue
  }
  $note = ''
  if (-not $NoCompile) {
    try {
      $r = Invoke-FPBRest 'POST' ($path + '/tm1.Compile') @{}
      $errs = @($r.value)
      if ($errs.Count -gt 0) {
        $compileErrors += $errs.Count
        $note = " - $($errs.Count) compile error(s)"
        foreach ($e in $errs) { Log ("    {0} line {1}: {2}" -f $e.Procedure, $e.LineNumber, $e.Message) }
      } else { $note = ' - compiles' }
    } catch { $note = ' - compile check not available: ' + $_.Exception.Message }
  }
  Log ("{0} {1}{2}" -f $what, $p.Name, $note)
}
Log ("done: {0} created, {1} replaced, {2} failed, {3} compile errors" -f $created, $updated, $failed, $compileErrors)
} finally { Close-FPBenchRest }
if ($failed -gt 0 -or $compileErrors -gt 0) { exit 1 }
exit 0
