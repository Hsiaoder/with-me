# Windows Tray Controls Design

## Goal

Add a persistent Windows system tray entry for the desktop pet. Remove the in-pet settings button and move every setting to the tray context menu while preserving save-file persistence, full-screen visibility behavior, live mute behavior, and the existing animated exit sequence.

## Menu

The tray context menu contains, in order:

1. `显示桌宠`
2. `隐藏桌宠`
3. separator
4. `静音` (checkbox)
5. `全屏时隐藏` (checkbox)
6. `开发者模式` (checkbox)
7. separator
8. `退出`

`显示桌宠` and `隐藏桌宠` are session commands. They do not add fields to `save.json`; a new process starts visible. The three checkboxes map to the existing `Settings` object and continue to persist immediately.

Double-clicking the tray icon performs `显示桌宠`. The tooltip is `with-me`.

## Architecture

### Main process owns settings

`src/main/index.ts` retains the loaded save object as the only mutable settings source. Both renderer-originated changes and tray-originated changes call one shared `updateSettings(patch)` function. That function:

- applies the patch through `applySettings`;
- updates the full-screen visibility watcher;
- persists `save.json`;
- sends the full settings snapshot to the renderer;
- refreshes the tray menu check states.

The renderer remains a consumer of settings because audio playback and the developer button are renderer concerns. It no longer owns any setting controls.

### Tray controller

Create `src/main/tray.ts`. It owns Electron `Tray` and context-menu construction, but does not own save data. Dependencies are callbacks supplied by `main/index.ts`:

- read current settings;
- show or hide the pet;
- apply a settings patch;
- request graceful exit.

The menu is rebuilt after settings change so Electron checkbox states remain authoritative.

### Manual visibility

Add a manual-hidden gate to the visibility policy. Automatic full-screen decisions continue to run, but while manually hidden they cannot show the window. `显示桌宠` clears the gate and asks the policy to immediately reevaluate the current scenario. `隐藏桌宠` sets the gate and hides immediately.

This prevents the full-screen probe's next 500 ms sample from undoing a user's explicit Hide command. If the current full-screen rule says hide, choosing Show clears the manual gate but the pet remains hidden until that rule allows it; the menu does not silently rewrite the full-screen setting.

### Graceful exit

Add a main-to-renderer IPC channel `pet:quit-requested`. Tray `退出` first clears manual hiding and reveals the window, then sends this channel. The renderer calls the same existing exit-sequence function used by the old settings button: farewell animation, farewell voice, then renderer-to-main `pet:quit`.

The main process starts a 12-second fallback timer when the tray requests exit. If the renderer is unavailable or never acknowledges, `app.quit()` still runs. Repeated exit requests are idempotent.

## Removing the settings panel

- Remove the `settings` entry from `PANEL_BUTTONS`.
- Remove `settings` from `PanelView`.
- Remove settings rendering, handlers, layout branches, and setting-specific CSS.
- Remove the now-unused `settingsAnchor` geometry helper and its tests.
- Keep `Panel.setSettings` because developer mode still controls whether the debug button is visible.
- Keep settings IPC support so the main process can push tray changes to the renderer.
- Delete the unused `src/renderer/icons/settings.svg` asset.

## Icon and packaging

Copy `E:/ai-pet/ico/dafeiyu.ico` to `assets/dafeiyu.ico` so it is versioned with the application. The supplied ICO is 32-bit and contains 16, 24, 32, 48, 64, and 128 pixel frames.

Use it for:

- the tray icon during development and after packaging;
- `win.icon`, which sets the executable and NSIS icon;
- an `extraResources` entry so the tray can load a stable filesystem path from `process.resourcesPath` in packaged builds.

The missing 256-pixel frame is acceptable for the tray. Windows Explorer can scale the 128-pixel frame for extra-large desktop icons; a native 256-pixel frame can be added later without changing code.

## Error handling

- If the tray icon fails to load, log an explicit error and keep the desktop pet running.
- Saving a tray setting follows the existing non-fatal save behavior.
- The graceful-exit fallback prevents a broken renderer or media file from trapping the process.
- Tray resources are disposed during `before-quit`.

## Testing

- Unit-test menu state and callbacks through injected tray dependencies.
- Extend visibility-policy tests for manual hide/show precedence.
- Extend preload contract and renderer tests for main-to-renderer quit requests.
- Update panel DOM tests to assert four buttons and absence of settings UI.
- Run typecheck, all unit tests, build, license audit, and an electron-builder directory build.
- Inspect the packaged directory for `dafeiyu.ico` and verify builder config resolves the Windows icon.
