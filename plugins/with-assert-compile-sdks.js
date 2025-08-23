// plugins/with-assert-compile-sdks.js
const { withProjectBuildGradle, withAppBuildGradle } = require("@expo/config-plugins");

const SDKS = { compile: 35, target: 35, min: 24 };

function forceNumbers(s) {
  // Groovy
  s = s
    .replace(/compileSdkVersion\s+\d+/g, `compileSdkVersion ${SDKS.compile}`)
    .replace(/targetSdkVersion\s+\d+/g, `targetSdkVersion ${SDKS.target}`)
    .replace(/minSdkVersion\s+\d+/g, `minSdkVersion ${SDKS.min}`);
  // Kotlin DSL
  s = s
    .replace(/compileSdk\s*=\s*\d+/g, `compileSdk = ${SDKS.compile}`)
    .replace(/targetSdk\s*=\s*\d+/g, `targetSdk = ${SDKS.target}`)
    .replace(/minSdk\s*=\s*\d+/g, `minSdk = ${SDKS.min}`);
  return s;
}

function ensureRootExt(s) {
  // Ensure root ext { compile/target/min } exist or are updated
  if (!/ext\s*{[^}]*compileSdkVersion/.test(s)) {
    const extBlock = `ext {
    compileSdkVersion = ${SDKS.compile}
    targetSdkVersion = ${SDKS.target}
    minSdkVersion = ${SDKS.min}
}
`;
    if (/buildscript\s*{/.test(s)) {
      return s.replace(/buildscript\s*{/, (m) => `${m}\n${extBlock}`);
    }
    return extBlock + s;
  }
  return s
    .replace(/(ext\s*{[^}]*compileSdkVersion\s*=\s*)\d+/s, `$1${SDKS.compile}`)
    .replace(/(ext\s*{[^}]*targetSdkVersion\s*=\s*)\d+/s, `$1${SDKS.target}`)
    .replace(/(ext\s*{[^}]*minSdkVersion\s*=\s*)\d+/s, `$1${SDKS.min}`);
}

module.exports = function withAssertCompileSDKs(config) {
  // Patch root android/build.gradle
  config = withProjectBuildGradle(config, (cfg) => {
    const mod = cfg.modResults;
    if (mod?.contents) {
      let c = mod.contents;
      c = ensureRootExt(c);
      c = forceNumbers(c);
      mod.contents = c;
    }
    return cfg;
  });

  // Patch app android/app/build.gradle
  config
