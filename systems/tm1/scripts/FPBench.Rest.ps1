<#
  FPBench.Rest.ps1 - the TM1 REST API connection shared by Run-FPBench.ps1 and Import-FPBench.ps1.
  Dot-source it from a script that has loaded its config into $C and defines a Log function, then call
  Initialize-FPBenchRest.

  Config keys:
    RestBaseUrl               the server's .../api/v1 URL (required)
    User / Password           TM1 security (Basic sign-in)
    CAMNamespace              set it for CAM security
    RestAuthorization         a complete Authorization header instead, for other sign-in schemes
                              (for example a TM1 Database 12 API key)
    PasswordEnvVar            read the password from this environment variable instead of the file
                              (if neither Password nor PasswordEnvVar is set, the script asks for it)
    RestSkipCertificateCheck  $true accepts an invalid (for example self-signed) certificate, for the
                              RestBaseUrl host and port only (a server you control)
    AllowInsecureHttp         $true allows http:// for a server on this machine (localhost) only;
                              any other http:// URL is refused, because the sign-in would travel unencrypted
  The sign-in header and the password are never written to the console or to a log.

  Generated with the help of Claude Opus 5.5; requires validation. Provided as is (see LICENSE).
#>

function Initialize-FPBenchRest {
  $script:restSession = $null
  $script:restExtra = @{}
  $script:restParamTypes = @{}
  if (-not $C.RestBaseUrl) { throw 'RestBaseUrl is missing in the config, e.g. https://localhost:<HttpPortNumber>/api/v1' }
  $script:restBase = ([string]$C.RestBaseUrl).TrimEnd('/')
  $u = [Uri]$script:restBase
  if ($u.Scheme -ne 'https') {
    $local = $u.IsLoopback
    if (-not ($C.AllowInsecureHttp -and $local)) {
      throw ("RestBaseUrl uses {0}: the sign-in would travel unencrypted. Use https (the TM1 REST API default), or, for a server on this machine only, set AllowInsecureHttp = `$true." -f $u.Scheme)
    }
  }
  [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
  [System.Net.ServicePointManager]::Expect100Continue = $false     # else .NET waits for "100 Continue" before each POST body
  [System.Net.ServicePointManager]::UseNagleAlgorithm = $false
  if ($C.RestSkipCertificateCheck) {
    if ($PSVersionTable.PSVersion.Major -ge 6) {
      # PowerShell 7: the check is skipped per request, only on the requests these scripts send
      $script:restExtra = @{ SkipCertificateCheck = $true }
    } else {
      # Windows PowerShell 5.1 has no per-request switch: the .NET callback is process-wide. It is narrowed
      # to the RestBaseUrl host and port; every other connection is still validated as usual. It is a
      # compiled callback because a PowerShell script block cannot run on the threads that check certificates.
      if (-not ('FPBenchCertScope' -as [type])) {
        Add-Type -TypeDefinition @'
using System; using System.Net; using System.Net.Security; using System.Security.Cryptography.X509Certificates;
public static class FPBenchCertScope {
  public static string Host; public static int Port;
  static RemoteCertificateValidationCallback previous;
  static bool Check(object sender, X509Certificate c, X509Chain ch, SslPolicyErrors e) {
    if (e == SslPolicyErrors.None) return true;
    HttpWebRequest r = sender as HttpWebRequest;
    if (r != null && string.Equals(r.RequestUri.Host, Host, StringComparison.OrdinalIgnoreCase) && r.RequestUri.Port == Port) return true;
    return previous != null ? previous(sender, c, ch, e) : false;
  }
  public static void Enable(string host, int port) {
    Host = host; Port = port;
    if (ServicePointManager.ServerCertificateValidationCallback != (RemoteCertificateValidationCallback)Check) {
      previous = ServicePointManager.ServerCertificateValidationCallback;
      ServicePointManager.ServerCertificateValidationCallback = Check;
    }
  }
  public static void Disable() { ServicePointManager.ServerCertificateValidationCallback = previous; }
}
'@
      }
      [FPBenchCertScope]::Enable($u.Host, $u.Port)
      $script:restCertScoped = $true
    }
  }
}

function Close-FPBenchRest {
  # gives back the process-wide certificate callback (Windows PowerShell 5.1) when a script ends
  if ($script:restCertScoped) { [FPBenchCertScope]::Disable(); $script:restCertScoped = $false }
}

function Get-FPBenchPassword {
  if ($null -ne $script:fpbPassword) { return $script:fpbPassword }
  if ($C.PasswordEnvVar) {
    $v = [Environment]::GetEnvironmentVariable([string]$C.PasswordEnvVar)
    if ($null -eq $v) { throw "PasswordEnvVar: environment variable $($C.PasswordEnvVar) is not set" }
    $script:fpbPassword = [string]$v
  } elseif ($C.ContainsKey('Password')) {
    $script:fpbPassword = [string]$C.Password
  } else {
    $sec = Read-Host -AsSecureString ("TM1 password for {0}" -f $C.User)
    $script:fpbPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
  }
  return $script:fpbPassword
}

function Get-RestAuthorization {
  if ($C.RestAuthorization) { return [string]$C.RestAuthorization }
  $pw = Get-FPBenchPassword
  if ($C.CAMNamespace) {
    return 'CAMNamespace ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(('{0}:{1}:{2}' -f $C.User, $pw, $C.CAMNamespace)))
  }
  return 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(('{0}:{1}' -f $C.User, $pw)))
}

