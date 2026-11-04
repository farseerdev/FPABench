@{
    System             = 'IBM Planning Analytics <version>'   # product and exact version, recorded in tm1-results.json
    # Copy to FPBench.config.psd1 and adjust. Used by Install-FPBench.ps1, Import-FPBench.ps1 and Run-FPBench.ps1.
    # FPBench.config.psd1 is listed in .gitignore: keep server addresses and credentials out of the repository.

    # ---- safety: the scripts stop unless this is $true. It confirms the server is an isolated, disposable
    #      benchmark environment holding nothing you need to keep (see Safety and operational risks in README.md)
    DisposableServer   = $false

    # ---- connection (REST API)
    RestBaseUrl        = 'https://localhost:<HttpPortNumber>/api/v1'   # https; http only with AllowInsecureHttp (localhost)
    User               = 'admin'
    PasswordEnvVar     = 'FPB_TM1_PASSWORD'      # read the password from this environment variable;
                                                 # or Password = '...' (never commit it), or neither: you are asked
    # CAMNamespace             = ''              # set for CAM security; leave out for TM1 security (Basic)
    # RestAuthorization        = ''              # a complete Authorization header instead, for other sign-in schemes
    # RestSkipCertificateCheck = $true           # accept an invalid / self-signed certificate, for RestBaseUrl's host only
    # AllowInsecureHttp        = $true           # allow http:// for a server on this machine only

    # ---- folders: everything below is derived from WorkDir (see FPBench.Config.ps1); the TM1 server
    #      must be able to read and write them
    WorkDir            = 'C:\FPABench-10m'
    # DatasetDirectory   = 'C:\FPABench-10m\official_10m'          # an existing FPABench 10m dataset
    # StageDirectory     = 'C:\FPABench-10m\tm1_load'
    # IncrementDirectory = 'C:\FPABench-10m\tm1_load_close-2026-07'
    # StructureDirectory = 'C:\FPABench-10m\tm1_structure'
    # OutDirectory       = 'C:\FPABench-10m\tm1_results'
    # LogDirectory       = 'C:\FPABench-10m\tm1_logs'
    # PlanFile           = 'C:\FPABench-10m\tm1_plan\plan.json'
    # ReferenceFile      = 'C:\FPABench-10m\tm1_reference\answers-duckdb-10m.json'
    # PackageDirectory   = '<this package, as the server sees it>'  # default: the folder above scripts\

    # ---- local server only: R8, -FromSnapshot and -Affinity (leave ServiceName out for a remote server)
    # ServiceName        = 'FPABench'            # the TM1 server's Windows service
    # DataDirectory      = 'C:\TM1\FPABench\Data'  # its data folder (file snapshot for R8 / -FromSnapshot)
    # SnapshotDirectory  = 'C:\FPABench-10m\tm1_snapshot'
}
