import { createHash } from 'node:crypto';

import type {
  OperationalFetchContext,
  OperationalSourceAdapter,
} from '../application/operational-source.port.js';
import type {
  OperationalObservation,
  OperationalSourceMetadata,
} from '../domain/operational-data.js';

const SOURCE_ID = 'a129327c-e4cd-400b-a55d-c8577f95c404';
const ENDPOINT =
  'https://data.petabencana.id/floods?admin=ID-JK&minimum_state=1';
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

type FetchFunction = typeof fetch;
type TopologyTransform = Readonly<{
  scale?: unknown;
  translate?: unknown;
}>;

export type GeoJsonPolygon = Readonly<{
  type: 'Polygon' | 'MultiPolygon';
  coordinates: unknown;
}>;

type PetaBencanaGeometry = Readonly<{
  type: 'Polygon' | 'MultiPolygon';
  coordinates?: unknown;
  arcs?: unknown;
  properties?: Readonly<{
    area_id?: unknown;
    area_name?: unknown;
    parent_name?: unknown;
    city_name?: unknown;
    state?: unknown;
    last_updated?: unknown;
  }>;
}>;

export type PetaBencanaFloodObservation = Readonly<{
  observation: OperationalObservation;
  geometry: GeoJsonPolygon;
  sourceEventId: string;
  floodState: number;
}>;

type PetaBencanaResponse = Readonly<{
  statusCode?: unknown;
  result?: Readonly<{
    arcs?: unknown;
    transform?: TopologyTransform;
    objects?: Readonly<{
      output?: Readonly<{
        geometries?: unknown;
      }>;
    }>;
  }>;
}>;

