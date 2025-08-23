// plugins/with-enforce-kotlin.js
const { withProjectBuildGradle, withGradleProperties } = require("@expo/config-plugins");

module.exports = function withEnforceKotlin(config) {
  const K = "1.9.24";

  // Ensure KOTLIN_VERSION in gradle.properties
  config = withGradleProperties(config, (cfg) => {
    const props = cfg.modResults || [];
    const i = props.findIndex((p) => p.type === "property" && p.key === "KOTLIN_VERSION");
    if (i >= 0) props[i].value = K;
    else props.push({ type: "property", key: "KOTLIN_VERSION", value: K });
    cfg.modResults = props;
    return cfg;
  });

  // Rewrite plugin versions in root build.gradle if present
  config = withProjectBuildGradle(config, (cfg) => {
    const mod = cfg.modResults;
    if (mod?.contents) {
      mod.contents = mod.contents
        .replace(
          /id\s+['"]org\.jetbrains\.kotlin\.android['"]\s+version\s+['"][^'"]+['"]/g,
          `id 'org.jetbrains.kotlin.android' version '${K}'`
        )
        .replace(/kotlin_version\s*=\s*['"][^'"]+['"]/g, `kotlin_version = '${K}'`);
    }
    return cfg;
  });

  return config;
};
