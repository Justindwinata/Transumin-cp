'use client';

import {
  CrosshairIcon,
  PauseIcon,
  PlayIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import type { Guidance } from '../lib/navigation';
import { formatDistance } from '../lib/passenger';

type Props = Readonly<{
  guidance: Guidance;
  paused: boolean;
  direction?: string;
  locationReady: boolean;
  onPause: () => void;
  onLocate: () => void;
  onReport: () => void;
}>;

/** Only supplied routing instructions are displayed; no inferred street turns. */
export function NavigationHud({
  guidance,
  paused,
  direction,
  locationReady,
  onPause,
  onLocate,
  onReport,
}: Props) {
  const tracking = guidance.progressStatus === 'TRACKING' && !paused;
  return (
    <section className="navigation-hud" aria-label="Panduan pada peta">
      <div className="navigation-hud-instruction" aria-live="polite">
        <span className="navigation-hud-label">
          {paused ? 'Panduan dijeda' : 'Tahap sekarang'}
        </span>
        <strong>
          {direction && (
            <span className="navigation-turn-symbol" aria-hidden="true">
              {(
                {
                  LEFT: '↰',
                  RIGHT: '↱',
                  SLIGHTLY_LEFT: '↖',
                  SLIGHTLY_RIGHT: '↗',
                  CONTINUE: '↑',
                  DEPART: '↑',
                  HARD_LEFT: '↰',
                  HARD_RIGHT: '↱',
                  UTURN_LEFT: '↶',
                  UTURN_RIGHT: '↷',
                } as Record<string, string>
              )[direction] ?? ''}
            </span>
          )}
          <span data-navigation-instruction>{guidance.title}</span>
        </strong>
        {guidance.destination && (
          <span>Tujuan tahap: {guidance.destination}</span>
        )}
        {guidance.nextInstruction && guidance.nextDistanceMeters !== null && (
          <p>
            {tracking ? 'Sekitar' : 'Dari awal tahap, sekitar'}{' '}
            {formatDistance(guidance.nextDistanceMeters)}:{' '}
            {guidance.nextInstruction}
          </p>
        )}
        <small>
          {!locationReady
            ? 'GPS belum akurat · ikuti petunjuk secara manual.'
            : 'Perhatikan kondisi jalan dan rambu.'}
        </small>
      </div>
      <div className="navigation-hud-actions">
        <button
          type="button"
          onClick={onLocate}
          aria-label="Pusatkan lokasi saya"
          title="Pusatkan lokasi saya"
        >
          <CrosshairIcon size={23} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onPause}
          aria-label={paused ? 'Lanjutkan panduan' : 'Jeda panduan'}
          title={paused ? 'Lanjutkan panduan' : 'Jeda panduan'}
        >
          {paused ? (
            <PlayIcon size={23} aria-hidden="true" />
          ) : (
            <PauseIcon size={23} aria-hidden="true" />
          )}
        </button>
        <button type="button" onClick={onReport}>
          <WarningCircleIcon size={23} aria-hidden="true" /> Ada masalah
        </button>
      </div>
    </section>
  );
}
