import { makeMonotonicTimes } from '../domain/controlled-routing.js';

export interface StationDepartureSet {
  readonly stationSlug: string;
  readonly stationName: string;
  readonly serviceCalendar: 'WEEKDAY' | 'WEEKEND';
  readonly departures: readonly number[];
}

export interface LrtJabodebekParseResult {
  readonly stationNames: readonly string[];
  readonly departureSets: readonly StationDepartureSet[];
  readonly displayedTimeCount: number;
  readonly errors: readonly string[];
}

function stripTags(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseLrtJabodebekTimetableHtml(
  html: string,
): LrtJabodebekParseResult {
  const stationNames = new Map<string, string>();
  for (const match of html.matchAll(
    /id="pills-([a-z0-9-]+)-tab"[\s\S]*?aria-selected="true">([\s\S]*?)<\/button>/g,
  )) {
    stationNames.set(String(match[1]), stripTags(String(match[2])));
  }

  const paneStarts = [
    ...html.matchAll(
      /<div class="tab-pane fade[^"]*"\s+id="pills-([a-z0-9-]+)"/g,
    ),
  ];
  const departureSets: StationDepartureSet[] = [];
  const errors: string[] = [];
  for (const [index, match] of paneStarts.entries()) {
    const slug = String(match[1]);
    const name = stationNames.get(slug);
    if (name === undefined) continue;
    const start = match.index ?? 0;
    const end = paneStarts[index + 1]?.index ?? html.length;
    const section = html.slice(start, end);
    const weekdayHeading = section.indexOf('Jam Keberangkatan Hari Biasa');
    const weekendHeading = section.indexOf('Jam Keberangkatan Hari Libur');
    if (weekdayHeading < 0 || weekendHeading < 0) {
      errors.push(`${slug}: missing weekday/weekend headings`);
      continue;
    }
    const slices: Array<{
      calendar: 'WEEKDAY' | 'WEEKEND';
      text: string;
    }> = [
      {
        calendar: 'WEEKDAY',
        text: section.slice(weekdayHeading, weekendHeading),
      },
      { calendar: 'WEEKEND', text: section.slice(weekendHeading) },
    ];
    for (const slice of slices) {
      const clockValues = [
        ...slice.text.matchAll(/<small>(\d{2}:\d{2})<\/small>/g),
      ].map((time) => String(time[1]));
      const departures = makeMonotonicTimes(clockValues).filter(
        (value): value is number => value !== null,
      );
      if (departures.length === 0)
        errors.push(`${slug}:${slice.calendar}: no departures`);
      if (
        departures.some(
          (value, position) =>
            position > 0 && value < (departures[position - 1] ?? 0),
        )
      )
        errors.push(`${slug}:${slice.calendar}: departures are not ordered`);
      departureSets.push({
        stationSlug: slug,
        stationName: name,
        serviceCalendar: slice.calendar,
        departures,
      });
    }
  }

  return {
    stationNames: [...stationNames.values()],
    departureSets,
    displayedTimeCount: departureSets.reduce(
      (sum, set) => sum + set.departures.length,
      0,
    ),
    errors,
  };
}

export function medianHeadwaySeconds(
  departures: readonly number[],
): number | null {
  if (departures.length < 2) return null;
  const intervals = departures
    .slice(1)
    .map((value, index) => value - Number(departures[index]))
    .filter((value) => value > 0)
    .sort((left, right) => left - right);
  if (intervals.length === 0) return null;
  return Number(intervals[Math.floor(intervals.length / 2)]);
}
