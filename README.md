# Alian Tree Study

A standalone WebGL workbench for comparing modeled foliage, hybrid foliage cards, and whole-tree impostors. Edit a seeded oak, birch, or pine recipe, then inspect a single tree or a grove. The workbench reports triangles, draw calls, texture memory, and browser FPS.

## Run locally

Serve the static files with Python 3. No build step or package installation is needed.

```sh
python3 -m http.server 8000 --directory dist
```

Open [localhost:8000](http://localhost:8000). The scene requires WebGL. All rendering assets are included in the repository.

## Source

- `dist/growth.js` generates the connected shoots and their taper.
- `dist/tree.js` builds the geometry, foliage cards, and bark materials.
- `dist/study.js` connects recipe controls, camera interaction, and rendering metrics.

The page includes growth model references. See [bark texture credits](dist/bark/SOURCES.txt) and the [Three.js license](dist/vendor/THREE-LICENSE.txt).
