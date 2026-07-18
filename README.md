# Halo Craft: Installation 04

A photoreal, first-person **Halo campaign** built on a procedural lakeside world.
Master Chief crash-lands in a mountain-ringed lake basin beneath a Halo ring that
arcs across the sky, and fights the Covenant across four stages that move through a
full day → night cycle — dawn landing to a night finale under the stars.

Built with **Three.js + Vite**. The world (terrain, Gerstner-wave water with planar
reflections, dynamic sky, instanced forests, dock, mist/fireflies/birds, procedural
ambient audio) is descended from the "Silent Lake" scene; the Halo gameplay
(FPS controller, regenerating shields, plasma combat, Covenant AI, Cortana comms,
objectives, waypoints, stages) is layered on top.

## Play

```bash
npm install
npm run dev          # http://localhost:5173
```

Or the built container (see below): **http://localhost:8091**

- **WASD** move · **mouse** look · **click** fire · **Space** jump · **Shift** sprint · **R** reload
- Click the canvas to capture the mouse.

## Modes

- **Campaign** — 4 stages with briefings, objectives, nav waypoints, Cortana, and checkpoints:
  1. *Landfall* (dawn) — get your bearings, reach the dock, destroy 3 drones
  2. *The Silent Shore* (morning) — clear 6 Covenant along the shoreline
  3. *Into the Highlands* (dusk) — break the assault, reach the beacon
  4. *The Cartographer* (night) — recover 3 energy cores, beat the Field Marshal, activate the console
- **Skirmish** — endless escalating waves, for score.

## Structure

```
src/
  core/      math (noise + terrain height field), input
  world/     Terrain, Water, Sky (+ Halo ring), Environment, World (day/night)
  entities/  Player (FPS controller), Enemies (Covenant AI), Projectiles
  campaign/  StageManager, stages (declarative campaign)
  ui/        HUD, Cortana comms, style.css
  audio/     procedural Ambient + SFX
  Game.js    orchestrator (renderer, postFX, weapon, main loop)
  main.js    boot + menu wiring
```

## Docker

```bash
cd docker
./run.sh up          # build + serve on http://localhost:8091
./run.sh down        # stop
./run.sh rebuild     # rebuild image + restart
PORT=9000 ./run.sh up
```

The image is a self-contained multi-stage build (Vite build baked in, served by
nginx). Port **8091** is used so it doesn't collide with the old voxel build on 8090.

## Verify (headless)

```bash
node scripts/verify.mjs --url http://localhost:8091 --wait 4000 --out shot.png
node scripts/combat-test.mjs http://localhost:8091     # deterministic combat-chain test
```
