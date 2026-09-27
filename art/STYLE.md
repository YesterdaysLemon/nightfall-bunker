# Nightfall Bunker: world bible ("1997")

The owner chose the Polygon Ghoul direction. Every character, prop and surface
should look like it shipped on the same late-90s console disc: one world, one
set of rules. The reference implementation for painting and export is
`art/zombies/z_ps1b.py` (Ghoul v2). Reuse its ideas and code, but fix what the
owner flagged: **v2 looks bulbous; this world is sharp.**

## Shape: sharp, not bulbous

- Build silhouettes from **angular planes**. Limbs are 4–6-sided prisms with
  tapers and slight twists, never round tubes. Chins, cheekbones, brows,
  knuckles, knees, elbows and shoulder points are hard ridges and wedges.
  Torsos are faceted boxes, narrower at the waist, with a pointed collar line.
- **Hard normals.** Split normals on every edge sharper than about 30°, and let
  flat facets catch the light as distinct planes. No superellipse or lofted
  "pillow" cross-sections, and no smooth shading across a whole part. Where a
  form must read as round (a skull cap, the porcelain lady's hair rolls), use
  6–8-sided rings that stay hard-edged.
- **Silhouette first.** Every part must read as a distinct shape from 10 m in a
  dark, foggy room. Exaggerate slightly: hunched shoulders, long forearms, big
  hands and feet, gaunt faces.
- **Budget.** Humanoids 700–1200 triangles, hounds 500–900, props 40–300.
  Everything is rigid segments pivoted at joints: no skinning.

## Surface: painted light, small palettes

- One texture page per character. Humanoids get 256×256, and the face gets
  about 2× density, mirrored left/right. Nearest-neighbour filtering, no
  normal maps.
- **Paint the light in, moderately.** Key light comes from above and slightly in
  front (a bare bulb about 1 m over the head), with a faint warm bounce from
  below. Ambient occlusion goes in creases, under the collar, cap brim, belt
  and jaw, and where limbs meet. The game also lights models with warm bulbs,
  so keep painted shading at roughly 60% strength: no pitch-black painted
  shadows.
- **Ramps.** 8–16 colours per material, hue-shifted (warm highlights, cool
  shadows), quantised per part like v2. Grime and blood go in deliberate
  clusters, never per-pixel noise.
- **Shared tones.** Use the `RAMPS` in `z_ps1b.py` as the world palette:
  - Skin: grey-green corpse `skin` ramp.
  - Cloth: olive `shirt`, `trousers` and `cap` ramps.
  - Blood: `blood`, plus dried `bloodc`.
  - Leather: the `leather` ramp.
  - Concrete, wood and chalk red: from the same table.

  New materials (the hound's charred hide and ember cracks, porcelain glaze,
  cobalt print, gold) extend the table in the same spirit, with the same value
  range and the same hue shift. Nothing should be more saturated than the
  blood or the chalk red, except emissive embers and gold glints.
- Eyes read in the dark: pale milky painted eyes for zombies, ember glow for
  hounds, and empty black sockets for the porcelain lady.

## Presentation (renders)

- Native 300×400 frame, nearest textures, no anti-aliasing, then the soft
  composite TV pass from v2 (`crt()` in `z_ps1b.py`). The same murky bunker
  staging: warm bulb, dark concrete, green-grey fog.
- Also render an in-game shot: 320×240 in the bunker, at a typical fighting
  distance of 5–8 m.

## Export for the game (`public/models/<id>.json` + `<id>.png`)

The game loads these with `src/client/render/models.js`:

```
{ "version": 1, "texture": "<id>.png", "emissive": "<id>_glow.png" (optional),
  "joints": { "<joint>": { "parent": "<joint>" | null, "pos": [x, y, z] } },
  "parts":  [ { "name": "<part>", "joint": "<joint>",
                "pos": [...], "nrm": [...], "uv": [...], "col": [...] (optional), "idx": [...] } ],
  "meta": { ... } (optional) }
```

- **Three.js space.** Metres, +Y up, the character faces **+Z**, and the
  character's left is **+X**. From Blender (Z up, facing -Y), map
  `(x, y, z) → (x, z, -y)`.
- **Joints.** `pos` is relative to the parent joint (or to the model origin at
  the feet, for roots) in the rest pose.
- **Parts.** Vertices are in their joint's local space. Export per face corner:
  split normals must survive (use `mesh.corner_normals` in Blender 5.2), and
  identical corners are deduplicated into `idx`.
- **UVs.** `v` is flipped for a top-left origin: export `1 - v`. The page loads
  with `flipY = false`.
- **Vertex colours** (optional, 0–1 RGB) multiply the texture: use them for
  tint and extra occlusion.
- **Size.** Round floats to 4 decimals. Aim for under 150 KB of JSON per
  character.
- The page is an sRGB PNG, power of two. A glow page (optional) uses the same
  UV layout; black means no glow.

## In-game rendering it will meet

- Materials are `MeshLambertMaterial` with the page as `map`, lit by six warm
  point lights and a dim moon.
- Exponential fog is dark blue-grey, thicker and warmer during hound rounds.
- The frame renders at a low internal resolution (about 400 lines), then goes
  through a soft TV pass: horizontal blur, chroma bleed, faint scanlines and
  an ordered dither.
- A texel should cover about 1–2 screen pixels at 5 m.
