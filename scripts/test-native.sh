#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
mkdir -p .build/native-tests
xcrun swiftc -module-cache-path .build/native-tests/module-cache \
  modules/playr-icloud/ios/ICloudFileAccess.swift tests/native/ICloudFileAccessTests.swift \
  -o .build/native-tests/file-access
.build/native-tests/file-access
