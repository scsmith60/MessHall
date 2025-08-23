// plugins/with-patch-share-menu-gradle.js
const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

function patchShareMenuGradle(src) {
  // 1) Remove any hard-coded buildToolsVersion like '29.0.2'
  src = src.replace(/^\s*buildToolsVersion\s+['"].+?['"]\s*$/gm, "");

  // 2) Force modern SDKs for any pattern (numeric or safeExtGet)
  // compileSdk
  src = src
    .replace(/compileSdkVersion\s*\(\s*rootProject\.ext\.[^)]+\)\s*/g, "compileSdkVersion 35")
    .replace(/compileSdkVersion\s+safeExtGet\([^)]*\)/g, "compileSdkVersion 35")
    .replace(/compileSdkVersion\s+\d+/g, "compileSdkVersion 35");

  // targetSdk
  src = src
    .replace(/targetSdkVersion\s*\(\s*rootProject\.ext\.[^)]+\)\s*/g, "targetSdkVersion 35")
    .replace(/targetSdkVersion\s+safeExtGet\([^)]*\)/g, "targetSdkVersion 35")
    .replace(/targetSdkVersion\s+\d+/g, "targetSdkVersion 35");

  // minSdk (keep at 24 for RN/Expo SDK 52)
  src = src
    .replace(/minSdkVersion\s*\(\s*rootProject\.ext\.[^)]+\)\s*/g, "minSdkVersion 24")
    .replace(/minSdkVersion\s+safeExtGet\([^)]*\)/g, "minSdkVersion 24")
    .replace(/minSdkVersion\s+\d+/g, "minSdkVersion 24");

  return src;
}

module.exports = function withPatchShareMenuGradle(config) {
  return withDangerousMod(config, [
    "android",
    async (cfg) => {
      const file = path.join(
        cfg.modRequest.projectRoot,
        "node_modules",
        "react-native-share-menu",
        "android",
        "build.gradle"
      );

      if (fs.existsSync(file)) {
        let src = fs.readFileSync(file, "utf8");
        const patched = patchShareMenuGradle(src);
        if (patched !== src) {
          fs.writeFileSync(file, patched);
          console.log("[with-patch-share-menu-gradle] Patched react-native-share-menu/android/build.gradle");
        } else {
          console.log("[with-patch-share-menu-gradle] No changes needed");
        }
      } else {
        console.warn("[with-patch-share-menu-gradle] File not found:", file);
      }
      return cfg;
    },
  ]);
};
