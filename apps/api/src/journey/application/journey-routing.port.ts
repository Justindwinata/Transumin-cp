import type {
  JourneyAlternative,
  JourneyPlanRequest,
} from '../domain/journey.js';

export const JOURNEY_ROUTING_PORT = Symbol('JOURNEY_ROUTING_PORT');

export type RouterHealth = Readonly<{
  status: 'AVAILABLE' | 'UNAVAILABLE';
  provider: 'OTP';
  version: string;
  checkedAt: string;
  latencyMilliseconds: number;
}>;

export type RouterPlanRequest = JourneyPlanRequest &
  Readonly<{
    excludedRouteIds: readonly string[];
    attempt: number;
  }>;

export interface JourneyRoutingPort {
  planJourney(
    request: RouterPlanRequest,
  ): Promise<readonly JourneyAlternative[]>;
  routerHealth(): Promise<RouterHealth>;
  routingSnapshot(): Readonly<{
    snapshotId: string;
    manifestSha256: string;
    graphSha256: string;
    commonServiceDate: string;
    timezone: 'Asia/Jakarta';
  }>;
}
