// plugins/with-patch-share-menu-gradle.js
const { withAppBuildGradle, createRunOncePlugin } = require('@expo/config-plugins');

const TAG = 'with-patch-share-menu-gradle';

function ensureCompileOptions(src) {
  if (/compileOptions\s*{[^}]*coreLibraryDesugaringEnabled\s+true/m.test(src)) return src;
  // Insert under android {} if possible; otherwise append at end.
  if (/android\s*{/.test(src)) {
    return src.replace(/android\s*{/, (m) => `${m}
    compileOptions {
        coreLibraryDesugaringEnabled true
    }`);
  }
  return `${src}

android {
    compileOptions {
        coreLibraryDesugaringEnabled true
    }
}
`;
}

const withPatchShareMenuGradle = (config) =>
  withAppBuildGradle(config, (cfg) => {
    if (!cfg.modResults?.contents) return cfg;
    cfg.modResults.contents = ensureCompileOptions(cfg.modResults.contents);
    return cfg;
  });

module.exports = createRunOncePlugin(withPatchShareMenuGradle, TAG, '1.0.0');
