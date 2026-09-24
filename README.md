# Playr

An iOS audio player for files in the Playr iCloud Drive folder. Removing a download evicts the local copy; it does not delete the iCloud original.

## Development

Use Bun 1.4.2, Node.js 22.13 or newer, Xcode 27, and CocoaPods. The native views use iOS 27 APIs behind availability checks. Expo SDK 57 is pinned through `bun.lock`.

```sh
bun install --frozen-lockfile
bun run typecheck
bun test
```

To generate and build the native app locally:

```sh
bunx expo prebuild --platform ios --no-install
cd ios
pod install
cd ..
bun run ios
```

`bun run ios` installs and launches the app on the selected simulator or device. Use an isolated simulator for development. Do not install a development build over a daily-use installation unless you intend to replace it.

If Xcode is installed but `xcodebuild` resolves to Command Line Tools, select Xcode in its Settings > Locations panel, or set `DEVELOPER_DIR` for the command to your Xcode installation's `Contents/Developer` directory.

The native iCloud module requires a native build. Expo Go cannot load it. Real iCloud checks require an entitled, signed build and an iCloud account. The app's existing bundle identifier and entitlements are in `app.json`; configure your own signing and iCloud container when using another account.

## Playback behavior

- Starting an episode in the library establishes its folder's playback order.
- Explicitly queued episodes play before the remaining library episodes, in their chosen order. Successful playback consumes the entry. Failed or canceled preparation leaves it queued.
- Manually selecting another library episode preserves the explicit queue and changes the library continuation.
- Next consumes the explicit queue first, then advances through the library order. Previous ignores consumed queue entries. From a queued episode it returns to the last library position; otherwise it goes backward through the library order.
- Repeat-all wraps the library order. It does not restore consumed queue entries. Repeat-one replays the current episode on completion without consuming another entry. Manual Next still advances.
- Shuffle affects the library order, not explicit queued episodes.
- Scroll below the controls in Now Playing to manage the queue. The Queue tab shows the same live order, with explicit entries before automatic library continuation. Repeat One displays a reminder that the current episode will keep playing until you skip or turn repeat off.
- Touch and hold an episode to drag it. Rearrange either queue section directly, or drag episodes between Next from Library and Next in Queue. Dragging into the queue removes the episode from the remaining session so it does not play twice. Changes to library continuation apply to the current playback session; dragging within a library folder saves that folder's order. Clear Queue clears pending entries without stopping playback or removing library continuation.
- Swipe right on library episodes to add them to the queue, or remove them if already queued. Swipe right on explicit queue entries to remove them. Library continuation rows also offer queue actions. These actions never remove an audio file. The separate Remove Download action in the library still evicts only the downloaded copy.
- When Remember Timestamps is enabled for an episode's folder, Continue Listening and library rows show its saved position and remaining time.
- Cancel stops a pending playback request. An iCloud transfer already requested can continue. Prefetch never starts playback by itself.

The app icon is generated from `scripts/generate-icon.swift`. Run `swift scripts/generate-icon.swift` to update `assets/icon.png`, then regenerate the native project before building.

## Verification

`bun test` covers the playback hooks with a mocked native audio boundary, queue rules, request races, storage operations against an in-memory SQLite database, metadata reconciliation, and shared file preparation. The React test renderer currently prints its upstream deprecation notice.

On macOS with Xcode, run the native file-operation checks:

```sh
bun run test:native
```

These checks use temporary local files. They verify coordinated moves and error classification, but cannot reproduce iCloud synchronization or SwiftUI rendering.

Before using a new native build with a real library, verify on a test device or isolated simulator:

1. Play from the library, add and rearrange queued episodes, then let playback return to the library.
2. Select a slow cloud episode, then another episode. Cancel preparation and confirm it cannot start later.
3. Seek backward from both the player and lock screen. After five seconds, check that saved progress continues to advance.
4. Rename a reversed folder, including one with an emoji in its name, and relaunch to check progress and preferences.
5. Move files while Files is also open; verify failed moves preserve the original and successful moves retain saved state.
6. Check the final queue row above the mini-player, VoiceOver actions, and large text. Keep controls visible during downloads.

Native sources are under `modules/playr-icloud/ios`. Expo generates the ignored `ios` directory; make persistent native changes in the module or config plugin.
