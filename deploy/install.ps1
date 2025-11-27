# Customer Dashboard Installer for Windows
# CLEAN ASCII VERSION

Param(
    [string]$ComposeFile = "docker-compose.yml"
)

Write-Host "=== Customer Dashboard Installer (Windows) ==="
Write-Host ""

# -------------------------------------------------------------
# 0. ADMIN CHECK
# -------------------------------------------------------------
$IsAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole] "Administrator"
)

if (-not $IsAdmin) {
    Write-Host "ERROR: This script must be executed as Administrator."
    Write-Host "Right-click on PowerShell and select 'Run as Administrator'."
    exit 1
}

# -------------------------------------------------------------
# 1. Determine Directories
# -------------------------------------------------------------
$deployDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$packageRoot = Split-Path -Parent $deployDir

$InstallDir   = "C:\CustomerDashboard"
$TargetDeploy = "$InstallDir\deploy"
$TargetDaemon = "$InstallDir\system-daemon"
$LogDir       = "$InstallDir\logs"
$TaskName     = "CustomerDashboardAutoUpdater"

Write-Host "Installer directory:    $deployDir"
Write-Host "Package root directory: $packageRoot"
Write-Host ""

# -------------------------------------------------------------
# 2. Create Target Directories
# -------------------------------------------------------------
Write-Host "Creating installation directories..."
New-Item -ItemType Directory -Force -Path $InstallDir    | Out-Null
New-Item -ItemType Directory -Force -Path $TargetDeploy  | Out-Null
New-Item -ItemType Directory -Force -Path $TargetDaemon  | Out-Null
New-Item -ItemType Directory -Force -Path $LogDir        | Out-Null

# -------------------------------------------------------------
# 3. Robust Copy Function (Retry)
# -------------------------------------------------------------
function Copy-WithRetry($source, $target) {
    $success = $false

    for ($i = 1; $i -le 5; $i++) {
        try {
            Copy-Item -Recurse -Force $source $target
            $success = $true
            break
        } catch {
            Start-Sleep -Milliseconds 500
        }
    }

    if (-not $success) {
        Write-Host "ERROR: Failed to copy from $source to $target"
        exit 1
    }
}

Write-Host "Copying files..."
Copy-WithRetry "$deployDir\*" $TargetDeploy

$daemonSource = "$packageRoot\system-daemon"
if (-not (Test-Path $daemonSource)) {
    Write-Host "ERROR: system-daemon directory missing in package."
    exit 1
}
Copy-WithRetry "$daemonSource\*" $TargetDaemon

# -------------------------------------------------------------
# 4. Validate .env File
# -------------------------------------------------------------
$envPath = "$TargetDeploy\.env"

if (-not (Test-Path $envPath)) {
    Write-Host "ERROR: .env file is missing in target deploy directory."
    exit 1
}

$envLines = Get-Content $envPath
$version  = ($envLines | Where-Object { $_ -match '^APP_VERSION=' }) -replace 'APP_VERSION=',''
$portLine = ($envLines | Where-Object { $_ -match '^APP_PORT=' })
$port     = if ($portLine) { $portLine -replace 'APP_PORT=','' } else { "8080" }

Write-Host "Version: $version"
Write-Host "Port:    $port"
Write-Host ""

# -------------------------------------------------------------
# 5. Docker Compose Path
# -------------------------------------------------------------
$composeFilePath = Join-Path $TargetDeploy $ComposeFile

if (-not (Test-Path $composeFilePath)) {
    Write-Host "ERROR: docker-compose.yml missing."
    exit 1
}

# -------------------------------------------------------------
# 6. Stop Docker Services
# -------------------------------------------------------------
Write-Host "Stopping old dashboard containers..."
docker compose -f "$composeFilePath" down | Out-Null

# -------------------------------------------------------------
# 7. Start Docker Services
# -------------------------------------------------------------
Write-Host "Pulling latest image..."
docker compose -f "$composeFilePath" pull

Write-Host "Starting dashboard..."
docker compose -f "$composeFilePath" up -d

Start-Sleep 10

# -------------------------------------------------------------
# 8. HTTP Check
# -------------------------------------------------------------
Write-Host "Checking dashboard availability..."
$uri = "http://localhost:$port/"

try {
    Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec 10 | Out-Null
    Write-Host "Dashboard successfully started."
} catch {
    Write-Host "WARNING: Dashboard is running, but HTTP test failed."
}

# -------------------------------------------------------------
# 9. Install Auto-Update Daemon (Scheduled Task)
# -------------------------------------------------------------
Write-Host "Installing auto-update daemon..."

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

$action = New-ScheduledTaskAction -Execute "node.exe" -Argument "$TargetDaemon\daemon.js"
$trigger = New-ScheduledTaskTrigger -AtStartup

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -RunLevel Highest `
    -Force | Out-Null

Write-Host "Auto-update daemon installed."

# -------------------------------------------------------------
# 10. Finished
# -------------------------------------------------------------
Write-Host ""
Write-Host "INSTALLATION COMPLETE."
Write-Host "Dashboard: http://localhost:$port/"
Write-Host "Auto-Update Task: $TaskName"
Write-Host "Logs: $LogDir"
