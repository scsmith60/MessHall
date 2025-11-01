# Jitsi SDK Setup - Automated Scripts

This directory contains automation scripts to set up all Jitsi SDK dependencies and configuration.

## Quick Setup

Run the complete setup script:

```powershell
.\setup-jitsi-complete.ps1
```

This script will:
1. ✅ Configure `android/build.gradle` with required `gradlePluginVersion`
2. ✅ Install all 27 required Jitsi SDK peer dependencies
3. ✅ Apply the Jitsi SDK patch (if needed)
4. ✅ Clear build caches

## Manual Steps (if needed)

If the automated script doesn't work, you can run individual steps:

### 1. Install Dependencies Only

```powershell
.\install-jitsi-dependencies.ps1
```

### 2. Fix Gradle Configuration

Ensure `android/build.gradle` contains:

```gradle
ext {
    gradlePluginVersion = '8.5.2'
}
```

### 3. Clear Caches and Rebuild

```powershell
# Clear caches
Remove-Item -Recurse -Force android\.gradle -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force android\app\build -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force .expo -ErrorAction SilentlyContinue

# Rebuild
npx expo start --clear
```

## Current Issues Being Resolved

If you encounter Kotlin compilation errors, try:

1. **Clean build:**
   ```powershell
   cd android
   .\gradlew.bat clean
   cd ..
   ```

2. **Check Kotlin version compatibility:**
   - Current: `android.kotlinVersion=2.0.21`
   - Some packages may need different versions

3. **Reinstall dependencies:**
   ```powershell
   npm install --legacy-peer-deps
   ```

## Dependencies Installed

See `JITSI_PEER_DEPENDENCIES.md` for the complete list of all 27 peer dependencies.

## Troubleshooting

### Build fails with "gradlePluginVersion" error
- Ensure `android/build.gradle` has the `ext { gradlePluginVersion = '8.5.2' }` block
- The automated script handles this automatically

### "Unable to resolve" errors
- Run `.\setup-jitsi-complete.ps1` to install all dependencies
- Clear Metro cache: `npx expo start --clear`

### Kotlin compilation errors
- Clean build: `cd android && .\gradlew.bat clean`
- Check Kotlin version in `android/gradle.properties`
- May need to update Kotlin version or package versions

## Next Steps After Setup

1. Run: `npx expo start --clear`
2. Or: `npx expo run:android`

