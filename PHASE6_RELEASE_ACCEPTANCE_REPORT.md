# YTDOWNLOAD Phase 6 Release Acceptance Report

Date: 2026-08-11  
Candidate tested: `0a1de8b302c47b1cae44f07e90a57405626a7eea`  
Repository: `https://github.com/nbt040922-stack/YTDOWNLOAD`

## Release identity

- Product: YTDOWNLOAD
- App version: 1.0.0
- Electron: 28.3.3
- yt-dlp fallback: 2026.07.04
- Deno fallback: 2.7.8
- FFmpeg fallback: 8.0.1 essentials build

Legacy Stacher/YTD Pro names and the old 7.1.8 version were removed from active product metadata, window text, and tray text. UI layout and locked runtime behavior were not redesigned.

## Automated regression

Final `npm test` result:

- Total: 57
- Passed: 57
- Failed: 0
- Skipped: 0
- Duration: 2,945.5058 ms

All Phase 1-5 regression areas passed. Phase 6 added one acceptance assertion proving temporary authentication cookies are removed when an operation is cancelled.

## Clean build

Old `dist` content was moved out before each release build. Final results:

- `npm run preflight`: PASS
- `npm test`: PASS
- `npm run build`: PASS
- electron-builder: 24.13.3
- Portable: `dist/YTDOWNLOAD 1.0.0.exe`, 143,293,785 bytes
- Portable SHA-256: `CC886515418A0C302DC3956FEC68E8FCA56BEA0411221908AB9523272A2B4A4A`
- Unpacked app: `dist/win-unpacked/YTDOWNLOAD.exe`
- `app.asar`: 140,583 bytes

Final `app.asar` contains only runtime source/UI files and the renderer mascot. Tests, validation scripts, phase reports, and `resources/bin` are excluded.

## Fresh-install acceptance

`npm run test:fresh-install` passed against the final artifact with:

- New empty userData
- No pre-existing writable runtime
- `PATH` reduced to `C:\WINDOWS\System32`
- No system yt-dlp, Deno, FFmpeg, or Python dependency
- No Administrator elevation; package uses `requestedExecutionLevel: asInvoker`

First launch copied fallback engines into userData runtime and passed all diagnostics. A second launch against the same isolated userData also stayed running and reported all engines healthy. The dedicated YouTube partition existed. Automatic test cleanup removed the temporary fresh-install directory.

## Public video acceptance

Public URL: `https://www.youtube.com/watch?v=jNQXAC9IVRw`

- Metadata loaded: PASS (`Me at the zoo`)
- Real DownloadManager job: `public-video-1`
- State path: `QUEUED -> METADATA -> DOWNLOADING -> VERIFYING -> DONE`
- Retry count: 0
- Exact output path reported and present: PASS
- Merge: PASS
- Video stream: PASS
- Audio stream: PASS
- Playable duration: 00:00:19.02

The final packaged-artifact fresh-install test independently repeated the metadata, download, merge, exact-path, stream, and duration checks.

## Playlist acceptance

Public playlist: `https://www.youtube.com/playlist?list=PL2m1vjiMH_hNUSRHljPR-deOEKs8G_5nK`

Only the first two entries were selected. Metadata returned two ordinary video URLs. Both downloaded and merged successfully:

- `01 - Countdown to Liftoff! 🚀🦊 #ozzyfox #shorts.mp4` (743,288 bytes)
- `02 - Play Catch with Mickey and Minnie Mouse! 🩵✨ ｜ Me & Mickey ｜ ESPN JV.mp4` (17,454,209 bytes)

Renderer playlist selection and single-URL submission both use `enqueue-download-jobs`; main process sends both to the same `DownloadManager.enqueueMany` path. Controlled playlist regression confirmed the shared manager and concurrency limit of 2. No separate playlist downloader exists.

## Queue, cancellation, and restart recovery

Controlled acceptance covered at least three jobs and confirmed:

