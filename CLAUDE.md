# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Fireflow is a turn-based firefighting game: TypeScript + Vite, rendered to a canvas, no framework.
The README is the authoritative rules reference (tile model, turn order, AP costs, controls). Keep it
in sync when rules, costs or controls change.

## Commands

```
npm run dev                          # Vite dev server, http://localhost:5173
npm test                             # vitest run (all specs in tests/)
npx vitest run tests/fire.test.ts    # one spec file
npx vitest run -t "substring"        # tests whose name matches
npm run typecheck                    # tsc --noEmit (strict, noUnusedLocals/Parameters)
npm run build                        # typecheck + static build to dist/
```

There is no linter; `tsc` strictness is the check.

## Architecture

- `src/core/` is pure, deterministic game logic with no DOM access. `src/ui/` (canvas renderer,
  tap → action options in `intent.ts`, shown as a tap menu when there's more than one) and `src/main.ts` (DOM wiring, keyboard, undo stack) sit on top.
- **Immutable state transitions.** `performAction(state, action)` (`actions.ts`) and `endTurn(state)`
  (`game.ts`) `structuredClone` the input and return a new `GameState`; never mutate a state you
  were handed from outside. Undo in `main.ts` is just a stack of previous states for the current turn.
  Inside systems and `performAction`, mutating the cloned state is the norm.
- **Determinism.** All randomness goes through `Rng` (`rng.ts`), whose state is stored in
  `GameState.rngState`. Don't use `Math.random`; the same scenario + actions must replay identically.
- **Actions** are a discriminated union in `actions.ts`. Each has validation in `actionCost`
  (returns AP cost or an error string) and effects in `performAction`. AP constants live in `COST`
  / `SPRAY`. Ladder-crew-only jobs are gated by `LADDER_JOBS`. Adding an action means touching the
  union, `actionCost`, `performAction`, usually an option in `clickOptions` (`ui/intent.ts`) — the UI is tap-only, with no mode or action buttons —
  and the README action table.
- **Turn loop** (`game.ts`): `endTurn` increments the turn, runs the environment `SYSTEMS` in order
  (fire → smoke → fans → structure → exposure → water), arrives due trucks, restores AP, spots victims,
  then `evaluate` sets win/loss. Fire only changes during this phase. New hazards are added as a
  `SimSystem` (`systems.ts`) appended to `SYSTEMS`.
- **Grid model** (`types.ts`): `state.floors[floor][y][x]` of `Tile` (kind, material, contents,
  temperature, fire, smoke, integrity…). Helpers for adjacency, walkability, open air and shafts
  between floors are in `grid.ts`; reuse them rather than re-deriving.
- **Scenarios** (`src/scenarios/`, parsed by `building.ts`) are ASCII floor plans plus an optional
  contents overlay; the character legends are in `building.ts`. All floors share one size and stairs
  must line up across adjacent floors. `buildState` turns a `Scenario` into a `GameState`; `newGame`
  also runs `preburn` environment turns.

## Tests

Rule tests build tiny ad-hoc scenarios with `tests/helpers.ts`: `miniScenario(floors, extra)` for a
minimal `Scenario`, `run(state, ...actions)` to apply actions and throw on the first rejected one,
and `standAt` to place a crew member directly on a tile. `endTurn(state, systems)` accepts a subset of
systems to isolate one system in a test.
