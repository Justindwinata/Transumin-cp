import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';

import {
  DATABASE,
  type FoundationDatabase,
} from '../../infrastructure/database/database.constants.js';
import type { NetworkSnapshot } from '../../mobility-twin/domain/mobility-twin.js';
import type { ProductMode } from '../../routing-data/domain/otp-input.js';
import type { RoutingIdentityPort } from '../application/routing-identity.port.js';
import {
  type CanonicalEntityBinding,
  type JourneyLeg,
  JourneyRoutingError,
} from '../domain/journey.js';
import { parseNamespacedId } from './otp-journey-routing.adapter.js';
import { controlledRoutingDatasetVersionId } from './routing-identity-preparation.js';

type ReferenceRow = Readonly<{
  externalReference: string;
  canonicalEntityId: string;
  entityType: CanonicalEntityBinding['entityType'];
  provenanceRef: string;
}>;

const feedMode: Readonly<Record<string, ProductMode>> = {
  tj: 'TRANSJAKARTA',
  mikro: 'MIKROTRANS',
  krl: 'KRL',
  mrt: 'MRT_JAKARTA',
  lrtj: 'LRT_JAKARTA',
  lrtjb: 'LRT_JABODEBEK',
};
@Injectable()
export class KyselyRoutingIdentityBridge implements RoutingIdentityPort {
  constructor(
    @Inject(DATABASE)
    private readonly database: Kysely<FoundationDatabase>,
  ) {}

  async resolveLegs(
    legs: readonly JourneyLeg[],
    snapshot: NetworkSnapshot,
  ): Promise<readonly JourneyLeg[]> {
    const requestedStops = legs.flatMap((leg) => [
      ...(leg.from.otpStopId === null
        ? []
        : [
            {
              id: leg.from.otpStopId,
              name: leg.from.name,
              latitude: leg.from.latitude,
              longitude: leg.from.longitude,
            },
          ]),
      ...leg.intermediateStops.map((stop) => ({
        id: stop.otpStopId,
        name: stop.name,
        latitude: stop.latitude,
        longitude: stop.longitude,
      })),
      ...(leg.to.otpStopId === null
        ? []
        : [
            {
              id: leg.to.otpStopId,
              name: leg.to.name,
              latitude: leg.to.latitude,
              longitude: leg.to.longitude,
            },
          ]),
    ]);
    const requestedRoutes = legs.flatMap((leg) =>
      leg.routeId === null
        ? []
        : [{ id: leg.routeId, name: leg.routeShortName }],
    );
    const busExternalIds = [
      ...new Set(
        [...requestedStops, ...requestedRoutes].flatMap((item) => {
          const parsed = parseNamespacedId(item.id);
          return parsed !== null &&
            (parsed.feedKey === 'tj' || parsed.feedKey === 'mikro')
            ? [parsed.originalId]
            : [];
        }),
      ),
    ];
    const busReferences = await this.busReferences(
      snapshot.transitDatasetVersionId,
      busExternalIds,
    );
    const railReferences = await this.routingReferences([
      ...requestedStops.map((stop) => sourceScopedId(stop.id)),
      ...requestedRoutes.map((route) => sourceScopedId(route.id)),
    ]);

    return legs.map((leg) => {
      if (leg.mode === 'WALK') return leg;
      const bindings: CanonicalEntityBinding[] = [];
      for (const stop of requestedStopsForLeg(leg)) {
        const parsed = parseNamespacedId(stop.id);
        if (parsed === null)
          throw unresolved(stop.id, leg.mode, 'invalid OTP namespace');
        const productMode = feedMode[parsed.feedKey];
        if (productMode !== leg.mode)
          throw unresolved(stop.id, leg.mode, 'mode namespace mismatch');
        if (parsed.feedKey === 'tj' || parsed.feedKey === 'mikro') {
          bindings.push(
            exactlyOneBusBinding(
              busReferences,
              parsed.originalId,
              stop.id,
              productMode,
              ['STOP', 'STATION'],
            ),
          );
        } else {
          bindings.push(
            exactlyOneControlledBinding(
              railReferences,
              stop.id,
              productMode,
              'STATION',
            ),
          );
        }
      }
      if (leg.routeId !== null) {
        const parsed = parseNamespacedId(leg.routeId);
        if (parsed === null)
          throw unresolved(leg.routeId, leg.mode, 'invalid route namespace');
        if (parsed.feedKey === 'tj' || parsed.feedKey === 'mikro') {
          bindings.push(
            exactlyOneBusBinding(
              busReferences,
              parsed.originalId,
              leg.routeId,
              leg.mode,
              ['ROUTE'],
            ),
          );
        } else
          bindings.push(
            exactlyOneControlledBinding(
              railReferences,
              leg.routeId,
              leg.mode,
              'ROUTE',
            ),
          );
      }
      return { ...leg, entityBindings: deduplicate(bindings) };
    });
  }

  async coverage(
    snapshot: NetworkSnapshot,
  ): Promise<Readonly<Record<string, number>>> {
    const result = await sql<{ operatorKey: string; count: number }>`
      select operator_key as "operatorKey", count(distinct canonical_entity_id)::int as count
      from meta.source_entity_reference
      where source_dataset_version_id in (
        ${snapshot.transitDatasetVersionId}::uuid,
        ${snapshot.spatialDatasetVersionId}::uuid,
        ${controlledRoutingDatasetVersionId}::uuid
      )
      group by operator_key
      order by operator_key
    `.execute(this.database);
    return Object.fromEntries(
      result.rows.map((row) => [row.operatorKey, Number(row.count)]),
    );
  }

