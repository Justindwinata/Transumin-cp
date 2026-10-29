import type {
  EffectiveMobilityState,
  MobilityStateHistoryRecord,
  NetworkSnapshot,
  PersistedOperationalObservation,
  SnapshotCreationInput,
} from '../domain/mobility-twin.js';
import type { OperationalObservation } from '../../operational-data/domain/operational-data.js';

export const MOBILITY_STATE_PORT = Symbol('MOBILITY_STATE_PORT');

export type PersistObservationResult = Readonly<{
  observationId: string;
  status: 'INSERTED' | 'ALREADY_PERSISTED';
}>;

export type MobilityEntityView = Readonly<{
  mobilityEntityId: string;
  entityType: string;
  state: EffectiveMobilityState;
}>;

export interface MobilityStatePort {
  persistObservation(
    observation: OperationalObservation,
    mobilityEntityId?: string | null,
  ): Promise<PersistObservationResult>;
  projectState(entityId: string, asOf: Date): Promise<EffectiveMobilityState>;
  projectStates(
    entityIds: readonly string[],
    asOf: Date,
  ): Promise<readonly EffectiveMobilityState[]>;
  getCurrentState(entityId: string): Promise<EffectiveMobilityState>;
  getStates(
    entityIds: readonly string[],
  ): Promise<readonly EffectiveMobilityState[]>;
  getEntity(entityId: string): Promise<MobilityEntityView>;
  getSnapshotStates(
    snapshotId: string,
    entityIds?: readonly string[],
  ): Promise<readonly EffectiveMobilityState[]>;
  getStateHistory(
    entityId: string,
    from?: Date,
    to?: Date,
  ): Promise<readonly MobilityStateHistoryRecord[]>;
  createSnapshot(input: SnapshotCreationInput): Promise<NetworkSnapshot>;
  getSnapshot(snapshotId: string): Promise<NetworkSnapshot>;
  replayState(entityId: string, asOf: Date): Promise<EffectiveMobilityState>;
  replayStates(
    entityIds: readonly string[],
    asOf: Date,
  ): Promise<readonly EffectiveMobilityState[]>;
}

export type ObservationStoreRecord = PersistedOperationalObservation;
