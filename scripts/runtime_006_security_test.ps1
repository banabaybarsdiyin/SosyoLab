# No connection arguments: this harness can only target its own local container.
$ErrorActionPreference = 'Stop'
& node (Join-Path $PSScriptRoot 'runtime_006_security_test.js')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
