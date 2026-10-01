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

Each level is a grid of equal square tiles: the ground floor, the upper floor, and a walkable roof.
Upper levels are shown side by side above the ground floor, as a cutaway. The ground floor includes
the outside: yard, trees, sidewalk, road, driveway and fire hydrants. Roads are 2 tiles wide for one
lane, or at least 4 tiles wide for two lanes (the street here is 4 wide; the driveway is one 2-wide
lane).
Every tile has:

| Property | Examples |
|---|---|
| **Kind** (structural role) | floor, wall, door (open / closed / locked), window, stairs, roof, roof vent, ground, air, hole, rubble |
| **Material** (what it's made of) | concrete, asphalt, grass, brick, drywall, wood, carpet, ceramic tile, glass, roof shingles, air |
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
it: click *Park* and pick a road or driveway tile. **R** (or right-click) turns it a quarter at a
time, so the front can face any way. While placing, the arrow and white headlights mark the front (cab)
and red lights mark the back.

| Truck | Size | Water tank | Hose | Crew |
|---|---|---|---|---|
| Engine | 2 × 5 tiles | 20 units | 28 tiles | engine crew (yellow), 4 AP: hoses and hydrants |
| Ladder | 2 × 7 tiles | — | — | ladder crew (orange), 5 AP: forcible entry, ventilation, ladders, 1 fan |

The crew rides on the truck, drawn in seats from the cab back. Click a seated firefighter to select
them, then click a tile next to the truck to get them off. Units
take up a tile each: they can pass through teammates but can't stop on an occupied tile. Movement and
actions share the firefighter's AP for the turn.

## Ladder crews: forcible entry and ventilation

Only ladder crews can do these jobs. In the **Tools** mode, the target decides the job:

- **Force a locked door** (2 AP). The house's front door is locked. Engine crews can't open it.
- **Axe** through a drywall wall (2 AP), a door or a window (1 AP).
- **Raise a ground ladder** (2 AP) standing outside against the building. It reaches each level
  above whose wall it leans on: upper-floor windows and the roof edge.
- **Cut a roof vent** (3 AP) through an adjacent roof tile, while standing on the roof. A vent draws
  30% of the smoke and some of the heat out of the whole connected space below it, every turn. A fire
  right under an opening gets more air, though. Fire can also burn through a weakened roof by itself.
- **Place a fan** (2 AP) beside an open door or window. It blows through the opening into the
  building, and its truck carries one. With another opening for the air to leave by (an open window,
  door or roof vent), it clears 75% of the smoke in its path each turn. Sealed, it only clears 15%.
  **If anything in its path is still burning, the fan feeds it:** the fire grows and heat is pushed
  into neighbouring tiles. Knock the fire down first, then ventilate. A fan can be shut down (1 AP)
  and goes back on its truck.

Anyone can open and close unlocked doors and windows, which is the simplest ventilation of all.

## Smoke and search

- **Victims are hidden** until found. After every action, each firefighter sees up to 3 tiles through
  clear air (smoke below 30%) and finds anyone there. Smoke blocks sight.
- In smoke, crews **search** by hand: the Search action covers their tile and the 8 around it
  (1 AP, or 2 AP in thick smoke). Walking over an unseen victim also finds them. A small green mark
  shows searched tiles.
- **Smoke slows fire attack:** spraying from a smoky tile (30%+) costs +1 AP, and from thick smoke
  (60%+) +2 AP. Thick smoke also cuts the spray range from 3 to 2. Moving through thick smoke costs
  +1 AP per tile.

## Water and hoses

- **Water comes from the engine.** Each engine arrives with a full tank, and every spray uses one unit
  from the engine feeding that line. Until the engine is supplied by a hydrant, the tank only goes down.
- **Attack lines come off the engine's hose connections**, halfway down each long side (drawn on the
  truck). Each side has a red **1¾″** and a blue **2½″** coupling, so an engine has up to four attack
  lines. With a firefighter selected and standing beside the connections, click the coupling you want
  (the half toward the cab is the 1¾″), or press **A** (1¾″) / **D** (2½″). Couplings in use are
  greyed out.

  | Attack line | Water per spray | Knockdown | Cooling (target / around it) | Reach | Advancing |
  |---|---|---|---|---|---|
  | 1¾″ (red) | 1 | −2 fire | −320 °C / −80 °C | 3 tiles | normal |
  | 2½″ (blue) | 2 | −3 fire | −480 °C / −180 °C | 4 tiles | +1 AP per new tile of hose laid |

