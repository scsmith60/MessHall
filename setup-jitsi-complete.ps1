# Complete Jitsi SDK Setup Script for MessHall
# This script automates the entire setup process

Write-Host "`n=== Jitsi SDK Complete Setup ===" -ForegroundColor Cyan
Write-Host ""

# Step 1: Ensure gradlePluginVersion is set
Write-Host "Step 1: Configuring Android build.gradle..." -ForegroundColor Yellow
$buildGradlePath = "android\build.gradle"
$buildGradle = Get-Content $buildGradlePath -Raw

if (-not ($buildGradle -match "gradlePluginVersion")) {
    Write-Host "  Adding gradlePluginVersion to build.gradle..." -ForegroundColor Gray
    $extBlock = @"

// CRITICAL: Jitsi SDK REQUIRES this - removing it will break the build
// The Jitsi SDK's build.gradle file references `$rootProject.ext.gradlePluginVersion` on line 8
ext {
    gradlePluginVersion = '8.5.2'
}
"@
    
    # Find the line after "apply plugin: com.facebook.react.rootproject"
    $buildGradle = $buildGradle -replace '(apply plugin: "com\.facebook\.react\.rootproject")', "`$1`n$extBlock"
    Set-Content -Path $buildGradlePath -Value $buildGradle -NoNewline
    Write-Host "  ✅ gradlePluginVersion added" -ForegroundColor Green
} else {
    Write-Host "  ✅ gradlePluginVersion already configured" -ForegroundColor Green
    # Double-check it's actually there (might be commented out)
    if ($buildGradle -notmatch "ext\s*\{[\s\S]*gradlePluginVersion") {
        Write-Host "  ⚠️  Warning: gradlePluginVersion found but ext block may be incomplete" -ForegroundColor Yellow
    }
}

# Step 2: Install all Jitsi peer dependencies
Write-Host "`nStep 2: Installing Jitsi SDK peer dependencies..." -ForegroundColor Yellow
$dependencies = @(
    "@amplitude/analytics-react-native@1.4.13",
    "@amplitude/analytics-core",
    "@giphy/react-native-sdk@4.1.0",
    "@react-native-async-storage/async-storage@1.23.1",
    "@react-native-clipboard/clipboard@1.14.3",
    "@react-native-community/netinfo@11.1.0",
    "@react-native-community/slider@4.5.6",
    "@react-native-google-signin/google-signin@10.1.0",
    "@sayem314/react-native-keep-awake@1.3.1",
    "react-native-background-timer@github:jitsi/react-native-background-timer#d180dfaa4486ae3ee17d01242db92cb3195f4718",
    "react-native-calendar-events@github:jitsi/react-native-calendar-events#47f068dedfed7c0f72042e093f688eb11624eb7b",
    "react-native-default-preference@github:jitsi/react-native-default-preference#c9bf63bdc058e3fa2aa0b87b1ee1af240f44ed02",
    "react-native-device-info@12.1.0",
    "react-native-get-random-values@1.11.0",
    "react-native-gesture-handler@2.24.0",
    "react-native-pager-view@6.8.1",
    "react-native-performance@5.1.2",
    "react-native-orientation-locker@github:jitsi/react-native-orientation-locker#fe095651d819cf134624f786b61fc8667862178a",
    "react-native-safe-area-context@5.5.2",
    "react-native-screens@4.11.1",
    "react-native-sound@github:jitsi/react-native-sound#ea13c97b5c2a4ff5e0d9bacbd9ff5e4457fe2c3c",
    "react-native-splash-view@0.0.18",
    "react-native-svg@15.11.2",
    "react-native-video@6.13.0",
    "react-native-watch-connectivity@1.1.0",
    "react-native-webrtc@124.0.7",
    "react-native-webview@13.13.5",
    "react-native-worklets-core@github:jitsi/react-native-worklets-core#8c5dfab2a5907305da8971696a781b60f0f9cb18"
)

$dependenciesList = $dependencies -join " "
npm install $dependenciesList --legacy-peer-deps

if ($LASTEXITCODE -ne 0) {
    Write-Host "  ❌ Dependency installation failed!" -ForegroundColor Red
    exit 1
}
Write-Host "  ✅ All dependencies installed" -ForegroundColor Green

# Step 3: Fix Kotlin compilation errors in dependencies
Write-Host "`nStep 3: Fixing Kotlin compilation errors..." -ForegroundColor Yellow

