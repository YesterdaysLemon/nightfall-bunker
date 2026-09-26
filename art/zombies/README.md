# Zombie style explorations

A smorgasbord of zombie designs in deliberately different art styles, built as
code in headless Blender 5.2 so every model is reproducible and editable. The
chosen direction(s) will later be carried into the game (zombies first, then
guns and the bunker).

| id | name | direction |
|---|---|---|
| `plush` | Stitchling | chibi plush toy: felt, stitches, button eyes, pastel |
| `toon` | Noodle | rubber-hose Saturday-morning cartoon, cel shading, ink outlines |
| `rot` | The Rotted | gritty photoreal creature sculpt, subsurface skin, torn clothes |
| `ps1` | Polygon Ghoul | 1997 32-bit console model: ~600 tris, 64 px textures, dithering |
| `ink` | The Long Dead | tall gaunt woodcut print: black and cream, one blood-red accent |
| `porcelain` | Kintsugi | bonus: glazed porcelain figurine repaired with gold seams |

## Files

- `styles.json`: names, taglines and the concept-art prompts.
- `concepts.mjs`: draws a concept sheet per style with the Codex CLI image tool
  (`node art/zombies/concepts.mjs [id ...]`, output in `output/art/zombies/concepts/`).
- `kit.py`: the shared Blender toolkit (see its docstring):
  - skeleton and skin-modifier bodies;
  - sculpting by code (the `Sculpt` brush class);
  - baked cloth inflation, cloth drape and soft-body sag;
  - materials (PBR, cel), outlines, lights, backdrops and framing;
  - `run()`, which renders previews or final hero views plus a 24-frame turntable.
- `z_<id>.py`: one script per style. It builds the character, then stages and renders it.
- `blend.mjs`: runs a style script headless and filters Blender's output. Final renders take turns on the GPU.
- `_example.py`: toolkit smoke test and API example.

## Commands

```bash
node art/zombies/blend.mjs z_plush.py --preview                      # one 3/4 still at half res
node art/zombies/blend.mjs z_plush.py --preview --views front,side   # more angles
node art/zombies/blend.mjs z_plush.py --final                        # 4 hero views, turntable, .blend, meta.json
```

Output goes to `output/art/zombies/<id>/` (git-ignored). The gallery keeps the chosen renders.

## Conventions

- Metres, feet on z=0, the character faces -Y. Parent every part to the root
  empty returned by `build()`; `run()` spins that root for the views and the turntable.
- Final renders are 900x1200 portrait. The character fills about 85% of the frame height.
- Materials are shared by name: `kit.mat()` returns an existing material instead of replacing it.
- `kit.toon_mat` uses Shader to RGB, which works in Eevee only (it renders black in Cycles).
- Cloth pressure depends on scale: small parts need high pressure and soft fabric (see `inflate_cloth`).
- Everything is original: no game-franchise names, logos or likenesses.
