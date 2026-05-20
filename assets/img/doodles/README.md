Doodles folder
=================

This folder holds decorative "doodle" images used by the site as side accents.

Guidelines
---------
- Filenames should match those listed in `list.json` (e.g. `doodle-1.png`).
- Prefer PNG or WEBP with transparent background when possible.
- Suggested size: around 800–1200px on the longest edge; the site scales them down to ~112px.
- To add or replace doodles: drop files into this folder and update `list.json` with their relative paths.

Notes
-----
- The site script (`script.js`) reads `assets/img/doodles/list.json` and randomly places a few doodles on the left and right of the main layout. The doodles are decorative only and have `alt=""`.
- Doodles are hidden on narrow screens (viewport < 980px).
