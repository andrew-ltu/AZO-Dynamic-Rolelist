# assets/

Drop operation files here. All are optional - the page degrades gracefully without them.

- **`music/`** - background anthems, e.g. `karoonda.mp3`. Point `operation.music` in
  `roster.json` at the file.
- **`backgrounds/`** - hero background images, e.g. `karoonda.jpg`. Point
  `operation.background` at the file. Big, darkish, wide images work best.
- **`avatars/`** - optional member profile pictures, e.g. `gunter.png`. Reference with
  `"avatar": "/assets/avatars/gunter.png"` in `members.json`. If absent, a coloured initials
  badge is generated automatically.
- **`logo.png`** *(optional)* - a custom AZO emblem. If present you can swap the inline SVG
  emblem in `index.html` for it; otherwise the built-in shield is used.