function Connect-Rest {
  # one sign-in; the server's session cookie (TM1SessionId) in the web session carries every later call
  $script:restSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  $r = Invoke-WebRequest -Uri ($script:restBase + '/Configuration/ProductVersion/$value') -Headers @{ Authorization = (Get-RestAuthorization) } `
    -WebSession $script:restSession -UseBasicParsing -TimeoutSec 60 @script:restExtra
  $v = $r.Content
  if ($v -is [byte[]]) { $v = [Text.Encoding]::UTF8.GetString($v) }
  $script:restServerVersion = [string]$v
}

function Get-RestStatus($ErrorRecord) {
  $code = 0
  try { $code = [int]$ErrorRecord.Exception.Response.StatusCode } catch { }
  return $code
}

function Invoke-FPBRest([string]$Method, [string]$Path, $Body = $null) {
  # one REST call relative to RestBaseUrl; signs in again once if the session was lost (401)
  $uri = $script:restBase + $Path
  for ($attempt = 1; $attempt -le 2; $attempt++) {
    if (-not $script:restSession) { Connect-Rest }
    try {
      $a = @{ Method = $Method; Uri = $uri; WebSession = $script:restSession; TimeoutSec = 600 }
      if ($null -ne $Body) {
        $json = if ($Body -is [string]) { $Body } else { ConvertTo-Json -InputObject $Body -Depth 8 -Compress }
        $a.Body = [Text.Encoding]::UTF8.GetBytes($json)
        $a.ContentType = 'application/json; charset=utf-8'
      }
      return (Invoke-RestMethod @a @script:restExtra)
    } catch {
      if ((Get-RestStatus $_) -eq 401 -and $attempt -eq 1) { $script:restSession = $null; continue }
      throw
    }
  }
}

function Get-RestParamTypes([string]$ProcUri) {
  # the parameter types the process declares (Numeric / String), read once per process and untimed;
  # a JSON number sent to a string parameter (or the reverse) is rejected by the server
  if (-not $script:restParamTypes.ContainsKey($ProcUri)) {
    $t = @{}
    try {
      if (-not $script:restSession) { Connect-Rest }
      $d = Invoke-RestMethod -Method Get -Uri ($ProcUri + '?$select=Parameters') -WebSession $script:restSession -TimeoutSec 60 @script:restExtra
      foreach ($q in @($d.Parameters)) { $t[[string]$q.Name] = [string]$q.Type }
    } catch { }                              # unknown: fall back to the value's own type
    $script:restParamTypes[$ProcUri] = $t
  }
  return $script:restParamTypes[$ProcUri]
}

function Get-ProcessPath([string]$Process) {
  return "/Processes('" + [Uri]::EscapeDataString(($Process -replace "'", "''")) + "')"
}

function Invoke-TI([string]$Process, [hashtable]$Params, [switch]$Quiet) {
  # runs a TI process and times the call (sign-in excluded); returns @{ ms; exit }:
  # exit 0 = CompletedSuccessfully, 3 = HasMinorErrors, 1 = anything else
  $procUri = $script:restBase + (Get-ProcessPath $Process)
  $uri = $procUri + '/tm1.ExecuteWithReturn'
  $plist = @()
  if ($Params -and $Params.Count -gt 0) {
    $types = Get-RestParamTypes $procUri
    foreach ($k in $Params.Keys) {
      $v = $Params[$k]
      $num = $v -is [double] -or $v -is [single] -or $v -is [decimal] -or $v -is [int] -or $v -is [long]
      if ($types.ContainsKey($k)) { $num = ($types[$k] -eq 'Numeric') }
      if ($num) { $plist += @{ Name = $k; Value = [double]$v } }
      else { $plist += @{ Name = $k; Value = [System.Convert]::ToString($v, [System.Globalization.CultureInfo]::InvariantCulture) } }
    }
  }
  $body = ConvertTo-Json -InputObject @{ Parameters = $plist } -Depth 4 -Compress
  $code = 1; $detail = ''; $ms = 0.0
  for ($attempt = 1; $attempt -le 2; $attempt++) {
    try {
      if (-not $script:restSession) { Connect-Rest }       # sign-in is not part of the timed call
      $sw = [System.Diagnostics.Stopwatch]::StartNew()
      $r = Invoke-RestMethod -Method Post -Uri $uri -Body ([Text.Encoding]::UTF8.GetBytes($body)) -ContentType 'application/json; charset=utf-8' `
        -WebSession $script:restSession -TimeoutSec 14400 @script:restExtra
      $sw.Stop(); $ms = $sw.Elapsed.TotalMilliseconds
      $st = [string]$r.ProcessExecuteStatusCode
      if ($st -eq 'CompletedSuccessfully') { $code = 0 } elseif ($st -eq 'HasMinorErrors') { $code = 3 } else { $code = 1 }
      $detail = $st
      break
    } catch {
      $http = Get-RestStatus $_
      $script:restSession = $null
      $detail = $_.Exception.Message
      if ($http -eq 401 -and $attempt -eq 1) { continue }    # session gone (server restarted): sign in again once
      $code = 1
      break
    }
  }
  if ($code -ne 0 -and -not $Quiet) { Log ("{0} exit {1}: {2}" -f $Process, $code, $detail) }
  [pscustomobject]@{ ms = $ms; exit = $code }
}
