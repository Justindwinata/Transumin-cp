import type { TransitPlace } from './passenger';

export const DEMO_REPLAY = {
  label: 'Uji lokal dengan jadwal historis',
  serviceDate: '2026-10-02',
  timezone: 'Asia/Jakarta',
  departure: '2026-10-02T08:00',
  graphSha256:
    'ad9fdd3ea0308dcf033f51b43e027dd3ffa10166ef130f9512e3a9e643331574',
  origin: {
    place_id: 'demo:gambir:H00058P',
    external_id: 'H00058P',
    name: 'Gambir',
    kind: 'STOP',
    product_mode: 'TRANSJAKARTA',
    latitude: -6.174612,
    longitude: 106.8304,
    dataset_version_id: 'bf7e3650-6af7-5bee-b25a-26f763f7fe4c',
    provenance: 'OFFICIAL_TRANSJAKARTA_GTFS',
  } satisfies TransitPlace,
  destination: {
    place_id: 'demo:pejaten:H00158P',
    external_id: 'H00158P',
    name: 'Pejaten',
    kind: 'STOP',
    product_mode: 'TRANSJAKARTA',
    latitude: -6.278404,
    longitude: 106.82972,
    dataset_version_id: 'bf7e3650-6af7-5bee-b25a-26f763f7fe4c',
    provenance: 'OFFICIAL_TRANSJAKARTA_GTFS',
  } satisfies TransitPlace,
} as const;
