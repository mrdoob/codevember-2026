# Codevember 2026

Daily creative agentic coding experiments for November 2026.

Following the [prompt list shared by @thespite](https://x.com/thespite/status/2116974998212772095).

## Gallery

The [live gallery](https://mrdoob.github.io/codevember-2026/) (`index.html`) lists all 30 prompts, with screenshot links to the completed experiments. To browse the gallery and the day pages together, serve this directory:

```sh
python3 -m http.server 8026 --bind 127.0.0.1
```

Open **http://localhost:8026/**. The gallery is plain HTML and CSS with no build step. The experiments load their dependencies from the internet and require a WebGPU-capable browser.

`index.html` contains the day entries; `gallery.css` contains the layout and presentation. The grid uses eight columns on wide screens and adapts down to two on phones. Completed days link to their local folders. Future days are non-clickable placeholders with muted labels.

Thumbnails live in `files/` as 800 × 800 WebP images, captured directly from the running experiments with their interfaces hidden. They display in full color. Day labels sit horizontally centered at 87.5% of the tile height. Completed-day labels and the title share a white background with 2px vertical and 8px horizontal padding; upcoming labels have no background.

To add a day:

1. Add its screenshot as `files/DD.webp`.
2. Replace its placeholder in `index.html` with an experiment link following the existing entries, including the day folder, accessible label, and image dimensions.
3. Update the days table below. Keep gallery links relative so the page also works under a hosting subdirectory.

## Days

| Day | Word | Experiment | Source |
| --- | --- | --- | --- |
| 01 | Fold | [View](https://mrdoob.github.io/codevember-2026/01/) | [Code](01/) |
| 02 | Shatter | [View](https://mrdoob.github.io/codevember-2026/02/) | [Code](02/) |
| 03 | Melt | [View](https://mrdoob.github.io/codevember-2026/03/) | [Code](03/) |
| 04 | Tangle | [View](https://mrdoob.github.io/codevember-2026/04/) | [Code](04/) |
| 05 | Moss | [View](https://mrdoob.github.io/codevember-2026/05/) | [Code](05/) |
| 06 | Orrery | [View](https://mrdoob.github.io/codevember-2026/06/) | [Code](06/) |
| 07 | Hollow | [View](https://mrdoob.github.io/codevember-2026/07/) | [Code](07/) |
| 08 | Tesseract | [View](https://mrdoob.github.io/codevember-2026/08/) | [Code](08/) |
| 09 | Membrane | [View](https://mrdoob.github.io/codevember-2026/09/) | [Code](09/) |
| 10 | Caustic | [View](https://mrdoob.github.io/codevember-2026/10/) | [Code](10/) |
| 11 | Rust | — | — |
| 12 | Feather | — | — |
| 13 | Labyrinth | — | — |
| 14 | Tension | — | — |
| 15 | Mirage | — | — |
| 16 | Spore | — | — |
| 17 | Kelp | — | — |
| 18 | Pendulum | — | — |
| 19 | Erosion | — | — |
| 20 | Cocoon | — | — |
| 21 | Bolt | — | — |
| 22 | Echo | — | — |
| 23 | Magma | — | — |
| 24 | Nest | — | — |
| 25 | Veil | — | — |
| 26 | Anamorph | — | — |
| 27 | Burrow | — | — |
| 28 | Hive | — | — |
| 29 | Portal | — | — |
| 30 | Dissolve | — | — |
