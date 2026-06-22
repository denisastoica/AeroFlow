Write-Host "================================" -ForegroundColor Cyan
Write-Host "TESTING FULL AUTHENTICATION FLOW" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Green
Write-Host ""

# Test 1: Backend API
Write-Host "TEST 1: Backend API Login Endpoint" -ForegroundColor Yellow
Write-Host "====================================" -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:8000/auth/login" `
        -Method POST `
        -ContentType "application/json" `
        -Body '{"email":"customer@example.com","password":"Pass123!"}' `
        -ErrorAction Stop
    
    $data = $response.Content | ConvertFrom-Json
    Write-Host "[✓] API returned token:" -ForegroundColor Green
    Write-Host "    - Token starts with: $($data.access_token.Substring(0, 20))..."
    Write-Host "    - User email: $($data.user.email)"
    Write-Host "    - User role: $($data.user.role)"
} catch {
    Write-Host "[✗] API ERROR: $_" -ForegroundColor Red
}
Write-Host ""

# Test 2: Frontend Server
Write-Host "TEST 2: Frontend Server Status" -ForegroundColor Yellow
Write-Host "===============================" -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://localhost:3000" `
        -ErrorAction SilentlyContinue `
        -UseBasicParsing
    if ($response.StatusCode -eq 200) {
        Write-Host "[✓] Frontend server is running on port 3000" -ForegroundColor Green
    }
} catch {
    Write-Host "[✗] Frontend not accessible: $_" -ForegroundColor Red
}
Write-Host ""

# Test 3: Check axios in frontend
Write-Host "TEST 3: Frontend Dependencies" -ForegroundColor Yellow
Write-Host "=============================" -ForegroundColor Yellow
$axiosPath = "c:\Users\Denisa\OneDrive\Desktop\Facultate\Licenta\frontend\node_modules\axios"
if (Test-Path $axiosPath) {
    Write-Host "[✓] axios is installed" -ForegroundColor Green
} else {
    Write-Host "[✗] axios is NOT installed" -ForegroundColor Red
}
Write-Host ""

# Test 4: Check API file is syntactically valid
Write-Host "TEST 4: Frontend api.js Syntax" -ForegroundColor Yellow
Write-Host "===============================" -ForegroundColor Yellow
$apiPath = "c:\Users\Denisa\OneDrive\Desktop\Facultate\Licenta\frontend\src\services\api.js"
$content = Get-Content $apiPath -Raw
if ($content -match 'export const authAPI' -and $content -match 'login:') {
    Write-Host "[✓] api.js contains authAPI export and login method" -ForegroundColor Green
    # Count occurrences of authAPI declaration
    $matches = [regex]::Matches($content, 'export const authAPI')
    if ($matches.Count -eq 1) {
        Write-Host "[✓] No duplicate authAPI declarations" -ForegroundColor Green
    } else {
        Write-Host "[✗] Found $($matches.Count) authAPI declarations (should be 1)" -ForegroundColor Red
    }
} else {
    Write-Host "[✗] api.js structure is invalid" -ForegroundColor Red
}
Write-Host ""

# Test 5: Manual cURL test to isolate issue
Write-Host "TEST 5: Simulating Frontend API Call" -ForegroundColor Yellow
Write-Host "====================================" -ForegroundColor Yellow
Write-Host "Sending login request like frontend would..."
try {
    $headers = @{
        "Content-Type" = "application/json"
    }
    
    $body = @{
        email = "customer@example.com"
        password = "Pass123!"
    } | ConvertTo-Json
    
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:8000/auth/login" `
        -Method POST `
        -ContentType "application/json" `
        -Body $body `
        -Headers $headers `
        -ErrorAction Stop
    
    Write-Host "[✓] Complete login flow works" -ForegroundColor Green
    Write-Host "    Status: $($response.StatusCode)"
    Write-Host "    Response size: $($response.Content.Length) bytes"
} catch {
    Write-Host "[✗] Login request failed: $_" -ForegroundColor Red
}

Write-Host ""
Write-Host "================================" -ForegroundColor Cyan
Write-Host "NEXT STEPS:" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Green
Write-Host "1. Open browser and go to: http://localhost:3000"
Write-Host "2. Hard refresh with: Ctrl+Shift+R"
Write-Host "3. Open DevTools with: F12"
Write-Host "4. Go to Console tab"
Write-Host "5. Try login with:"
Write-Host "   Email: customer@example.com"
Write-Host "   Password: Pass123!"
Write-Host "6. Look for [API] and [Login] messages in console"
Write-Host ""
Write-Host "If login works but you see errors in console,"
Write-Host "check the Network tab to see actual API requests"
Write-Host ""
