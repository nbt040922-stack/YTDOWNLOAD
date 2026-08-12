# YTDOWNLOAD — iPhone Capsule UI + Final Control Alignment Report

## URL capsule geometry

- Converted the URL surface to a true `999px` pill.
- Idle minimum height is 68px, within the requested 64–72px range.
- Existing 900px responsive max-width remains unchanged.
- Capsule content uses `align-items: center` with 13px vertical padding.
- Textarea uses a 40px box, zero margin/padding, and 40px line height so idle placeholder and typed text share the capsule center line.
- Search remains translucent (`rgba(255,255,255,0.28)`) with the existing blur, thin rim, asymmetric inset edge, and tighter two-layer shadow.
- Heavy SVG displacement/refraction from Pass 9 was removed as directed; no extra blur was added.

## Queue capsule geometry

- Download cards now use a 72px minimum height and `border-radius: 999px`.
- Existing responsive 900px max-width and flexible content column remain unchanged.
- Thumbnail remains 80×45px with 11px corners and vertical flex centering.
- Content column uses `justify-content: center` and a reduced 4px internal gap.
- Progress track is now 3px high with fully rounded ends.
- Completed, active, failed, and cancelled cards retain neutral backgrounds with existing faint semantic rims/icons only.
- Title truncation and flexible width protect right-side controls at narrow widths.

## Button alignment contract

- Search download control is a fixed 40×40 circle with zero margin/padding and flex centering.
- Default button glass is `rgba(255,255,255,0.12)`; hover is `0.30`.
- Font Awesome download glyph remains corrected at glyph level only with `translateY(-1px)`.
- Queue action controls use fixed 34×34 geometry, zero padding, flex centering, and block/line-height normalization for glyphs.
- Window-control glyphs share the same block/line-height normalization.

## Old positioning hacks removed

- Removed the obsolete `mt-[-4px]` minimize-icon class.
- Removed old search-button 1px top margin.
- Removed obsolete `quality-badge` top-margin, separator, and padding rules.
- Removed Pass 9 SVG filter definitions, refraction map asset, URL filter support blocks, card filter support blocks, and their dedicated contract test.
- No removed profile/link icons, folder pill, or separator returned.

## Files changed

- `index.html`
- `style.css`
- `test/pass8-contract.test.js`
- `test/capsule-ui-contract.test.js`
- Removed `resources/refraction-map.svg`
- Removed `test/pass9-refraction.test.js`
- Added `IPHONE_CAPSULE_UI_ALIGNMENT_REPORT.md`

No runtime, yt-dlp, DownloadManager, authentication, queue, File menu, update/recovery, IPC, or application-state behavior changed.

## Visual verification

Verified directly in an isolated Electron profile:

- Empty state: placeholder and 40×40 download control centered in the 68px URL pill.
- Active job: thumbnail, title/status, 3px progress, percentage, and cancel control centered.
- Completed job: neutral capsule, green check, Completed, and 100% visible.
- Failed job: neutral capsule, long title truncation, failure status, progress, and retry control aligned.
- Multiple jobs: consistent 12px spacing, matching capsule ends, and no crowding.

Synthetic visual-only queue fixtures were removed before final testing and are not present in source.

## Regression result

- Command: `npm test`
- Tests: **65**
- Passed: **65**
- Failed: **0**
- Duration: **1752.9962 ms**
- `git diff --check`: passed.

This pass ends here. No further UI pass was started.
