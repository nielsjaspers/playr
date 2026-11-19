import { expect, test } from 'bun:test';

test('Expo uses the same custom iCloud container in both entitlements and Info.plist', () => {
  const bundleIdentifier = 'com.example.playr';
  const container = 'iCloud.com.example.audio';
  const appleTeamId = 'ABCDE12345';
  const result = Bun.spawnSync(['node', 'node_modules/expo/bin/cli', 'config', '--type', 'introspect', '--json'], {
    cwd: import.meta.dir,
    env: {
      ...process.env,
      EXPO_OFFLINE: '1',
      EXPO_NO_DOTENV: '1',
      PLAYR_APPLE_TEAM_ID: appleTeamId,
      PLAYR_BUNDLE_IDENTIFIER: bundleIdentifier,
      PLAYR_ICLOUD_CONTAINER: container,
    },
  });

  expect(result.exitCode, result.stderr.toString()).toBe(0);
  const config = JSON.parse(result.stdout.toString());
  expect(config.ios).toMatchObject({ appleTeamId, bundleIdentifier });
  const { entitlements, infoPlist } = config._internal.modResults.ios;
  expect(entitlements).toMatchObject({
    'com.apple.developer.icloud-container-identifiers': [container],
    'com.apple.developer.icloud-services': ['CloudDocuments'],
    'com.apple.developer.ubiquity-container-identifiers': [container],
    'com.apple.developer.ubiquity-kvstore-identifier': `$(TeamIdentifierPrefix)${bundleIdentifier}`,
  });
  expect(Object.keys(infoPlist.NSUbiquitousContainers)).toEqual([container]);
});
