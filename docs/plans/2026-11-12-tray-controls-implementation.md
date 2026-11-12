# Windows Tray Controls Implementation Plan

> **For implementer:** Use TDD throughout. Write failing test first. Watch it fail. Then implement.

**Goal:** Add a Windows tray menu that owns all settings and visibility commands, remove the in-pet settings UI, and use the supplied fish icon for the tray and packaged executable.

**Architecture:** `src/main/index.ts` remains the only owner of mutable save/settings state. A new injected `src/main/tray.ts` adapter renders Electron menu items and delegates commands; visibility policy gains an explicit manual-hidden gate; graceful tray exit uses a new main-to-renderer IPC event and the existing renderer farewell sequence.

**Tech Stack:** Electron 45, TypeScript 7, Vitest 5, electron-builder 26.

---

### Task 1: Manual visibility gate

**Files:**
- Modify: `src/main/visibility.ts`
- Test: `test/visibility-watch.test.ts`

**Step 1: Write failing tests**

Add tests proving:

```ts
it('manual hide survives later automatic samples', () => {
  const p = createVisibilityPolicy(platform, SHOW, 1)
  p.hideManually()
  p.setScenario('none')
  expect(platform.show).not.toHaveBeenCalled()
  expect(p.hidden).toBe(true)
})

it('manual show clears the gate and immediately reapplies the current scenario', () => {
  const p = createVisibilityPolicy(platform, SHOW, 1)
  p.hideManually()
  p.showManually()
  expect(platform.show).toHaveBeenCalledOnce()
})
```

Also test that `showManually()` does not override `onFullscreen: 'hide'` while the current scenario is full-screen.

**Step 2: Run test and confirm RED**

Command: `npm.cmd test -- test/visibility-watch.test.ts`

Expected: TypeScript/test failure because `hideManually` and `showManually` do not exist.

**Step 3: Implement minimally**

Extend `VisibilityPolicy` and `VisibilityWatch` with:

```ts
hideManually(): void
showManually(): void
```

Track `manualHidden` separately from the actual window `hidden` state. Automatic decisions use `!manualHidden && decideVisibility(...)`. `hideManually()` sets the gate and applies hidden immediately; `showManually()` clears the gate and reapplies the current scenario immediately. Expose both methods through `startVisibilityWatch`, including the non-Windows fallback.

**Step 4: Verify GREEN**

Commands:

```powershell
npm.cmd test -- test/visibility-watch.test.ts
npm.cmd run typecheck
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add src/main/visibility.ts test/visibility-watch.test.ts
git commit -m "feat: add manual tray visibility gate"
```

### Task 2: Tray menu controller

**Files:**
- Create: `src/main/tray.ts`
- Create: `test/tray.test.ts`

**Step 1: Write failing tests**

Define an injected `TrayPort` so tests do not require a live Electron app. Tests must assert:

- menu order and labels;
- mute/full-screen/developer checkbox state comes from `getSettings()`;
- show, hide, and exit delegate to their callbacks;
- checkbox clicks emit minimal patches (`{ muted: true }`, etc.);
- refresh rebuilds the context menu;
- dispose destroys the tray once.

The desired exported API is:

```ts
export type TrayController = { refresh(): void; dispose(): void }
export function createTrayController(deps: TrayDeps): TrayController
```

**Step 2: Run test and confirm RED**

Command: `npm.cmd test -- test/tray.test.ts`

Expected: module-not-found failure for `src/main/tray.ts`.

**Step 3: Implement minimally**

Use injected constructors/builders for tests, with a production adapter importing `Menu`, `Tray`, `nativeImage`, `app`, and `join` from Electron/Node. Build this menu:

```ts
[
  { label: '显示桌宠', click: deps.show },
  { label: '隐藏桌宠', click: deps.hide },
  { type: 'separator' },
  { label: '静音', type: 'checkbox', checked: s.muted, click: i => deps.updateSettings({ muted: i.checked }) },
  { label: '全屏时隐藏', type: 'checkbox', checked: s.onFullscreen === 'hide', click: i => deps.updateSettings({ onFullscreen: i.checked ? 'hide' : 'show' }) },
  { label: '开发者模式', type: 'checkbox', checked: s.developerMode, click: i => deps.updateSettings({ developerMode: i.checked }) },
  { type: 'separator' },
  { label: '退出', click: deps.quit },
]
```

