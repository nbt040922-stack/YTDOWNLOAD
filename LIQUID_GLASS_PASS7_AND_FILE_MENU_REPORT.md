# YTDOWNLOAD — File Menu Cleanup + Liquid Glass Pass 7 Report

## Files changed

- `index.html`
- `renderer.js`
- `preload.js`
- `main.js`
- `style.css`
- `LIQUID_GLASS_PASS7_AND_FILE_MENU_REPORT.md`

No downloader, yt-dlp, Deno, FFmpeg, DownloadManager, queue, authentication, recovery, or application-state logic changed.

## File menu changes

The File menu now contains, in order:

1. Download Folder...
2. Open Download Folder
3. Divider
4. Minimize to Tray
5. Quit

`Download Folder...` reuses the existing native `select-folder` IPC handler. It opens at the configured download path, persists a selected path through the existing settings mechanism, and returns `null` without changing state when cancelled.

`Open Download Folder` uses one minimal IPC handler. It resolves the current configured path, creates a missing directory recursively, opens it with Electron's native `shell.openPath`, and returns a clear error for the renderer to display instead of failing silently.

## Removed main storage UI

- Removed the storage-path pill markup beneath the URL input.
- Removed CSS used only by that pill.
- Removed renderer references used only to display/update pill text.
- Kept `currentSavePath` and existing initialization because normal and playlist downloads still pass that exact persisted path to the unchanged queue API.
- No dead vertical gap remains: `.search-section` now contains only the search surface.

## Persisted path behavior

- Startup still reads the existing saved path through `get-default-path`.
- Folder selection still updates `currentSavePath` in both main and renderer processes.
- Main process still writes `savePath` with the existing `saveSettings` function.
- Normal and playlist download requests still use `currentSavePath` as `output_directory`.

## Background changes

- Neutral base moved from `#e5e8ec` to `#e4e7eb`.
- Supporting gradient changed to `#e7eaed` / `#e1e4e8`.
- Existing cyan, lavender/pink, and peach ambient fields remain unchanged.

## Glass opacity changes

- Header: `0.32` → `0.28`.
- Search: `0.44` → `0.40`; focus `0.50` → `0.44`.
- Cards: `0.40` → `0.36`; hover `0.48` → `0.40`.
- Footer: `0.24` → `0.20`.
- Dropdown: `0.58` → `0.54`.
- Active and hover menu capsules were reduced without adding tint or blur.

## Shadow changes

- Search and cards now use restrained close and distance shadow layers.
- Search and card inset edges are asymmetric: brighter top/left and darker bottom/right.
- Blur and saturation values were not increased; no glow or nested backdrop filter was added.

## Icon alignment verification

- Account and download controls retain the shared 34×34 geometry and common hover target.
- No separator or left input icon was introduced.
- Only the Font Awesome download glyph receives `translateY(-1px)` for optical centering; the button box does not move.

## Visual verification

- Main UI: no storage pill and no dead spacing.
- File menu: all requested entries visible in correct order.
- Native folder picker: opened successfully at the current `Downloads` path.
- Search, header, footer, and background visually inspected in the isolated development profile.
- Automation stopped immediately when user input was detected; no further focus or Explorer interaction was attempted.

## Regression result

- Command: `npm test`
- Result: **57 passed, 0 failed**
- Duration: **1741.9255 ms**
- `git diff --check`: passed.

Pass 7 ends here. No further UI pass was started.
