<#
  Run-FPBench.ps1 - FPABench test harness for the TM1 build (Windows PowerShell 5.1 or PowerShell 7).

  Talks to TM1 through its REST API only: one signed-in session for the whole run, and each TI process
  runs through POST /Processes('<name>')/tm1.ExecuteWithReturn. Needs a TM1 server with the REST API:
  IBM Planning Analytics v11 (TM1 Server 11, HttpPortNumber set in tm1s.cfg) or TM1 Database 12.

  Times every test the way FPABench's tests/method.md says, with a Stopwatch around one process call per run
  (the TI process does the write/load/change AND its proving read). Signing in is not timed. The median
  round trip of z.FPB.Noop is measured first and reported next to the raw times ("net" = raw - noop).

  The TM1 server stays up, as a production server would. Instead of stop / copy / start, every test
  is reset inside the running server, untimed:
    before a run   z.FPB.State.Save    writes the current value of every cell, attribute or structure
                                       the run will change to a journal (OutDirectory\journal)
    after the test z.FPB.State.Restore puts them back, newest journal first
  Reads change nothing, so they need no reset. A file snapshot (OutDirectory of SnapshotDirectory) is
  still taken after L1 - by copying the saved data folder while the server runs - and is used only by
  R8, which by definition starts a stopped server, and by -FromSnapshot.
  A warm-up (the L1 read and every R read, untimed) runs before the reads (R1..R7, C2) whenever the
  calculation cache was emptied (load, restart, rule reload, undo), so reads meet a server in its normal
  working state. Writes, loads and model changes get no warm-up: in TM1 any change to data the
  rules read empties the dependent cubes' calculation cache anyway, so a warm-up before them changes
  nothing their timer sees. -NoWarmup turns it off.
  Both choices are written into tm1-results.json under "settings".

  Config keys for the connection:
    RestBaseUrl               the server's .../api/v1 URL (required)
    User / Password           TM1 security (Basic sign-in)
    CAMNamespace              set it for CAM security
    RestAuthorization         a complete Authorization header instead, for other sign-in schemes
                              (for example a TM1 Database 12 API key)
    RestSkipCertificateCheck  $true accepts a self-signed certificate (a server you control only)

  Local server only: R8, -FromSnapshot and -Affinity stop, start or pin the TM1 Windows service named in
  ServiceName and copy its DataDirectory, so they need the server on this machine and an elevated
  PowerShell. Without a local service R8 is reported as not measurable here.
  The TI processes read and write files (answers, journals, rules, staged data) at the paths in the
  config, so those paths must be visible to the TM1 server. On a server on this machine they are.
  TM1 Database 12 keeps files in its own file storage, which this harness does not handle yet: there it
  can run and time the processes, but the answer files, the undo journals and R8 need adapting.

  Usage
    .\Run-FPBench.ps1 -Config .\FPBench.config.psd1                       # every test
    .\Run-FPBench.ps1 -Config .\FPBench.config.psd1 -Tests R1,R4,W1       # some tests, on the running server
    .\Run-FPBench.ps1 -Config .\FPBench.config.psd1 -Quick                # 1 run each (4 for single-cell writes)
    -FromSnapshot   restore the file snapshot (stop / copy / start) before the first test
    -NoWarmup       no untimed warm-up reads
    -Affinity 0xFFF pin the TM1 service process to these logical processors (hex mask, e.g. 0xFFF = processors
                    0-11; choose the performance-core threads) and raise it to High priority; re-applied after
                    every service start (R8, -FromSnapshot)
  Then
    node scripts\compare.mjs <ReferenceFile> <OutDirectory>\answers            (add --quick after -Quick)

  The TI processes and rules this harness drives were generated with the help of Claude Opus 5.5 and
  require validation. Provided as is, without warranty (see LICENSE).
