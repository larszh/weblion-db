/**
 * The start of a sync run or a live refresh. Rows are then compared with `updatedAt < started`,
 * so a change made in the console while the provider's answer was on its way is not overwritten
 * with the older state. Timestamps have millisecond precision: with a plain `new Date()` a write
 * in the very millisecond the run starts in would count as made during the run and be skipped
 * (seen on fast CI machines). So the start is the first millisecond after every earlier write.
 * Waits about a millisecond, at most a few if the clock is set back meanwhile.
 */
export async function runStart(): Promise<Date> {
  const before = Date.now();
  const deadline = performance.now() + 5;
  while (Date.now() <= before && performance.now() < deadline) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  return new Date(Math.max(Date.now(), before + 1));
}
