/** Undo/redo over immutable snapshots. */
export class History<T> {
  private past: T[] = [];
  private future: T[] = [];

  constructor(
    public current: T,
    private limit = 200,
  ) {}

  push(next: T) {
    if (next === this.current) return;
    this.past.push(this.current);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
    this.current = next;
  }

  /** How many steps undo can go back. */
  get steps() {
    return this.past.length;
  }

  /** Replaces the current state without a new undo step (live edits such as scrubbing). */
  replace(next: T) {
    this.current = next;
    this.future = [];
  }

  undo() {
    const prev = this.past.pop();
    if (prev === undefined) return false;
    this.future.push(this.current);
    this.current = prev;
    return true;
  }

  redo() {
    const next = this.future.pop();
    if (next === undefined) return false;
    this.past.push(this.current);
    this.current = next;
    return true;
  }

  reset(value: T) {
    this.past = [];
    this.future = [];
    this.current = value;
  }
}
