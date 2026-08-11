# YTDOWNLOAD Phase 5 — Packaging / Fresh Install / Recovery Report

## Runtime and fallback architecture

Production now separates immutable packaged engines from writable per-user engines:

```text
<process.resourcesPath>/bin/fallback/
  yt-dlp.exe
  deno.exe
  ffmpeg.exe

<app.userData>/runtime/
  yt-dlp.exe
  yt-dlp.backup.exe
  deno.exe
  ffmpeg.exe
  bootstrap-state.json
```

All metadata, playlist, download, diagnostics, Repair, and update operations execute absolute paths under `app.userData/runtime`. No operation resolves a system binary or writes to the packaged fallback directory.

## First-run bootstrap

At startup, `bootstrapRuntime`:

1. Creates the writable runtime directory.
2. Probes each packaged fallback by absolute path.
3. Keeps an existing valid runtime, regardless of whether its version is newer than fallback.
4. Restores an invalid/missing yt-dlp from a valid runtime backup, then fallback.
5. Restores invalid/missing Deno and FFmpeg from fallback.
6. Verifies all runtime copies by launching their version commands.
7. Atomically persists runtime/fallback versions, status, and recovery source in `bootstrap-state.json`.

A missing or unlaunchable fallback produces a hard diagnostic failure. A valid newer runtime is never overwritten merely because a packaged baseline differs.

## Repair priority

Repair uses this bounded order:

- Valid current runtime: keep it.
- Invalid yt-dlp plus valid runtime backup: restore backup.
- Invalid/missing backup: restore immutable yt-dlp fallback.
- Invalid/missing Deno or FFmpeg: restore their immutable fallbacks.
- Verify every restored executable and report `runtime`, `backup`, or `fallback` as its recovery source.

Phase 2 updates only writable runtime `yt-dlp.exe`. The backup is created beside the runtime executable. A broken update restores a verified backup first, then a verified immutable fallback. The fallback is never passed `--update` and never written.

## Independent version and path model

Diagnostics now records:

- `runtime_ytdlp_path`, `fallback_ytdlp_path`, and both versions/status values.
- `runtime_deno_path`, `fallback_deno_path`, and both versions/status values.
- `runtime_ffmpeg_path`, `fallback_ffmpeg_path`, and both versions/status values.
- Per-engine recovery source.

Existing Phase 1 diagnostic aliases remain available for compatibility. Logs contain paths, versions, status, and recovery source only; auth secrets remain excluded.

## Build provisioning

`scripts/provision-binaries.ps1` creates `resources/bin/fallback`, copies only missing approved binaries from a supplied source directory, launches every version command, and prints SHA256 for review. `-Refresh` is required to intentionally replace an existing fallback baseline. It does not silently download binaries.

`scripts/test-fresh-install.ps1` provides the repeatable clean-machine procedure. It creates isolated userData, restricts PATH to Windows `System32`, launches the packaged app without elevation, verifies bootstrap, and optionally performs public metadata/download/merge validation.

Because `resources/bin` remains Git-ignored, a fresh source checkout must explicitly provide approved binaries:

```powershell
.\scripts\provision-binaries.ps1 -SourceDirectory C:\approved\YTDOWNLOAD-bin
```

Missing or invalid binaries stop provisioning with a clear error.

## Build preflight and packaging

`npm run preflight` checks required application files, package metadata, immutable fallback packaging configuration, binary presence, and all three version commands with an empty executable-search PATH.

The same preflight is registered as electron-builder's `beforePack` hook, so direct electron-builder execution is also blocked when critical fallback resources are missing. Packaging copies only `resources/bin/fallback/` to `resources/bin/fallback/`; no mutable runtime is shipped inside the application directory.

`npm run build` completed successfully and produced:

- `dist/YTD Pro v5 7.1.8.exe`
- `dist/win-unpacked/`

The unpacked package contains only the three immutable engines under `resources/bin/fallback`.

## Fresh-install validation

A packaged build was launched as a normal, non-elevated user with:

- Unique empty userData directory.
- No previous runtime or bootstrap state.
- PATH restricted to Windows `System32`; no Python, yt-dlp, Deno, or FFmpeg was available through PATH.

Results:

- App launched successfully.
- All three runtime engines were copied from fallback.
- `bootstrap-state.json` reported `ok: true` and `fallback` as the first-run recovery source.
- Runtime and fallback diagnostics passed.
- Public metadata extraction passed for YouTube video `jNQXAC9IVRw` (`Me at the zoo`).
- yt-dlp selected two separate formats (`video + audio`).
- Public download completed to an exact final MP4 path (475,973 bytes).
- The runtime FFmpeg probe confirmed both a video stream and an audio stream in the merged output.
- No administrator privileges or system engine/Python dependency was used.

## Corruption and regression tests

`npm test`: **56 passed, 0 failed**.

Phase 5 coverage includes:

- First-run bootstrap and persisted state.
- Existing valid/newer runtime preservation.
- Missing/corrupt runtime restoration.
- Backup-before-fallback priority.
- Invalid backup fallback recovery.
- Runtime-only yt-dlp update and immutable fallback preservation.
- Missing Deno and FFmpeg Repair.
- Missing fallback hard failure.
- Build-preflight missing-binary failure.
- Fresh-install absolute paths with no system executable lookup.

All Phase 1–4 regression tests also passed. The build preflight, electron-builder hook, portable packaging, fresh launch, public metadata, public download, and merge validations passed.

## Files changed

- `runtime-binaries.js`
- `engine-runtime.js`
- `main.js`
- `package.json`
- `scripts/provision-binaries.ps1`
- `scripts/preflight.js`
- `scripts/test-fresh-install.ps1`
- `test/runtime-binaries.test.js`
- `test/auto-recovery.test.js`
- `test/engine-runtime.test.js`
- `PHASE5_PACKAGING_RECOVERY_REPORT.md`

## Remaining risks

- Fallback binaries are intentionally not committed; builders must provision approved artifacts before preflight can pass.
- SHA256 values are displayed but not pinned in source. Pin checksums when release artifact governance is established.
- Public YouTube validation depends on external network and video availability.
- The Windows portable executable is not code-signed and still uses electron-builder's default icon.

Phase 5 stops here. No Phase 6 work was started.
