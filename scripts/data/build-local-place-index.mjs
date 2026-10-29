import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

export function decodeOpl(value) {
  return value.replace(/%([0-9a-fA-F]+)%/g, (_, hex) =>
    String.fromCodePoint(parseInt(hex, 16)),
  );
}

export function extractPlace(line, envelope) {
  if (!/^n\d+ /.test(line)) return null;
  const parts = line.split(' ');
  const tags = Object.fromEntries(
    (parts.find((p) => p.startsWith('T'))?.slice(1) ?? '')
      .split(',')
      .filter((p) => p.includes('='))
      .map((p) => {
        const i = p.indexOf('=');
        return [decodeOpl(p.slice(0, i)), decodeOpl(p.slice(i + 1))];
      }),
  );
  // ponytail: nodes only; polygon/relation centroids need separate geometry validation.
  if (
    tags.public_transport ||
    tags.railway ||
    tags.highway === 'bus_stop' ||
    ['bus_station', 'ferry_terminal'].includes(tags.amenity)
  )
    return null;
  if (
    ['private', 'no'].includes(tags.access) ||
    tags.disused === 'yes' ||
    tags.abandoned === 'yes'
  )
    return null;
  const longitude = Number(parts.find((p) => p.startsWith('x'))?.slice(1));
  const latitude = Number(parts.find((p) => p.startsWith('y'))?.slice(1));
  if (
    !Number.isFinite(longitude) ||
    !Number.isFinite(latitude) ||
    longitude < envelope.west ||
    longitude > envelope.east ||
    latitude < envelope.south ||
    latitude > envelope.north
  )
    return null;
  const address =
    tags['addr:full'] ||
    (tags['addr:street'] && tags['addr:housenumber']
      ? `${tags['addr:street']} ${tags['addr:housenumber']}`
      : '');
  const poi =
    tags.name &&
    ([
      'hospital',
      'clinic',
      'bank',
      'restaurant',
      'cafe',
      'school',
      'university',
      'library',
      'place_of_worship',
      'marketplace',
      'parking',
      'parking_entrance',
      'car_wash',
      'shelter',
    ].includes(tags.amenity) ||
      ['mall', 'supermarket', 'convenience', 'car'].includes(tags.shop) ||
      ['artwork', 'viewpoint', 'museum', 'attraction', 'hotel'].includes(
        tags.tourism,
      ) ||
      ['company', 'government'].includes(tags.office));
  if (!address && !poi) return null;
  const name = address
    ? [tags.name, address, tags['addr:city']].filter(Boolean).join(' · ')
    : tags.name;
  if (!name || name.length > 500 || /[\p{Cc}\p{Cf}]/u.test(name)) return null;
  return {
    externalId: `osm:${parts[0]}`,
    name,
    kind: address ? 'ADDRESS' : 'POI',
    latitude,
    longitude,
  };
}

export async function build() {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const sourceManifest = 'data/manifests/PHASE-2A-SPATIAL-SNAPSHOT.json';
  const source = JSON.parse(
    await readFile(resolve(root, sourceManifest), 'utf8'),
  );
  const input = resolve(root, source.processing.opl_path);
  const hash = createHash('sha256');
  const stream = createReadStream(input);
  stream.on('data', (chunk) => hash.update(chunk));
  const entries = [];
  for await (const line of createInterface({
    input: stream,
    crlfDelay: Infinity,
  })) {
    const place = extractPlace(line, source.study_envelope);
    if (place) entries.push(place);
  }
  if (hash.digest('hex') !== source.processing.opl_sha256)
    throw new Error('SOURCE_CHECKSUM_MISMATCH');
  if (!entries.length) throw new Error('NO_REAL_LOCAL_PLACES');
  const output = '.local/geocoder/local-places.json';
  const bytes =
    JSON.stringify({
      version: 1,
      datasetVersionId: source.dataset_version_id,
      entries,
    }) + '\n';
  const manifest = {
    version: 1,
    source_manifest: sourceManifest,
    source_opl_sha256: source.processing.opl_sha256,
    dataset_version_id: source.dataset_version_id,
    source: source.source,
    envelope: source.study_envelope,
    index_path: output,
    index_sha256: createHash('sha256').update(bytes).digest('hex'),
    counts: {
      ADDRESS: entries.filter((p) => p.kind === 'ADDRESS').length,
      POI: entries.filter((p) => p.kind === 'POI').length,
    },
    coverage:
      'Incidental non-transit OSM nodes in existing filtered spatial extract only; no comprehensive residential, business or street coverage; coordinates not independently verified. Private/no-access and transit objects excluded. Nodes only; no polygon/relation centroids.',
  };
  await mkdir(dirname(resolve(root, output)), { recursive: true });
  try {
    await writeFile(resolve(root, output), bytes, { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if ((await readFile(resolve(root, output), 'utf8')) !== bytes)
      throw new Error('EXISTING_LOCAL_INDEX_DIFFERS_REFUSING_OVERWRITE');
  }
  await writeFile(
    resolve(root, 'data/manifests/LOCAL-PLACE-INDEX.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );
  console.log(JSON.stringify(manifest, null, 2));
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await build();
