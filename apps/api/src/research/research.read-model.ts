// FR-011/FR-013: read models over persisted simulation + version-aligned spatial data.
// No fake metrics: geometry sourced from transit/spatial tables aligned to snapshot dataset versions;
// caps + clipped bbox; scenarios/runs use bounded cursor pagination; experiments honest empty.
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import {
  DATABASE,
  type FoundationDatabase,
} from '../infrastructure/database/database.constants.js';

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const parseLimit = (value?: string) => {
  const n = value === undefined ? 25 : Number(value);
  if (
    !/^\d+$/.test(value ?? '25') ||
    !Number.isSafeInteger(n) ||
    n < 1 ||
    n > 100
  )
    throw new BadRequestException(
      'limit must be an integer between 1 and 100.',
    );
  return n;
};
export function parseCursor(
  value: string | undefined,
  scope: string,
): { t: string; id: string } | null {
  if (value === undefined) return null;
  try {
    const p = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as {
      v: number;
      s: string;
      t: string;
      id: string;
    };
    if (
      p.v !== 1 ||
      p.s !== scope ||
      typeof p.t !== 'string' ||
      !Number.isFinite(Date.parse(p.t)) ||
      !uuid.test(p.id)
    )
      throw Error();
    return { t: p.t, id: p.id };
  } catch {
    throw new BadRequestException('cursor is invalid or malformed.');
  }
}
export function parseBbox(
  bbox: string | undefined,
): ReturnType<typeof sql> | null {
  if (bbox === undefined) return null;
  const parts = bbox.split(',').map((v) => Number(v.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n)))
    throw new BadRequestException('bbox must be minLon,minLat,maxLon,maxLat.');
  const [minLon, minLat, maxLon, maxLat] = parts as [
    number,
    number,
    number,
    number,
  ];
  if (
    minLon < -180 ||
    maxLon > 180 ||
    minLat < -90 ||
    maxLat > 90 ||
    minLon >= maxLon ||
    minLat >= maxLat ||
    maxLon - minLon > 20 ||
    maxLat - minLat > 20
  )
    throw new BadRequestException(
      'bbox must be minLon,minLat,maxLon,maxLat within 20 degrees.',
    );
  return sql`ST_MakeEnvelope(${minLon},${minLat},${maxLon},${maxLat},4326)`;
}
const encodeCursor = (scope: string, t: string, id: string) =>
  Buffer.from(JSON.stringify({ v: 1, s: scope, t, id }), 'utf8').toString(
    'base64url',
  );

