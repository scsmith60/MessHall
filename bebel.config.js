module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // keep other plugins if you add them
      'react-native-reanimated/plugin',
    ],
  };
};
