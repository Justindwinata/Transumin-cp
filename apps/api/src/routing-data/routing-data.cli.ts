import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseClockTime,
  validateControlledRoutingRepresentation,
  type ControlledRoutingRepresentation,
  type FrequencyRoutingPattern,
  type FrequencyWindow,
  type RoutingMode,
  type RoutingStop,
} from './domain/controlled-routing.js';
import { parseKrlGapekaPdf } from './sources/krl-gapeka.js';
import {
  medianHeadwaySeconds,
  parseLrtJabodebekTimetableHtml,
} from './sources/lrt-jabodebek.js';

const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const defaultInputPath = path.join(
  repositoryRoot,
  'data/registry/phase4ar-controlled-routing-config.json',
);
const outputPath = path.join(
  repositoryRoot,
  'data/processed/routing/phase4ar/controlled-routing-snapshot.json',
);

interface SourceArtifact {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
}

interface LocalStop extends RoutingStop {
  readonly aliases?: readonly string[];
}

interface LocalPattern {
  readonly id: string;
  readonly direction: string;
  readonly stops: readonly LocalStop[];
  readonly endToEndMinutes: number;
  readonly windows?: readonly {
    serviceCalendar: FrequencyWindow['serviceCalendar'];
    start: string;
    end: string;
    headwayMinutes: number;
  }[];
  readonly departureSourceStation?: string;
}

interface FrequencyInput {
  readonly mode: Exclude<RoutingMode, 'KRL'>;
  readonly sourceId: string;
  readonly sourceRetrievedAt: string;
  readonly sourceArtifact?: SourceArtifact;
  readonly sourceFactChecksum: string;
  readonly expectedStationNames?: readonly string[];
  readonly patterns: readonly LocalPattern[];
}

interface ControlledInput {
  readonly schemaVersion: 1;
  readonly snapshotCreatedAt: string;
  readonly krl: {
    readonly sourceId: string;
    readonly sourceUrl: string;
    readonly sourceRetrievedAt: string;
    readonly sourceEffectiveFrom: string;
    readonly sourceEffectiveTo?: string;
    readonly sourceArtifact: SourceArtifact;
    readonly stationNames: Readonly<Record<string, string>>;
  };
  readonly lrtJabodebekTimetable: SourceArtifact;
  readonly frequencyModes: readonly FrequencyInput[];
}

async function sha256(filePath: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(filePath))
    .digest('hex');
}