@Injectable()
export class ResearchReadModel {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<FoundationDatabase>,
  ) {}

  async scenarios(limitValue?: string, cursorValue?: string) {
    const limit = parseLimit(limitValue);
    const after = parseCursor(cursorValue, 'scenarios');
    const db = this.db as unknown as Kysely<unknown>;
    const rows = (
      await sql<{
        scenario_id: string;
        name: string;
        description: string;
        version: number;
        status: string;
        created_at: string;
        action_count: number;
        run_count: number;
      }>`
      select s.id as scenario_id,s.name,s.description,s.version,s.status,s.created_at::timestamptz::text as created_at,
        (select count(*)::int from simulation.scenario_action a where a.scenario_id=s.id) as action_count,
        (select count(*)::int from simulation.run r where r.scenario_id=s.id) as run_count
      from simulation.scenario s
      where ${after ? sql`(s.created_at,s.id)<(${after.t}::timestamptz,${after.id}::uuid)` : sql`true`}
      order by s.created_at desc,s.id desc limit ${limit + 1}
    `.execute(db)
    ).rows;
    const data = rows.slice(0, limit);
    const last = data[data.length - 1];
    const next_cursor =
      rows.length > limit && last
        ? encodeCursor('scenarios', last.created_at, last.scenario_id)
        : null;
    return { data, next_cursor };
  }

  async runs(limitValue?: string, cursorValue?: string) {
    const limit = parseLimit(limitValue);
    const after = parseCursor(cursorValue, 'runs');
    const db = this.db as unknown as Kysely<unknown>;
    const rows = (
      await sql<{
        simulation_run_id: string;
        scenario_id: string;
        scenario_name: string;
        network_snapshot_id: string;
        status: string;
        created_at: string;
        completed_at: string | null;
        failure_code: string | null;
      }>`
      select r.id as simulation_run_id,r.scenario_id,s.name as scenario_name,r.network_snapshot_id,r.status,r.created_at::timestamptz::text as created_at,r.completed_at::timestamptz::text as completed_at,r.failure_code
      from simulation.run r join simulation.scenario s on s.id=r.scenario_id
      where ${after ? sql`(r.created_at,r.id)<(${after.t}::timestamptz,${after.id}::uuid)` : sql`true`}
      order by r.created_at desc,r.id desc limit ${limit + 1}
    `.execute(db)
    ).rows;
    const data = rows.slice(0, limit);
    const last = data[data.length - 1];
    const next_cursor =
      rows.length > limit && last
        ? encodeCursor('runs', last.created_at, last.simulation_run_id)
        : null;
    return { data, next_cursor };
  }

  async experiments(limitValue?: string, cursorValue?: string) {
    const limit = parseLimit(limitValue);
    const after = parseCursor(cursorValue, 'experiments');
    const columns = (
      await sql<{ name: string; udt: string }>`
      select column_name as name, udt_name as udt
      from information_schema.columns
      where table_schema='research' and table_name='experiment_run'
    `.execute(this.db)
    ).rows;
    if (!columns.length)
      return {
        data: [],
        next_cursor: null as string | null,
        availability: 'EXPERIMENT_SCHEMA_NOT_INSTALLED',
      };
    const byName = new Map(columns.map((c) => [c.name, c.udt]));
    const idColumn =
      byName.has('id') && byName.get('id') === 'uuid'
        ? 'id'
        : byName.has('experiment_run_id') &&
            byName.get('experiment_run_id') === 'uuid'
          ? 'experiment_run_id'
          : null;
    const createdColumn = byName.has('created_at') ? 'created_at' : null;
    if (!idColumn || !createdColumn)
      return {
        data: [],
        next_cursor: null as string | null,
        availability: 'EXPERIMENT_SCHEMA_UNREADABLE',
      };
    // Installed research schema without canonical id/created_at cannot be
    // paginated or time-ordered honestly; empty beats invented ordering.
    const rows = (
      await sql<{
        record: Record<string, unknown>;
        cursor_at: string;
        cursor_id: string;
      }>`
      select to_jsonb(e) as record, (e.${sql.ref(createdColumn)})::timestamptz::text as cursor_at, (e.${sql.ref(idColumn)})::text as cursor_id
      from research.experiment_run e
      where ${after ? sql`((e.${sql.ref(createdColumn)}),(e.${sql.ref(idColumn)}))<((${after.t}::timestamptz),(${after.id}::uuid))` : sql`true`}
      order by e.${sql.ref(createdColumn)} desc, e.${sql.ref(idColumn)} desc limit ${limit + 1}
    `.execute(this.db)
    ).rows;
    const last = rows[Math.min(rows.length, limit) - 1];
    return {
      data: rows.slice(0, limit).map((r) => r.record),
      next_cursor:
        rows.length > limit
          ? encodeCursor('experiments', last!.cursor_at, last!.cursor_id)
          : null,
      availability: rows.length ? 'AVAILABLE' : 'NO_RECORDED_EXPERIMENT_RUNS',
    };
  }

  // Real geometry from version-aligned tables; no synthetic metrics.
  async geometry(snapshotId: string, bbox?: string) {
    if (!uuid.test(snapshotId))
      throw new BadRequestException('snapshot_id must be a UUID.');
    const db = this.db as unknown as Kysely<unknown>;
    let box: null | ReturnType<typeof sql> = null;
    if (bbox !== undefined) {
      const parts = bbox.split(',').map((v) => Number(v.trim()));
      if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n)))
        throw new BadRequestException(
          'bbox must be minLon,minLat,maxLon,maxLat.',
        );
      const [minLon, minLat, maxLon, maxLat] = parts as [
        number,
        number,
        number,
        number,
      ];
      if (
        minLon < -180 ||
        maxLon > 180 ||
        minLat < -90 ||
        maxLat > 90 ||
        minLon >= maxLon ||
        minLat >= maxLat ||
        maxLon - minLon > 20 ||
        maxLat - minLat > 20
      )
        throw new BadRequestException(
          'bbox must be minLon,minLat,maxLon,maxLat within 20 degrees.',
        );
      box = sql`ST_MakeEnvelope(${minLon},${minLat},${maxLon},${maxLat},4326)`;
    }
    // Version-aligned: each table filtered by the snapshot's dataset_version_ids; bbox clipped.
    const q = box
      ? sql<{
          features: unknown;
          truncated: boolean;
          transit_dataset_version_id: string | null;
          spatial_dataset_version_id: string | null;
        }>`
        with snap as (select transit_dataset_version_id,spatial_dataset_version_id from twin.network_snapshot where id=${snapshotId}::uuid and status='FINALIZED'),
        f as (
          select 'stop'::text kind,s.mobility_entity_id id,s.name label,ST_AsGeoJSON(ST_Intersection(s.geom,${box}::geometry))::json feature from transit.stop s,snap where s.dataset_version_id=snap.transit_dataset_version_id and s.geom && ${box}::geometry and not ST_IsEmpty(ST_Intersection(s.geom,${box}::geometry))
          union all select 'transit_segment',t.mobility_entity_id,null,ST_AsGeoJSON(ST_Intersection(t.geom,${box}::geometry))::json from transit.transit_segment t,snap where t.dataset_version_id=snap.transit_dataset_version_id and t.geom && ${box}::geometry and not ST_IsEmpty(ST_Intersection(t.geom,${box}::geometry))
          union all select 'walking_edge',w.mobility_entity_id,null,ST_AsGeoJSON(ST_Intersection(w.geom,${box}::geometry))::json from spatial.walking_edge w,snap where w.dataset_version_id=snap.spatial_dataset_version_id and w.geom && ${box}::geometry and not ST_IsEmpty(ST_Intersection(w.geom,${box}::geometry))
          union all select 'rail_topology_edge',e.mobility_entity_id,null,ST_AsGeoJSON(ST_Intersection(e.geom,${box}::geometry))::json from spatial.rail_topology_edge e,snap where e.dataset_version_id=snap.spatial_dataset_version_id and e.geom && ${box}::geometry and not ST_IsEmpty(ST_Intersection(e.geom,${box}::geometry))
        ), bounded as (select * from f limit 5001)
        select
          coalesce((select json_agg(json_build_object('type','Feature','geometry',feature,'properties',json_build_object('kind',kind,'mobility_entity_id',id::text,'label',label))) from (select * from bounded limit 5000) q),'[]'::json) features,
          (select count(*)>5000 from bounded) truncated,
          (select transit_dataset_version_id::text from snap) transit_dataset_version_id,
          (select spatial_dataset_version_id::text from snap) spatial_dataset_version_id
      `
      : sql<{
          features: unknown;
          truncated: boolean;
          transit_dataset_version_id: string | null;
          spatial_dataset_version_id: string | null;
        }>`
        with snap as (select transit_dataset_version_id,spatial_dataset_version_id from twin.network_snapshot where id=${snapshotId}::uuid and status='FINALIZED'),
        f as (
          select 'stop'::text kind,s.mobility_entity_id id,s.name label,ST_AsGeoJSON(s.geom)::json feature from transit.stop s,snap where s.dataset_version_id=snap.transit_dataset_version_id
          union all select 'transit_segment',t.mobility_entity_id,null,ST_AsGeoJSON(t.geom)::json from transit.transit_segment t,snap where t.dataset_version_id=snap.transit_dataset_version_id
          union all select 'walking_edge',w.mobility_entity_id,null,ST_AsGeoJSON(w.geom)::json from spatial.walking_edge w,snap where w.dataset_version_id=snap.spatial_dataset_version_id
          union all select 'rail_topology_edge',e.mobility_entity_id,null,ST_AsGeoJSON(e.geom)::json from spatial.rail_topology_edge e,snap where e.dataset_version_id=snap.spatial_dataset_version_id
        ), bounded as (select * from f limit 5001)
        select
          coalesce((select json_agg(json_build_object('type','Feature','geometry',feature,'properties',json_build_object('kind',kind,'mobility_entity_id',id::text,'label',label))) from (select * from bounded limit 5000) q),'[]'::json) features,
          (select count(*)>5000 from bounded) truncated,
          (select transit_dataset_version_id::text from snap) transit_dataset_version_id,
          (select spatial_dataset_version_id::text from snap) spatial_dataset_version_id
      `;
    const row = (await q.execute(db)).rows[0];
    if (!row || row.transit_dataset_version_id === null)
      return {
        snapshot_id: snapshotId,
        features: [] as unknown[],
        truncated: false,
        coverage: 'SNAPSHOT_NOT_FOUND_OR_NOT_FINALIZED' as const,
      };
    const features = (row.features ?? []) as unknown[];
    // Never invent metrics: truncated flag is real DB count
    return {
      snapshot_id: snapshotId,
      dataset_version_ids: [
        row.transit_dataset_version_id,
        row.spatial_dataset_version_id!,
      ],
      features: (features as unknown[]).slice(0, 5000),
      truncated: Boolean(row.truncated),
    };
  }
}
