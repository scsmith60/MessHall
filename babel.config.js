// babel.config.js
// 👶 This tells Babel how to read your code and understand our aliases.
// IMPORTANT:
// - Keep "expo-router/babel" so Expo Router works.
// - Add "module-resolver" so Metro understands "@/..." imports.
// - Keep Reanimated plugin LAST.

module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      "babel-preset-expo",            // ✅ main Expo preset
    ],
    plugins: [
      "expo-router/babel",            // ✅ needed for expo-router
      [
        "module-resolver",            // ✅ teaches Metro what "@" means
        {
          root: ["./"],               // project root
          alias: {
            "@": "./"                 // "@/lib/..." → "./lib/..."
          },
          extensions: [".ts", ".tsx", ".js", ".jsx", ".json"]
        }
      ],
      "react-native-reanimated/plugin" // ✅ keep LAST
    ],
  };
};
