export interface Coordinate {
  readonly longitude: number;
  readonly latitude: number;
}

export type PedestrianDirection = 'FORWARD' | 'REVERSE';
export type AccessClassification = 'ALLOWED' | 'CONDITIONAL' | 'UNKNOWN';

export interface OSMWay {
  readonly id: string;
  readonly refs: readonly string[];
  readonly tags: Readonly<Record<string, string>>;
}

export interface NetworkNode extends Coordinate {
  readonly id: string;
  readonly externalId: string;
  readonly kind: 'PEDESTRIAN' | 'CROSSING' | 'ENTRANCE' | 'TRANSIT_ACCESS';
  readonly tags: Readonly<Record<string, string>>;
}

export interface WalkingEdge {
  readonly id: string;
  readonly mobilityEntityId: string;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly sourceWayId: string;
  readonly segmentSequence: number;
  readonly direction: PedestrianDirection;
  readonly lengthM: number;
  readonly accessClassification: AccessClassification;
  readonly highwayClass: string;
  readonly bridge: boolean | null;
  readonly tunnel: boolean | null;
  readonly geometry: readonly Coordinate[];
  readonly tags: Readonly<Record<string, string>>;
}

export interface WalkingGraph {
  readonly nodes: readonly NetworkNode[];
  readonly edges: readonly WalkingEdge[];
  readonly sourceNodeCount: number;
  readonly sourceWayCount: number;
  readonly rejectedWayCount: number;
  readonly missingNodeReferenceCount: number;
}

export interface EntityReferenceRecord {
  readonly canonicalEntityId: string;
  readonly sourceKey: string;
  readonly operatorKey: string;
  readonly externalReference: string;
  readonly referenceType:
    'OFFICIAL_ID' | 'OPERATOR_REFERENCE' | 'ROUTE_CODE' | 'OSM_ID';
}

export interface EntityAliasRecord {
  readonly canonicalEntityId: string;
  readonly sourceKey: string;
  readonly operatorKey: string;
  readonly alias: string;
  readonly normalizedAlias: string;
}

export type EntityResolutionResult =
  | {
      readonly status: 'RESOLVED';
      readonly canonicalEntityId: string;
      readonly method: 'EXACT_REFERENCE' | 'EXACT_ALIAS';
    }
  | {
      readonly status: 'AMBIGUOUS';
      readonly candidateEntityIds: readonly string[];
    }
  | { readonly status: 'UNRESOLVED' };

export interface EndpointCandidate extends Coordinate {
  readonly networkNodeId: string;
  readonly kind: NetworkNode['kind'];
}

export type EndpointResolution =
  | {
      readonly status: 'RESOLVED' | 'FALLBACK';
      readonly method:
        | 'VERIFIED_ENTRANCE'
        | 'NEAREST_PEDESTRIAN_NODE'
        | 'TRANSIT_LOCATION'
        | 'STATION_CENTROID';
      readonly networkNodeId: string;
      readonly distanceM: number;
    }
  | { readonly status: 'UNRESOLVED'; readonly method: 'NONE' };
