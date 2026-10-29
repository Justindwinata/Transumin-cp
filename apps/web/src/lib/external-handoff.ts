import {
  gpsNavigationReady,
  type GpsSample,
  type GpsState,
} from './device-location.ts';

export type HandoffDestination = Readonly<{
  name: string;
  latitude?: number | null;
  longitude?: number | null;
}>;

// Provider availability, fare and booking are unknown. These are choices for
// deliberate manual handoff, never routed legs or automatically sent positions.
export const EXTERNAL_PROVIDERS = [
  { name: 'Gojek', href: 'https://www.gojek.com/' },
  { name: 'Grab', href: 'https://www.grab.com/' },
  { name: 'Bluebird', href: 'https://www.bluebirdgroup.com/' },
] as const;

export function handoffDestinationText(
  destination: HandoffDestination,
): string {
  const { latitude, longitude } = destination;
  const coordinates =
    typeof latitude === 'number' &&
    Number.isFinite(latitude) &&
    Math.abs(latitude) <= 90 &&
    typeof longitude === 'number' &&
    Number.isFinite(longitude) &&
    Math.abs(longitude) <= 180
      ? ` (${latitude}, ${longitude})`
      : '';
  return `Tujuan Transum-In: ${destination.name}${coordinates}`;
}

export function handoffPickupText(
  position: GpsSample | null,
  state: GpsState,
  now = Date.now(),
): string | null {
  if (!gpsNavigationReady(position, state, now)) return null;
  return `Titik jemput dari lokasi perangkat: ${position.latitude}, ${position.longitude} (akurasi ±${Math.round(position.accuracy!)} m). Pastikan titik jemput aman dan sesuai di aplikasi penyedia.`;
}