Set tooltip `with-me`, bind double-click to Show, and log/return a no-op controller if icon creation is empty or tray construction fails.

**Step 4: Verify GREEN**

Commands:

```powershell
npm.cmd test -- test/tray.test.ts
npm.cmd run typecheck
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add src/main/tray.ts test/tray.test.ts
git commit -m "feat: add Windows tray menu controller"
```

### Task 3: Graceful tray exit IPC

**Files:**
- Modify: `src/shared/ipc.ts`
- Modify: `src/preload/index.cjs`
- Modify: `src/renderer/global.d.ts`
- Modify: `src/renderer/index.ts`
- Modify: `test/preload-contract.test.ts`
- Add or modify: `test/ipc-payload.test.ts`

**Step 1: Write failing tests**

Extend the preload contract expectation with:

```ts
onQuitRequested: (cb) => ipcRenderer.on('pet:quit-requested', cb)
```

Add a renderer-facing test or extracted pure coordinator test proving two quit requests start only one exit sequence.

**Step 2: Run tests and confirm RED**

Command: `npm.cmd test -- test/preload-contract.test.ts test/ipc-payload.test.ts`

Expected: missing channel/API failure.

**Step 3: Implement minimally**

- Add `quitRequested: 'pet:quit-requested'` to `IPC`.
- Expose `onQuitRequested(cb)` from preload and its TypeScript declaration.
- Extract the existing panel `quit` callback body in renderer index into `requestExit()`.
- Register `window.petBridge?.onQuitRequested(requestExit)`.
- Keep the existing renderer-to-main `quitApp()` acknowledgement unchanged.

**Step 4: Verify GREEN**

Commands:

```powershell
npm.cmd test -- test/preload-contract.test.ts test/ipc-payload.test.ts
npm.cmd run typecheck
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add src/shared/ipc.ts src/preload/index.cjs src/renderer/global.d.ts src/renderer/index.ts test/preload-contract.test.ts test/ipc-payload.test.ts
git commit -m "feat: route tray exit through farewell sequence"
```

