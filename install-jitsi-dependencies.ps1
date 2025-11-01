# Jitsi SDK Complete Dependency Installation Script
# This script installs all required peer dependencies for @jitsi/react-native-sdk

Write-Host "Installing all Jitsi SDK peer dependencies..." -ForegroundColor Cyan

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
$command = "npm install $dependenciesList --legacy-peer-deps"

Write-Host "Running: npm install with --legacy-peer-deps" -ForegroundColor Yellow
Invoke-Expression $command

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n✅ All dependencies installed successfully!" -ForegroundColor Green
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "1. Run: npx expo start --clear" -ForegroundColor White
    Write-Host "2. Or: npx expo run:android" -ForegroundColor White
} else {
    Write-Host "`n❌ Installation failed. Check errors above." -ForegroundColor Red
    exit 1
}

