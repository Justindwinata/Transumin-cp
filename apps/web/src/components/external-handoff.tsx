'use client';

import { useState } from 'react';
import Image from 'next/image';
import {
  EXTERNAL_PROVIDERS,
  handoffDestinationText,
  handoffPickupText,
  type HandoffDestination,
} from '../lib/external-handoff';
import type { DeviceLocation } from '../lib/use-device-location';

export function ExternalHandoff({
  destination,
  device,
}: {
  destination: HandoffDestination;
  device: DeviceLocation;
}) {
  const [message, setMessage] = useState('');
  const [manualText, setManualText] = useState('');
  const pickup = handoffPickupText(device.position, device.state);
  async function copy(kind: 'destination' | 'pickup' | 'trip') {
    // Recheck at the click: a fix may have expired since the last render.
    const currentPickup = handoffPickupText(device.position, device.state);
    if (kind === 'pickup' && !currentPickup) {
      setMessage(
        'Lokasi belum cukup akurat atau sudah kedaluwarsa. Tentukan titik jemput secara manual.',
      );
      return;
    }
    const target = handoffDestinationText(destination);
    const text =
      kind === 'destination'
        ? target
        : kind === 'pickup'
          ? currentPickup!
          : `${currentPickup ?? 'Titik jemput belum tersedia; tentukan secara manual di aplikasi penyedia.'}\n${target}`;
    try {
      if (!navigator.clipboard?.writeText)
        throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(text);
      setManualText('');
      setMessage(
        `Disalin: ${kind === 'destination' ? destination.name : 'detail perjalanan'}. Tempelkan di aplikasi penyedia.`,
      );
    } catch {
      setManualText(text);
      setMessage(
        'Penyalinan diblokir perangkat. Pilih dan salin detail berikut secara manual.',
      );
    }
  }
  return (
    <section
      className="external-handoff"
      aria-label="Lanjutkan dengan layanan lain"
    >
      <h3>Pilih kendaraan lain</h3>
      <p className="fine-print">
        Buka penyedia untuk memesan. Tarif dan kendaraan dicek di sana.
      </p>
      <p>Tujuan: {destination.name}</p>
      <p className="fine-print" data-pickup-ready={pickup ? 'true' : 'false'}>
        {pickup
          ? 'Periksa titik jemput sebelum memesan.'
          : 'Tentukan titik jemput di aplikasi penyedia.'}
      </p>
      <div className="text-button-row">
        {EXTERNAL_PROVIDERS.map((provider) => (
          <a
            key={provider.name}
            className="external-handoff-link"
            href={provider.href}
            target="_blank"
            rel="noopener noreferrer"
            data-handoff={provider.name.toLowerCase()}
            aria-label={`Lanjutkan dengan ${provider.name} (situs resmi, tab baru)`}
            title={`Buka ${provider.name}`}
          >
            <ProviderMark name={provider.name} />
          </a>
        ))}
      </div>
      <details className="handoff-copy-details">
        <summary>Salin lokasi untuk pemesanan</summary>
        <div className="text-button-row">
          <button
            type="button"
            className="text-button"
            onClick={() => void copy('destination')}
          >
            Salin tujuan
          </button>
          <button
            type="button"
            className="text-button"
            disabled={!pickup}
            onClick={() => void copy('pickup')}
          >
            Salin titik jemput
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() => void copy('trip')}
          >
            Salin perjalanan
          </button>
        </div>
      </details>
      <p className="fine-print" role="status">
        {message || 'Lokasi tidak dikirim otomatis.'}
      </p>
      {manualText && (
        <label>
          Detail untuk disalin manual
          <textarea
            readOnly
            value={manualText}
            onFocus={(event) => event.currentTarget.select()}
          />
        </label>
      )}
    </section>
  );
}

function ProviderMark({ name }: { name: string }) {
  const [unavailable, setUnavailable] = useState(false);
  if (unavailable) return <strong>{name}</strong>;
  return (
    <Image
      src={`/providers/${name === 'Gojek' ? 'gojek.svg' : name === 'Grab' ? 'grab.png' : 'bluebird.png'}`}
      width={100}
      height={40}
      alt={name}
      unoptimized
      onError={() => setUnavailable(true)}
    />
  );
}