### Task 4: Integrate tray with main-process settings

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/main/tray.ts`
- Test: `test/tray.test.ts`

**Step 1: Write failing integration-oriented unit tests**

Test a small exported settings updater or injected tray callbacks to prove one tray patch:

- applies only the requested setting;
- calls visibility `setSettings`;
- persists;
- broadcasts `IPC.settingsLoaded`;
- refreshes the menu.

Test tray exit sends `IPC.quitRequested`, reveals the pet first, is idempotent, and starts the fallback.

**Step 2: Run tests and confirm RED**

Command: `npm.cmd test -- test/tray.test.ts`

Expected: new assertions fail because main integration is absent.

**Step 3: Implement minimally**

In `main/index.ts`:

- declare `watch` before registering IPC, then assign it after window creation;
- centralize the existing settings callback as `updateSettings(patch)`;
- broadcast the complete settings object after every update;
- create the tray after the window and watcher exist;
- wire show/hide to `watch.showManually()` / `watch.hideManually()`;
- wire quit to reveal, send `IPC.quitRequested`, and schedule a 12-second `app.quit()` fallback;
- dispose the tray and clear the fallback in `before-quit`.

Avoid a temporal-dead-zone callback: renderer settings messages can arrive immediately after window creation, so `watch` must be initialized to a safe no-op implementation before IPC registration.

**Step 4: Verify GREEN**

Commands:

```powershell
npm.cmd test -- test/tray.test.ts test/visibility-watch.test.ts test/preload-contract.test.ts
npm.cmd run typecheck
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add src/main/index.ts src/main/tray.ts test/tray.test.ts
git commit -m "feat: make main process own tray settings"
```

### Task 5: Remove the in-pet settings UI

**Files:**
- Modify: `src/shared/config.ts`
- Modify: `src/shared/geometry.ts`
- Modify: `src/renderer/panel.ts`
- Modify: `src/renderer/index.ts`
- Modify: `src/renderer/style.css`
- Delete: `src/renderer/icons/settings.svg`
- Modify: `test/panel-dom.test.ts`
- Modify: `test/geometry.test.ts`
- Modify: `README.md`

**Step 1: Change tests first**

Update expectations to four buttons:

```ts
expect(defaultActions().map(a => a.id)).toEqual(['feed', 'game', 'status', 'debug'])
expect(defaultActions().map(a => a.label)).toEqual(['喂食', '小游戏', '状态', '调试'])
```

Add assertions that no settings button or settings plate exists. Remove tests whose only subject is the deleted settings view and `settingsAnchor`.

**Step 2: Run tests and confirm RED**

Command: `npm.cmd test -- test/panel-dom.test.ts test/geometry.test.ts`

Expected: button-count/settings-view assertions fail against current UI.

**Step 3: Implement minimally**

- Remove the settings panel button and view type.
- Remove setting/quit handler members from `PanelHandlers`.
- Remove settings render helpers and layout branches.
- Preserve `setSettings()` solely to update developer-mode debug-button visibility.
- Remove unused CSS and icon.
- Update README controls/settings documentation to describe tray operation.

**Step 4: Verify GREEN**

Commands:

```powershell
npm.cmd test -- test/panel-dom.test.ts test/geometry.test.ts
npm.cmd run typecheck
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add -A src/shared/config.ts src/shared/geometry.ts src/renderer test/panel-dom.test.ts test/geometry.test.ts README.md
git commit -m "feat: move pet settings out of the overlay"
```

### Task 6: Add and package the supplied icon

**Files:**
- Create: `assets/dafeiyu.ico` from `E:/ai-pet/ico/dafeiyu.ico`
- Modify: `electron-builder.yml`
- Modify: `src/main/tray.ts`
- Modify: `tools/check-licenses.mjs`
- Modify: `licenses.json`
- Modify: `NOTICE.md`
- Test: `test/licenses.test.ts`

**Step 1: Write failing tests**

Add assertions that:

- the icon exists and starts with a valid ICO header;
- `licenses.json` covers `assets/dafeiyu.ico`;
- the builder config declares `win.icon` and an `extraResources` copy.

**Step 2: Run tests and confirm RED**

Command: `npm.cmd test -- test/licenses.test.ts`

Expected: missing icon/config/registration failures.

**Step 3: Implement minimally**

- Copy the supplied ICO without re-encoding it.
- Add `.ico` to the license auditor's asset extensions and register the icon as project-provided artwork.
- Configure:

```yaml
win:
  icon: assets/dafeiyu.ico
extraResources:
  - from: assets/dafeiyu.ico
    to: dafeiyu.ico
```

- In development load `join(app.getAppPath(), 'assets', 'dafeiyu.ico')`; when packaged load `join(process.resourcesPath, 'dafeiyu.ico')`.

**Step 4: Verify GREEN and package**

Commands:

```powershell
npm.cmd test -- test/licenses.test.ts
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run check:license
npx.cmd electron-builder --win dir --config.directories.output=release-tray-check --config.electronDist=node_modules/electron/dist
```

Expected: all tests pass; `release-tray-check/win-unpacked/resources/dafeiyu.ico` exists; builder exits 0.

**Step 5: Commit**

```powershell
git add assets/dafeiyu.ico electron-builder.yml src/main/tray.ts tools/check-licenses.mjs licenses.json NOTICE.md test/licenses.test.ts
git commit -m "build: package fish tray and application icon"
```

### Task 7: Final verification and review

**Files:**
- Review all changed files

**Step 1: Run the full gate**

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run check:license
```

Expected: typecheck passes, all Vitest files pass, static assets copy, and license audit passes.

**Step 2: Run packaged-resource checks**

Confirm the directory build contains the tray icon and that `app.asar` contains the new tray module but not the deleted settings SVG.

**Step 3: Manual Windows check**

Run the application and verify:

1. tray icon appears;
2. right-click menu states match `save.json`;
3. Hide remains hidden for more than one visibility-probe interval;
4. Show restores the pet;
5. Mute stops current voice and persists;
6. full-screen/developer choices persist and update UI behavior;
7. Exit plays farewell and terminates;
8. the settings gear is absent.

**Step 4: Overall review**

Review for spec compliance, then code quality, before finishing the branch.
