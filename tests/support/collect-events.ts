export async function collectEvents<T>(
  source: AsyncIterable<T>,
): Promise<T[]> {
  const events: T[] = [];
  for await (const event of source) {
    events.push(event);
  }
  return events;
}
