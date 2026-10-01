# Fireflow

A turn-based firefighting and emergency-response game. A multi-storey building is shown as a stack of
2D floor plans divided into equal square tiles. Each turn the fire acts first, then your crew responds.

```
npm install
npm run dev        # play at http://localhost:5173
npm test           # simulation & rules tests
npm run build      # static build in dist/
```

## How a turn works

1. **Environment phase.** These systems run in order:
   - **Fire.** Burning tiles radiate heat to their neighbours, to the floor above (strongly up a stairwell
     or through a hole, weakly through the ceiling), and a little to the floor below. Hot gas mixes
     between open tiles and rises up shafts. A tile whose heat passes its material's ignition point may
     catch fire. Fires grow faster when they have air (a broken window, a hole, outside), consume fuel,
     and burn out. Windows shatter at high heat.
   - **Smoke.** Fire makes smoke. It spreads through open space, rises up stairwells and holes, and
     vents through open windows and to the outside. Closed doors and walls contain it.
   - **Structure.** Fire eats the integrity of walls, doors and upper-floor tiles. A fire also weakens
     the floor directly above it. At 0 integrity a wall or door becomes rubble, and the tile above it
     loses support. An upper floor becomes a hole: anyone standing on it falls, and burning debris
     lands on the floor below. Collapses can cascade.
   - **Exposure.** Fire, heat and smoke damage everyone inside. Firefighters have breathing apparatus;
     civilians don't.
2. **Player phase.** Each firefighter has 4 AP and a 6-shot water tank:

   | Action | AP | Notes |
   |---|---|---|
   | Move | 1 | +1 through a window, +1 while carrying someone, +1 in thick smoke. Cannot enter a tile burning at intensity 2+. Stairs connect floors. |
   | Spray | 1 | Straight line, up to 3 tiles, unobstructed. −2 fire, −40 heat, leaves the tile wet (won't ignite) for 2 turns. Uses 1 water. |
   | Door | 1 | Open or close an adjacent door or window. |
   | Axe | 1–2 | Breach an adjacent door, window (vents smoke) or drywall wall (2 AP). Brick is too solid. |
   | Carry / Drop | 1 / 0 | Pick up an adjacent civilian. Walking them onto the street rescues them. |
   | Refill | 1 | Next to the engine **E**. |

You **win** when no fire remains. Civilians still inside then walk out. You **lose** if every
firefighter goes down. Your score counts rescues, losses, how much of the structure you saved, and
speed.

## Controls

Select a firefighter (click or **Tab**) and click tiles. In **Auto** mode a click does the obvious
thing: pick up an adjacent civilian, spray a burning tile in range, open an adjacent closed door, or
walk to the tile by the shortest path (stairs included). Explicit modes: **1** Auto, **2** Move,
**3** Spray, **4** Door, **5** Axe, **6** Carry. **Enter** ends the turn, **Z** undoes within the turn,
**G** drops, **R** refills, **H**/**V** toggle the heat/smoke overlays. Hover a tile to inspect its heat,
fuel, smoke and integrity. Dashed orange borders mark tiles close to igniting.

## Architecture

```
src/core/       pure, deterministic game logic (no DOM)
  types.ts        Tile / Unit / GameState model — floors[floor][y][x]
  materials.ts    ignition point, fuel, structural damage per material
  building.ts     ASCII floor-plan parser and Scenario definition
  systems.ts      SimSystem interface — one step of the environment
  fire.ts smoke.ts structure.ts exposure.ts   the environment systems
  actions.ts      player actions: validation (actionCost) and application (performAction)
  pathing.ts      Dijkstra movement across floors within the AP budget
  game.ts         turn loop, win/loss, scoring
  rng.ts          seeded PRNG; its state lives in GameState so every game is reproducible
src/scenarios/  building layouts and starting conditions
src/ui/         canvas renderer and click → action translation
src/main.ts     DOM wiring
tests/          vitest specs for the rules
```

State is immutable from the outside: `performAction` and `endTurn` return a new `GameState`. That's
what makes undo trivial. Everything random goes through the seeded RNG in the state, so the same
scenario plus the same actions always produce the same game.

### Adding a scenario

Draw each floor as strings using the legend in `src/core/building.ts`. All floors share one size, and
stairs must sit at the same x/y on adjacent floors. Then list the starting fires, civilians and crew.

### Adding another kind of emergency

Implement a `SimSystem` (`step({ state, rng, log })`) and add it to `SYSTEMS` in `game.ts`. A flood,
gas leak or structural failure can reuse the same grid and the same player phase. Add tile fields or
actions as the new hazard needs them.

## Ideas for next steps

- More scenarios: apartment block, warehouse, basement fire; scenario select screen.
- Hose lines tethered to the engine instead of tanks; fog/wide spray; ladders to upper-floor windows.
- Backdraft when a superheated closed room is opened; flashover when a room's average heat peaks.
- Civilians who move on their own (panic, follow a firefighter); downed firefighters can be dragged out.
- Other emergencies as new systems: flooding, gas leak, earthquake damage, hazmat.
- Isometric/3D-style rendering of the same grid model.
