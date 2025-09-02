# Mike's First Game

A small top-down Phaser 3 game with a safe room, simple combat prototype, and lightweight meta progression.

## Run Locally

- Requirements: Node 18+ (or 20), npm
- Install deps: `npm ci`
- Start dev server: `npm run dev`
- Build for production: `npm run build`

## Controls

- Left Click: Dash to cursor
- Shift + Left Click: Force direct dash (ignores pathing)
- Right Click: Shoot
- F: Toggle fullscreen
- F3: Toggle debug overlays
- N: Advance to next level when prompted
- R: Restart after death (returns to Safe Room)
- Safe Room: Walk into the portal to start Level 1; walk up to the terminal to open the upgrade panel (close with `E` or `Esc`)

## Project Structure

- `src/game.ts`: Game config and scene list
- `src/scenes/`: Scenes (Save Select, Character Builder, Main Scene)
- `src/state/save.ts`: Save/load slots and meta upgrades

## Notes

- Debug tools are disabled by default. Press F3 to show overlays.
- Upgrade panel pauses movement while open.
- Upgrades currently include: Max HP, Bullet Speed, Fire Rate, Pierce, Dash Speed, and Heal on Level Clear.

## Git / Repo

- This repo includes a `.gitignore` suitable for Node/Vite and a `.gitattributes` for Git LFS.
- If you haven’t yet, install LFS locally:
  - `git lfs install`
  - (LFS patterns are already in `.gitattributes`.)

## CI (GitHub Actions)

A minimal CI workflow builds the project on push/PR to ensure it stays green. See `.github/workflows/ci.yml`.

