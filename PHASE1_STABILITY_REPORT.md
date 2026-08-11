# Phase 1 Stability Hardening Report

Date: 2026-08-11
Scope: downloader runtime stability only; no UI redesign or Phase 2 work.

## Files changed

- `engine-runtime.js`: shared bundled-binary resolver, shared yt-dlp base arguments, process runner, engine diagnostics, update verification, and final-path parser.
- `main.js`: uses shared runtime for metadata, playlist metadata, download, startup diagnostics, and yt-dlp update.
- `renderer.js`: shows update status/version transition and receives the exact completed output path without changing layout.
- `package.json`: adds the Node test command and changes Windows execution level from `requireAdministrator` to `asInvoker`.
- `test/engine-runtime.test.js`: focused tests for shared arguments, Unicode final paths, executable diagnostics, and missing-binary reporting.
- `PHASE1_STABILITY_REPORT.md`: this report.
- `resources/bin/yt-dlp.exe`: locally self-updated from `2026.03.17` to `2026.07.04`; the binary directory remains Git-ignored but is included by electron-builder.

## Old behavior

- Metadata, playlist, and download each assembled their own yt-dlp arguments.
- Normal calls forced `--no-check-certificate`, a Chrome User-Agent, and `youtube:player_client=web,web_embedded`.
- Deno discovery depended on environment variables and a modified `PATH`.
- Downloads forced `--restrict-filenames` and verified completion by scanning for the first 15 sanitized title characters.
- Startup only checked whether the three executable files existed.
- Update ran `yt-dlp --update` without pre/post executable or version checks.
- Portable builds requested Administrator elevation.

## New behavior

- All YouTube metadata, playlist, and download calls use `buildYtDlpBaseArgs()`.
- Every call explicitly passes bundled Deno and EJS fallback:
  - `--js-runtimes deno:<absolute bundled deno.exe>`
  - `--remote-components ejs:github`
- `--encoding utf-8` makes exact Unicode paths round-trip correctly through Windows stdout.
- Removed default certificate bypass, forced player clients, stale User-Agent, and restricted filenames.
- Downloads request `--print after_move:__YTD_FINAL_PATH__:%(filepath)s`, capture the exact final path, verify that exact file, and send it to the renderer.
- Production resolves binaries only from `process.resourcesPath/bin`; development resolves only from `resources/bin`.
- Startup executes all three binaries and logs paths, versions, availability, errors, JS runtime state, and H.264 encoder availability to `app_debug.log`.
- Update records the old version, runs official self-update once, verifies the executable/version afterward, and reports `updated`, `already_current`, `precheck_failed`, `failed_usable`, or `failed_unusable`.
- Portable build uses the caller's Windows token (`asInvoker`) without UAC elevation.

## yt-dlp commands before and after

Metadata before:

```text
yt-dlp --dump-json --no-check-certificate --extractor-args youtube:player_client=web,web_embedded --user-agent <stale Chrome UA> [--cookies cookies.txt] <URL>
```

Metadata after:

```text
<bundled yt-dlp.exe> --encoding utf-8 --js-runtimes deno:<absolute bundled deno.exe> --remote-components ejs:github [--cookies cookies.txt] --dump-json <URL>
```

Download before:

```text
yt-dlp --ffmpeg-location <ffmpeg.exe> --output <template> --restrict-filenames --no-part -f bestvideo+bestaudio/best --merge-output-format mp4 --newline --progress --no-check-certificate --extractor-args youtube:player_client=web,web_embedded --user-agent <stale Chrome UA> [--cookies cookies.txt] <URL>
```

Download after:

```text
<bundled yt-dlp.exe> --encoding utf-8 --js-runtimes deno:<absolute bundled deno.exe> --remote-components ejs:github [--cookies cookies.txt] --ffmpeg-location <absolute bundled ffmpeg.exe> --output <Unicode template> --no-part -f bestvideo+bestaudio/best --merge-output-format mp4 --newline --progress --no-simulate --print after_move:__YTD_FINAL_PATH__:%(filepath)s <URL>
```

## Resolved engines

Development:

- yt-dlp: `F:\CA_NHAN\Tool\YTDOWNLOAD\resources\bin\yt-dlp.exe` — `2026.07.04`
- Deno: `F:\CA_NHAN\Tool\YTDOWNLOAD\resources\bin\deno.exe` — `2.7.8`
- FFmpeg: `F:\CA_NHAN\Tool\YTDOWNLOAD\resources\bin\ffmpeg.exe` — `8.0.1-essentials_build-www.gyan.dev`

Packaged smoke test:

- yt-dlp: `F:\CA_NHAN\Tool\YTDOWNLOAD\dist\win-unpacked\resources\bin\yt-dlp.exe` — `2026.07.04`
- Deno: `F:\CA_NHAN\Tool\YTDOWNLOAD\dist\win-unpacked\resources\bin\deno.exe` — `2.7.8`
- FFmpeg: `F:\CA_NHAN\Tool\YTDOWNLOAD\dist\win-unpacked\resources\bin\ffmpeg.exe` — `8.0.1-essentials_build-www.gyan.dev`
- `js_runtime_available: true`
- `h264_available: true`

## Test results

| Test | Result |
| --- | --- |
| `npm test` | PASS — 5/5 |
| Public/known JS-challenge metadata: `9SEH1ItSR4I` | PASS; Deno explicitly detected, metadata returned |
| Actual video download and FFmpeg merge: `YKsQJVzr3a8` | PASS; 61,275-byte MP4 |
| Exact final path and mixed Unicode filename | PASS; Japanese, Korean, Vietnamese, and emoji path returned exactly and existed |
| Japanese metadata title: `4EeTnIV05j4` | PASS; `【1hour Podcast】「日本語上手」ってなんだろう？ ...` preserved |
| Channel playlist metadata: `@livinleggings/videos` | PASS; first three items parsed |
| Manual yt-dlp update | PASS; `2026.03.17` to `2026.07.04`, post-update launch verified |
| Portable electron-builder package | PASS; `dist/YTD Pro v5 7.1.8.exe` built |
| Normal-user startup | PASS; Windows Medium Mandatory Level, no UAC, app remained running |
| Packaged startup diagnostics | PASS; all bundled paths/versions logged and executable |
| Folder selection | PASS; packaged app opened native picker at `D:\Test` and selected the same folder |

Download smoke used the production argument path with a four-second public video to keep test transfer small. Queue, progress, cancel-all, login, tray, and playlist UI code paths were not redesigned.

## Remaining risks

- YouTube behavior and EJS delivery remain external network dependencies; future extractor changes may still require a yt-dlp update.
- Cookie login architecture is intentionally unchanged for Phase 1.
- Automated smoke tests exercised engine paths and packaged startup; login requiring a real account and canceling a long in-progress download were not performed.
- `resources/bin/` is included in local packages but remains excluded from Git, so a fresh clone must provision the three approved binaries before building.
