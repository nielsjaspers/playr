import type { ConfigContext, ExpoConfig } from 'expo/config';

export default function ({ config }: ConfigContext): Partial<ExpoConfig> {
  const {
    PLAYR_APPLE_TEAM_ID: appleTeamId,
    PLAYR_BUNDLE_IDENTIFIER: customBundleIdentifier,
    PLAYR_ICLOUD_CONTAINER: customContainer,
  }: Record<string, string | undefined> = process.env;

  const signingOverrides = [appleTeamId, customBundleIdentifier, customContainer];
  if (
    signingOverrides.some(value => value !== undefined) &&
    signingOverrides.some(value => !value?.trim())
  ) {
    throw new Error('Set PLAYR_APPLE_TEAM_ID, PLAYR_BUNDLE_IDENTIFIER, and PLAYR_ICLOUD_CONTAINER together.');
  }

  const bundleIdentifier = customBundleIdentifier ?? 'com.nielsjaspers.playr';
  const container = customContainer ?? `iCloud.${bundleIdentifier}`;

  return {
    ...config,
    ios: {
      ...config.ios,
      appleTeamId,
      bundleIdentifier,
      entitlements: {
        'com.apple.developer.icloud-container-identifiers': [container],
        'com.apple.developer.icloud-services': ['CloudDocuments'],
        'com.apple.developer.ubiquity-container-identifiers': [container],
        'com.apple.developer.ubiquity-kvstore-identifier': `$(TeamIdentifierPrefix)${bundleIdentifier}`,
      },
      infoPlist: {
        NSUbiquitousContainers: {
          [container]: {
            NSUbiquitousContainerIsDocumentScopePublic: true,
            NSUbiquitousContainerName: 'Playr',
            NSUbiquitousContainerSupportedFolderLevels: 'Any',
          },
        },
      },
    },
  };
}
