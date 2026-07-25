$ErrorActionPreference = "Stop"

$workerRoot = $PSScriptRoot
$projectRoot = (Resolve-Path (Join-Path $workerRoot "../..")).Path
$python = Join-Path $workerRoot ".venv/Scripts/python.exe"
$workerEntry = Join-Path $workerRoot "worker.py"
$distPath = Join-Path $projectRoot "build/unity-worker/win-x64"
$workPath = Join-Path $projectRoot "build/pyinstaller/work"
$specPath = Join-Path $projectRoot "build/pyinstaller/spec"
$executablePath = Join-Path $distPath "lorplus-unity-worker/lorplus-unity-worker.exe"

if (-not (Test-Path -LiteralPath $python -PathType Leaf))
{
    throw "The Python virtual environment was not found at $python."
}

if (-not (Test-Path -LiteralPath $workerEntry -PathType Leaf))
{
    throw "The Unity worker entry point was not found at $workerEntry."
}

$arguments = @(
    "-m", "PyInstaller",
    "--noconfirm",
    "--clean",
    "--onedir",
    "--console",
    "--noupx",
    "--collect-all", "UnityPy",
    "--collect-all", "fmod_toolkit",
    "--collect-data", "archspec",
    "--name", "lorplus-unity-worker",
    "--distpath", $distPath,
    "--workpath", $workPath,
    "--specpath", $specPath,
    $workerEntry
)

& $python @arguments

if ($LASTEXITCODE -ne 0)
{
    throw "PyInstaller exited with code $LASTEXITCODE."
}

if (-not (Test-Path -LiteralPath $executablePath -PathType Leaf))
{
    throw "The build completed without producing $executablePath."
}

Write-Host "Unity worker built successfully:"
Write-Host $executablePath
