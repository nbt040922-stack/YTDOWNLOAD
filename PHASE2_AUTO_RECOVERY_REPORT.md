# Phase 2 Auto-Recovery Report

Date: 2026-08-11

Phase 1 runtime arguments, exact-path handling, bundled engine resolution, diagnostics, and non-admin packaging remain intact. Phase 2 adds a recovery layer around those paths without redesigning the application.

## Files changed

- `engine-runtime.js`: update states, 24-hour cadence, failure classifier, safe update, backup/rollback, repair, structured logging, and one-retry recovery wrapper.
- `main.js`: shared update lock, persisted update state, non-blocking periodic check, recovery wrapping for metadata/playlist/download, and repair/status IPC handlers.
- `preload.js`: exposes engine status, repair, and status update events.
- `renderer.js`: displays engine versions and handles Update Downloader/Repair results.
- `index.html`: adds two engine version rows and the Repair action to the existing Tools menu.
- `style.css`: minimal non-interactive styling for version rows.
- `test/auto-recovery.test.js`: the 10 required recovery tests.
- `PHASE2_AUTO_RECOVERY_REPORT.md`: this report.

## Failure classifier

Recoverable evidence:

- `n challenge solving failed` / equivalent n-challenge failure
- `nsig extraction failed`
- `Only images are available`
- `Requested format is not available`
- player or signature extraction failure
- extractor failure
- JavaScript challenge or challenge-solver failure

Not automatically recoverable without explicit engine evidence:

- invalid or unsupported URL
- private or deleted video
- generic video unavailable
- geographic restriction
- login/sign-in-required content
- unclassified errors

Classification returns only a category/reason. Raw stderr, cookies, authorization headers, and authentication values are not written to recovery logs.

## Recovery state machine

```text
Run original operation
  |-- success -> return result
  |-- non-engine failure -> return original error; no update
  `-- recoverable engine failure
        -> join/start one shared update operation
        -> back up yt-dlp.exe
        -> run official self-update once
        -> verify yt-dlp --version
        -> verify bundled Deno --version
        |-- unusable update -> restore backup and verify it
        `-- usable engine -> retry original operation exactly once
              |-- success -> RECOVERY_SUCCESS
              `-- failure -> RECOVERY_FAILED; no further retry
```

Explicit result states:

- `NOT_CHECKED`
- `UP_TO_DATE`
- `UPDATED`
- `UPDATE_FAILED_USABLE`
- `UPDATE_FAILED_ROLLED_BACK`
- `RECOVERY_SUCCESS`
- `RECOVERY_FAILED`

Every update/recovery log record is restricted to:

- `old_version`
- `new_version`
- `update_trigger`
- `recovery_retry`
- `rollback_performed`
- `update_status`

## Backup and rollback

- Runtime binary: `<bundled bin>/yt-dlp.exe`
- Backup: `<bundled bin>/yt-dlp.backup.exe`
- The current executable must pass `--version` before it becomes the backup.
- Official update runs once.
- Updated yt-dlp and bundled Deno are executed after update.
- If the updated executable cannot run or version verification fails, the backup replaces it and is executed again.
- Failed network/update checks that leave the current executable usable return `UPDATE_FAILED_USABLE` and do not stop the app.
- Manual Repair runs full yt-dlp/Deno/FFmpeg diagnostics and restores the backup only when runtime yt-dlp is unusable.

## Update cadence

The existing user `settings.json` now preserves:

```json
{
  "last_update_check": "2026-08-11T14:15:45.111Z",
  "last_known_version": "2026.07.04",
  "last_update_result": "UP_TO_DATE"
}
```

- A periodic check is due only when the timestamp is absent, invalid, or at least 24 hours old.
- The attempted check time is persisted even if offline, preventing repeated startup checks.
- Startup diagnostics still gate truly unusable bundled engines, but the periodic network update runs in the background and is never awaited by app startup.
- A second packaged launch inside the interval returned `NOT_CHECKED` and left `last_update_check` unchanged.

## Minimal UI

Existing Tools menu now contains:

```text
yt-dlp: 2026.07.04
Deno: 2.7.8
Update Downloader
Repair
```

No main layout, queue, playlist modal, progress, login, tray, or visual theme was redesigned.

## Tests

Automated test result: `15/15 PASS` (`10` Phase 2 recovery tests plus `5` locked Phase 1 tests).

| Required Phase 2 test | Result |
| --- | --- |
| Periodic check respects 24-hour interval | PASS |
| Offline update check does not block startup | PASS |
| n-challenge error triggers one recovery update | PASS |
| nsig error triggers one recovery update | PASS |
| Non-engine error does not trigger update | PASS |
| Retry happens exactly once | PASS |
| Broken updated binary rolls back | PASS |
| Successful update keeps new binary | PASS |
| Manual Repair restores usable state | PASS |
| Cookie/auth content does not enter recovery logs | PASS |

Additional smoke results:

- Portable electron-builder package: PASS
- Packaged startup at Windows Medium Mandatory Level without UAC: PASS
- Periodic update: `UP_TO_DATE`, backup created, settings persisted: PASS
- Immediate second startup: `NOT_CHECKED`, timestamp unchanged: PASS
- Tools version display: PASS
- Manual Repair through packaged UI: `RECOVERY_SUCCESS`: PASS
- Packaged diagnostics: yt-dlp `2026.07.04`, Deno `2.7.8`, FFmpeg `8.0.1`, JS runtime and H.264 available: PASS

## Remaining risks

- YouTube failure text can change; unknown wording remains non-recoverable by design to avoid unsafe update triggers.
- Windows may prevent executable replacement while another yt-dlp process is active. The update then reports a usable failure or rollback instead of looping; a later operation/check may try again after the 24-hour cadence or manual action.
- Repair can restore only a backup created by a prior safe update. A fresh install with a damaged initial binary has no separate immutable recovery image.
- Network-dependent yt-dlp/EJS behavior remains external. Recovery reduces manual work but cannot repair an upstream outage or unavailable release service.
- Login/cookie architecture remains intentionally unchanged.

Phase 3 was not started.
