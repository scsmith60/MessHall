// plugins/with-patch-share-menu-gradle.js
// Force react-native-share-menu to compile with modern SDK/toolchain on every prebuild.

const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('@expo/config-plugins');

function safeReplace(src, [pattern, replacement]) {
  const re = typeof pattern === 'string' ? new RegExp(pattern, 'g') : pattern;
  return src.replace(re, replacement);
}

module.exports = (config) =>
  withDangerousMod(config, [
    'android',
    async (c) => {
      const gradlePath = path.join(
        c.modRequest.projectRoot,
        'node_modules',
        'react-native-share-menu',
        'android',
        'build.gradle'
      );

      if (!fs.existsSync(gradlePath)) {
        console.warn('[with-patch-share-menu-gradle] build.gradle not found at:', gradlePath);
        return c;
      }

      let src = fs.readFileSync(gradlePath, 'utf8');
      let out = src;

      // Bump compile/target/min SDKs + build tools if they’re present.
      out = safeReplace(out, [/compileSdkVersion\s+\d+/g, 'compileSdkVersion 35']);
      out = safeReplace(out, [/compileSdk\s*=\s*\d+/g, 'compileSdk = 35']);
      out = safeReplace(out, [/buildToolsVersion\s+['"][^'"]+['"]/g, 'buildToolsVersion "35.0.0"']);
      out = safeReplace(out, [/targetSdkVersion\s+\d+/g, 'targetSdkVersion 35']);
      out = safeReplace(out, [/minSdkVersion\s+\d+/g, 'minSdkVersion 24']);

      // If the DSL uses rootProject.ext.* forms, leave them; AGP will resolve to our root ext values.
      // Ensure Java 17 compileOptions block exists.
      if (!/compileOptions\s*\{[^}]*sourceCompatibility/m.test(out)) {
        out = out.replace(
          /android\s*\{/,
          `android {
    compileOptions {
        sourceCompatibility JavaVersion.VERSION_17
        targetCompatibility JavaVersion.VERSION_17
    }
`
        );
      } else {
        // If compileOptions exists, normalize it to Java 17.
        out = safeReplace(out, [/sourceCompatibility\s+JavaVersion\.\S+/g, 'sourceCompatibility JavaVersion.VERSION_17']);
        out = safeReplace(out, [/targetCompatibility\s+JavaVersion\.\S+/g, 'targetCompatibility JavaVersion.VERSION_17']);
      }

      if (out !== src) {
        fs.writeFileSync(gradlePath, out, 'utf8');
        console.log('[with-patch-share-menu-gradle] Patched:', gradlePath);
      } else {
        console.log('[with-patch-share-menu-gradle] No changes needed.');
      }

      return c;
    },
  ]);

module.exports.name = 'with-patch-share-menu-gradle';
