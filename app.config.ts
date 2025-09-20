// app.config.ts
// 🧸 What this file does:
// - Tells Expo/EAS your app's name, icon, Android package id,
// - Plumbs in your Supabase keys from env (EXPO_PUBLIC_*).

const APP_NAME = "MessHall";                 // 👈 Pretty name users see
const ANDROID_PACKAGE = "app.messhall";      // 👈 Play Store ID (reverse DNS). PICK ONCE!

export default ({ config }) => ({
  // 🎟️ App identity
  owner: "scsmith60",
  name: APP_NAME,
  slug: "messhall",
  version: "1.0.0",                          // 👈 Human version (bump for releases)

  // 🌶️ Public env values (okay for client): must start with EXPO_PUBLIC_
  extra: {
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    eas: {
      projectId: "521a656b-0e37-4ae1-aae2-f4fd552a48b7" // 👈 this links your folder to the cloud project
    }
  },

  // 🤖 Android-specific stuff
  android: {
    package: ANDROID_PACKAGE,                // 👈 CANNOT change after Play release
    versionCode: 1,                          // 👈 Must increase 1→2→3 for each store upload
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#0D1F16"            // 👈 Your MessHall green-ish background
    }
    // permissions: []                       // 👈 Add camera/notifications, etc. when needed
  },

  // 🖼️ Icon/Splash (optional but nice)
  icon: "./assets/icon.png",
  splash: {
    image: "./assets/splash.png",
    resizeMode: "contain",
    backgroundColor: "#0D1F16"
  },

  // 🧩 Plugins (leave empty unless a package needs config)
  plugins: []
});
