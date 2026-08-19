const { withAppDelegate, withInfoPlist } = require("expo/config-plugins");

const legacyWindowStartup = `#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

`;

const sceneDelegate = `class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard
      let windowScene = scene as? UIWindowScene,
      let appDelegate = UIApplication.shared.delegate as? AppDelegate,
      let factory = appDelegate.reactNativeFactory
    else {
      return
    }

    let window = UIWindow(windowScene: windowScene)
    self.window = window
    appDelegate.window = window

    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: nil)
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    guard let appDelegate = UIApplication.shared.delegate as? AppDelegate else {
      return
    }

    for context in URLContexts {
      _ = appDelegate.application(UIApplication.shared, open: context.url, options: [:])
    }
  }
}`;

function addSceneLifecycleToAppDelegate(contents) {
  if (contents.includes("class SceneDelegate: UIResponder, UIWindowSceneDelegate")) {
    return contents;
  }

  if (!contents.includes(legacyWindowStartup)) {
    throw new Error(
      "Could not find Expo's AppDelegate window startup block. Update the iOS scene lifecycle plugin for the current Expo template.",
    );
  }

  const reactNativeDelegateMarker = "class ReactNativeDelegate: ExpoReactNativeFactoryDelegate";
  if (!contents.includes(reactNativeDelegateMarker)) {
    throw new Error(
      "Could not find ReactNativeDelegate in Expo's generated AppDelegate.",
    );
  }

  return contents
    .replace(legacyWindowStartup, "")
    .replace(reactNativeDelegateMarker, `${sceneDelegate}\n\n${reactNativeDelegateMarker}`);
}

function withIosSceneLifecycle(config) {
  config = withInfoPlist(config, (infoPlistConfig) => {
    infoPlistConfig.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: "Default Configuration",
            UISceneDelegateClassName: "$(PRODUCT_MODULE_NAME).SceneDelegate",
          },
        ],
      },
    };
    return infoPlistConfig;
  });

  return withAppDelegate(config, (appDelegateConfig) => {
    if (appDelegateConfig.modResults.language !== "swift") {
      throw new Error("The Playr scene lifecycle plugin requires a Swift AppDelegate.");
    }

    appDelegateConfig.modResults.contents = addSceneLifecycleToAppDelegate(
      appDelegateConfig.modResults.contents,
    );
    return appDelegateConfig;
  });
}

module.exports = withIosSceneLifecycle;
module.exports.addSceneLifecycleToAppDelegate = addSceneLifecycleToAppDelegate;