- **Hose is limited.** A crew member pulls an attack line from the couplings, or the **5″ supply
  line** (yellow large-diameter hose, 1 per engine) from anywhere beside the engine. The hose follows their exact path, one tile of hose per tile
  walked, through doors, up stairs and up ladders. They can't go further than the hose left on that
  engine. Walking back along the hose takes it back in. The hose can be put down and picked up by
  someone else, or packed back onto the engine. A door with a hose through it can't be closed.
- **Spraying needs the nozzle of an attack line** whose engine still has enough water. Thick smoke
  cuts the reach of either size by one tile.
- **Hydrants take crew time.** Walk a supply line next to a hydrant and **click the hydrant** (or
  press **Y**). Hooking up is 5 AP of work: take the cap off (1), couple the hose (2, using one more
  tile of hose), and open the hydrant (2). The firefighter spends whatever AP they have left on it.
  If the job isn't finished, they carry on automatically at the start of the next turn, unless they
  walk away, which abandons it (the work already done stays done). Without a supply line in hand,
  only the cap comes off.

  Water reaches the engine during the fire phase after the hydrant opens. After that, the engine's
  tank refills by 8 units a turn, up to its capacity. The hydrant's badge and the inspector show
  hookup progress. A supply line with water flowing in it is drawn solid and animated.

| Action | AP | Notes |
|---|---|---|
| Move | 1/tile | +1 over furniture, +1 through a window, +1 while carrying someone, +1 in thick smoke, +1 per new tile of 2½″ hose laid. Cannot enter a tile burning at intensity 2+. Stairs and ladders connect floors. |
| Attack line | 1 | Beside the engine's hose connections; click the 1¾″ or 2½″ coupling. |
| Supply line | 1 | Beside an engine with hose left. |
| Put down / pick up hose | 0 / 1 | Pick up the loose end of a line from its tile. |
| Pack hose | 1 | Next to the line's engine; the whole line goes back on the truck. |
| Hook up hydrant | up to 5 total | One click; uses your remaining AP and continues next turn — see above. |
| Spray | 1 | Holding an attack line. Straight, unobstructed line within the hose's reach. Strength and water use depend on the hose size (see above). Leaves the tile wet for 2 turns. |
| Door | 1 | Open or close an adjacent door or window. |
| Carry / Put down | 1 / 0 | Pick up an adjacent civilian (hands must be free of hose). Carrying them to any outside tile rescues them. |
| Search | 1–2 | Your tile and the 8 around it; 2 AP in thick smoke. |
| Tools (ladder crew) | 1–3 | Force door 2, axe 1–2, cut roof 3. |
| Ladder (ladder crew) | 2 | Standing outside against the building. |
| Place / remove fan | 2 / 1 | Ladder crew places; anyone beside it removes. |

You **win** when no fire remains. Civilians still inside then walk out. You **lose** if every
firefighter goes down. Your score counts rescues, losses, how much of the structure you saved, and
speed.

## Controls

Select a firefighter (click, **Tab**, or click their truck) and click tiles. In **Auto** mode a click
does the obvious thing: pick up an adjacent civilian, spray a burning tile in range, open an adjacent
closed door, or walk to the tile by the shortest path (stairs and ladders included). Explicit modes:
**1** Auto, **2** Move, **3** Spray, **4** Door, **5** Tools, **6** Carry. **Enter** ends the turn,
**Z** undoes within the turn, **A** / **D** / **S** take a 1¾″ attack / 2½″ attack / 5″ supply line, **N** picks up or puts
down a hose, **B** packs a hose, **Y** hooks up an adjacent hydrant, **G** puts a person down, **E** searches, **P** places or removes a fan, **L**
raises a ladder, **R** turns a truck being parked, **H**/**V** toggle the heat/smoke overlays, **Esc** cancels. Hover a tile to inspect
its material, contents, condition and temperature. Dashed orange borders mark tiles close to igniting.

## Architecture

```
src/core/       pure, deterministic game logic (no DOM)
  types.ts        Tile / Unit / Truck / GameState model — floors[floor][y][x]
  materials.ts    ignition point, fuel and damage per material; contents properties
  building.ts     floor-plan + contents parser, Scenario and dispatch definitions
  trucks.ts       truck footprints and parking rules
  hoses.ts        hose lines, hydrant states, and the water system (hydrant → engine refill)
  ventilation.ts  fans: the space they pressurise, exhaust openings, smoke clearing, feeding fire
  search.ts       sight through clear air, hands-on search, finding victims
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
