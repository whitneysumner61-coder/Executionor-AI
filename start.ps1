# ═══════════════════════════════════════════════════════
# EXECUTIONOR — Launcher
# Installs deps, creates .env if missing, starts server
# ═══════════════════════════════════════════════════════

$env:PATH = "D:\npm-global;C:\Program Files\nodejs;" + $env:PATH
$DIR = "D:\tools\executionor"
Set-Location $DIR

function Log($m) { Write-Host "  $m" -ForegroundColor Cyan }
function Ok($m)  { Write-Host "  ✓ $m" -ForegroundColor Green }
function Err($m) { Write-Host "  ✗ $m" -ForegroundColor Red }

Write-Host ""
Write-Host "╔══════════════════════════════════════╗" -ForegroundColor Yellow
Write-Host "║   EXECUTIONOR  Production Launcher   ║" -ForegroundColor Yellow
Write-Host "╚══════════════════════════════════════╝" -ForegroundColor Yellow
Write-Host ""

# 1. Check .env
if (-not (Test-Path "$DIR\.env")) {
  Log "Creating .env from template..."
  Copy-Item "$DIR\.env.example" "$DIR\.env"
  Ok ".env created — edit D:\tools\executionor\.env to add your API keys"
} else {
  Ok ".env found"
}

# 2. Install dependencies
if (-not (Test-Path "$DIR\node_modules")) {
  Log "Installing npm dependencies..."
  $result = npm install --prefix $DIR 2>&1
  if ($LASTEXITCODE -eq 0) { Ok "Dependencies installed" }
  else { Err "npm install failed: $result"; exit 1 }
} else {
  Ok "node_modules present"
}

# 3. Start server
Log "Starting EXECUTIONOR on port 3100..."
Write-Host ""
node "$DIR\server.js"