# Fix Amplitude analytics
$amplitudeFile = "node_modules\@amplitude\analytics-react-native\android\src\main\java\com\amplitude\reactnative\AndroidContextProvider.kt"
if (Test-Path $amplitudeFile) {
    $content = Get-Content $amplitudeFile -Raw
    if ($content -match 'toUpperCase\(Locale') {
        $content = $content -replace '\.toUpperCase\(Locale', '.uppercase(Locale'
        Set-Content -Path $amplitudeFile -Value $content -NoNewline
        Write-Host "  ✅ Fixed Amplitude toUpperCase deprecation" -ForegroundColor Green
    }
}

# Fix react-native-video Event type - Kotlin 2.0 prohibits projections in supertype clauses with recursive generics
# Solution: Replace anonymous object with concrete VideoEvent class
$videoFile = "node_modules\react-native-video\android\src\main\java\com\brentvatne\common\react\VideoEventEmitter.kt"
if (Test-Path $videoFile) {
    $content = Get-Content $videoFile -Raw
    
    # Check if it still uses the old pattern with projections
    if ($content -match 'object\s*:\s*Event<[^>]*>\(surfaceId,\s*viewId\)') {
        # Replace with concrete VideoEvent class approach
        $videoEventClass = @"

    private class VideoEvent(surfaceId: Int, viewId: Int, private val eventName: String, private val eventData: WritableMap?) : Event<VideoEvent>(surfaceId, viewId) {
        override fun getEventName() = eventName
        override fun getEventData() = eventData
    }

    private class EventBuilder(private val surfaceId: Int, private val viewId: Int, private val dispatcher: EventDispatcher) {
        fun dispatch(event: EventTypes, paramsSetter: (WritableMap.() -> Unit)? = null) {
            val eventName = "top`${'$'}{event.eventName.removePrefix("on")}"
            val eventData = Arguments.createMap().apply(paramsSetter ?: {})
            dispatcher.dispatchEvent(VideoEvent(surfaceId, viewId, eventName, eventData))
        }
    }
"@
        
        # Find and replace the EventBuilder class
        $oldPattern = '(?s)    private class EventBuilder.*?dispatchEvent\(.*?\}\s*\}'
        if ($content -match $oldPattern) {
            $content = $content -replace $oldPattern, $videoEventClass
            Set-Content -Path $videoFile -Value $content -NoNewline
            Write-Host "  ✅ Fixed react-native-video Event type using concrete VideoEvent class" -ForegroundColor Green
        } else {
            Write-Host "  ⚠️  react-native-video EventBuilder pattern not found, may already be fixed" -ForegroundColor Yellow
        }
    } else {
        Write-Host "  ✅ react-native-video Event type appears to be already fixed" -ForegroundColor Green
    }
}

# Step 4: Apply patch-package
Write-Host "`nStep 4: Applying patches..." -ForegroundColor Yellow
npm run postinstall
if ($LASTEXITCODE -eq 0) {
    Write-Host "  ✅ Patches applied successfully" -ForegroundColor Green
} else {
    Write-Host "  ⚠️  Patch application had issues (may be OK if already applied)" -ForegroundColor Yellow
}

# Step 5: Clear caches
Write-Host "`nStep 5: Clearing build caches..." -ForegroundColor Yellow
if (Test-Path "android\.gradle") {
    Remove-Item -Recurse -Force "android\.gradle" -ErrorAction SilentlyContinue
    Write-Host "  ✅ Gradle cache cleared" -ForegroundColor Gray
}
if (Test-Path "android\app\build") {
    Remove-Item -Recurse -Force "android\app\build" -ErrorAction SilentlyContinue
    Write-Host "  ✅ Android build cache cleared" -ForegroundColor Gray
}
if (Test-Path ".expo") {
    Remove-Item -Recurse -Force ".expo" -ErrorAction SilentlyContinue
    Write-Host "  ✅ Expo cache cleared" -ForegroundColor Gray
}

Write-Host "`n=== Setup Complete! ===" -ForegroundColor Green
Write-Host "`nNext steps:" -ForegroundColor Cyan
Write-Host "  1. Run: npx expo start --clear" -ForegroundColor White
Write-Host "  2. Or: npx expo run:android" -ForegroundColor White
Write-Host ""

