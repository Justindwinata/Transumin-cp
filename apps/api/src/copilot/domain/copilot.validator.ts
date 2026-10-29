// Closed-world facts only. Question text never becomes factual authority.
export type CopilotFact = Readonly<{
  reference: string;
  field: string;
  value: string | number | boolean | null;
}>;

export function validateFactuality(
  candidate: readonly CopilotFact[],
  authorized: readonly CopilotFact[],
): boolean {
  return (
    candidate.length > 0 &&
    candidate.every(
      (fact) =>
        typeof fact.reference === 'string' &&
        fact.reference.length > 0 &&
        typeof fact.field === 'string' &&
        fact.field.length > 0 &&
        (fact.value === null ||
          typeof fact.value === 'boolean' ||
          (typeof fact.value === 'number' && Number.isFinite(fact.value)) ||
          (typeof fact.value === 'string' && fact.value.length <= 200)) &&
        authorized.some(
          (source) =>
            source.reference === fact.reference &&
            source.field === fact.field &&
            Object.is(source.value, fact.value),
        ),
    )
  );
}

export function renderFacts(facts: readonly CopilotFact[]): string {
  return facts
    .map(
      (fact) =>
        `${fact.field}=${JSON.stringify(fact.value)} [${fact.reference}]`,
    )
    .join('\n');
}
