/** Small seeded PRNG (mulberry32). The state lives in GameState so games are replayable. */
export class Rng {
  constructor(public state: number) {}

  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let r = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  }

  chance(p: number): boolean {
    return this.next() < p;
  }
}
