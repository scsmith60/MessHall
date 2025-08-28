// babel.config.js
// 👶 This tells Babel how to read your code.
// 👇 We use "babel-preset-expo" (the new, correct way).
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      // ✅ This preset replaces the old "expo-router/babel" plugin usage.
      "babel-preset-expo",
    ],
    plugins: [
      // ❌ DO NOT include "expo-router/babel" anymore.
      // ✅ Keep Reanimated plugin LAST so animations work.
      "react-native-reanimated/plugin",
    ],
  };
};
