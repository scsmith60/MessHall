// plugins/with-enforce-kotlin.js
const {
  withGradleProperties,
  withProjectBuildGradle,
  withSettingsGradle,
  withDangerousMod,
} = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

// We must match Compose 1.5.14 -> Kotlin 1.9.24
const KOTLIN = "1.9.24";

/** Replace kotlin version mentions in arbitrary text (Groovy/KTS). */
function forceKotlinInText(src) {
  if (!src) return src;
  return src
    // plugins { id "org.jetbrains.kotlin.android" version "x.y.z" }
    .replace(
      /id\s+['"]org\.jetbrains\.kotlin\.android['"]\s+version\s+['"][^'"]+['"]/g,
      `id 'org.jetbrains.kotlin.android' version '${KOTLIN}'`
    )
    // kotlin_version = "x.y.z" (toml-ish or gradle extra vars)
    .replace(/kotlin[_-]?version\s*=\s*['"][^'"]+['"]/gi, `kotlin_version = '${KOTLIN}'`)
    // ext.kotlin_version = "x.y.z"
    .replace(/ext\.kotlin[_-]?version\s*=\s*['"][^'"]+['"]/gi, `ext.kotlin_version = '${KOTLIN}'`)
    // kotlin("android") version "x.y.z"
    .replace(/kotlin\(['"]android['"]\)\s+version\s+['"][^'"]+['"]/g, `kotlin("android") version '${KOTLIN}'`)
    // libs.versions.toml style: kotlin = "x.y.z"
    .replace(/(^|\n)\s*kotlin\s*=\s*["'][^"']+["']/g, `$1kotlin = "${KOTLIN}"`);
}

module.exports = function withEnforceKotlin(config) {
  // gradle.properties: set KOTLIN_VERSION and (fallback) suppress check if needed.
  config = withGradleProperties(config, (cfg) => {
    const props = cfg.modResults || [];
    const setProp = (key, value) => {
      const i = props.findIndex((p) => p.type === "property" && p.key === key);
      if (i >= 0) props[i].value = value;
      else props.push({ type: "property", key, value });
    };
    setProp("KOTLIN_VERSION", KOTLIN);
    // Safety net if something still bumps Kotlin: uncomment the next line as a last resort.
     setProp("suppressKotlinVersionCompatibilityCheck", "true");
    cfg.modResults = props;
    return cfg;
  });

  // android/build.gradle (root)
  config = withProjectBuildGradle(config, (cfg) => {
    const mod = cfg.modResults;
    if (mod?.contents) mod.contents = forceKotlinInText(mod.contents);
    return cfg;
  });

  // settings.gradle / settings.gradle.kts (pluginManagement can pin versions)
  config = withSettingsGradle(config, (cfg) => {
    const mod = cfg.modResults;
    if (mod?.contents) mod.contents = forceKotlinInText(mod.contents);
    return cfg;
  });

  // Also patch version catalog if present: android/gradle/libs.versions.toml
  config = withDangerousMod(config, [
    "android",
    async (cfg) => {
      const toml = path.join(cfg.modRequest.platformProjectRoot, "gradle", "libs.versions.toml");
      if (fs.existsSync(toml)) {
        const src = fs.readFileSync(toml, "utf8");
        const out = forceKotlinInText(src);
        if (out !== src) {
          fs.writeFileSync(toml, out);
          console.log("[with-enforce-kotlin] Patched gradle/libs.versions.toml -> kotlin =", KOTLIN);
        }
      }
      return cfg;
    },
  ]);

  return config;
};
