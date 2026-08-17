$ErrorActionPreference = "Stop"

$pythonPath = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $pythonPath)) {
    throw "The Python 3.14 virtual environment is missing. Create .venv before starting Voice Desk."
}

& $pythonPath (Join-Path $PSScriptRoot "app.py")