function deterministicUuid(namespace: string, value: string): string {
  const bytes = createHash('sha256')
    .update(`${namespace}:${value}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '')
    throw new Error(`PetaBencana ${field} is missing`);
  return value;
}

type Position = [number, number];

function decodeArc(
  index: number,
  arcs: readonly unknown[],
  transform: TopologyTransform | undefined,
): Position[] {
  const reversed = index < 0;
  const sourceIndex = reversed ? ~index : index;
  const raw = arcs[sourceIndex];
  if (!Array.isArray(raw))
    throw new Error('PetaBencana TopoJSON arc is missing');
  const scale = transform?.scale;
  const translate = transform?.translate;
  const quantized =
    Array.isArray(scale) &&
    scale.length >= 2 &&
    Array.isArray(translate) &&
    translate.length >= 2;
  let x = 0;
  let y = 0;
  const positions = raw.map((position): Position => {
    if (
      !Array.isArray(position) ||
      typeof position[0] !== 'number' ||
      typeof position[1] !== 'number'
    )
      throw new Error('PetaBencana TopoJSON position is malformed');
    if (!quantized) return [position[0], position[1]];
    x += position[0];
    y += position[1];
    return [
      x * (scale[0] as number) + (translate[0] as number),
      y * (scale[1] as number) + (translate[1] as number),
    ];
  });
  return reversed ? positions.reverse() : positions;
}

function joinArcs(
  indexes: readonly unknown[],
  arcs: readonly unknown[],
  transform: TopologyTransform | undefined,
): Position[] {
  const result: Position[] = [];
  for (const value of indexes) {
    if (typeof value !== 'number' || !Number.isInteger(value))
      throw new Error('PetaBencana TopoJSON arc reference is malformed');
    const decoded = decodeArc(value, arcs, transform);
    result.push(...(result.length === 0 ? decoded : decoded.slice(1)));
  }
  return result;
}

function geometryFromTopology(
  geometry: PetaBencanaGeometry,
  response: PetaBencanaResponse,
): GeoJsonPolygon {
  if (Array.isArray(geometry.coordinates))
    return { type: geometry.type, coordinates: geometry.coordinates };
  const arcs = response.result?.arcs;
  if (!Array.isArray(arcs) || !Array.isArray(geometry.arcs))
    throw new Error(
      'PetaBencana geometry has neither coordinates nor TopoJSON arcs',
    );
  if (geometry.type === 'Polygon')
    return {
      type: 'Polygon',
      coordinates: geometry.arcs.map((ring) => {
        if (!Array.isArray(ring))
          throw new Error('PetaBencana polygon ring is malformed');
        return joinArcs(ring, arcs, response.result?.transform);
      }),
    };
  return {
    type: 'MultiPolygon',
    coordinates: geometry.arcs.map((polygon) => {
      if (!Array.isArray(polygon))
        throw new Error('PetaBencana multipolygon is malformed');
      return polygon.map((ring) => {
        if (!Array.isArray(ring))
          throw new Error('PetaBencana multipolygon ring is malformed');
        return joinArcs(ring, arcs, response.result?.transform);
      });
    }),
  };
}

export class PetaBencanaOperationalAdapter implements OperationalSourceAdapter {
  readonly metadata: OperationalSourceMetadata = {
    sourceId: SOURCE_ID,
    sourceKey: 'petabencana-public-flood-api',
    publisher: 'Yayasan Peta Bencana / Disaster Map Foundation',
    classification: 'VERIFIED_PUBLIC_API',
    authority: 'VERIFIED_GOVERNMENT_OR_DISRUPTION',
    canonicalUrl: 'https://docs.petabencana.id/routes/area-banjir',
    documented: true,
    authenticationRequired: false,
    automationPermitted: true,
    rightsStatus: 'PERMITTED',
  };

  constructor(private readonly fetchFunction: FetchFunction = fetch) {}

  async fetchObservations(
    context: OperationalFetchContext = {},
  ): Promise<readonly OperationalObservation[]> {
    return (await this.fetchFloodAreas(context)).map(
      (item) => item.observation,
    );
  }

  async fetchFloodAreas(
    context: OperationalFetchContext = {},
  ): Promise<readonly PetaBencanaFloodObservation[]> {
    const receivedAt = context.receivedAt ?? new Date();
    const response = await this.fetchFunction(ENDPOINT, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'TRANSUM-IN-NEXUS-academic-research/1.0',
      },
    });
    if (!response.ok)
      throw new Error(
        `PetaBencana request failed with HTTP ${response.status}`,
      );
    const payload = (await response.json()) as PetaBencanaResponse;
    const geometries = payload.result?.objects?.output?.geometries;
    if (payload.statusCode !== 200 || !Array.isArray(geometries))
      throw new Error(
        'PetaBencana response does not match the documented shape',
      );

    return (geometries as PetaBencanaGeometry[]).map((geometry) => {
      if (!['Polygon', 'MultiPolygon'].includes(geometry.type))
        throw new Error('PetaBencana geometry must be Polygon or MultiPolygon');
      const decodedGeometry = geometryFromTopology(geometry, payload);
      const properties = geometry.properties;
      const areaId = requiredString(properties?.area_id, 'area_id');
      const observedAt = requiredString(
        properties?.last_updated,
        'last_updated',
      );
      if (
        typeof properties?.state !== 'number' ||
        !Number.isInteger(properties.state)
      )
        throw new Error('PetaBencana state must be an integer');
      const expiresAt = new Date(
        Date.parse(observedAt) + SIX_HOURS_MS,
      ).toISOString();
      const identity = `${areaId}:${observedAt}`;
      const received = receivedAt.toISOString();
      const observation = {
        observationId: deterministicUuid(SOURCE_ID, `observation:${identity}`),
        incidentId: deterministicUuid(SOURCE_ID, `incident:${identity}`),
        incidentType: 'FLOOD',
        affectedEntityRefs: [`PETABENCANA_AREA:${areaId}`],
        affectedModes: [],
        operationalState: 'UNKNOWN',
        evidenceType: 'OBSERVED',
        sourceAuthority: 'VERIFIED_GOVERNMENT_OR_DISRUPTION',
        sourceChannel: 'ENVIRONMENTAL_OBSERVATION',
        impactBasis: 'ENVIRONMENTAL_INDICATOR',
        observedAt,
        receivedAt: received,
        updatedAt: received,
        expiresAt,
        reason: `PetaBencana reported flood state ${String(properties.state)} for ${requiredString(properties.area_name, 'area_name')}. This does not assert a transport closure.`,
        confidenceStatus: 'SOURCE_REPORTED',
        confidence: null,
        provenance: {
          sourceId: SOURCE_ID,
          sourceClassification: 'VERIFIED_PUBLIC_API',
          rawReference: `${ENDPOINT}#area_id=${encodeURIComponent(areaId)}`,
          lineageReference: `petabencana:flood-area:${identity}`,
          retrievedAt: received,
        },
        sourceAttributes: {
          flood_state: properties.state as number,
          area_name: requiredString(properties.area_name, 'area_name'),
          parent_name:
            typeof properties.parent_name === 'string'
              ? properties.parent_name
              : null,
          city_name:
            typeof properties.city_name === 'string'
              ? properties.city_name
              : null,
        },
      } satisfies OperationalObservation;
      return {
        observation,
        geometry: decodedGeometry,
        sourceEventId: areaId,
        floodState: properties.state,
      };
    });
  }
}
