Param(
    [string]$TaskName  = "CustomerDashboardAutoUpdate",
    [string]$DailyTime = "14:32"  # Uhrzeit HH:mm (24h-Format)
)

# Skriptverzeichnis
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

# Pfad zu update.ps1
$updateScriptPath = Join-Path $scriptDir "update.ps1"

if (-not (Test-Path $updateScriptPath)) {
    Write-Host "ERROR: update.ps1 nicht gefunden unter $updateScriptPath" -ForegroundColor Red
    exit 1
}

Write-Host "Erstelle geplanten Task '$TaskName' für $DailyTime täglich…" -ForegroundColor Cyan

# PowerShell-Executable finden
$psExe = (Get-Command powershell.exe).Source

# Aktion: update.ps1 ausführen
$action = New-ScheduledTaskAction `
    -Execute $psExe `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$updateScriptPath`""

# Trigger: täglich um $DailyTime
$timeParts = $DailyTime.Split(":")
$hour   = [int]$timeParts[0]
$minute = [int]$timeParts[1]

$triggerTime = [datetime]::Today.AddHours($hour).AddMinutes($minute)
$trigger = New-ScheduledTaskTrigger -Daily -At $triggerTime

# Principal: aktueller Benutzer mit höchsten Rechten
$principal = New-ScheduledTaskPrincipal -UserId $env:UserName -RunLevel Highest

# Task registrieren (überschreibt bei Bedarf)
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Force

Write-Host "Fertig. Der Task '$TaskName' läuft jetzt täglich um $DailyTime." -ForegroundColor Green
Write-Host "Du findest ihn in der Aufgabenplanung unter 'Aufgabenplanungsbibliothek'." -ForegroundColor Green