  private async busReferences(
    datasetVersionId: string,
    externalIds: readonly string[],
  ): Promise<readonly ReferenceRow[]> {
    if (externalIds.length === 0) return [];
    const result = await sql<ReferenceRow>`
      select r.external_reference as "externalReference",
             r.canonical_entity_id as "canonicalEntityId",
             m.entity_type as "entityType",
             r.provenance_ref as "provenanceRef"
      from meta.source_entity_reference r
      join twin.mobility_entity m on m.id=r.canonical_entity_id
      where r.source_dataset_version_id=${datasetVersionId}::uuid
        and r.source_key='transjakarta-official-gtfs-static'
        and r.external_reference in (
          select jsonb_array_elements_text(${JSON.stringify(externalIds)}::jsonb)
        )
      order by r.external_reference, m.entity_type, r.canonical_entity_id
    `.execute(this.database);
    return result.rows;
  }

  private async routingReferences(
    externalIds: readonly string[],
  ): Promise<readonly ReferenceRow[]> {
    if (externalIds.length === 0) return [];
    const result = await sql<ReferenceRow>`
      select r.external_reference as "externalReference",
             r.canonical_entity_id as "canonicalEntityId",
             m.entity_type as "entityType",
             r.provenance_ref as "provenanceRef"
      from meta.source_entity_reference r
      join twin.mobility_entity m on m.id=r.canonical_entity_id
      where r.source_dataset_version_id=${controlledRoutingDatasetVersionId}::uuid
        and r.source_key='phase4b-a-controlled-router-input'
        and r.external_reference in (
          select jsonb_array_elements_text(${JSON.stringify(externalIds)}::jsonb)
        )
      order by r.external_reference, r.canonical_entity_id
    `.execute(this.database);
    return result.rows;
  }
}

function requestedStopsForLeg(leg: JourneyLeg) {
  return [
    ...(leg.from.otpStopId === null
      ? []
      : [
          {
            id: leg.from.otpStopId,
            name: leg.from.name,
            latitude: leg.from.latitude,
            longitude: leg.from.longitude,
          },
        ]),
    ...leg.intermediateStops.map((stop) => ({
      id: stop.otpStopId,
      name: stop.name,
      latitude: stop.latitude,
      longitude: stop.longitude,
    })),
    ...(leg.to.otpStopId === null
      ? []
      : [
          {
            id: leg.to.otpStopId,
            name: leg.to.name,
            latitude: leg.to.latitude,
            longitude: leg.to.longitude,
          },
        ]),
  ];
}

function exactlyOneBusBinding(
  rows: readonly ReferenceRow[],
  externalReference: string,
  otpEntityId: string,
  productMode: ProductMode,
  entityTypes: readonly CanonicalEntityBinding['entityType'][],
): CanonicalEntityBinding {
  const matches = rows.filter(
    (row) =>
      row.externalReference === externalReference &&
      entityTypes.includes(row.entityType),
  );
  const unique = [
    ...new Map(matches.map((row) => [row.canonicalEntityId, row])).values(),
  ];
  if (unique.length !== 1)
    throw unresolved(
      otpEntityId,
      productMode,
      unique.length === 0
        ? 'no source reference'
        : 'ambiguous source reference',
    );
  const selected = unique[0] as ReferenceRow;
  return {
    otpEntityId,
    productMode,
    entityType: selected.entityType,
    canonicalEntityId: selected.canonicalEntityId,
    mobilityEntityId: selected.canonicalEntityId,
    resolutionMethod: 'EXACT_SOURCE_REFERENCE',
    provenanceRef: selected.provenanceRef,
  };
}

function exactlyOneControlledBinding(
  references: readonly ReferenceRow[],
  otpEntityId: string,
  productMode: ProductMode,
  entityType: 'STATION' | 'ROUTE',
): CanonicalEntityBinding {
  const exactReferences = [
    ...new Map(
      references
        .filter(
          (row) =>
            row.externalReference === sourceScopedId(otpEntityId) &&
            row.entityType === entityType,
        )
        .map((row) => [row.canonicalEntityId, row]),
    ).values(),
  ];
  if (exactReferences.length === 1) {
    const selected = exactReferences[0] as ReferenceRow;
    return {
      otpEntityId,
      productMode,
      entityType,
      canonicalEntityId: selected.canonicalEntityId,
      mobilityEntityId: selected.canonicalEntityId,
      resolutionMethod: 'EXACT_SOURCE_REFERENCE',
      provenanceRef: selected.provenanceRef,
    };
  }
  if (exactReferences.length > 1)
    throw unresolved(
      otpEntityId,
      productMode,
      'ambiguous controlled source reference',
    );
  throw unresolved(otpEntityId, productMode, 'no canonical routing reference');
}

function unresolved(
  otpEntityId: string,
  productMode: ProductMode,
  reason: string,
): JourneyRoutingError {
  return new JourneyRoutingError(
    'IDENTITY_UNRESOLVED',
    `Router entity ${otpEntityId} cannot be mapped deterministically.`,
    { otpEntityId, productMode, reason },
  );
}

function sourceScopedId(value: string): string {
  const offset = value.indexOf('tnx:');
  return offset < 0 ? value : value.slice(offset);
}

function deduplicate(
  bindings: readonly CanonicalEntityBinding[],
): readonly CanonicalEntityBinding[] {
  return [
    ...new Map(
      bindings.map((binding) => [binding.otpEntityId, binding]),
    ).values(),
  ];
}
