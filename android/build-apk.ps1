$ErrorActionPreference = "Stop"

$AndroidDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $AndroidDir
$PythonDir = Join-Path $AndroidDir "app\src\main\python"
$ToolsDir = Join-Path $ProjectDir ".android-tools"

$PortableJdk = Get-ChildItem (Join-Path $ToolsDir "jdk") -Directory |
    Select-Object -First 1
$PortableGradle = Join-Path $ToolsDir "gradle\gradle-9.4.1\bin\gradle.bat"
$PortableSdk = Join-Path $ToolsDir "sdk"
$Keystore = Join-Path $AndroidDir "lesson-library.keystore"

# Signing secrets come from android/keystore.properties (gitignored); fall back
# to a throwaway default for fresh forks (must match app/build.gradle).
$StorePass = "android"
$KeyPass = "android"
$KeyAlias = "lessonlibrary"
$KeystoreProps = Join-Path $AndroidDir "keystore.properties"
if (Test-Path $KeystoreProps) {
    Get-Content $KeystoreProps | ForEach-Object {
        if ($_ -match '^\s*storePassword\s*=\s*(.+?)\s*$') { $StorePass = $Matches[1] }
        elseif ($_ -match '^\s*keyPassword\s*=\s*(.+?)\s*$') { $KeyPass = $Matches[1] }
        elseif ($_ -match '^\s*keyAlias\s*=\s*(.+?)\s*$') { $KeyAlias = $Matches[1] }
    }
}

if ($PortableJdk) {
    $env:JAVA_HOME = $PortableJdk.FullName
    $env:Path = (Join-Path $env:JAVA_HOME "bin") + ";" + $env:Path
}
if (Test-Path $PortableSdk) {
    $env:ANDROID_HOME = $PortableSdk
    $env:ANDROID_SDK_ROOT = $PortableSdk
}
if (-not $env:GRADLE_USER_HOME) {
    $env:GRADLE_USER_HOME = Join-Path $ToolsDir "gradle-home"
}

if (-not (Test-Path $Keystore)) {
    if (-not $env:JAVA_HOME) {
        throw "Java is required to create the APK signing key."
    }
    & (Join-Path $env:JAVA_HOME "bin\keytool.exe") `
        -genkeypair -noprompt `
        -keystore $Keystore `
        -storepass $StorePass `
        -alias $KeyAlias `
        -keypass $KeyPass `
        -keyalg RSA `
        -keysize 2048 `
        -validity 10000 `
        -dname "CN=Lesson Library, O=Personal, C=US"
    if ($LASTEXITCODE -ne 0) {
        throw "Could not create the APK signing key."
    }
}

Copy-Item (Join-Path $ProjectDir "server.py") (Join-Path $PythonDir "server.py") -Force
$PackagedStatic = Join-Path $PythonDir "static"
New-Item -ItemType Directory -Force -Path $PackagedStatic | Out-Null
Copy-Item (Join-Path $ProjectDir "static\*") $PackagedStatic -Recurse -Force

# Chaquopy needs a real Python 3.11 interpreter to assemble the pip
# requirements (Flask). Gradle only auto-detects interpreters the `py`
# launcher knows about, so locate 3.11 ourselves — py launcher first, then a
# uv-managed CPython, then a python3.11 on PATH — and hand Chaquopy the exact
# path. If none is found we let Gradle try its own detection.
$BuildPython = $null
try {
    $p = & py -3.11 -c "import sys; print(sys.executable)" 2>$null
    if ($LASTEXITCODE -eq 0 -and $p) { $BuildPython = $p.Trim() }
} catch { }
if (-not $BuildPython) {
    $uv = Get-ChildItem (Join-Path $env:APPDATA "uv\python\cpython-3.11*\python.exe") `
        -ErrorAction SilentlyContinue | Sort-Object FullName -Descending |
        Select-Object -First 1
    if ($uv) { $BuildPython = $uv.FullName }
}
if (-not $BuildPython) {
    $cmd = Get-Command python3.11 -ErrorAction SilentlyContinue
    if ($cmd) { $BuildPython = $cmd.Source }
}
if ($BuildPython) {
    Write-Host "Using Python 3.11 for Chaquopy: $BuildPython"
} else {
    Write-Host "No explicit Python 3.11 found; relying on Gradle auto-detection."
}

$GradleArgs = @("assembleDebug")
if ($BuildPython) {
    $GradleArgs += "-PchaquopyPython=$BuildPython"
}

Push-Location $AndroidDir
try {
    if (Test-Path $PortableGradle) {
        & $PortableGradle @GradleArgs
    } elseif (Test-Path ".\gradlew.bat") {
        & .\gradlew.bat @GradleArgs
    } else {
        throw "Gradle is not installed and the portable build kit was not found."
    }
    if ($LASTEXITCODE -ne 0) {
        throw "Android build failed."
    }
} finally {
    Pop-Location
}

$Apk = Join-Path $AndroidDir "app\build\outputs\apk\debug\app-debug.apk"
$FriendlyApk = Join-Path $ProjectDir "LessonLibrary.apk"
Copy-Item $Apk $FriendlyApk -Force
Write-Host ""
Write-Host "APK ready:"
Write-Host $FriendlyApk
