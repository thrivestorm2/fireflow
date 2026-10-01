# Fireflow

A turn-based firefighting and emergency-response game. A multi-storey building is shown as a stack of
2D floor plans divided into equal square tiles. Each turn the fire acts first, then your crew responds.

```
npm install
npm run dev        # play at http://localhost:5173
npm test           # simulation & rules tests
npm run build      # static build in dist/
```

## The grid

Each floor is a grid of equal square tiles. Upper floors are shown above the ground floor, as a cutaway.
The ground floor includes the outside: yard, trees, sidewalk, road, driveway and fire hydrants.
Every tile has:

| Property | Examples |
|---|---|
| **Kind** (structural role) | floor, wall, door, window, stairs, ground, air, hole, rubble |
| **Material** (what it's made of) | concrete, asphalt, grass, brick, drywall, wood, carpet, ceramic tile, glass, air |
| **Contents** (what's on it) | sofa, bed, table, cabinets, stove, bookshelf, plant, tree, hydrant |
| **Temperature** | in °C; ambient is 20 °C, a fully involved tile reaches 800 °C |
| **Condition** | fire intensity (0–3), smoke, wet, burnt, structural integrity |

Material and contents both count as fuel. A tile ignites at whichever has the lower ignition
temperature. Some contents block movement (cabinets, bookshelves, trees, hydrants). Others cost an
extra AP to climb over (sofas, beds, tables).

## How a turn works

1. **Fire phase.** Fire only spreads here, never during your phase. These systems run in order:
   - **Fire.** Burning tiles radiate heat to their neighbours, to the floor above (strongly up a stairwell
     or through a hole, weakly through the ceiling), and a little to the floor below. Hot gas mixes
     between open tiles and rises up shafts. A tile hotter than its ignition point may catch fire.
     Fires grow faster with air (a broken window, a hole, outside), consume fuel, and burn out,
     destroying the contents. Windows shatter at 450 °C.
   - **Smoke.** Fire makes smoke. It spreads through open space, rises up stairwells and holes, and
     vents through open windows and to the outside. Closed doors and walls contain it.
   - **Structure.** Fire eats the integrity of walls, doors and upper-floor tiles. A fire also weakens
     the floor directly above it. At 0 integrity a wall or door becomes rubble, and the tile above it
     loses support. An upper floor becomes a hole: anyone standing on it falls, and burning debris
     lands on the floor below.
   - **Exposure.** Fire, heat and smoke damage everyone inside. Firefighters have breathing apparatus;
     civilians don't.
2. **Player phase.** Trucks due this turn arrive, and every firefighter's AP is restored. Then you act.

## Trucks and crews

Trucks are a limited resource dispatched on a schedule. In the house scenario: Engine 1 on turn 1,
Ladder 7 on turn 3, Engine 4 on turn 5. A truck that has arrived waits in staging until you **park**
it: click *Park* and pick a road or driveway tile (R or right-click rotates it).

| Truck | Size | Water tank | Hose | Crew |
|---|---|---|---|---|
| Engine | 2 × 5 tiles | 20 units | 28 tiles | engine crew (yellow), 4 AP |
| Ladder | 2 × 7 tiles | — | — | ladder crew (orange), 5 AP, ground ladders |

The crew starts aboard. Select a crew member and click a tile next to the truck to get them off. Units
take up a tile each: they can pass through teammates but can't stop on an occupied tile. Movement and
actions share the firefighter's AP for the turn.

## Water and hoses

- **Water comes from the engine.** Each engine arrives with a full tank, and every spray uses one unit
  from the engine feeding that line. Until the engine is supplied by a hydrant, the tank only goes down.
- **Hose is limited.** A crew member next to an engine pulls off an **attack line** (up to 2 per engine)
  or a **supply line** (1 per engine). The hose follows their exact path, one tile of hose per tile
  walked, through doors, up stairs and up ladders. They can't go further than the hose left on that
  engine. Walking back along the hose takes it back in. The hose can be put down and picked up by
  someone else, or packed back onto the engine. A door with a hose through it can't be closed.
- **Spraying needs the nozzle of an attack line** whose engine still has water.
- **Hydrants take crew time.** Run a supply line to a hydrant, then work it from an adjacent tile:
  1. **Remove cap**: 1 AP
  2. **Couple supply hose**: 2 AP, using one more tile of hose
  3. **Open hydrant**: 2 AP. Water reaches the engine during the next fire phase.

  After that, the engine's tank refills by 8 units a turn, up to its capacity. The badge on a hydrant
  shows how far the crew has got. A supply line with water flowing in it is drawn solid and animated.

| Action | AP | Notes |
|---|---|---|
| Move | 1/tile | +1 over furniture, +1 through a window, +1 while carrying someone, +1 in thick smoke. Cannot enter a tile burning at intensity 2+. Stairs and ladders connect floors. |
| Attack / supply line | 1 | Next to an engine with hose left. |
| Put down / pick up hose | 0 / 1 | Pick up the loose end of a line from its tile. |
| Pack hose | 1 | Next to the line's engine; the whole line goes back on the truck. |
| Hydrant | 1 / 2 / 2 | Remove cap, couple, open — see above. |
| Spray | 1 | Holding an attack line. Straight line, up to 3 tiles, unobstructed. −2 fire, −320 °C, leaves the tile wet for 2 turns. Uses 1 water from the engine. |
| Door | 1 | Open or close an adjacent door or window. |
| Axe | 1–2 | Breach an adjacent door, window or drywall wall (2 AP). Brick is too solid. |
| Carry / Put down | 1 / 0 | Pick up an adjacent civilian (hands must be free of hose). Carrying them to any outside tile rescues them. |
| Ladder | 2 | Ladder crew, standing outside directly below an upper-floor window. |

You **win** when no fire remains. Civilians still inside then walk out. You **lose** if every
firefighter goes down. Your score counts rescues, losses, how much of the structure you saved, and
speed.

## Controls

Select a firefighter (click, **Tab**, or click their truck) and click tiles. In **Auto** mode a click
does the obvious thing: pick up an adjacent civilian, spray a burning tile in range, open an adjacent
closed door, or walk to the tile by the shortest path (stairs and ladders included). Explicit modes:
**1** Auto, **2** Move, **3** Spray, **4** Door, **5** Axe, **6** Carry. **Enter** ends the turn,
**Z** undoes within the turn, **A** / **S** take an attack / supply line, **N** picks up or puts
down a hose, **B** packs a hose, **Y** works an adjacent hydrant, **G** puts a person down, **L**
raises a ladder, **R** rotates a truck being parked, **H**/**V** toggle the heat/smoke overlays, **Esc** cancels. Hover a tile to inspect
its material, contents, condition and temperature. Dashed orange borders mark tiles close to igniting.

## Architecture

```
src/core/       pure, deterministic game logic (no DOM)
  types.ts        Tile / Unit / Truck / GameState model — floors[floor][y][x]
  materials.ts    ignition point, fuel and damage per material; contents properties
  building.ts     floor-plan + contents parser, Scenario and dispatch definitions
  trucks.ts       truck footprints and parking rules
  hoses.ts        hose lines, hydrant states, and the water system (hydrant → engine refill)
  systems.ts      SimSystem interface — one step of the environment
  fire.ts smoke.ts structure.ts exposure.ts   the environment systems
  actions.ts      player actions: validation (actionCost) and application (performAction)
  pathing.ts      Dijkstra movement across floors (stairs, ladders) within the AP budget
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

Draw each floor as two layers of strings: a `plan` (kind and material) and an optional `contents`
overlay, using the legends in `src/core/building.ts`. All floors share one size, and stairs must sit
at the same x/y on adjacent floors. Then list the starting fires, the civilians, and the `dispatch`:
each truck's type, arrival turn and crew.

### Adding another kind of emergency

Implement a `SimSystem` (`step({ state, rng, log })`) and add it to `SYSTEMS` in `game.ts`. A flood,
gas leak or structural failure can reuse the same grid and the same player phase. Add tile fields or
actions as the new hazard needs them.

## Ideas for next steps

- More scenarios: apartment block, warehouse, basement fire; scenario select screen.
- Pump operator required at the engine; hose burning through in fire; fog/wide spray; aerial ladder from the truck.
- More truck types (ambulance, rescue squad, battalion chief), and limited choice over what to dispatch.
- Backdraft when a superheated closed room is opened; flashover when a room's average heat peaks.
- Civilians who move on their own (panic, follow a firefighter); downed firefighters can be dragged out.
- Other emergencies as new systems: flooding, gas leak, earthquake damage, hazmat.
- Isometric/3D-style rendering of the same grid model.
