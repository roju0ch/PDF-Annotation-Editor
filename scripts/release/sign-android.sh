#!/usr/bin/env bash
set -euo pipefail
key="$RUNNER_TEMP/pdf-editor-signing.jks"
trap 'rm -f "$key"' EXIT
if [[ "${SIGN_ANDROID:-false}" == true ]]; then
  : "${ANDROID_KEYSTORE_BASE64:?Missing keystore}" "${ANDROID_KEYSTORE_PASSWORD:?Missing store password}" "${ANDROID_KEY_ALIAS:?Missing alias}" "${ANDROID_KEY_PASSWORD:?Missing key password}"
  printf '%s' "$ANDROID_KEYSTORE_BASE64" | base64 --decode > "$key"
  signing=persistent-key
else
  export ANDROID_KEYSTORE_PASSWORD=android ANDROID_KEY_PASSWORD=android ANDROID_KEY_ALIAS=ci-test
  keytool -genkeypair -keystore "$key" -storepass:env ANDROID_KEYSTORE_PASSWORD -keypass:env ANDROID_KEY_PASSWORD -alias "$ANDROID_KEY_ALIAS" -dname 'CN=PDF Editor CI Test Key' -keyalg RSA -keysize 2048 -validity 30 -storetype JKS
  signing=ephemeral-ci-test-key
fi
mapfile -t apks < <(find src-tauri/gen/android/app/build/outputs/apk -name '*-unsigned.apk')
[[ ${#apks[@]} == 1 ]] || { echo "Expected exactly one unsigned release APK"; exit 1; }
buildtools="$ANDROID_HOME/build-tools/35.0.0"
mkdir -p "$RUNNER_TEMP/signed-apk"
"$buildtools/zipalign" -P 16 -f 4 "${apks[0]}" "$RUNNER_TEMP/aligned.apk"
"$buildtools/apksigner" sign --ks "$key" --ks-pass env:ANDROID_KEYSTORE_PASSWORD --key-pass env:ANDROID_KEY_PASSWORD --ks-key-alias "$ANDROID_KEY_ALIAS" --out "$RUNNER_TEMP/signed-apk/editor.apk" "$RUNNER_TEMP/aligned.apk"
"$buildtools/apksigner" verify --verbose --print-certs "$RUNNER_TEMP/signed-apk/editor.apk"
"$buildtools/zipalign" -c -P 16 4 "$RUNNER_TEMP/signed-apk/editor.apk"
"$buildtools/aapt" dump badging "$RUNNER_TEMP/signed-apk/editor.apk" > "$RUNNER_TEMP/android-package.txt"
node scripts/release/android-config.mjs verify "$RUNNER_TEMP/android-package.txt"
PACKAGE_SIGNING="$signing" node scripts/release/collect.mjs "$RUNNER_TEMP/signed-apk" android-arm64-test apk
