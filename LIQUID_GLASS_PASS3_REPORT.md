# YTDOWNLOAD Liquid Glass Pass 3 Report

Date: 2026-08-12  
Base commit: `0bb4d22`  
Scope: strong Apple-inspired visual experiment only

## Files changed

- `style.css`
- `LIQUID_GLASS_PASS3_REPORT.md`

No HTML, JavaScript, runtime, DownloadManager, queue, authentication, IPC, recovery, packaging, or application-state behavior changed.

## Strong glass token system

Pass 3 defines reusable light-glass tokens for:

- `--glass-bg`
- `--glass-bg-strong`
- `--glass-bg-ultra`
- `--glass-border`
- `--glass-border-dark`
- `--glass-shadow`
- `--glass-shadow-soft`
- `--glass-inset`
- `--glass-blur`
- `--motion-fast`

Typography uses graphite `#1d1d1f`, secondary `#6e7378`, and muted `#989da3`. Old dark and pink visual tokens were removed. Green and red remain only for semantic success/error states.

## Depth hierarchy

- Level 0: light neutral body with two large, low-contrast radial fields.
- Level 1: translucent header and footer.
- Level 2: storage capsule, menu controls, and icon hover surfaces.
- Level 3: floating download cards and dropdowns.
- Level 4: elevated URL search surface and playlist modal.

Shadow strength, border opacity, blur, and radius increase by level instead of applying one treatment everywhere.

## Surfaces changed

- Header: 28px glass blur, light border, shallow floating shadow, neutral active-menu capsule.
- Search: 26px radius, 34px blur, strongest layered shadow, static liquid-like top highlight, neutral focus treatment.
- Icons: transparent by default; white translucent hover surface with a small border/shadow. Close retains conventional red danger hover.
- Storage path: compact floating glass pill.
- Cards: 20px radius, 22px blur, stronger depth, static top highlight, and 1px hover lift.
- Completed card: neutral surface with muted green check and faint green border only.
- Failed card: neutral surface with faint red border only.
- Cancelled card: reduced opacity only.
- Thumbnails: 11px radius and a restrained shadow.
- Progress: translucent track with graphite highlighted fill; no accent glow.
- Dropdowns: 32px blur, 18px radius, strong glass shadow, dark graphite text.
- Playlist: 14px overlay blur and 34px modal blur; rows remain flat and translucent.
- Footer: quiet translucent strip with no strong shadow.
- Welcome action, checkboxes, and batch button: neutral graphite/white controls; no pink remnants.

## Motion

- Hover/focus transitions use 160ms.
- Progress width transition uses 180ms.
- Movement is limited to `translateY(-1px)`.
- No scale, bounce, spring, shine sweep, or animated blur.
- `prefers-reduced-motion` suppresses nonessential motion.

## Performance precautions

- No new dependencies, frameworks, remote assets, or scripts.
- Blur is limited to body-level major surfaces: header, search, cards, dropdowns, modal/overlay, and footer.
- Buttons, playlist rows, modal controls, thumbnails, and progress elements do not add nested backdrop filters.
- Backdrop filters never animate.
- Static pseudo-element highlights exist only on search, cards, and modal.
- Opaque light fallbacks remain under `@supports not (backdrop-filter)`.

## Visual acceptance

The live Electron UI was inspected at 1020x760 with:

- Empty/welcome state
- Input focus
- Active download
- Completed download
- Multiple cards
- Failed card
- Cancelled card
- File dropdown
- Public playlist modal with long titles and scrolling
- Window controls and footer

The result immediately reads as a stronger premium light-glass UI. Contrast stayed readable, card title truncation remained intact, semantic states remained distinct, and no clipping or layout shifts were observed. Menu, input, download, and playlist interactions remained functional.

Temporary visual-test userData was removed after inspection. A user-initiated completed download in the normal Downloads folder was left untouched.

## Regression

Final `npm test` result:

- Total: 57
- Passed: 57
- Failed: 0
- Skipped: 0
- Duration: 1,718.1673 ms

Pass 3 complete. Pass 4 not started.
