// plugins/with-project-gradle-overrides.js
// Ensure all Android libraries (incl. react-native-share-menu) compile with a modern SDK/toolchain.
// Also defines root ext versions so app/build.gradle can inherit them.

const { withProjectBuildGradle } = require('@expo/config-plugins');

const START = '// @messhall begin sdks';
const END = '// @messhall end sdks';

const BLOCK = `
${START}
ext {
  compileSdkVersion = 35
  targetSdkVersion  = 35
  minSdkVersion     = 24
  buildToolsVersion = "35.0.0"
}

/* Force modern SDK/toolchain for all Android library modules */
subprojects { proj ->
  plugins.withId('com.android.library') {
    // Avoid GString interpolation in Groovy; use concatenation:
    proj.logger.lifecycle("Forcing SDK/toolchain for " + proj.path)
    proj.android {
      // Set both forms for broad AGP compatibility
      compileSdk = (rootProject.ext.compileSdkVersion ?: 35)
      compileSdkVersion (rootProject.ext.compileSdkVersion ?: 35)
      buildToolsVersion (rootProject.ext.buildToolsVersion ?: "35.0.0")

      defaultConfig {
        minSdk    = (rootProject.ext.minSdkVersion    ?: 24)
        targetSdk = (rootProject.ext.targetSdkVersion ?: 35)
        // Some older plugins still read the *Version* setters:
        minSdkVersion    (rootProject.ext.minSdkVersion    ?: 24)
        targetSdkVersion (rootProject.ext.targetSdkVersion ?: 35)
      }

      compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
      }
    }
  }
}
${END}
`.trim();

module.exports = (config) =>
  withProjectBuildGradle(config, (c) => {
    let src = c.modResults.contents || '';
    const re = new RegExp(`${START}[\\s\\S]*?${END}`, 'm');
    if (re.test(src)) {
      src = src.replace(re, BLOCK);
    } else {
      src += (src.endsWith('\n') ? '' : '\n') + '\n' + BLOCK + '\n';
    }
    c.modResults.contents = src;
    return c;
  });

module.exports.name = 'with-project-gradle-overrides';
