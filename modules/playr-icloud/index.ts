// Re-export the native module. On web, it will be resolved to PlayrICloudModule.web.ts
// and on native platforms to PlayrICloudModule.ts
export { default } from './src/PlayrICloudModule';
export * from './src/PlayrICloud.types';
export * from './src/PlayrLibraryView';
