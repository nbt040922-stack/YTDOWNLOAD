# YTDOWNLOAD — Glass Pass 8 + Queue Session Cleanup Report

## Root cause of Completed 0%

The DownloadManager transitioned a verified job to `DONE` without normalizing its live progress fields. If yt-dlp had not emitted a final progress update, the model and renderer snapshot could therefore contain `state: DONE` with `progress_percent: 0`.

## DONE progress normalization

- Every model transition to `DONE` now forces `progress_percent = 100`.
- `speed` and `eta` are cleared when completion occurs.
- Job snapshots independently normalize `DONE` to 100%, preventing old or malformed in-memory data from reporting `Completed 0%`.
- Existing renderer behavior therefore receives 100% and renders the completed bar fully filled without a presentation-only workaround.

## Old queue persistence behavior

DownloadManager previously wrote every queue mutation to `download-jobs.json`. Startup loaded that file, converted interrupted states back to `QUEUED`, and restored all other historical states.

## New session-only queue model

- Queue state now lives only in DownloadManager memory.
- Enqueue, progress, retry, cancel, clear, and state transitions emit current-session snapshots without writing a job cache.
- A new app process always starts with an empty queue.
- Crashed or interrupted jobs are not reconstructed.
- Concurrency, scheduling, duplicate protection, cancel, retry, recovery, playlist handling, and output verification remain unchanged within a running session.

## Legacy cache cleanup

- Startup detects the exact legacy `download-jobs.json` path.
- Valid legacy snapshots pass through DONE normalization for migration accounting, then are discarded.
- Valid, invalid, or empty legacy cache files are deleted safely.
- Missing cache is accepted without error.
- Cleanup does not touch downloaded media, output directories, settings, auth storage, runtime state, engine state, or partial media files.

## Profile icon removal

- Removed `btnLoginURL` and its renderer event wiring.
- URL input now contains only the textarea and download action.
- Tools → Login YouTube and Tools → Logout YouTube remain unchanged.
- The main-screen folder pill remains absent; File menu behavior from Pass 7 remains intact.

## Download icon alignment

- Download action remains 34×34 with flex centering and clean right padding.
- No separator or dead right-side gap exists.
- Only the Font Awesome glyph keeps `translateY(-1px)` for optical centering; the button box does not move.

## Background tuning

- Neutral base: `#e4e7eb` → `#e1e5e9`.
- Supporting neutral gradient: `#e4e8eb` / `#dde1e6`.
- Existing cyan, lavender/pink, and peach ambient fields remain unchanged in color and saturation.

## Glass opacity tuning

- Header: `0.28` → `0.23`.
- Search: `0.40` → `0.35`; focus `0.44` → `0.38`.
- Cards: `0.36` → `0.31`; hover `0.40` → `0.34`.
- Footer: `0.20` → `0.16`.
- Dropdown: `0.54` → `0.50`.
- Active and hover menu surfaces were reduced accordingly.
- Existing blur and saturation values were not increased.

## Shadow and refraction tuning

- Search uses tighter `0 2px 6px` close and `0 12px 28px` distance shadows.
- Cards use restrained close and distance layers with reduced opacity.
- Thin top/left highlights and darker bottom/right inset edges remain asymmetric.
- Search/card pseudo-element haze was reduced; no glow, nested backdrop filter, or blur animation was added.

## Tests updated

- Replaced cross-session restoration expectations with session-empty behavior.
- Added legacy cache normalization/discard and safe invalid-cache cleanup coverage.
- Added raw DONE transition and DONE snapshot normalization coverage.
- Added UI contract checks for settings/folder persistence wiring, profile-icon removal, download-button geometry, and absent folder pill.
- Existing suites continue covering runtime/bootstrap persistence, auth persistence, max concurrency 2, cancel/retry, playlist queue, recovery, and download path behavior.

## Final test result

- Command: `npm test`
- Tests: **63**
- Passed: **63**
- Failed: **0**
- Duration: **1974.791 ms**
- JavaScript syntax checks: passed.
- `git diff --check`: passed.
- Visual inspection: passed in an isolated development window; queue started empty, URL profile icon was absent, download action remained centered, and Pass 8 glass/background changes rendered correctly.

Pass 8 ends here. Pass 9 was not started.
