// Structured Node events include hook failures even when every assertion passes.
export default async function* (events) {
  for await (const event of events) {
    yield `${JSON.stringify(event)}\n`;
  }
}
