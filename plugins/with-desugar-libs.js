const { withAppBuildGradle } = require("@expo/config-plugins");

module.exports = function withDesugarLibs(config) {
  return withAppBuildGradle(config, (cfg) => {
    const mod = cfg.modResults;
    if (!mod?.contents) return cfg;

    const needle = 'coreLibraryDesugaring("com.android.tools:desugar_jdk_libs';
    if (!mod.contents.includes(needle)) {
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