function sha256Text(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function assertArtifact(artifact: SourceArtifact): Promise<string> {
  const filePath = path.join(repositoryRoot, artifact.path);
  const metadata = await stat(filePath);
  if (metadata.size !== artifact.bytes)
    throw new Error(`${artifact.path}: byte size mismatch`);
  if ((await sha256(filePath)) !== artifact.sha256)
    throw new Error(`${artifact.path}: SHA-256 mismatch`);
  return filePath;
}

function explicitWindows(pattern: LocalPattern): readonly FrequencyWindow[] {
  return (pattern.windows ?? []).map((window) => ({
    serviceCalendar: window.serviceCalendar,
    startSeconds: parseClockTime(window.start),
    endSeconds: parseClockTime(window.end),
    headwaySeconds: window.headwayMinutes * 60,
  }));
}

function derivedWindows(
  pattern: LocalPattern,
  departures: ReturnType<
    typeof parseLrtJabodebekTimetableHtml
  >['departureSets'],
): readonly FrequencyWindow[] {
  if (pattern.departureSourceStation === undefined)
    return explicitWindows(pattern);
  const normalized = pattern.departureSourceStation.toLocaleLowerCase('id-ID');
  const matches = departures.filter(
    (set) => set.stationName.toLocaleLowerCase('id-ID') === normalized,
  );
  return matches.flatMap((set) => {
    const headway = medianHeadwaySeconds(set.departures);
    const start = set.departures[0];
    const end = set.departures.at(-1);
    if (headway === null || start === undefined || end === undefined) return [];
    return [
      {
        serviceCalendar:
          set.serviceCalendar === 'WEEKDAY'
            ? ('WEEKDAY' as const)
            : ('WEEKEND' as const),
        startSeconds: start,
        endSeconds: end + headway,
        headwaySeconds: headway,
      },
    ];
  });
}

function frequencyRepresentation(
  input: FrequencyInput,
  parsedLrt: ReturnType<typeof parseLrtJabodebekTimetableHtml>,
): ControlledRoutingRepresentation {
  const patterns: FrequencyRoutingPattern[] = input.patterns.map((pattern) => ({
    id: pattern.id,
    direction: pattern.direction,
    stops: pattern.stops.map(({ id, name, boardingAllowed }) => ({
      id,
      name,
      ...(boardingAllowed === undefined ? {} : { boardingAllowed }),
    })),
    endToEndSeconds: pattern.endToEndMinutes * 60,
    windows:
      input.mode === 'LRT_JABODEBEK'
        ? derivedWindows(pattern, parsedLrt.departureSets)
        : explicitWindows(pattern),
    travelTimeBasis: 'OFFICIAL_END_TO_END_WITH_UNIFORM_INTERPOLATION',
  }));
  return {
    mode: input.mode,
    sourceId: input.sourceId,
    sourceChecksum: input.sourceArtifact?.sha256 ?? input.sourceFactChecksum,
    sourceRetrievedAt: input.sourceRetrievedAt,
    precision: 'FREQUENCY_DERIVED',
    frequencyPatterns: patterns,
  };
}

async function main(): Promise<void> {
  if (process.argv[2] !== 'verify') throw new Error('Expected command: verify');
  const inputPath = process.env.ROUTING_RESEARCH_INPUT ?? defaultInputPath;
  const input = JSON.parse(
    await readFile(inputPath, 'utf8'),
  ) as ControlledInput;
  if (input.schemaVersion !== 1)
    throw new Error('Unsupported controlled input version');

  const krlPath = await assertArtifact(input.krl.sourceArtifact);
  const lrtTimetablePath = await assertArtifact(input.lrtJabodebekTimetable);
  for (const mode of input.frequencyModes) {
    if (mode.sourceArtifact !== undefined) {
      await assertArtifact(mode.sourceArtifact);
    } else if (
      sha256Text(JSON.stringify(mode.patterns)) !== mode.sourceFactChecksum
    ) {
      throw new Error(`${mode.mode}: tracked source-fact checksum mismatch`);
    }
  }

  const krl = await parseKrlGapekaPdf(krlPath);
  const unmappedKrlCodes = krl.stationCodes.filter(
    (code) => input.krl.stationNames[code] === undefined,
  );
  if (unmappedKrlCodes.length > 0)
    throw new Error(
      `Unmapped KRL station codes: ${unmappedKrlCodes.join(', ')}`,
    );
  if (krl.rejectedRows.length > 0)
    throw new Error(
      `Rejected KRL rows: ${krl.rejectedRows.slice(0, 5).join('; ')}`,
    );

  const lrtJabodebek = parseLrtJabodebekTimetableHtml(
    await readFile(lrtTimetablePath, 'utf8'),
  );
  if (lrtJabodebek.errors.length > 0)
    throw new Error(
      `LRT Jabodebek validation: ${lrtJabodebek.errors.join('; ')}`,
    );

  const representations: ControlledRoutingRepresentation[] = [
    {
      mode: 'KRL',
      sourceId: input.krl.sourceId,
      sourceChecksum: input.krl.sourceArtifact.sha256,
      sourceRetrievedAt: input.krl.sourceRetrievedAt,
      sourceApplicability: {
        timezone: 'Asia/Jakarta',
        effectiveFrom: input.krl.sourceEffectiveFrom,
        ...(input.krl.sourceEffectiveTo === undefined
          ? {}
          : { effectiveTo: input.krl.sourceEffectiveTo }),
        sourceUrl: input.krl.sourceUrl,
      },
      precision: 'EXACT_SCHEDULE',
      exactTrips: krl.trips,
    },
    ...input.frequencyModes.map((mode) =>
      frequencyRepresentation(mode, lrtJabodebek),
    ),
  ];
  const validations = representations.map((representation) => ({
    mode: representation.mode,
    ...validateControlledRoutingRepresentation(representation),
  }));
  if (validations.some((validation) => !validation.valid))
    throw new Error(
      validations
        .filter((validation) => !validation.valid)
        .map(
          (validation) => `${validation.mode}: ${validation.errors.join('; ')}`,
        )
        .join('\n'),
    );

  const output = {
    schemaVersion: 1,
    generatedAt: input.snapshotCreatedAt,
    handling: 'LOCAL_NONCOMMERCIAL_RESEARCH_ONLY_NO_REDISTRIBUTION',
    inputChecksum: await sha256(inputPath),
    representations,
    validation: {
      krlPageCount: krl.pageCount,
      krlStationCodeCount: krl.stationCodes.length,
      krlIgnoredOutsideStationGridCells: krl.ignoredOutsideStationGridCells,
      lrtJabodebekStationCount: lrtJabodebek.stationNames.length,
      lrtJabodebekDisplayedTimeCount: lrtJabodebek.displayedTimeCount,
      modes: validations,
    },
  };
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, {
    mode: 0o600,
  });
  process.stdout.write(
    `${JSON.stringify({
      status: 'VERIFIED_LOCAL_RESEARCH_SNAPSHOT',
      output: path.relative(repositoryRoot, outputPath),
      outputSha256: await sha256(outputPath),
      inputSha256: output.inputChecksum,
      validations,
      sourceCounts: output.validation,
    })}\n`,
  );
}

await main();
