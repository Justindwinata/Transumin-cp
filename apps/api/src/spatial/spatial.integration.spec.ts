import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';

import { getDatabaseConfig } from '../infrastructure/database/database.config.js';
import type { FoundationDatabase } from '../infrastructure/database/database.constants.js';
import { assertInvocationScratchDatabase } from '../infrastructure/database/scratch.guard.js';

describe('Phase 2A PostGIS spatial contracts', () => {
  const pool = new Pool(getDatabaseConfig());
  const database = new Kysely<FoundationDatabase>({
    dialect: new PostgresDialect({ pool }),
  });

  before(async () => {
    await assertInvocationScratchDatabase(database);
    await pool.query('select 1 from spatial.network_node limit 1');
  });
  after(async () => database.destroy());

  it('enforces real node FKs, SRID 4326, scoped references, and ambiguous aliases', async () => {
    const client = await pool.connect();
    const sourceId = randomUUID();
    const versionId = randomUUID();
    const nodeA = randomUUID();
    const nodeB = randomUUID();
    const edgeEntity = randomUUID();
    const invalidEdgeEntity = randomUUID();
    const entityA = randomUUID();
    const entityB = randomUUID();
    try {
      await client.query('begin');
      await client.query(
        `insert into meta.dataset_source (id,source_key,name,provider,source_type,verification_status) values ($1,$2,'fixture','fixture','OSM_PBF','VERIFIED')`,
        [sourceId, `phase2a-test-${sourceId}`],
      );
      await client.query(
        `insert into meta.dataset_version (id,source_id,version_label,checksum_sha256,retrieved_at,raw_path_ref,manifest_path,validation_status) values ($1,$2,'fixture','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',now(),'fixture','fixture','VALID')`,
        [versionId, sourceId],
      );
      await client.query(
        `insert into spatial.network_node (id,dataset_version_id,external_id,node_kind,geom) values ($1,$3,'1','PEDESTRIAN',ST_SetSRID(ST_MakePoint(106.8,-6.2),4326)),($2,$3,'2','PEDESTRIAN',ST_SetSRID(ST_MakePoint(106.801,-6.2),4326))`,
        [nodeA, nodeB, versionId],
      );
      await client.query(
        `insert into twin.mobility_entity (id,entity_type,creation_dataset_version_id) values ($1,'WALKING_EDGE',$5),($2,'WALKING_EDGE',$5),($3,'STATION',$5),($4,'STATION',$5)`,
        [edgeEntity, invalidEdgeEntity, entityA, entityB, versionId],
      );
      await client.query(
        `insert into spatial.walking_edge (id,mobility_entity_id,dataset_version_id,from_node_id,to_node_id,source_way_id,segment_sequence,direction,length_m,access_classification,highway_class,geom) values ($1,$2,$3,$4,$5,'10',0,'FORWARD',110,'ALLOWED','footway',ST_GeomFromText('LINESTRING(106.8 -6.2,106.801 -6.2)',4326))`,
        [randomUUID(), edgeEntity, versionId, nodeA, nodeB],
      );
      const geometry = await client.query<{ srid: number; valid: boolean }>(
        `select ST_SRID(geom) srid, ST_IsValid(geom) valid from spatial.walking_edge where mobility_entity_id=$1`,
        [edgeEntity],
      );
      assert.deepEqual(geometry.rows[0], { srid: 4326, valid: true });

      await client.query(
        `insert into meta.source_entity_reference (id,source_key,operator_key,source_dataset_version_id,external_reference,reference_type,canonical_entity_id,provenance_ref) values ($1,'fixture','A',$5,'ST01','OFFICIAL_ID',$3,'fixture'),($2,'fixture','B',$5,'ST01','OFFICIAL_ID',$4,'fixture')`,
        [randomUUID(), randomUUID(), entityA, entityB, versionId],
      );
      const scoped = await client.query<{
        operatorKey: string;
        entityId: string;
      }>(
        `select operator_key "operatorKey", canonical_entity_id "entityId" from meta.source_entity_reference where source_key='fixture' and external_reference='ST01' order by operator_key`,
      );
      assert.deepEqual(scoped.rows, [
        { operatorKey: 'A', entityId: entityA },
        { operatorKey: 'B', entityId: entityB },
      ]);
      await client.query(
        `insert into meta.entity_alias (id,source_key,operator_key,source_dataset_version_id,alias,normalized_alias,canonical_entity_id,alias_type,provenance_ref) values ($1,'fixture','A',$5,'Central','central',$3,'CANONICAL_NAME','fixture'),($2,'fixture','A',$5,'Central','central',$4,'CANONICAL_NAME','fixture')`,
        [randomUUID(), randomUUID(), entityA, entityB, versionId],
      );
      const ambiguity = await client.query<{ count: number }>(
        `select count(distinct canonical_entity_id)::int count from meta.entity_alias where source_key='fixture' and operator_key='A' and normalized_alias='central'`,
      );
      assert.equal(ambiguity.rows[0]?.count, 2);

      await client.query('savepoint invalid_fk');
      await assert.rejects(
        client.query(
          `insert into spatial.walking_edge (id,mobility_entity_id,dataset_version_id,from_node_id,to_node_id,source_way_id,segment_sequence,direction,length_m,access_classification,highway_class,geom) values ($1,$2,$3,$4,$5,'11',0,'FORWARD',1,'ALLOWED','footway',ST_GeomFromText('LINESTRING(106.8 -6.2,106.801 -6.2)',4326))`,
          [randomUUID(), invalidEdgeEntity, versionId, nodeA, randomUUID()],
        ),
      );
      await client.query('rollback to savepoint invalid_fk');
      await client.query('rollback');
    } finally {
      await client.query('rollback').catch(() => undefined);
      client.release();
    }
  });

  it('rolls failed spatial writes back atomically', async () => {
    const client = await pool.connect();
    const sourceId = randomUUID();
    try {
      await client.query('begin');
      await client.query(
        `insert into meta.dataset_source (id,source_key,name,provider,source_type,verification_status) values ($1,$2,'fixture','fixture','OSM_PBF','VERIFIED')`,
        [sourceId, `rollback-${sourceId}`],
      );
      await client.query('rollback');
      const result = await pool.query<{ count: number }>(
        'select count(*)::int count from meta.dataset_source where id=$1',
        [sourceId],
      );
      assert.equal(result.rows[0]?.count, 0);
    } finally {
      await client.query('rollback').catch(() => undefined);
      client.release();
    }
  });
});
