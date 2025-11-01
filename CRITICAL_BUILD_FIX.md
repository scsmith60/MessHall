# ⚠️ CRITICAL: Required Build Configuration

## The Problem

The Jitsi SDK's `android/build.gradle` file **REQUIRES** a property called `gradlePluginVersion` to be defined in your root `android/build.gradle` file.

**Line 8 of `node_modules/@jitsi/react-native-sdk/android/build.gradle`** references:
```gradle
classpath "com.android.tools.build:gradle:$rootProject.ext.gradlePluginVersion"
```

If this property is missing, the build will fail with:
```
> Could not find property 'gradlePluginVersion' on root project
```

## The Solution

Your `android/build.gradle` file **MUST** contain:

```gradle
apply plugin: "expo-root-project"
apply plugin: "com.facebook.react.rootproject"

// CRITICAL: Jitsi SDK REQUIRES this - removing it will break the build
ext {
    gradlePluginVersion = '8.5.2'
}
```

## Why It Keeps Getting Removed

If you're using auto-formatting or your IDE is cleaning up the file, it might remove this block thinking it's unnecessary. **DO NOT** remove it!

## Automatic Fix

Run the setup script to automatically restore this:

```powershell
.\setup-jitsi-complete.ps1
```

Or manually add the `ext` block after the `apply plugin` lines.

## Alternative: Make It Permanent

We've patched the Jitsi SDK to use a fallback value if the property is missing, but having it explicitly set is still recommended for compatibility.

