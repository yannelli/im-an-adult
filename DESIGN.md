# Design notes — "Scrolling. Period."

Visual identity for **I'm an Adult**, built as a small brand system rather than
a one-off icon.

## Concept

The name is a deadpan sentence, so the brand treats it like one: set in an
editorial serif and closed with a full stop. **Every full stop is terracotta** —
the period is the brand's signature, the typographic version of "end of
discussion."

The mark is a chunky **vertical double-headed arrow**: scrolling restored, both
directions, no interference. The terracotta period sits beside it — *scrolling,
period*. (The previous mark struck through a down-arrow, which read as "no
scrolling" — backwards for a product that gives scrolling back.) Promo art adds
one literal prop: a scrollbar with a terracotta thumb, the thing you are taking
back.

Tone targets: adult, dry, slightly defiant. Editorial print, not SaaS gradient.

## Palette

| Token     | Hex       | Use                                        |
| --------- | --------- | ------------------------------------------ |
| Cream     | `#F3F1E8` | Backgrounds (popup, promo art)             |
| Cream dim | `#E4E0CF` | Scrollbar tracks, quiet panels             |
| Ink       | `#17231D` | Headline type, body text                   |
| Ink soft  | `#4A544D` | Secondary/microtype                        |
| Pine      | `#1B4A33` | Icon field, brand green (`#2E5B43` for green text) |
| Terracotta| `#EB5C3F` | The period, scrollbar thumbs, accents      |

Evolved from the original palette: same cream/ink/terracotta family, green
consolidated to a single flat pine (no gradients — flat is adult).

## Typography

- **IBM Plex Serif SemiBold** — wordmark and headlines ("I'm an Adult.")
- **IBM Plex Serif Medium Italic** — the aside ("Let me scroll.")
- **IBM Plex Mono Medium** — letterspaced caps microtype (folio lines)

All type in shipped SVGs is outlined to paths — no font dependency. The popup
tagline falls back to Georgia italic (universally available) since bundling a
webfont for one line isn't worth the weight.

## Icon

Pine rounded square, cream double-arrow, terracotta period, faint cream
keyline for plaque-like finish. `icons/icon.svg` is the 32px+ master;
`icons/icon-16.svg` is a separate hand-tuned cut — solid filled arrow instead
of strokes (strokes smudge at 16px), no keyline, larger dot. Verified legible
on light (`#F1F3F4`) and dark (`#202124`) toolbar chips; the pine field holds
its edge on both.

## File map

| File | What it is |
| ---- | ---------- |
| `icons/icon.svg` | Icon master (source of 32/48/128 PNGs) |
| `icons/icon-16.svg` | Dedicated 16px cut (source of icon-16.png) |
| `icons/icon-{16,32,48,128}.png` | Manifest/toolbar icons |
| `assets/logo.svg` | Horizontal lockup (mark + outlined wordmark), used by popup header and README |
| `store/banner-1400x560.{svg,png}` | Chrome Web Store marquee |
| `store/tile-440x280.{svg,png}` | Small promo tile |
| `scripts/brand.mjs` | Generator that rebuilds all of the above (see its header; needs `sharp` + `opentype.js` + IBM Plex TTFs, none of which are project deps) |

## UI wiring

The popup is an editorial control panel on this palette. The masthead uses
`assets/logo.svg` inside the `<h1>` (alt text carries the name), with a
Georgia-italic “Let me scroll.” aside ending in a terracotta period. The
per-site control is a verdict panel — pine when the site is under control,
paper with a terracotta verdict when paused, dashed and inert on Chrome
pages. Settings sit as flat hairline rows; autoplay is secondary. Switch
IDs and the `settings` / `disabledSites` storage contract are unchanged.
