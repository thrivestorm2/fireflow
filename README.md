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
The building is stacked and **one floor is shown at a time**; everywhere outside the building you see
the ground below (yard, road, trucks, hydrants, hoses), slightly darkened on upper floors. The floor
navigator beside the map has **▲** / **▼** with the current floor number between them (1 = ground);
a 🔥 on an arrow means fire in that direction, and clicking the number goes back to the ground floor.
Selecting a firefighter on another floor, or moving one up or down, switches to their floor. The ground floor includes
the outside: yard, trees, sidewalk, road, driveway and fire hydrants. Roads are 2 tiles wide for one
lane, or at least 4 tiles wide for two lanes (the street here is 4 wide; the driveway is one 2-wide
lane).
Every tile has:

| Property | Examples |
|---|---|
| **Kind** (structural role) | floor, wall, door (open / closed / locked), window, stairs, roof, roof vent, ground, air, hole, rubble |
| **Material** (what it's made of) | concrete, asphalt, grass, brick, drywall, wood, carpet, ceramic tile, glass, roof shingles, air |
| **Contents** (what's on it) | sofa, bed, table, cabinets, stove, bookshelf, plant, tree, hydrant |
| **Temperature** | in °C; ambient is 20 °C, burning tiles run at 500 / 750 / 950 °C by intensity |
| **Condition** | fire intensity (0–3), smoke, wet, burnt, structural integrity |

Material and contents both count as fuel. A tile ignites at whichever has the lower ignition
temperature. Some contents block movement (cabinets, bookshelves, trees, hydrants). Others cost an
extra AP to climb over (sofas, beds, tables).

## How a turn works

1. **Fire phase.** Fire only spreads here, never during your phase. A turn is about a minute, and the
   fire is tuned against compartment-fire research on modern furnishings. These systems run in order:
   - **Fire.** Burning tiles radiate heat to their neighbours, to the floor above (strongly up a stairwell
     or through a hole, weakly through the ceiling), and a little to the floor below. The hot gas
     layer spreads across each **room** within the turn, flows out through open doorways, leaks a
     little around closed doors, and rises up stairwells. A tile hotter than its ignition point may
     catch fire. Fires consume fuel and burn out, destroying the contents. Windows shatter at 450 °C.
   - **Air.** A fire needs air. In a room with no way to the outside (no open or broken window, no
     open outside door, no hole or roof vent, and no open doorway or stairs to a room that has one) it
     is **ventilation-limited**: it can't grow past intensity 2 and burns dirty, making half again as
     much smoke. Give it air and it grows quickly.
   - **Flashover.** When a burning room's air averages 550 °C and the fire can get air, everything
     that can burn in the room ignites at once. A closed-up room fire typically breaks its window a
     few minutes in, then flashes over soon after.
   - **Smoke.** Fire makes smoke, and so does hot fuel that isn't burning yet (from 250 °C). It fills
     the room of origin within a few turns, pours out through open doorways, and leaks around closed
     doors, which hold it back but don't stop it. It rises up stairwells and holes, and the floor
     above fills first, up to twice as smoky as the floor below. It vents through open windows, roof
     vents and to the outside; a closed-up house barely loses any.
   - **Structure.** Fire eats the integrity of walls, doors and upper-floor tiles. A fire also weakens
     the floor directly above it. At 0 integrity a wall or door becomes rubble, and the tile above it
     loses support. An upper floor becomes a hole: anyone standing on it falls, and burning debris
     lands on the floor below.
   - **Exposure.** Fire, heat and smoke damage everyone inside. Firefighters have breathing apparatus;
     civilians don't. A resident takes damage from smoke above 30% and heat above 80 °C. A bedroom
     with its door open to a smoke-filled stairwell becomes deadly within minutes; a closed door buys
     time.
2. **Player phase.** Trucks due this turn arrive, and every firefighter's AP is restored. Then you act.

## Trucks and crews

Trucks are a limited resource dispatched on a schedule. In the house scenario: Engine 1 on turn 1,
Ladder 7 on turn 3, Engine 4 on turn 5. That's the **1st alarm**. Need more? **Strike the next
alarm** with the 🚨 button at the bottom of *Dispatch & crew* (it always names the next level: 2nd, 3rd… up to
5th). Each alarm sends 2 more engines and a ladder truck with their crews (LT, ENG, FF). They come
from further away: the first is due 4 turns after you strike it and the rest a turn apart, and each
alarm beyond the 2nd adds another turn. Hovering the button shows which companies and when. A truck that has arrived shows **Staging** in the Dispatch
panel and waits there until you **park** it: click its card to pick it up (click it again to put it
back), then pick a road or driveway tile. Its crew can't be used until it's parked. **R** (or right-click) turns it a quarter at a
time, so the front can face any way. While placing, the arrow and white headlights mark the front (cab)
and red lights mark the back.

| Truck | Size | Water tank | Hose | Crew |
|---|---|---|---|---|
| Engine | 2 × 5 tiles | 20 units | 28 tiles | engine crew, 4 AP: hoses and hydrants |
| Ladder | 2 × 7 tiles | 4 units | 16 tiles (5″ supply only) | ladder crew, 5 AP: forcible entry, ventilation, ladders, 1 fan; aerial with master stream |

Each firefighter's circle shows their unit on top (E1, L7…) and their position below: **LT**
(lieutenant, the officer, red circle), **ENG** (engineer, yellow) or **FF** (firefighter, yellow). In a
scenario's crew list the first name is the LT, the second the ENG and the rest FF. The crew rides on
the truck: the ENG in the driver's seat (front left, facing the way the truck points), the LT front
right, and FFs behind. Click a seated firefighter to select
them, then click a tile next to the truck to get them off. Units
take up a tile each: they can pass through teammates but can't stop on an occupied tile. Movement and
actions share the firefighter's AP for the turn.

## Forcible entry and ventilation

Tap the door, window, wall or roof next to a firefighter; the tap menu offers what they can do:

- **Force a locked door** (2 AP). Any crew can force a normal locked door; the house's front door is
  one. A **reinforced** door (`F` in a floor plan) takes a ladder crew and 3 AP.

The rest are ladder crew jobs:

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

## The aerial

A ladder truck carries an aerial ladder on a **turntable**, the dark deck across the truck one row
ahead of the rear coupling. It's the one part of a truck you can stand on (stepping up costs +1 AP),
from either side. Anyone on the turntable, or at the tip of the raised aerial, works it:

- **Raise or swing it** (2 AP): view an upper floor and tap an
  open-air or roof tile (outlined) up to 7 tiles from the turntable (diagonals count as one). Whoever is at the
  tip rides along.
- **Climb it** (2 AP between the turntable and the tip). It's a route from the street to the roof, or
  to a window beside the tip: open or break the window from the tip and step in. Carrying a victim
  down it to the turntable rescues them.
- **Master stream** (1 AP): tap fire the stream can reach (outlined in blue). A big stream from the
  tip nozzle aimed in a straight, open line up to 5 tiles on the tip's floor. It floods an area: the
  target and the tiles around it (diagonals too) that the water can reach from the target each take
  −3 fire and −600 °C (and −250 °C splash around them). Walls, closed doors and closed windows stop
  it; open doors and open or broken windows let it through. Fed by a hydrant, directly or relayed through an engine, it runs off the supply.
  Otherwise each flow uses 3 of the ladder truck's 4 units of water, so it's good for about one shot.

## Size-up and fog of war

**The fire starts somewhere different every game**, somewhere a fire is likely to start, following
home fire cause statistics: about half the time at the stove (cooking), otherwise at a sofa, a bed,
a bookshelf, kitchen cabinets or a table. Nobody tells you where.

You know the building's layout, and you can always see the outside: the yard, the street, and the
building's outer walls, windows and doors. Inside, **fire, smoke and heat are only shown where your
crew can perceive them**; everywhere else is fogged:

- **Sight:** up to 3 tiles through clear air (below 30% smoke). Smoke blinds.
- **Touch:** in smoke, a firefighter still feels the tiles right around them.
- **Glow:** flames show through smoke up to 2 tiles away.
- **Thermal camera:** every lieutenant (LT) carries one. Switch to the **thermal** view (🌡️, above the floor selector) to see
  heat through smoke, but not through walls, up to 5 tiles from each LT: dark is cool, and red,
  orange, then white is hotter. Fire reads white-hot. Hovering a fogged tile the camera covers gives
  its temperature.

Hints lead the way from the street:

- **Smoke showing** at windows and doors: puffs drift out of every opening with smoke behind it,
  thicker and darker the worse it is inside. A closed window only seeps a little round the frame;
  an open or broken one pours.
- **Fire showing:** flames out of an open or broken window or door, an orange glow through closed
  glass. Glass darkened by heat glows faintly.
- The floor arrows show **🔥** for fire your crew has seen on another floor, or **💨** for smoke showing
  there. The fire count only counts fire you've seen. A tap only offers water on fire you can see,
  or on heat a thermal camera shows.

## Smoke and search

- **Victims are hidden** until found. After every action, each firefighter sees up to 3 tiles through
  clear air (smoke below 30%) and finds anyone there. Smoke blocks sight.
- In smoke, crews **search** by hand: the Search action covers their tile and the 8 around it
  (1 AP, or 2 AP in thick smoke). Walking over an unseen victim also finds them. A small green mark
  shows searched tiles.
- **Smoke limits fire attack:** spraying always costs 1 AP, but thick smoke (60%+) at the nozzle cuts
  the reach by one tile (3 to 2 for a 1¾″ line). Moving through thick smoke costs +1 AP per tile.

## Water and hoses

- **Water comes from the engine.** Each engine arrives with a full tank, and every spray uses one unit
  from the engine feeding that line. Until the engine is supplied by a hydrant, the tank only goes down.
- **Attack lines come off the engine's hose connections**, halfway down each long side (drawn on the
  truck). Each side has a red **1¾″** and a blue **2½″** coupling, so an engine has up to four attack
  lines. With a firefighter selected and standing beside the connections, click the coupling you want
  (the half toward the cab is the 1¾″). Couplings in use are
  greyed out.

  | Attack line | Water per spray | Knockdown | Cooling (target / around it) | Reach | Advancing |
  |---|---|---|---|---|---|
  | 1¾″ (red) | 1 | −2 fire | −320 °C / −80 °C | 3 tiles | normal |
  | 2½″ (blue) | 2 | −3 fire | −480 °C / −180 °C | 4 tiles | +1 AP per new tile of hose laid |

- **The 5″ supply line** (yellow large-diameter hose, 2 per truck) comes off the yellow coupling at
  the **back** of an engine or ladder truck: stand next to the rear of the truck and tap it. Take it to a hydrant, or to another truck's **inlet**: the small yellow couplings on
  each side, just behind the crosslays on an engine and halfway along a ladder truck. Stand beside
  one and click it (1 AP). Trucks joined by a supply line share hydrant water either way, so an
  engine on a hydrant can relay to the ladder truck.
- **Hose is limited** to what each engine carries. The hose follows their exact path, one tile of hose per tile
  walked, through doors, up stairs and up ladders. They can't go further than the hose left on that
  engine. Walking back along the hose takes it back in. The hose can be put down and picked up by
  someone else, or packed back onto the engine. A door with a hose through it can't be closed.
- **Spraying needs the nozzle of an attack line** whose engine still has enough water. Thick smoke
  cuts the reach of either size by one tile.
- **Hydrants take crew time.** Walk a supply line next to a hydrant and **tap the hydrant**. Hooking up is 5 AP of work: take the cap off (1), couple the hose (2, using one more
  tile of hose), and open the hydrant (2). The firefighter spends whatever AP they have left on it.
  If the job isn't finished, they carry on automatically at the start of the next turn, unless they
  walk away, which abandons it (the work already done stays done). Without a supply line in hand,
  only the cap comes off.

  Water reaches the engine during the fire phase after the hydrant opens. After that, the engine's
  tank (and the tank of every truck relayed from it) refills by 8 units a turn, up to its capacity. The hydrant's badge and the inspector show
  hookup progress. A supply line with water in it (from a flowing hydrant, or between trucks that have hydrant water) is
  drawn solid with a thin blue line of water running down it.

| Action | AP | Notes |
|---|---|---|
| Move | 1/tile | +1 over furniture, +1 through a window, +1 while carrying someone, +1 in thick smoke, +1 per new tile of 2½″ hose laid. Cannot enter a tile burning at intensity 2+. Stairs and ladders connect floors. |
| Attack line | 1 | Beside the engine's hose connections; click the 1¾″ or 2½″ coupling. |
| Supply line | 1 | At the back of an engine or ladder truck; click the yellow coupling. |
| Couple to inlet | 1 | Holding another truck's supply line, beside a side inlet; click it. |
| Put down / pick up hose | 0 / 1 | Pick up the loose end of a line from its tile. |
| Pack hose | 1 | Next to the line's engine; the whole line goes back on the truck. |
| Hook up hydrant | up to 5 total | One click; uses your remaining AP and continues next turn — see above. |
| Spray | 1 | Holding an attack line. Straight, unobstructed line within the hose's reach. Strength and water use depend on the hose size (see above). Leaves the tile wet for 2 turns. |
| Door | 1 | Open or close an adjacent door or window. |
| Carry / Put down | 1 / 0 | Pick up an adjacent civilian (hands must be free of hose). Carrying them to any outside tile rescues them. |
| Search | 1–2 | Your tile and the 8 around it; 2 AP in thick smoke. |
| Tools | 1–3 | Force door 2 (anyone), reinforced door 3 (ladder crew). Ladder crew: axe 1–2, cut roof 3. |
| Raise / swing aerial | 2 | On the turntable or at the tip; tap an open-air or roof tile on an upper floor. |
| Master stream | 1 | On the turntable or at the tip; floods the target and the tiles around it that aren't behind a wall or closed door/window. Uses 3 tank water unless supplied. |
| Ladder (ladder crew) | 2 | Standing outside against the building. |
| Place / remove fan | 2 / 1 | Ladder crew places; anyone beside it removes. |

You **win** when no fire remains. Civilians still inside then walk out. You **lose** if every
firefighter goes down. Your score counts rescues, losses, how much of the structure you saved, and
speed.

## Controls

**Everything is a tap or a click on the map** — no modes and no shortcuts to learn.

- **Tap a firefighter** to select them (or a seated crew member on a parked truck).
- **Tap a tile** to act on it. If there's one sensible thing to do, they do it: walk there by the
  shortest path (stairs, ladders and the aerial included), spray fire in reach, open a closed door,
  pick up a resident, work a hydrant. If a tap could mean several things (open the door or axe
  through it, step into a burning tile or spray it, break a window, set up a fan, swing the aerial),
  a **tap menu** pops up listing each with its AP cost. Tap one, or tap anywhere else to dismiss it.
- **Tap the selected firefighter** for jobs right where they stand: search, raise a ground ladder,
  put the hose down or pack it onto its truck, put a person down.
- **Tap a coupling** on a truck to take that hose, or a side inlet to couple the supply line you're
  carrying. **Tap a staging truck** in Dispatch to park it.
- **End turn** and **Undo** are in the top bar. The view buttons above the floor selector switch
  between the normal view (👁️), the thermal camera (🌡️), smoke (🌫️) and structure (🧱). Hover (or tap) a tile to inspect it. Dashed orange
  borders mark tiles close to igniting.

Optional keyboard shortcuts: **Tab** next firefighter, **Enter** end turn, **Z** undo, **R** turn a
truck being parked, **↑** / **↓** change floor, **Home** ground floor, **H** / **V** thermal and
smoke views, **Esc** close the tap menu or cancel parking.

## Architecture

```
src/core/       pure, deterministic game logic (no DOM)
  types.ts        Tile / Unit / Truck / GameState model — floors[floor][y][x]
  materials.ts    ignition point, fuel and damage per material; contents properties
  building.ts     floor-plan + contents parser, Scenario and dispatch definitions
  trucks.ts       truck footprints, parking rules, couplings, inlets and the aerial
  hoses.ts        hose lines, hydrant states, relays, and the water system (hydrant → truck refill)
  ventilation.ts  fans: the space they pressurise, exhaust openings, smoke clearing, feeding fire
  search.ts       sight through clear air, hands-on search, finding victims
  knowledge.ts    fog of war: what the crew can see, feel and read on a thermal camera; smoke showing
  alarms.ts       striking further alarms: more companies, further out
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
at the same x/y on adjacent floors. Then list the starting fires (or set `randomOrigin` to pick a likely
spot from the seed, weighted by `ORIGIN_WEIGHT`), the civilians, and the `dispatch`: each truck's type,
arrival turn and crew (lieutenant first, then the engineer, then firefighters).

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
