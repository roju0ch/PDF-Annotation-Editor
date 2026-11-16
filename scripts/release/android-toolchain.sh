#!/usr/bin/env bash
set -euo pipefail
sdkmanager="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
[[ -x "$sdkmanager" ]] || { echo 'Hosted runner is missing Android command-line tools'; exit 1; }
yes | "$sdkmanager" --licenses >/dev/null || test "${PIPESTATUS[1]}" -eq 0
"$sdkmanager" 'platforms;android-35' 'build-tools;35.0.0' 'ndk;28.0.13004108'
echo "NDK_HOME=$ANDROID_HOME/ndk/28.0.13004108" >> "$GITHUB_ENV"
rustup toolchain install stable --profile minimal
rustup default stable
rustup target add aarch64-linux-android
