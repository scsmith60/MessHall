// plugins/with-project-gradle-overrides.js
const { withProjectBuildGradle, createRunOncePlugin } = require('@expo/config-plugins');

const TAG = 'with-project-gradle-overrides';

function injectRepo(src) {
  const needle = "maven { url 'https://www.jitpack.io' }";
  if (src.includes(needle)) return src;
  return src.replace(/allprojects\s*{\s*repositories\s*{[^}]*}/m, (block) => {
    if (block.includes(needle)) return block;
    return block.replace(/repositories\s*{/, (r) => `${r}\n        ${needle}`);
  });
}

const withProjectGradleOverrides = (config) =>
  withProjectBuildGradle(config, (cfg) => {
    if (!cfg.modResults?.contents) return cfg;
    cfg.modResults.contents = injectRepo(cfg.modResults.contents);
    return cfg;
  });

module.exports = createRunOncePlugin(withProjectGradleOverrides, TAG, '1.0.0');
