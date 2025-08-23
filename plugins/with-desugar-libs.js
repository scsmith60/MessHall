// plugins/with-desugar-libs.js
const { withAppBuildGradle } = require("@expo/config-plugins");

/**
 * Ensures the coreLibraryDesugaring dependency exists in app/build.gradle.
 */
module.exports = function withDesugarLibs(config) {
  return withAppBuildGradle(config, (cfg) => {
    const mod = cfg.modResults;
    if (mod.language !== "groovy" && mod.language !== "kts") return cfg;

    const needle = 'coreLibraryDesugaring("com.android.tools:desugar_jdk_libs';
    const hasDep = mod.contents.includes(needle);

    if (!hasDep) {
      mod.contents = mod.contents.replace(
        /dependencies\s*{/,
        `dependencies {
    // Added by with-desugar-libs to satisfy coreLibraryDesugaring
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.0.4")`
      );
    }

    return cfg;
  });
};
