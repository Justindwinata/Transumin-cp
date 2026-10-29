import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';

export function GET() {
  const networkSnapshotId = process.env.PASSENGER_NETWORK_SNAPSHOT_ID;
  if (!networkSnapshotId || !/^[0-9a-f-]{36}$/i.test(networkSnapshotId)) {
    return NextResponse.json(
      {
        error: {
          code: 'DATASET_NOT_READY',
          message: 'Passenger routing snapshot is not configured.',
          request_id: randomUUID(),
        },
      },
      { status: 503 },
    );
  }
  return NextResponse.json(
    {
      data: { network_snapshot_id: networkSnapshotId },
      meta: { request_id: randomUUID(), warnings: [] },
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
