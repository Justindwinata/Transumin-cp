import { readFile } from 'node:fs/promises';

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

import {
  makeMonotonicTimes,
  type ExactRoutingTrip,
} from '../domain/controlled-routing.js';

export interface KrlGapekaParseResult {
  readonly trips: readonly ExactRoutingTrip[];
  readonly stationCodes: readonly string[];
  readonly rejectedRows: readonly string[];
  readonly ignoredOutsideStationGridCells: readonly string[];
  readonly pageCount: number;
}

export interface PositionedText {
  readonly text: string;
  readonly x: number;
  readonly y: number;
}

interface ParsedPage {
  readonly header: readonly PositionedText[];
  readonly rows: readonly PositionedText[][];
}

function groupRows(
  items: readonly PositionedText[],
): readonly PositionedText[][] {
  const rows: Array<{ baseline: number; items: PositionedText[] }> = [];
  for (const item of [...items].sort((left, right) => right.y - left.y)) {
    // The PDF uses slightly different font baselines within the same visual
    // row (up to about 0.36 points), while adjacent rows are about 4 points
    // apart. A 0.6-point cluster retains source column alignment safely.
    const existing = rows.find((row) => Math.abs(row.baseline - item.y) <= 0.6);
    if (existing === undefined) rows.push({ baseline: item.y, items: [item] });
    else existing.items.push(item);
  }
  return rows.map((row) => row.items.sort((left, right) => left.x - right.x));
}

async function extractPages(filePath: string): Promise<readonly ParsedPage[]> {
  const bytes = new Uint8Array(await readFile(filePath));
  const document = await getDocument({ data: bytes }).promise;
  const pages: ParsedPage[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const items: PositionedText[] = [];
    for (const item of content.items) {
      if (!('str' in item) || item.str.trim().length === 0) continue;
      items.push({
        text: item.str.trim(),
        x: item.transform[4],
        y: item.transform[5],
      });
    }
    const rows = groupRows(items);
    const header = rows
      .map((row) => row.filter((item) => /^[A-Z]{2,4}$/.test(item.text)))
      .sort((left, right) => right.length - left.length)[0];
    if (header === undefined || header.length < 2)
      throw new Error(`KRL page ${pageNumber}: station header not found`);
    pages.push({ header, rows });
  }
  return pages;
}

function nearestStation(
  header: readonly PositionedText[],
  timeCell: PositionedText,
): string | null {
  const nearest = [...header].sort(
    (left, right) =>
      Math.abs(left.x - timeCell.x) - Math.abs(right.x - timeCell.x),
  )[0];
  return nearest !== undefined && Math.abs(nearest.x - timeCell.x) <= 5
    ? nearest.text
    : null;
}

export async function parseKrlGapekaPdf(
  filePath: string,
): Promise<KrlGapekaParseResult> {
  const pages = await extractPages(filePath);
  const trips: ExactRoutingTrip[] = [];
  const rejectedRows: string[] = [];
  const ignoredOutsideStationGridCells: string[] = [];
  const stationCodes = new Set<string>();

  for (const [pageIndex, page] of pages.entries()) {
    const parsed = parseKrlPositionedRows(
      page.header,
      page.rows,
      pageIndex + 1,
    );
    trips.push(...parsed.trips);
    rejectedRows.push(...parsed.rejectedRows);
    ignoredOutsideStationGridCells.push(
      ...parsed.ignoredOutsideStationGridCells,
    );
    parsed.stationCodes.forEach((code) => stationCodes.add(code));
  }

  return {
    trips,
    stationCodes: [...stationCodes].sort(),
    rejectedRows,
    ignoredOutsideStationGridCells,
    pageCount: pages.length,
  };
}

export function parseKrlPositionedRows(
  header: readonly PositionedText[],
  rows: readonly (readonly PositionedText[])[],
  pageNumber = 1,
): KrlGapekaParseResult {
  const trips: ExactRoutingTrip[] = [];
  const rejectedRows: string[] = [];
  const ignoredOutsideStationGridCells: string[] = [];
  const stationCodes = new Set<string>();
  for (const row of rows) {
    const services = row.filter((item) => /^\d{4}[A-Z]?$/.test(item.text));
    for (const [serviceIndex, service] of services.entries()) {
      const segmentEnd =
        services[serviceIndex + 1]?.x ?? Number.POSITIVE_INFINITY;
      const segment = row.filter(
        (item) => item.x > service.x && item.x < segmentEnd,
      );
      const sourceRelation = segment.find((item) =>
        /^[A-Za-z]+-[A-Za-z]+$/.test(item.text),
      );
      const cells = segment.filter((item) =>
        /^(?:[0-4]\d:[0-5]\d|Ls)$/.test(item.text),
      );
      if (cells.length < 2) {
        rejectedRows.push(
          `page=${pageNumber};service=${service.text};reason=NO_TIMES`,
        );
        continue;
      }
      const maximumStationX = Math.max(...header.map((item) => item.x));
      const mappedCells = cells.map((cell) => ({
        cell,
        code: nearestStation(header, cell),
      }));
      const outsideTrailingGrid = mappedCells.filter(
        ({ cell, code }) => code === null && cell.x > maximumStationX + 5,
      );
      for (const { cell } of outsideTrailingGrid)
        ignoredOutsideStationGridCells.push(
          `page=${pageNumber};service=${service.text};value=${cell.text};reason=OUTSIDE_STATION_GRID`,
        );
      const stationCells = mappedCells.filter(
        ({ cell, code }) => code !== null || cell.x <= maximumStationX + 5,
      );
      const codes = stationCells.map(({ code }) => code);
      if (codes.some((code) => code === null)) {
        rejectedRows.push(
          `page=${pageNumber};service=${service.text};reason=STATION_ALIGNMENT`,
        );
        continue;
      }
      const resolvedCodes = codes as readonly string[];
      resolvedCodes.forEach((code) => stationCodes.add(code));
      const normalizedTimes = makeMonotonicTimes(
        stationCells.map(({ cell }) => (cell.text === 'Ls' ? null : cell.text)),
      );
      trips.push({
        serviceId: service.text,
        relation:
          sourceRelation?.text ??
          `${resolvedCodes[0]}-${resolvedCodes.at(-1) ?? resolvedCodes[0]}`,
        serviceCalendar: service.text.endsWith('F') ? 'WEEKDAY' : 'DAILY',
        stopTimes: resolvedCodes.map((code, index) => ({
          stopId: code,
          timeSeconds: normalizedTimes[index] ?? null,
          passThrough: stationCells[index]?.cell.text === 'Ls',
        })),
      });
    }
  }
  return {
    trips,
    stationCodes: [...stationCodes].sort(),
    rejectedRows,
    ignoredOutsideStationGridCells,
    pageCount: 1,
  };
}
