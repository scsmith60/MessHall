// plugins/with-bump-compose-core.js
const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

// Compose 1.5.15 pairs with Kotlin 1.9.25
const COMPOSE = "1.5.15";

function patchText(src) {
  if (!src) return src;
  return src
    // Groovy: composeOptions { kotlinCompilerExtensionVersion 'x.y.z' }
    .replace(
      /composeOptions\s*{[^}]*kotlinCompilerExtensionVersion\s+['"][^'"]+['"][^}]*}/gs,
      (block) => block.replace(/kotlinCompilerExtensionVersion\s+['"][^'"]+['"]/, `kotlinCompilerExtensionVersion '${COMPOSE}'`)
    )
    // KTS: composeCompiler.kotlinCompilerExtensionVersion = "x.y.z"
    .replace(
      /kotlinCompilerExtensionVersion\s*=\s*["'][^"']+["']/g,
      `kotlinCompilerExtensionVersion = "${COMPOSE}"`
    )
    // Version catalogs (.toml)
    .replace(/(^|\n)\s*compose(Compiler)?\s*=\s*["'][0-9.]+["']/g, `$1compose = "${COMPOSE}"`)
    .replace(/(^|\n)\s*androidxComposeCompiler\s*=\s*["'][0-9.]+["']/g, `$1androidxComposeCompiler = "${COMPOSE}"`);
}

module.exports = function withBumpComposeCore(config) {
  return withDangerousMod(config, [
    "android",
    async (cfg) => {
      const root = cfg.modRequest.projectRoot;
      const candidates = [
        path.join(root, "node_modules", "expo-modules-core", "android", "build.gradle"),
        path.join(root, "node_modules", "expo-modules-core", "android", "build.gradle.kts"),
        path.join(root, "node_modules", "expo-modules-core", "android", "gradle", "libs.versions.toml"),
      ];

      let changed = false;
      for (const file of candidates) {
        if (!fs.existsSync(file)) continue;
        const src = fs.readFileSync(file, "utf8");
        const out = patchText(src);
        if (out !== src) {
          fs.writeFileSync(file, out);
          console.log(`[with-bump-compose-core] Patched ${path.relative(root, file)} → Compose ${COMPOSE}`);
          changed = true;
        }
      }
      if (!changed) {
        console.log("[with-bump-compose-core] No changes applied (patterns not found).");
      }
      return cfg;
    },
  ]);
};