#>
param(
  [Parameter(Mandatory = $true)][string]$Config,
  [string[]]$Tests = @(),
  [switch]$Quick,
  [switch]$FromSnapshot,
  [switch]$NoWarmup,
  [string]$Affinity = ''
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'FPBench.Config.ps1')
$C = Read-FPBenchConfig $Config
Assert-FPBenchDisposable $C
Assert-FPBenchConfig $C 'RestBaseUrl', 'StageDirectory', 'IncrementDirectory', 'OutDirectory', 'PlanFile'
# powershell.exe -File passes -Tests L1,R1 as one string: split it
$Tests = @($Tests | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
if (-not (Test-Path $C.PlanFile)) { throw "$($C.PlanFile) not found: run the Data stage of Install-FPBench.ps1 first" }
$plan = Get-Content -Raw -Path $C.PlanFile | ConvertFrom-Json
$answers  = Join-Path $C.OutDirectory 'answers'
$journals = Join-Path $C.OutDirectory 'journal'
$warmDir  = Join-Path $C.OutDirectory 'warmup'
$rulesDir = Join-FPBenchPath $C.PackageDirectory 'rules'
$emptyDir = Join-FPBenchPath (Join-FPBenchPath $C.PackageDirectory 'stage') 'empty'
foreach ($d in $answers, $journals, $warmDir) { New-Item -ItemType Directory -Force -Path $d | Out-Null }
$order = 'L1','L2','L3','W1','W2','W3','W4','W5','W6a','W6b','W7','W8','R1','R2a','R2b','R2c','R3','R4','R5','R6','R7','R8','M1','M2','M3','M4','C1','C2','C3'
if ($Tests.Count -gt 0) { $order = $order | Where-Object { $Tests -contains $_ } }
$log = Join-Path $C.OutDirectory 'harness.log'
function Log($m) { $line = (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss.fff') + ' ' + $m; Write-Host $line; Add-Content -Path $log -Value $line }

# ---- REST connection and process calls (shared with Import-FPBench.ps1)
. (Join-Path $PSScriptRoot 'FPBench.Rest.ps1')
Initialize-FPBenchRest

function Invoke-Untimed([string]$Process, [hashtable]$Params, [string]$What) {
  $r = Invoke-TI $Process $Params
  if ($r.exit -ne 0) { throw "$What failed (exit $($r.exit))" }
}
function Wait-Ready([int]$TimeoutSec = 900) {
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  while ($sw.Elapsed.TotalSeconds -lt $TimeoutSec) {
    $r = Invoke-TI 'z.FPB.Noop' @{} -Quiet
    if ($r.exit -eq 0) { return $sw.Elapsed.TotalMilliseconds }
    Start-Sleep -Milliseconds 250
  }
  throw 'TM1 server did not become ready'
}
function Set-TM1Affinity {
  # the service's own process, found by service name (local server only)
  if (-not $Affinity) { return }
  if (-not $C.ServiceName) { throw '-Affinity needs ServiceName in the config (a TM1 service on this machine)' }
  $svcPid = (Get-CimInstance Win32_Service -Filter ("Name='{0}'" -f $C.ServiceName)).ProcessId
  if (-not $svcPid) { Log 'affinity: service process not found'; return }
  $pr = Get-Process -Id $svcPid
  $pr.ProcessorAffinity = [IntPtr]([Convert]::ToInt64($Affinity, 16))
  $pr.PriorityClass = 'High'
  Log ("affinity: {0} (pid {1}) pinned to {2}, priority High" -f $pr.ProcessName, $svcPid, $Affinity)
}
function Assert-LocalService([string]$What) {
  if (-not $C.ServiceName -or -not (Get-Service -Name $C.ServiceName -ErrorAction SilentlyContinue)) {
    throw "not measurable here: $What needs the TM1 Windows service (ServiceName) on this machine"
  }
}
function Stop-TM1  { Stop-Service -Name $C.ServiceName -Force; (Get-Service -Name $C.ServiceName).WaitForStatus('Stopped', '00:05:00') }
function Start-TM1 { Start-Service -Name $C.ServiceName; Set-TM1Affinity; Wait-Ready | Out-Null; $script:cold = $true }

function Assert-SnapshotPaths {
  # robocopy /MIR deletes whatever the destination has that the source lacks: refuse any pair of folders
  # where a mistake could wipe something else
  if (-not $C.DataDirectory -or -not $C.SnapshotDirectory) { throw 'snapshot: DataDirectory and SnapshotDirectory must both be set' }
  $d = [IO.Path]::GetFullPath([string]$C.DataDirectory).TrimEnd('\', '/')
  $s = [IO.Path]::GetFullPath([string]$C.SnapshotDirectory).TrimEnd('\', '/')
  foreach ($x in $d, $s) {
    if ($x.Length -le 3 -or $x -eq [IO.Path]::GetPathRoot($x).TrimEnd('\', '/')) { throw 'snapshot: refusing a drive root as DataDirectory or SnapshotDirectory' }
  }
  if ($d -ieq $s) { throw 'snapshot: DataDirectory and SnapshotDirectory are the same folder' }
  if ($s.StartsWith($d + [IO.Path]::DirectorySeparatorChar, 'OrdinalIgnoreCase') -or $d.StartsWith($s + [IO.Path]::DirectorySeparatorChar, 'OrdinalIgnoreCase')) {
    throw 'snapshot: DataDirectory and SnapshotDirectory must not contain one another'
  }
  if (-not (Test-Path (Join-Path $d 'tm1s.cfg'))) { throw "snapshot: $d has no tm1s.cfg - is DataDirectory really the TM1 server's data folder?" }
}
function Save-Snapshot {
  # L1 ends with SaveDataAll and nothing writes in between, so the data folder is copied while the server
  # runs: TM1 holds no lock on .cub / .dim files between saves, and its logs are in another folder. This
  # is a convenience for R8 and -FromSnapshot on a dedicated benchmark server, not a supported TM1 backup.
  if (-not $C.ServiceName -or -not $C.DataDirectory -or -not (Test-Path $C.DataDirectory)) { Log 'snapshot: skipped (no local TM1 service and data folder configured)'; return }
  Assert-SnapshotPaths
  if ((Test-Path $C.SnapshotDirectory) -and (Get-ChildItem $C.SnapshotDirectory -Force | Select-Object -First 1) -and -not (Test-Path (Join-Path $C.SnapshotDirectory 'tm1s.cfg'))) {
    throw "snapshot: $($C.SnapshotDirectory) has files but is not a previous snapshot (no tm1s.cfg); not mirroring into it"
  }
  Log 'snapshot: copying the saved data folder (server keeps running)'
  robocopy $C.DataDirectory $C.SnapshotDirectory /MIR /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "snapshot: robocopy failed ($LASTEXITCODE); the snapshot is incomplete, do not restore it" }
}
function Restore-Snapshot {
  Assert-LocalService '-FromSnapshot'
  Assert-SnapshotPaths
  if (-not (Test-Path (Join-Path $C.SnapshotDirectory 'tm1s.cfg'))) { throw 'no snapshot yet - run L1 first' }
  Log 'snapshot: restoring (stop / copy / start)'
  Stop-TM1
  robocopy $C.SnapshotDirectory $C.DataDirectory /MIR /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) {
    # the data folder may now be partly copied: leave the service stopped rather than start TM1 on it
    throw ("snapshot restore FAILED (robocopy {0}). The service {1} is left STOPPED, and {2} may be incomplete. Restore it again (-FromSnapshot) or from your own backup before starting the service." -f $LASTEXITCODE, $C.ServiceName, $C.DataDirectory)
  }
  Start-TM1
}

# ---- undo journal
$saveKeys = 'pVersion','pYear','pCustomer','pSKU','pMonth','pGroup','pCategory','pBrand','pCurrency','pCostCenter','pAccount','pFile','pTarget'
function Save-State([string]$Kind, [hashtable]$P, [string]$Name) {
  $j = Join-Path $journals "$Name.csv"
  if (Test-Path $j) { Remove-Item $j }
  $h = @{ pTest = $Kind; pJournal = $j }
  foreach ($k in $saveKeys) { if ($P -and $P.ContainsKey($k)) { $h[$k] = $P[$k] } }
  Invoke-Untimed 'z.FPB.State.Save' $h "state save $Name"
  return $j
}
function Restore-State([string[]]$List) {
  for ($i = $List.Count - 1; $i -ge 0; $i--) {
    Invoke-Untimed 'z.FPB.State.Restore' @{ pJournal = $List[$i]; pRulesDir = $rulesDir; pEmptyDir = $emptyDir } "state restore $($List[$i])"
  }
  # the undo invalidated cached values, as the snapshot restore of other systems does: warm up again
  if ($List.Count -gt 0) { $script:cold = $true }
}

# ---- checks of a run: read after the timer stops (tests/method.md: the timer stops when the proving read
#      returns) and before the run is undone. z.FPB.Test.Check writes <answers>\<test>_<run>.csv.check,
#      .check2 and so on: every check FPABench's expected.json has for the test
$checkTests = 'W1','W2','W4','W5','W8','L2','L3','M1','M2','M3','M4','C1'
function Run-Check([string]$T, [hashtable]$P, [string]$Out) {
  if ($checkTests -notcontains $T) { return }
  $h = @{ pTest = $T; pOut = $Out }
  foreach ($k in 'pVersion','pYear','pMonth','pCustomer','pSKU','pGroup','pCountry','pBrand') { if ($P -and $P.ContainsKey($k)) { $h[$k] = $P[$k] } }
  Invoke-Untimed 'z.FPB.Test.Check' $h "check $T"
}

# ---- warm-up: the reads a working server has already answered
$script:cold = $true
function Warm-Up([string]$Why) {
  if ($NoWarmup -or -not $script:cold) { return }
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $reads = @(@{ pTest = 'L1' })
  foreach ($t in 'R1','R2a','R2b','R2c','R3','R4','R5','R6','R7') { if ($plan.tests.$t) { $reads += To-Hash $plan.tests.$t.runs[0].params } }
  foreach ($p in $reads) {
    $p.pOut = (Join-Path $warmDir ($p.pTest + '.csv'))
    Invoke-Untimed 'z.FPB.Read' $p "warm-up read $($p.pTest)"
  }
  $script:cold = $false
  Log ("warm-up ({0}) {1:N1} s" -f $Why, $sw.Elapsed.TotalSeconds)
}

function To-Hash($o) { $h = @{}; if ($o) { $o.PSObject.Properties | ForEach-Object { $h[$_.Name] = $_.Value } }; $h }
function Median([double[]]$x) { if ($x.Count -eq 0) { return $null }; $s = $x | Sort-Object; $n = $s.Count; if ($n % 2) { $s[[int][math]::Floor($n / 2)] } else { ($s[$n / 2 - 1] + $s[$n / 2]) / 2 } }
function P95([double[]]$x) { if ($x.Count -eq 0) { return $null }; $s = $x | Sort-Object; $s[[int][math]::Ceiling(0.95 * $s.Count) - 1] }


# ---- calibration
Set-TM1Affinity
$noop = @()
foreach ($k in 1..10) {
  $r = Invoke-TI 'z.FPB.Noop' @{}
  if ($r.exit -ne 0) { throw "z.FPB.Noop failed (exit $($r.exit)) - check RestBaseUrl, User, Password and that the server is running" }
  $noop += $r.ms
}
$noopMs = Median $noop
Log ("REST round trip (z.FPB.Noop) median {0:N1} ms" -f $noopMs)
$results = [ordered]@{
  system = $(if ($C.System) { $C.System } else { 'IBM Planning Analytics' }); machine = $env:COMPUTERNAME; noopMedianMs = $noopMs; quick = [bool]$Quick
  settings = [ordered]@{
    transport = 'REST API, one signed-in session (' + $script:restBase + '); sign-in not timed'
    reset  = 'server stays up; each test undone in the running server by TI (z.FPB.State.Save / Restore), untimed; file snapshot only for R8'
    affinity = $(if ($Affinity) { "TM1 service pinned to $Affinity, priority High" } else { 'none (Windows schedules the service)' })
    checks = 'the checks of a run (W1, W2, W8, M2, M4, L2) are read after the timer stops, untimed (z.FPB.Test.Check)'
    warmup = $(if ($NoWarmup) { 'none' } else { 'untimed warm-up reads (L1 + R1..R7) before the read tests whenever the cache was emptied' })
  }
  tests = [ordered]@{}
}
# results are written after every test, to a timestamped file and to tm1-results.json, so a long run
# that stops part-way keeps what it measured (rerun the rest with -Tests and the files can be merged)
$resultsFile = Join-Path $C.OutDirectory ('tm1-results_' + (Get-Date -Format 'yyyyMMdd_HHmmss') + '.json')
function Save-Results {
  $json = $results | ConvertTo-Json -Depth 6
  Set-Content -Path $resultsFile -Value $json
  Set-Content -Path (Join-Path $C.OutDirectory 'tm1-results.json') -Value $json
}
$results.started = (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss')
if ($FromSnapshot) { Restore-Snapshot }

foreach ($t in $order) {
  $spec = $plan.tests.$t
  $times = @(); $status = 'ok'; $tStart = Get-Date
  Log "$t start"
  try {
    $n = if ($Quick) { 1 } else { [int]$spec.repeats }
    switch -Regex ($t) {
      '^L1$' {
        for ($i = 0; $i -lt $n; $i++) {
          # From an empty model, as FPABench's L1: the run destroys the four cubes and every FPB dimension,
          # then builds, sets up and loads them, all inside the timer.
          $r = Invoke-TI 'z.FPB.Run.L1' @{ pPkgDir = $C.PackageDirectory; pDataDir = $C.StageDirectory; pBuild = 1; pStructDir = $C.StructureDirectory
            pMasterDir = (Join-FPBenchPath $C.DatasetDirectory 'master'); pClear = 1; pBulk = 1; pSave = 1; pOut = (Join-Path $answers "L1_$i.csv") }
          if ($r.exit -ne 0) { throw "L1 exit $($r.exit)" }
          $times += $r.ms
        }
        Save-Snapshot
        $script:cold = $true          # L1 re-attached the rules
        break
      }
      '^L2$' {
        for ($i = 0; $i -lt $n; $i++) {
          $j = Save-State 'L2' @{} "L2_$i"
          $r = Invoke-TI 'z.FPB.Test.L2' @{ pIncDir = $C.IncrementDirectory; pSave = 1; pOut = (Join-Path $answers "L2_$i.csv") }
          if ($r.exit -ne 0) { throw "L2 exit $($r.exit)" }
          $times += $r.ms
          Run-Check 'L2' @{} (Join-Path $answers "L2_$i.csv.check")
          Restore-State @($j)
        }
        break
      }
      '^(L3|W2|M1|M2|M3|M4)$' {
        $p = To-Hash $spec.runs[0].params
        if ($t -eq 'W2') { $p.pFile = $p.pFile.Replace('<OUT>', (Split-Path $C.PlanFile)) }
        if ($t -eq 'M1' -or $t -eq 'M4') { $p.pRulesDir = $rulesDir }
        $kind = if ($p.ContainsKey('pTest')) { $p.pTest } else { $t }
        for ($i = 0; $i -lt $n; $i++) {
          $j = Save-State $kind $p "${t}_$i"
          $p.pOut = (Join-Path $answers "${t}_$i.csv")
          $r = Invoke-TI $spec.process $p
          if ($r.exit -ne 0) { throw "$t exit $($r.exit)" }
          $times += $r.ms
          Run-Check $t $p ($p.pOut + '.check')
          Restore-State @($j)
        }
        break
      }
      '^W' {
        $runs = $spec.runs
        if ($Quick) { $runs = @($runs | Select-Object -First 4) }
        $done = @()
        try {
          foreach ($run in $runs) {
            $p = To-Hash $run.params
            if ($t -eq 'W8' -and -not $p.ContainsKey('pValue')) {
              $tmp = Join-Path $C.OutDirectory "W8_setup_$($run.index).txt"
              if (Test-Path $tmp) { Remove-Item $tmp }
              Invoke-Untimed 'z.FPB.Test.W8Setup' @{ pGroup = $p.pGroup; pOut = $tmp } 'W8 setup'
              $p.pValue = [double]::Parse(((Get-Content $tmp | Select-Object -First 1) -replace '"', '').Trim(), [System.Globalization.CultureInfo]::InvariantCulture)
            }
            $done += Save-State $p.pTest $p "${t}_$($run.index)"
            $p.pOut = (Join-Path $answers "${t}_$($run.index).csv")
            $r = Invoke-TI $spec.process $p
            if ($r.exit -ne 0) { throw "$t run $($run.index) exit $($r.exit)" }
            if (-not $run.warmup) { $times += $r.ms }
            Run-Check $t $p ($p.pOut + '.check')
          }
        } finally { Restore-State $done }
        break
      }
      '^R8$' {
        Assert-LocalService 'R8 (it starts a stopped server)'
        for ($i = 0; $i -lt $n; $i++) {
          Stop-TM1
          $sw = [System.Diagnostics.Stopwatch]::StartNew()
          Start-Service -Name $C.ServiceName
          Set-TM1Affinity
          do { $r = Invoke-TI 'z.FPB.Read' @{ pTest = 'R8'; pOut = (Join-Path $answers "R8_$i.csv") } -Quiet; if ($r.exit -ne 0) { Start-Sleep -Milliseconds 100 } } while ($r.exit -ne 0 -and $sw.Elapsed.TotalSeconds -lt 900)
          $sw.Stop(); $times += $sw.Elapsed.TotalMilliseconds
        }
        $script:cold = $true
        break
      }
      '^R' {
        Warm-Up "before $t"
        $n = if ($Quick) { 1 } else { [int]$spec.warm }
        $p = To-Hash $spec.runs[0].params
        for ($i = 0; $i -lt $n; $i++) {
          $p.pOut = (Join-Path $answers "${t}_$i.csv")
          $r = Invoke-TI 'z.FPB.Read' $p
          if ($r.exit -ne 0) { throw "$t exit $($r.exit)" }
          $times += $r.ms
        }
        break
      }
      '^C' {
        if ($t -eq 'C2') { Warm-Up "before $t" }   # C2 only reads
        $p = To-Hash $spec.runs[0].params
        $j = $null
        if ($t -ne 'C2') { $j = Save-State $p.pTest $p "${t}_0" }
        $p.pOut = (Join-Path $answers "${t}_0.csv")
        try {
          $r = Invoke-TI $spec.process $p
          if ($r.exit -ne 0) { throw "$t exit $($r.exit)" }
          Run-Check $t $p ($p.pOut + '.check')
        } finally { if ($j) { Restore-State @($j) } }
        break
      }
    }
  } catch { $status = 'failed: ' + $_.Exception.Message; Log "$t $status" }
  $med = Median $times
  # netMedianMs = max(0, median - median REST round trip of an empty process): an estimate of the time
  # spent in TM1 beyond the call overhead, not a measurement taken inside the TM1 engine
  $entry = [ordered]@{ status = $status; rawMs = $times; medianMs = $med; netMedianMs = $(if ($med -ne $null) { [math]::Max(0, $med - $noopMs) } else { $null }) }
  if ($t -match '^W[13-8]') { $entry.p95Ms = P95 $times }
  $entry.wallSec = [math]::Round(((Get-Date) - $tStart).TotalSeconds, 1)
  $results.tests[$t] = $entry
  Save-Results
  Log ("{0} {1} median {2} ms (test took {3:N0} s incl. untimed resets)" -f $t, $status, $(if ($med -ne $null) { '{0:N1}' -f $med } else { '-' }), $entry.wallSec)
}
Save-Results
Log ('results: ' + $resultsFile + ' (and tm1-results.json)')
Close-FPBenchRest
