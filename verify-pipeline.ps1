# Voxaria Pipeline Verification Script
Write-Host "=== VOXARIA PIPELINE VERIFICATION ===" -ForegroundColor Cyan

# 1. Start PM2 processes
Write-Host "[1/8] Starting PM2 processes..." -ForegroundColor Yellow
cd C:\Bot\MusicBot
pm2 start ecosystem.config.js
Start-Sleep 5

# 2. Verify PM2 status
Write-Host "[2/8] Checking PM2 status..." -ForegroundColor Yellow
pm2 status
if ($LASTEXITCODE -ne 0) { Write-Error "PM2 failed"; exit 1 }

# 3. Wait for API health
Write-Host "[3/8] Waiting for API health..." -ForegroundColor Yellow
$healthOk = $false
for ($i = 0; $i -lt 30; $i++) {
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:3002/health/live" -TimeoutSec 5
        if ($r.StatusCode -eq 200) { $healthOk = $true; break }
    } catch {}
    Start-Sleep 2
}
if (-not $healthOk) { Write-Error "API health check failed"; exit 1 }
Write-Host "  ✅ API health OK" -ForegroundColor Green

# 4. Start ngrok
Write-Host "[4/8] Starting ngrok tunnel..." -ForegroundColor Yellow
$ngrokProc = Start-Process -FilePath "C:\Bot\ngrok.exe" -ArgumentList "http","3002","--url=https://unhitched-shrink-dorsal.ngrok-free.dev" -WindowStyle Hidden -PassThru
Start-Sleep 5

# 5. Verify ngrok endpoints
Write-Host "[5/8] Verifying ngrok endpoints..." -ForegroundColor Yellow
$ngrokBase = "https://unhitched-shrink-dorsal.ngrok-free.dev"
$headers = @{ "ngrok-skip-browser-warning" = "true"; "Origin" = "https://voxaria.lovable.app" }

$endpoints = @(
    @{ path = "/health/live"; method = "GET"; expected = 200 },
    @{ path = "/bot/status"; method = "GET"; expected = 200 },
    @{ path = "/auth/session"; method = "OPTIONS"; expected = 204; extraHeaders = @{ "Access-Control-Request-Method" = "GET" } },
    @{ path = "/music/player"; method = "OPTIONS"; expected = 204; extraHeaders = @{ "Access-Control-Request-Method" = "GET"; "Access-Control-Request-Headers" = "authorization,content-type" } }
)

foreach ($ep in $endpoints) {
    $h = $headers.Clone()
    if ($ep.extraHeaders) { $ep.extraHeaders.GetEnumerator() | ForEach-Object { $h[$_.Key] = $_.Value } }
    try {
        $r = Invoke-WebRequest -Uri "$ngrokBase$($ep.path)" -Method $ep.method -Headers $h -TimeoutSec 10
        if ($r.StatusCode -eq $ep.expected) {
            Write-Host "  ✅ $($ep.method) $($ep.path) = $($r.StatusCode)" -ForegroundColor Green
        } else {
            Write-Host "  ❌ $($ep.method) $($ep.path) = $($r.StatusCode) (expected $($ep.expected))" -ForegroundColor Red
        }
    } catch {
        Write-Host "  ❌ $($ep.method) $($ep.path) failed: $($_.Exception.Message)" -ForegroundColor Red
    }
}

# 6. Test auth flow (requires manual Discord login)
Write-Host "[6/8] Auth flow requires manual test:" -ForegroundColor Yellow
Write-Host "  1. Open https://voxaria.lovable.app" -ForegroundColor Cyan
Write-Host "  2. Click 'Login with Discord'" -ForegroundColor Cyan
Write-Host "  3. Complete Discord consent" -ForegroundColor Cyan
Write-Host "  4. Verify redirect back to Lovable" -ForegroundColor Cyan
Write-Host "  4. Check console for NO 'accessToken is not defined' errors" -ForegroundColor Cyan

# 7. Test authenticated endpoints after login
Write-Host "[7/8] After login, test these endpoints:" -ForegroundColor Yellow
Write-Host "  - GET /music/player" -ForegroundColor Cyan
Write-Host "  - GET /music/queue" -ForegroundColor Cyan
Write-Host "  - GET /music/history" -ForegroundColor Cyan
Write-Host "  - GET /system/audio-cache" -ForegroundColor Cyan

# 8. Test WebSocket
Write-Host "[8/8] WebSocket test:" -ForegroundColor Yellow
Write-Host "  wss://unhitched-shrink-dorsal.ngrok-free.dev/ws/karaoke?guildId=<GUILD>&token=<JWT>" -ForegroundColor Cyan

Write-Host "=== VERIFICATION COMPLETE ===" -ForegroundColor Cyan