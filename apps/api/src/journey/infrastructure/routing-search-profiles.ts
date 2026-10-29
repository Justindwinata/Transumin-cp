/** Product candidate-search policy V1; not a research experiment or live data.
 * Keep profiles fixed and versioned. The installed OTP 2.10 GraphQL schema
 * supports these preferences; all results still pass canonical/state validation.
 * Shared portfolio prevents each preference from ranking an unrelated tiny pool.
 */
export const ROUTING_SEARCH_POLICY_VERSION = 'PRODUCT_PORTFOLIO_V2';
export const ROUTING_SEARCH_PROFILES = [
  {
    name: 'BUS_ALTERNATIVE',
    walkReluctance: 2,
    boardCost: 0,
    transferCost: 0,
    busOnly: true,
  },
  { name: 'BALANCED', walkReluctance: 2, boardCost: 600, transferCost: 0 },
  { name: 'FASTEST', walkReluctance: 1, boardCost: 0, transferCost: 0 },
  { name: 'LEAST_WALKING', walkReluctance: 4, boardCost: 0, transferCost: 0 },
  {
    name: 'FEWEST_TRANSFERS',
    walkReluctance: 2,
    boardCost: 600,
    transferCost: 1200,
  },
] as const;

export function searchPreferences(
  profile: (typeof ROUTING_SEARCH_PROFILES)[number],
  excludedRouteIds: readonly string[],
) {
  return {
    street: {
      walk: {
        reluctance: profile.walkReluctance,
        boardCost: profile.boardCost,
      },
    },
    transit: {
      transfer: { cost: profile.transferCost },
      ...(excludedRouteIds.length
        ? { filters: [{ exclude: [{ routes: [...excludedRouteIds] }] }] }
        : {}),
    },
  };
}
