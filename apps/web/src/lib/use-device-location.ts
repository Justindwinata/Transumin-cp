'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  GPS_STATE,
  GPS_STALE_MS,
  gpsAccuracyTier,
  gpsNavigationReady,
  gpsErrorState,
  gpsNext,
  type GpsAccuracyTier,
  type GpsSample,
  type GpsState,
} from './device-location';

export type DeviceLocation = Readonly<{
  position: GpsSample | null;
  /** Tier of the retained fix; drives whether it may touch navigation logic. */
  accuracyTier: GpsAccuracyTier;
  /** True only when the fix is fresh and accurate enough for navigation. */
  navigationGrade: boolean;
  state: GpsState;
  start: () => void;
  stop: () => void;
  retry: () => void;
}>;

const OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 10_000,
  maximumAge: 0,
};

/** Device GPS: watch starts only after explicit start(); resume on visibility only if user opted. */
export function useDeviceLocation(): DeviceLocation {
  const [position, setPosition] = useState<GpsSample | null>(null);
  const [state, setState] = useState<GpsState>(GPS_STATE.GPS_OFF);
  const watchId = useRef<number | null>(null);
  const optedIn = useRef(false);
  const latest = useRef<GpsSample | null>(null);
  const generation = useRef(0);

  const clearWatch = useCallback(() => {
    generation.current += 1;
    if (watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
  }, []);

  const start = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setState(GPS_STATE.GPS_UNAVAILABLE);
      return;
    }
    if (watchId.current !== null) return;
    optedIn.current = true;
    const current = generation.current;
    setState(GPS_STATE.GPS_REQUESTING_PERMISSION);
    try {
      watchId.current = navigator.geolocation.watchPosition(
        ({ coords, timestamp }) => {
          if (generation.current !== current) return;
          const result = gpsNext(latest.current, {
            latitude: coords.latitude,
            longitude: coords.longitude,
            accuracy: Number.isFinite(coords.accuracy) ? coords.accuracy : null,
            heading: Number.isFinite(coords.heading) ? coords.heading : null,
            timestamp,
          });
          if (result.sample !== latest.current) {
            latest.current = result.sample;
            setPosition(result.sample);
          }
          setState(result.state);
        },
        (error) => {
          if (generation.current !== current) return;
          if (error.code === 1) {
            clearWatch();
            optedIn.current = false;
            latest.current = null;
            setPosition(null);
          }
          // Timeout/unavailable are transient watch errors. Keep the watch so
          // a later device fix can recover without reload or another permission.
          setState(gpsErrorState(error.code));
        },
        OPTIONS,
      );
    } catch {
      clearWatch();
      setState(GPS_STATE.GPS_ERROR);
    }
  }, [clearWatch]);

  const retry = useCallback(() => {
    clearWatch();
    start();
  }, [clearWatch, start]);

  const stop = useCallback(() => {
    optedIn.current = false;
    clearWatch();
    latest.current = null;
    setPosition(null);
    setState(GPS_STATE.GPS_STOPPED);
  }, [clearWatch]);

  useEffect(() => {
    const onVisibility = () => {
      if (!optedIn.current) return;
      if (document.visibilityState === 'hidden') {
        // Keep the user's opt-in, but stop watching in background.
        clearWatch();
        setState(GPS_STATE.GPS_STALE);
      } else if (watchId.current === null) {
        start();
      }
    };
    const staleTick = () => {
      if (watchId.current === null) return;
      if (
        latest.current &&
        Date.now() - latest.current.timestamp >= GPS_STALE_MS
      )
        setState(GPS_STATE.GPS_STALE);
    };
    document.addEventListener('visibilitychange', onVisibility);
    const stale = setInterval(staleTick, 1000);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      clearInterval(stale);
      optedIn.current = false;
      clearWatch();
    };
  }, [clearWatch, start]);

  return {
    position,
    state,
    accuracyTier: gpsAccuracyTier(position?.accuracy ?? null),
    navigationGrade: gpsNavigationReady(position, state),
    start,
    stop,
    retry,
  } as const;
}
