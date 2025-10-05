// app.config.ts
// 🧸 ELI5: This paper tells the phone how to build our app.
// This version avoids native changes so you can build without prebuild.
// We rely on the runtime StatusBar change in _layout.tsx to kill the green strip.

import { ExpoConfig, ConfigContext } from 'expo/config'

// 🏷️ Easy-to-read names so it’s simple
const APP_NAME = 'MessHall'                 // pretty name people see
const ANDROID_PACKAGE = 'app.messhall'      // Android app id (don’t change after publish)
const IOS_BUNDLE = 'app.messhall'           // iOS bundle id

// 🔧 Safe versions (kept as-is if you already had them)
const KOTLIN_VERSION = '2.0.21'
const ANDROID_COMPILE_SDK = 35
const ANDROID_TARGET_SDK = 35
const ANDROID_MIN_SDK = 24

export default ({ config }: ConfigContext): ExpoConfig => ({
  // 👤 Owner helps EAS link builds to your account
  owner: 'scsmith60',

  // 🪪 App identity
  ...config,
  name: APP_NAME,
  slug: 'messhall',
  version: '1.0.1',

  // 🔗 Deep-link scheme like messhall://path
  scheme: 'messhall',

  // 📱 Device basics
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,

  // 🖼️ App icon & splash
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

  // 🔌 Plugins (kept simple so no prebuild is required)
  plugins: [
    'expo-router',
    'expo-web-browser',
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
    'expo-share-intent',
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
    versionCode: 2,
    userInterfaceStyle: 'automatic',
    permissions: ['RECORD_AUDIO'],
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#0D1F16',
    },
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