- Maximum two active jobs
- Third job remains queued until a slot opens
- Next job starts automatically
- Duplicate active/queued URL and destination does not spawn again
- Queued cancellation never spawns a process
- Active cancellation kills its process
- Cancel-all handles queued and active jobs
- Cancelled jobs remain `CANCELLED`, never `FAILED`
- Queue continues after an individual cancellation
- Persisted queues reload after restart
- Interrupted active states normalize to `QUEUED`
- Restart does not create a duplicate job
- yt-dlp retains native partial-file handling for interrupted work

## Authentication acceptance

Automated acceptance confirmed:

- Dedicated persistent `persist:ytdownload-youtube` partition
- Session state survives helper recreation
- Login window isolation settings remain enabled
- Logout clears only the dedicated YouTube partition
- Unrelated app state remains untouched
- Metadata, playlist, and download use the same temporary-cookie helper
- Temporary cookie files are removed after success, failure, and cancellation
- Simulated stale `userData/tmp/ytd-auth-*.txt` is removed on startup

No test account/session was supplied, so a live authenticated download was not performed. No credential or cookie content was inspected or recorded.

## Auto-recovery, update, rollback, and repair

Regression and executable-level acceptance confirmed:

- `n challenge` and `nsig` failures classify as recoverable
- Recoverable failure invokes safe update and retries exactly once
- No nested DownloadManager retry loop
- Invalid/private/geo/auth failures do not trigger engine update
- 24-hour periodic update cadence and offline startup behavior pass
- Manual update against disposable runtime returned `UP_TO_DATE`
- Runtime yt-dlp remained usable at 2026.07.04
- Backup behavior passed
- Broken updated binary rollback passed
- Corrupt runtime plus corrupt backup restored yt-dlp from packaged fallback
- Deleted runtime Deno and FFmpeg restored from packaged fallback
- Final diagnostics reported all three engines `ok`
- Packaged fallback SHA-256 stayed unchanged during update and repair

## Unicode acceptance

Exact-path regression covers Vietnamese, Japanese, Korean, spaces, punctuation, and emoji. Real playlist outputs additionally proved emoji, full-width punctuation, spaces, `#`, and `!` survive filename creation. No ASCII-only conversion was observed.

## Security and log audit

Fresh-install log contains resolved engine paths, runtime/fallback versions, recovery sources, and diagnostics. DownloadManager records contain job IDs, state transitions, retry counts, completion paths, and recovery fields.

Automated redaction tests and generated-log inspection found no cookie values, Netscape cookie contents, passwords, authorization headers, bearer tokens, or access/refresh/session tokens. The report contains no authentication secrets.

## Packaged payload audit

- `app.asar` has no `resources/bin` payload
- Exactly three fallback executables exist at `resources/bin/fallback`: yt-dlp, Deno, FFmpeg
- No duplicate engine binary appears in `app.asar`
- Writable runtime is created only below userData
- Update/repair modifies disposable runtime, not packaged fallback
- Portable manifest configuration uses `asInvoker`
- Final `dist` contains only `win-unpacked`, builder metadata, and the 1.0.0 portable executable

## Bugs found and fixed

1. Release identity still mixed Stacher/YTD Pro, v5, and 7.1.8. Fixed metadata and visible labels to YTDOWNLOAD 1.0.0.
2. Fresh-install script still expected the old executable name. Fixed default path.
3. Fresh-install validation did not assert playable duration or clean its temporary userData. Added duration validation and safe default cleanup.
4. Cancelled authentication-operation cleanup lacked an explicit regression. Added it.
5. Tests, scripts, and old phase reports were unnecessarily packed in `app.asar`. Excluded them from release payload.

All relevant checks and the full regression suite passed after these fixes.

## Remaining known risks

- YouTube extractor behavior and public test content can change outside application control; Phase 2 recovery reduces but cannot eliminate this risk.
- Live authenticated download was not exercised because no suitable test account was available.
- Executable is not code-signed and uses Electron's default icon; this can affect Windows trust presentation but does not require elevation or affect tested runtime behavior.

RELEASE_ACCEPTED
