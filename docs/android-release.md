# Building a release APK (Android)

A release APK is the real, standalone app: no PC, cable or Metro needed. Build it on the Windows PC
that already builds the app (JDK 17 + Android SDK).

## One time: create your signing key

Every update must be signed with the **same key**, or Android refuses to install it over the old
app. Make the key once and keep it safe (back it up somewhere off this PC; if it's lost, testers have
to uninstall and lose the app's local data to get updates). This same key can later be the
Google Play "upload key".

```powershell
mkdir $env:USERPROFILE\keys
keytool -genkeypair -v -storetype PKCS12 -keystore $env:USERPROFILE\keys\mtgevent-release.keystore -alias mtgevent -keyalg RSA -keysize 2048 -validity 10000
```

It asks for a password (use the same one for the key if asked) and some name details (anything is fine).

Then tell Gradle where it is. Create or edit `%USERPROFILE%\.gradle\gradle.properties`
(e.g. `notepad $env:USERPROFILE\.gradle\gradle.properties`) and add:

```
MTG_RELEASE_STORE_FILE=C:/Users/Brian/keys/mtgevent-release.keystore
MTG_RELEASE_STORE_PASSWORD=your-password
MTG_RELEASE_KEY_ALIAS=mtgevent
MTG_RELEASE_KEY_PASSWORD=your-password
```

Use forward slashes in the path. This file lives in your user folder, not the repo, so the passwords
never reach GitHub. `plugins/withReleaseSigning.js` wires it into the build.

## Each release

1. Bump `expo.android.versionCode` in `app.json` (1, 2, 3, …) and optionally `expo.version`.
2. Build:

```powershell
cd C:\Users\Brian\MTGevent
git pull
npx expo prebuild --platform android
cd android
.\gradlew assembleRelease
```

3. The APK is at `android\app\build\outputs\apk\release\app-release.apk`.

## Installing it

- **USB:** with the phone plugged in and USB debugging on: `adb install -r app\build\outputs\apk\release\app-release.apk`
  (`-r` keeps the app's data when updating).
- **No cable:** copy the APK to the phone (Google Drive, email, or upload it to the website) and tap it.
  Android asks once to allow installs from that app.

The release app and the development app (the one that loads from Metro) are signed with different
keys. Uninstall the development app before installing the first release APK. Its local data goes with
it, but if you use a shared league, signing back in brings everything back from the server.
