# AZO Dynamic Role List

A self-contained, zero-dependency web page that renders an Australian Zeus Operations (AZO)
operation role list from JSON. Drop it on GitHub Pages and you're done.

- **`roster.json`** — the *current operation*. This is the file Jag edits each op.
- **`members.json`** — the *member directory* (ranks, ops attended, endorsements, avatars).
- **`index.html`** — the app. Loads both files, no build step.

---

## Updating the role list each operation

Open **`roster.json`** and change the names. That's the whole job.

```jsonc
{
  "operation": {
    "name": "Operation Karoonda I",            // the big title
    "zeus": "Jag McMuffin",
    "tier": "Tier 2 Operation",
    "date": "Sat 20 Jun 2026 · 1900 AEST",     // shown under the countdown
    "countdownTo": "2026-06-20T19:00:00+10:00",// live countdown target (ISO, +10:00 = AEST)
    "status": "upcoming",                       // "upcoming" | "live" | "complete"
    "theme": "tactical-blue",                   // see Themes below
    "background": "assets/backgrounds/african-savanna.svg",
    "music": "assets/music/karoonda.mp3",
    "comingSoonText": "..."                     // shown when status is "complete"
  },
  "command": [ { "role": "Platoon Commander", "member": "Sir Danger" }, ... ],
  "sections": [
    { "name": "ALPHA", "roles": [ { "role": "Section Leader", "member": "Gunter" }, ... ] },
    { "name": "CHARLIE", "locked": true, "note": "Reserved for Oceanic Rangers", "roles": [ ... ] }
  ]
}
```

- An empty slot is `"member": null` → shows a dashed **Available** slot.
- Add/remove sections and roles freely — the grid re-flows.
- **Name-size hierarchy** is automatic: Platoon Commander (biggest) → Section Leader (mid) →
  everyone else (base). It keys off the role text (`Platoon Commander`, `Section Leader`).

### Live countdown

`countdownTo` is an ISO timestamp. Use `+10:00` for AEST (e.g. `2026-06-20T19:00:00+10:00`
= Sat 20 Jun, 7 PM AEST). The header shows a ticking Days/Hours/Mins/Secs; when it hits zero
it flips to **"Operation is live"**. Remove the field to hide the countdown.

### Locking a section (e.g. Charlie → Oceanic Rangers)

Add `"locked": true` to a section and an optional `"note"`. Every slot shows a 🔒 and
**Reserved** instead of Available, and isn't clickable — handy when another unit is filling it.

### The "release soon" transition screen

Set `"status": "complete"` after an op → full-screen **"New Role List Incoming"** takeover
using `comingSoonText`, with a *view last role list* button. Set it back to `upcoming`/`live`
for the next op.

### Background music

Put an `.mp3` in `assets/music/` and point `operation.music` at it. A floating player appears
bottom-right (browsers block auto-play until the visitor clicks once — the button handles that).

### Themes & background

`operation.theme`: `tactical-blue` (default), `desert`, `jungle`, `night`, `blood` — palettes
defined in the `<style>` block (`[data-theme="..."]`). `operation.background` is the hero image
behind everything; ships with a stylised **African savanna SVG** — drop a real Arma 3 screenshot
in `assets/backgrounds/` and repoint it any time. Degrades gracefully if missing.

---

## Updating members (`members.json`)

Keyed by exact name as it appears in `roster.json`:

```jsonc
"Gunter": {
  "discordRank": "Senior Operator",   // the badge shown; the promotion bar reads this
  "avatar": "",                        // see Avatars below
  "opsAttended": 3,                    // REAL ops attended in 2026 (drives the bar)
  "attendance": { "Apr": true, "May": true, "Jun": false },  // which monthly op they made
  "endorsements": ["Section Lead", "Breacher"],
  "leadership": "senior"               // "senior" | "junior" | null  -> star + badge
}
```

**Promotion ladder** (thresholds = cumulative ops to reach the next rank, edit in
`index.html` → `RANK_THRESHOLD`):

| Rank | Reached at | Next step |
|---|---|---|
| Recruit | 0 ops | 1 op → Junior Operator |
| Junior Operator | 1 op | 6 ops → Operator |
| Operator | 6 ops | 14 ops → Senior Operator |
| Senior Operator | 14 ops | top of ladder (maxed) |
| SOCOMD | command staff | above the ladder (no bar) |

The click-through profile shows the rank badge, leadership badge, endorsement chips, ops/
endorsements/attendance stats, a **% to next promotion** bar (`remaining = next threshold −
ops attended`, so e.g. an Operator with 3 ops = "11 more ops to Senior Operator"), and the
attendance strip. **SOCOMD & Senior Operator are maxed** — the bar shows "command staff" / "MAX"
rather than a promotion %.

### Attendance strip (op circles)

The profile shows one circle per op of the year: **April 1, May 1, June onward 32** (= 34
total, set in `index.html` → `OPS_CALENDAR`). Circles fill from `attendance`: attended (blue),
missed (dark), or upcoming (dashed). As new ops run, add the month/op to `attendance` and bump
`opsAttended`.

### Roster (expandable)

The **ROSTER** card at the bottom expands into a full-screen panel of every active operator,
grouped and sorted by rank (SOCOMD → Recruit). Click anyone for their profile.

## Avatars / Discord profile pictures

1. **Auto initials (default).** Leave `"avatar": ""` → a coloured initials badge.
2. **A URL.** Any image URL, including a Discord CDN avatar
   (`https://cdn.discordapp.com/avatars/<userid>/<hash>.png`).
3. **A local file.** Drop an image in `assets/avatars/` and set
   `"avatar": "assets/avatars/gunter.png"`.

> Fetching someone's *live* Discord avatar needs a bot token, which can't run on a static
> GitHub Pages site. A scheduled GitHub Action could write current URLs into `members.json` —
> ask if you want that added.

## Club logo

The header/standby emblem use **`assets/logo.png`** if present (drop the AZO patch there),
otherwise a built-in SVG AZO badge is drawn as a fallback.

---

## Preview locally

The page fetches JSON, so `file://` won't work. No Node/Python needed:

```
Right-click serve.ps1  ->  Run with PowerShell      (serves http://localhost:8770/)
```

## Deploy (GitHub Pages)

Push to the repo root, then **Settings → Pages → Deploy from branch → `main` / root**.
Live at `https://<user>.github.io/AZO-Dynamic-Rolelist/`.

---

*Endorsement, leadership and ops-attended values in `members.json` are seeded from the June 2026
promotion chart + Karoonda role list — replace the placeholders with real values.*
