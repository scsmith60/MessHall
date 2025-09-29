// app.config.ts
// 🧸 ELI5: This file tells the app how to build.
// We fix the Android build by telling it which Kotlin number to use.
// Old bad number = 1.9.22 (makes Gradle cry). New happy number = 2.0.21.

import { ExpoConfig, ConfigContext } from 'expo/config'

// 🏷️ Easy-to-read names so it’s simple
const APP_NAME = 'MessHall'                 // pretty name people see
const ANDROID_PACKAGE = 'app.messhall'      // Android app id (don’t change after publish)
const IOS_BUNDLE = 'app.messhall'           // iOS bundle id

// 🔧 Safe versions for Android build tools
const KOTLIN_VERSION = '2.0.21'             // ✅ known-good with Expo SDK 53 / RN 0.79
const ANDROID_COMPILE_SDK = 35              // ✅ modern compile SDK
const ANDROID_TARGET_SDK = 35               // ✅ target SDK
const ANDROID_MIN_SDK = 24                  // ✅ min supported by Expo new arch

export default ({ config }: ConfigContext): ExpoConfig => ({
  // 👤 Owner helps EAS link builds to your account
  owner: 'scsmith60',

  // 🪪 App identity
  ...config,                 // keep any auto-injected Expo bits
  name: APP_NAME,
  slug: 'messhall',
  version: '1.0.1',          // human version; bump when you want

  // 🔗 Deep-link scheme like messhall://path
  scheme: 'messhall',

  // 📱 Device basics
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,

  // 🖼️ App icon & splash (make sure these files exist and are square where required)
  icon: './assets/icon.png',
  splash: {
    image: './assets/splash.png',
    resizeMode: 'contain',
    backgroundColor: '#0D1F16',
  },

  // 🔐 Env + EAS link
  extra: {
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    eas: { projectId: '521a656b-0e37-4ae1-aae2-f4fd552a48b7' },
  },

  // 🔌 Plugins (add-ons that tweak native builds)
  plugins: [
    // File-based routing
    'expo-router',

    // In-app browser
    'expo-web-browser',

    // 🎤 Voice commands while cooking
    [
      'expo-speech-recognition',
      {
        microphonePermission:
          "Let MessHall use the microphone to hear simple cooking commands like 'next' and 'back'.",
        speechRecognitionPermission:
          'Let MessHall understand your voice for hands-free cooking.',
        androidSpeechServicePackages: ['com.google.android.googlequicksearchbox'],
      },
    ],

    // 📤 Share sheet intake (so MessHall appears as a share target)
    'expo-share-intent',

    // 🎛️ Tidy system UI + quiet warnings
    'expo-system-ui',

    // 🧰 THE IMPORTANT FIX: Pin Kotlin + SDKs so Gradle is happy
    [
      'expo-build-properties',
      {
        android: {
          compileSdkVersion: ANDROID_COMPILE_SDK,
          targetSdkVersion: ANDROID_TARGET_SDK,
          minSdkVersion: ANDROID_MIN_SDK,
          kotlinVersion: KOTLIN_VERSION,
        },
      },
    ],
  ],

  // 🤖 Android settings
  android: {
    package: ANDROID_PACKAGE,
    versionCode: 2,                 // EAS can manage this; harmless here
    userInterfaceStyle: 'automatic',
    permissions: ['RECORD_AUDIO'],  // for speech

    // Adaptive icon (foreground image should be square & transparent where needed)
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#0D1F16',
    },

    // 🔗 Deep links (https and custom scheme)
    intentFilters: [
      {
        autoVerify: true,
        action: 'VIEW',
        category: ['BROWSABLE', 'DEFAULT'],
        data: [{ scheme: 'https', host: 'messhall.app', pathPrefix: '/' }],
      },
      {
        action: 'VIEW',
        category: ['BROWSABLE', 'DEFAULT'],
        data: [{ scheme: 'messhall' }],
      },
    ],
  },

  // 🍏 iOS settings
  ios: {
    bundleIdentifier: IOS_BUNDLE,
    supportsTablet: true,
    userInterfaceStyle: 'automatic',
    associatedDomains: ['applinks:messhall.app'],
    infoPlist: {
      NSSpeechRecognitionUsageDescription:
        "MessHall needs speech recognition to understand your cooking commands like 'next' and 'back'.",
      NSMicrophoneUsageDescription:
        'MessHall needs the microphone to listen for your cooking commands.',
    },
  },
})
