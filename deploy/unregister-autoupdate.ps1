Param(
    [string]$TaskName = "CustomerDashboardAutoUpdate"
)

try {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Task '$TaskName' wurde entfernt." -ForegroundColor Green
}
catch {
    Write-Host "Fehler beim Entfernen: $($_.Exception.Message)" -ForegroundColor Red
}
