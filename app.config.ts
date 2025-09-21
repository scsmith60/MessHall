// app.config.ts
// 🧸 like I’m 5:
// This file tells Expo everything about your app.
// We add a custom URL scheme (messhall://), the mic/speech plugin,
// Android/iOS permissions, and keep your Supabase + projectId.

import { ExpoConfig, ConfigContext } from 'expo/config';

const APP_NAME = 'MessHall';           // pretty name
const ANDROID_PACKAGE = 'app.messhall';// reverse-DNS id (keep consistent)
const IOS_BUNDLE = 'app.messhall';     // iOS bundle id (match Android)

export default ({ config }: ConfigContext): ExpoConfig => ({
  // 🔹 basics
  ...config,
  name: APP_NAME,
  slug: 'messhall',
  version: '1.0.0',

  // 🔹 URL scheme so Linking uses messhall://...
  scheme: 'messhall',

  // 🔹 nice to have
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,

  // 🔹 icons/splash (keeping yours)
  icon: './assets/icon.png',
  splash: {
    image: './assets/splash.png',
    resizeMode: 'contain',
    backgroundColor: '#0D1F16',
  },

  // 🔹 public env + EAS project
  extra: {
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    eas: { projectId: '521a656b-0e37-4ae1-aae2-f4fd552a48b7' },
  },

  // 🔹 plugins we actually use
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
  ],

  // 🔹 Android settings
  android: {
    package: ANDROID_PACKAGE,
    versionCode: 1,
    userInterfaceStyle: 'automatic',
    permissions: ['RECORD_AUDIO'], // mic for voice commands
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#0D1F16',
    },
    // deep links for https://messhall.app/... and messhall://...
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

  // 🔹 iOS settings
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
});
