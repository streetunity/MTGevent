// Expo config plugin: sign release builds with your own key instead of the shared debug key.
//
// The key's location and passwords are read from Gradle properties, normally kept in
// %USERPROFILE%\.gradle\gradle.properties (Windows) so they never end up in this repo:
//
//   MTG_RELEASE_STORE_FILE=C:/Users/you/keys/mtgevent-release.keystore
//   MTG_RELEASE_STORE_PASSWORD=...
//   MTG_RELEASE_KEY_ALIAS=mtgevent
//   MTG_RELEASE_KEY_PASSWORD=...
//
// If those properties are missing, release builds fall back to the debug key (fine for a quick
// test, but such an APK can't be updated by one signed with the real key).
const { withAppBuildGradle } = require('expo/config-plugins');

const SIGNING = `
        release {
            if (project.hasProperty('MTG_RELEASE_STORE_FILE')) {
                storeFile file(MTG_RELEASE_STORE_FILE)
                storePassword MTG_RELEASE_STORE_PASSWORD
                keyAlias MTG_RELEASE_KEY_ALIAS
                keyPassword MTG_RELEASE_KEY_PASSWORD
            }
        }`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let g = cfg.modResults.contents;
    if (g.includes('MTG_RELEASE_STORE_FILE')) return cfg; // already applied

    // 1) add a "release" signing config next to the debug one
    g = g.replace(/(signingConfigs\s*\{\s*debug\s*\{[^}]*\})/, `$1${SIGNING}`);

    // 2) make the release build type use it (when the key is configured)
    g = g.replace(
      /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/,
      "$1signingConfig project.hasProperty('MTG_RELEASE_STORE_FILE') ? signingConfigs.release : signingConfigs.debug",
    );

    if (!g.includes('MTG_RELEASE_STORE_FILE') || !g.includes('signingConfigs.release :')) {
      throw new Error('withReleaseSigning: could not find the signing blocks in android/app/build.gradle');
    }
    cfg.modResults.contents = g;
    return cfg;
  });
};
