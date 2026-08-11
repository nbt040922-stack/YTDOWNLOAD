# YTDOWNLOAD Phase 3 — Download Manager Report

## Scope

Phase 3 replaces renderer-owned download spawning with one persistent main-process `DownloadManager`. Phase 1 runtime behavior and the Phase 2 updater, classifier, backup, rollback, Repair, and 24-hour cadence remain intact.

## Files changed

- `download-manager.js` — job state machine, queue, concurrency, retry, cancellation, persistence, restart recovery, progress parsing, verification, and safe structured logging.
- `main.js` — manager lifecycle, IPC adapter, machine-readable yt-dlp progress, Phase 2 recovery integration, merge detection, and exact-path completion.
- `preload.js` — narrow queue-control API for the renderer.
- `renderer.js` — renders manager state and sends enqueue/cancel/retry/clear commands; it no longer owns a queue or yt-dlp processes.
- `style.css` — minimal cancelled-state styling using the existing card design.
- `test/download-manager.test.js` — Phase 3 manager, persistence, retry, cancellation, progress, and redaction coverage.
- `PHASE3_DOWNLOAD_MANAGER_REPORT.md` — implementation, validation, and risk report.

## State machine

Jobs use explicit states:

`QUEUED → METADATA → DOWNLOADING → MERGING → VERIFYING → DONE`

`FAILED` and `CANCELLED` are terminal until a failed job is manually retried. `MERGING` is entered when yt-dlp emits its merger/remux/fixup stage. Every successful operation enters `VERIFYING`; `DONE` is allowed only when yt-dlp's Phase 1 exact final path exists.

## Queue architecture

One main-process `DownloadManager` owns jobs, active process handles, scheduling, cancellation, retry, completion, and persistence. Single URLs and selected playlist entries both call `enqueueMany` and therefore use the same state machine and policy. Renderer state is a read-only snapshot received over IPC.

Duplicate protection rejects the same URL, output directory, and subdirectory while a matching job is queued or active. A completed, failed, or cancelled job does not permanently block another download.

## Concurrency behavior

The internal default is `2` concurrent jobs and is constructor-configurable. A terminal transition releases its active slot and immediately drains the next queued job. Queued cancellation never spawns a process. Active cancellation kills the registered yt-dlp child and remains `CANCELLED`, not `FAILED`.

## Retry rules

- Transient network failures such as reset, timeout, temporary failure, or applicable HTTP 5xx: at most one normal retry.
- Permanent content/input failures such as invalid/unsupported URL, private/deleted video, geo restriction, or login requirement: no normal retry.
- Engine/challenge failures: handled only by the existing Phase 2 `executeWithRecovery` path. The manager marks a final engine failure without adding another retry loop.
- Failed jobs may be manually reset to `QUEUED` with retry counters and progress cleared.

## Phase 2 integration

Metadata and download operations call the existing recovery-capable wrapper. Phase 2 remains the sole owner of extractor failure classification, official yt-dlp update, backup, verification, rollback, Deno verification, and one recovery retry. The periodic 24-hour check, Update Downloader, and Repair flows are unchanged.

## Persistence and restart recovery

`download-jobs.json` is stored in Electron `userData` and written through a temporary file followed by rename. Only the job whitelist is serialized; cookies, authorization headers, credentials, child processes, and runtime cancellation flags are excluded.

On startup, `DONE`, `FAILED`, and `CANCELLED` remain unchanged. Jobs interrupted in `METADATA`, `DOWNLOADING`, `MERGING`, or `VERIFYING` become `QUEUED` with progress reset, then restart through the ordinary manager. No custom byte-resume logic is added; yt-dlp remains responsible for its supported resume behavior.

## Progress parsing

Downloads use yt-dlp `--progress-template` output with a private prefix and pipe-delimited numeric fields. The manager tracks percentage, downloaded bytes, total or estimated bytes, speed, and ETA. UI updates are emitted live while disk persistence is throttled to avoid a write for every progress line.

## Test results

`npm test`: **32 passed, 0 failed**.

- 15 required Phase 3 manager scenarios passed.
- Machine-readable progress parsing and secret redaction tests passed.
- All existing Phase 1 and Phase 2 regression tests passed.
- Bundled yt-dlp, Deno, and FFmpeg launch diagnostics passed.

Packaging produced `dist/YTD Pro v5 7.1.8.exe` and the unpacked Windows application.

## Remaining risks

- A force-killed download can leave yt-dlp partial files; later retries rely on yt-dlp's native handling.
- Merge-state detection depends on yt-dlp's documented stage labels; unusual post-processors may move directly from downloading to verifying.
- Automated tests simulate download failures and process control. Real YouTube availability, account restrictions, and network conditions remain external variables.

Phase 3 stops here. No Phase 4 work was started.
