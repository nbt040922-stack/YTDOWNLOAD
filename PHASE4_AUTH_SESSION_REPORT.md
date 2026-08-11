# YTDOWNLOAD Phase 4 — Login / Cookie Hardening Report

## Scope

Phase 4 replaces the default Electron session and permanent runtime use of `cookies.txt` with one dedicated persistent YouTube session and per-operation temporary cookie exports. Phase 1 runtime verification, Phase 2 recovery, and Phase 3 queue/concurrency behavior remain unchanged.

## Files changed

- `auth-session.js` — shared persistent session, login window, auth state, Netscape export, temp cleanup, logout, auth classification, and redaction.
- `main.js` — shared helper lifecycle and authenticated metadata, playlist, and download integration.
- `preload.js` — narrow auth state, login, logout, and state-update bridge.
- `renderer.js` — minimal auth state rendering and login/logout actions.
- `index.html` — YouTube state plus Login/Logout items in the existing Tools menu.
- `download-manager.js` — expanded secret redaction for auth/session tokens and passwords.
- `test/auth-session.test.js` — Phase 4 security and integration coverage.
- `PHASE4_AUTH_SESSION_REPORT.md` — this report.

## Session partition

Login and cookie extraction both use `persist:ytdownload-youtube`. The `persist:` prefix gives the partition durable Chromium storage across normal app restarts. It does not share cookies or storage with Electron's default session.

The login window loads YouTube directly with `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, no preload, and no application APIs. The app never requests, reads, or injects code to capture credentials.

## Auth state model

The helper exposes only:

- `SIGNED_OUT`
- `SIGNED_IN`
- `UNKNOWN`

`SIGNED_IN` requires a recognized YouTube/Google authentication cookie in the dedicated partition. No email, account name, profile, or cookie value reaches the UI.

## Temporary-cookie lifecycle

Before metadata, playlist metadata, or an actual download, the same helper:

1. Reads only YouTube/Google-relevant cookies from the dedicated partition.
2. Creates a unique `userData/tmp/ytd-auth-<random>.txt` Netscape file with exclusive creation and restrictive file mode where supported.
3. Supplies that path to the existing `buildYtDlpBaseArgs` flow.
4. Keeps the file available through the bounded Phase 2 recovery operation.
5. Deletes it in `finally` after success, failure, or normal cancellation completion.

Startup removes stale files matching only the private `ytd-auth-*.txt` pattern. Output/download directories are never used for auth files. Cookie values and full Netscape content are never logged.

## Logout behavior

Logout calls `clearStorageData` only on the dedicated YouTube partition, removes stale temporary auth files, and publishes `SIGNED_OUT`. Default-session and unrelated application data are untouched.

## Legacy `cookies.txt` migration

If legacy `userData/cookies.txt` exists, the app retains it for recovery verification but no longer passes it to yt-dlp and never imports or silently trusts its plaintext contents. The safe migration path is one manual login in the dedicated YouTube window; after that, Chromium's persistent partition is the primary and only runtime auth source. Automatic plaintext import was deliberately omitted because it would re-trust long-lived secrets and mutate the new browser session without user confirmation. The legacy file is not deleted automatically.

## Authentication failures

Login-required yt-dlp output is normalized to `YouTube sign-in required`. It is categorized as permanent `AUTH`, receives no Phase 3 network retry, and remains excluded from Phase 2 engine updates. The existing Login actions remain visible; no automatic login loop is created.

## Security decisions

- Dedicated persistent partition; no `defaultSession` auth use.
- No username/password collection or credential-reading JavaScript.
- Relevant domains only in cookie export.
- Correct domain/subdomain, path, secure, expiration, name, value, and HttpOnly Netscape representation.
- Unique temporary files, exclusive creation, narrow startup cleanup, and unconditional operation cleanup.
- Structured logs omit cookie contents; cookie, authorization, bearer, access/refresh/OAuth/session token, and password patterns are redacted.
- Legacy plaintext cookies are retained but disabled.

## Test results

`npm test`: **43 passed, 0 failed**.

- All 11 Phase 4 auth/session tests passed.
- Dedicated partition, restart persistence, safe login preferences, temporary file success/failure cleanup, stale cleanup, logout isolation, auth retry exclusions, shared-helper integration, Netscape fields, and redaction are covered.
- All existing Phase 1, Phase 2, and Phase 3 regression tests passed.
- Bundled yt-dlp, Deno, and FFmpeg diagnostics passed.

## Remaining risks

- YouTube can change cookie names or sign-in requirements; an unrecognized future cookie may display `UNKNOWN`/`SIGNED_OUT` even while browser navigation is authenticated.
- A power loss can leave a temporary file until the next startup cleanup.
- Automated tests do not perform a real Google account login; that remains an interactive external flow.
- The retained legacy `cookies.txt` remains plaintext until the user manually archives or removes it after verifying the dedicated session.

Phase 4 stops here. No Phase 5 work was started.
