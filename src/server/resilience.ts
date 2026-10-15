class CircuitOpenError extends Error {
  constructor() {
    super('Dependency circuit is open. Retry shortly.');
  }
}
/** One half-open probe; failures cannot create an unbounded retry storm. */
export class CircuitBreaker {
  private failures = 0;
  private openUntil = 0;
  private probing = false;
  private epoch = 0;
  constructor(
    private threshold = 3,
    private cooldownMs = 5000,
    private clock = Date.now,
  ) {}
  get state(): 'closed' | 'open' | 'half-open' {
    return this.openUntil === 0 ? 'closed' : this.clock() < this.openUntil ? 'open' : 'half-open';
  }
  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'open' || (this.state === 'half-open' && this.probing))
      throw new CircuitOpenError();
    const generation = this.epoch;
    const probe = this.state === 'half-open';
    if (probe) this.probing = true;
    try {
      const value = await operation();
      if (generation === this.epoch) {
        this.failures = 0;
        this.openUntil = 0;
        if (probe) this.epoch++;
      }
      return value;
    } catch (error) {
      if (generation === this.epoch && (++this.failures >= this.threshold || probe)) {
        this.openUntil = this.clock() + this.cooldownMs;
        this.epoch++;
      }
      throw error;
    } finally {
      if (probe) this.probing = false;
    }
  }
}
export class Bulkhead {
  active = 0;
  rejected = 0;
  constructor(readonly capacity: number) {}
  acquire(): (() => void) | undefined {
    if (this.active >= this.capacity) {
      this.rejected++;
      return;
    }
    this.active++;
    let released = false;
    return () => {
      if (!released) {
        this.active--;
        released = true;
      }
    };
  }
}
