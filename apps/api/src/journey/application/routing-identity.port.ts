import type { NetworkSnapshot } from '../../mobility-twin/domain/mobility-twin.js';
import type { CanonicalEntityBinding, JourneyLeg } from '../domain/journey.js';

export const ROUTING_IDENTITY_PORT = Symbol('ROUTING_IDENTITY_PORT');

export interface RoutingIdentityPort {
  resolveLegs(
    legs: readonly JourneyLeg[],
    snapshot: NetworkSnapshot,
  ): Promise<readonly JourneyLeg[]>;
  coverage(
    snapshot: NetworkSnapshot,
  ): Promise<Readonly<Record<string, number>>>;
}

export type RoutingIdentityBinding = CanonicalEntityBinding;
