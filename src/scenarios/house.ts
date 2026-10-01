import type { Scenario } from '../core/building';

/** Two-storey family home with a kitchen fire. */
export const houseFire: Scenario = {
  name: 'Kitchen Fire — Two-Storey House',
  description:
    'A stove fire has spread into the kitchen cabinets. Three residents are still inside. ' +
    'Get them out, keep the fire from climbing the stairwell, and put it out.',
  seed: 20261001,
  preburn: 2,
  floors: [
    // Ground floor
    [
      '....................',
      '.##W#####W#W#####W#.',
      '.#ff,,,,,w_Swtttff#.',
      '.#f,,,,,,w_Swttttt#.',
      '.W,,,,,,,D__Dttttt#.',
      '.#,,,,,,,w__wtttff#.',
      '.#wwwwDwww__wwwDww#.',
      '.#f,,,,,,w__wttttt#.',
      '.W,,,,,,,w__wttttt#.',
      '.#ff,,,,,w__wttttt#.',
      '.#########DD#######.',
      '..........E.........',
    ],
    // Upper floor
    [
      '                    ',
      ' ##W#####W#W#####W# ',
      ' #ff,,,,,w_Sw,,,ff# ',
      ' #f,,,,,,w_Sw,,,,,# ',
      ' W,,,,,,,D__D,,,,,W ',
      ' #,,,,,,,w__w,,,ff# ',
      ' #wwwwDwww__wwwDww# ',
      ' #tttttttw__w,,,,f# ',
      ' Wtttttttw__w,,,,,W ',
      ' #tttttttw__wff,,,# ',
      ' ################## ',
      '                    ',
    ],
  ],
  fires: [
    { pos: { floor: 0, x: 16, y: 2 }, intensity: 2 },
    { pos: { floor: 0, x: 17, y: 2 }, intensity: 1 },
  ],
  civilians: [
    { name: 'Maria', pos: { floor: 1, x: 3, y: 3 } },
    { name: 'Theo', pos: { floor: 1, x: 15, y: 8 } },
    { name: 'Grandpa Joe', pos: { floor: 0, x: 4, y: 8 } },
  ],
  firefighters: [
    { name: 'Alvarez', pos: { floor: 0, x: 9, y: 11 } },
    { name: 'Brooks', pos: { floor: 0, x: 11, y: 11 } },
    { name: 'Chen', pos: { floor: 0, x: 12, y: 11 } },
  ],
};

export const SCENARIOS: Scenario[] = [houseFire];
