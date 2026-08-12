# YTDOWNLOAD — Liquid Glass Pass 9 Refraction Report

## Technique tested

A search-bar proof of concept used an inline SVG `feDisplacementMap` with a separate deterministic two-channel displacement image. The glass optical layer redraws the existing fixed cyan/lavender/peach background beneath the surface, then displaces that copy near the rounded edges.

The displacement map uses smooth horizontal red-channel and vertical green-channel gradients. Its center band is neutral (`128`), while displacement increases toward each edge and combines at corners. It contains no turbulence, random noise, ripple, or animation.

## Electron / Chromium behavior

The bundled Electron 28 / Chromium runtime rendered the local SVG filter on the search pseudo-element. Visual proof-of-concept inspection showed the fixed ambient layer continuing through the search surface with an optical edge discontinuity while the textarea and download icon remained sharp above it.

A stronger temporary scale was prepared to exaggerate the proof, but the compositor switched to a user-active window during capture. Automation stopped immediately rather than taking focus. The selected production scale remains the initially rendered subtle value.

## Refraction implementation selected

- SVG filter definitions live once in `index.html`.
- `resources/refraction-map.svg` supplies a static rounded-surface displacement field.
- Search refraction uses displacement scale `18`.
- Card refraction uses scale `11`, approximately 61% of search strength.
- Pseudo-elements reproduce the viewport-aligned application background with `background-attachment: fixed`, then apply the displacement filter.
- Search/card text, thumbnails, labels, progress UI, icons, and buttons use a higher content stacking layer and are never filtered.
- Thin directional rim overlays add restrained cyan/lavender/peach separation below 2px, with a brighter top-left and darker bottom-right edge.

## Fallback behavior

The refraction rules are guarded by CSS `@supports (filter: url(...))`. When URL-based SVG filtering is unavailable, the Pass 8 fill, rim gradient, backdrop blur, borders, and shadows remain active. No startup or runtime logic depends on the effect.

Cards after the first eight also use the standard Pass 8 glass treatment, preserving usability and predictable cost for large queues.

## Surfaces using refraction

- URL search surface: strongest static displacement and lens rim.
- First eight download cards: weaker static displacement and rim.
- Header, footer, dropdowns, modal, buttons, and nested controls retain their existing lightweight glass styling.

## Glass fill and edge tuning

- Search white fill: `0.35` → `0.24`; focus: `0.38` → `0.28`.
- Card white fill: `0.31` → `0.20`; hover: `0.34` → `0.24`.
- Existing backdrop blur and saturation values were not increased.
- Existing darker neutral base and ambient field colors were unchanged.
- Close/distance shadows remain the tight Pass 8 values.

## Performance impact

- Static SVG filters only; no JavaScript render loop.
- No WebGL canvas, continuous animation, animated turbulence, or 60fps redraw.
- One shared map asset and two filter definitions.
- Refraction is limited to the search surface and first eight cards.
- No nested backdrop filters were added.

## Preserved product decisions

- No profile icon or left link icon inside the URL field.
- Only the aligned 34×34 download action remains.
- Folder controls remain under File; no path pill returned.
- Queue remains session-only.
- DONE remains normalized to 100%.
- Downloader, runtime, recovery, auth, IPC, and queue semantics were not changed.

## Regression results

- Command: `npm test`
- Tests: **65**
- Passed: **65**
- Failed: **0**
- Duration: **1958.9965 ms**
- New visual contract tests verify both displacement filters, deterministic map channels, absence of turbulence/animation, sharp content stacking, capability fallback guards, and the eight-card performance cap.
- `git diff --check`: passed.

Pass 9 ends here. No later pass was started.
