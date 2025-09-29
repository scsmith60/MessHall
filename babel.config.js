// babel.config.js
// 👶 ELI5: This tells the app how to read your code super fast.
// What we changed:
// - ❌ Removed "expo-router/babel" (it's old and makes warnings).
// - ✅ Kept "babel-preset-expo" (the new way).
// - ✅ Kept "module-resolver" so "@/..." paths work.
// - ✅ Kept Reanimated plugin LAST (it’s picky about order).

module.exports = function (api) {
  // Cache for speed
  api.cache(true);

  return {
    // ✅ New preset for Expo SDK 50+ (covers expo-router too)
    presets: ['babel-preset-expo'],

    // 🧩 Extra helpers
    plugins: [
      // Teaches Metro what "@/..." means (nice short imports)
      [
        'module-resolver',
        {
          root: ['./'],
          alias: {
            '@': './', // so "@/components/Button" == "./components/Button"
          },
          extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
        },
      ],

      // 👇 MUST be last: Reanimated needs to be the final plugin
      'react-native-reanimated/plugin',
    ],
  };
};
