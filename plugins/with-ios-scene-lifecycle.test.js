import { describe, expect, test } from "bun:test";

import { addSceneLifecycleToAppDelegate } from "./with-ios-scene-lifecycle";

const expoAppDelegate = `
@main
class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)

    reactNativeDelegate = delegate
    reactNativeFactory = factory

#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {}
`;

describe("iOS scene lifecycle config plugin", () => {
  test("moves React Native window startup into a scene delegate", () => {
    const result = addSceneLifecycleToAppDelegate(expoAppDelegate);

    expect(result).toContain("class SceneDelegate: UIResponder, UIWindowSceneDelegate");
    expect(result).toContain("let window = UIWindow(windowScene: windowScene)");
    expect(result).not.toContain("UIWindow(frame: UIScreen.main.bounds)");
  });

  test("is idempotent", () => {
    const migrated = addSceneLifecycleToAppDelegate(expoAppDelegate);

    expect(addSceneLifecycleToAppDelegate(migrated)).toBe(migrated);
  });
});
