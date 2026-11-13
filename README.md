# Codevember 2026

Daily creative agentic coding experiments for November 2026.

Following the [prompt list shared by @thespite](https://x.com/thespite/status/2116974998212772095).

## Gallery

The [live gallery](https://mrdoob.github.io/codevember-2026/) (`index.html`) lists all 30 prompts, with screenshot links to the completed experiments. To browse the gallery and the day pages together, serve this directory:

```sh
python3 -m http.server 8026 --bind 127.0.0.1
```

Open **http://localhost:8026/**. The gallery is plain HTML and CSS with no build step. The experiments load their dependencies from the internet and require a WebGPU-capable browser.

`index.html` contains the day entries; `gallery.css` contains the layout and presentation. The grid uses eight columns on wide screens and adapts down to three on phones. Completed days link to their local folders. Future days are non-clickable placeholders with muted labels.

Thumbnails live in `files/` as 800 × 800 WebP images, captured directly from the running experiments with their interfaces hidden. They display in full color. Day labels sit horizontally centered at 87.5% of the tile height. The gallery follows the OS color preference through `prefers-color-scheme`: a light background with dark labels in light mode, and a dark background with white labels in dark mode. Completed-day labels and the title share 2px vertical and 8px horizontal padding; day labels use 4px horizontal padding on phones. Upcoming labels have no background.

To add a day:

1. Add its screenshot as `files/DD.webp`.
2. Replace its placeholder in `index.html` with an experiment link following the existing entries, including the day folder, accessible label, and image dimensions.

Keep gallery links relative so the page also works under a hosting subdirectory.
