'use client';

import { useEffect, useId, useState } from 'react';
import { passengerApi } from '../lib/passenger-api';
import { errorMessage, modeName, type TransitPlace } from '../lib/passenger';

type Props = Readonly<{
  label: string;
  snapshotId: string;
  value: TransitPlace | null;
  onSelect: (place: TransitPlace | null) => void;
  onChoosePin?: () => void;
}>;

export function PlaceSearch({
  label,
  snapshotId,
  value,
  onSelect,
  onChoosePin,
}: Props) {
  const id = useId().replaceAll(':', '-');
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<readonly TransitPlace[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [status, setStatus] = useState('');
  const [mounted, setMounted] = useState(false);
  const ready = mounted && !!snapshotId;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open || !ready || query.trim().length < 2) {
      setMatches([]);
      return;
    }
    setMatches([]);
    setActiveIndex(0);
    setStatus('Mencari tempat…');
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void passengerApi
        .places(query.trim(), snapshotId, controller.signal)
        .then((results) => {
          if (controller.signal.aborted) return;
          setMatches(results);
          setActiveIndex(0);
          setStatus(
            results.length
              ? `${results.length} tempat ditemukan.`
              : 'Tempat belum ditemukan. Coba nama lain atau pilih titik di peta.',
          );
        })
        .catch((cause: unknown) => {
          if (!controller.signal.aborted) setStatus(errorMessage(cause));
        });
    }, 240);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, query, ready, snapshotId]);

  useEffect(() => {
    if (!value) return;
    setQuery(value.name);
    setMatches([]);
    setOpen(false);
    setStatus('');
  }, [value]);

  function select(place: TransitPlace) {
    setQuery(place.name);
    onSelect(place);
    setOpen(false);
    setStatus('');
  }

  return (
    <div className="place-search">
      <label htmlFor={`${id}-input`}>
        {label === 'From' ? 'Dari' : label === 'To' ? 'Ke' : label}
      </label>
      <input
        id={`${id}-input`}
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open && matches.length > 0 ? `${id}-options` : undefined}
        aria-describedby={`${id}-hint`}
        aria-activedescendant={
          open && matches[activeIndex]
            ? `${id}-option-${activeIndex}`
            : undefined
        }
        autoComplete="off"
        disabled={!ready}
        placeholder="Cari halte, stasiun, alamat, atau tempat"
        maxLength={80}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          onSelect(null);
          setOpen(true);
        }}
        onFocus={() => {
          if (!value && query.length >= 2) setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
          if (event.key === 'ArrowDown' && matches.length) {
            event.preventDefault();
            setActiveIndex((index) => (index + 1) % matches.length);
          }
          if (event.key === 'ArrowUp' && matches.length) {
            event.preventDefault();
            setActiveIndex(
              (index) => (index - 1 + matches.length) % matches.length,
            );
          }
          if (event.key === 'Enter' && open && matches[activeIndex]) {
            event.preventDefault();
            select(matches[activeIndex]);
          }
        }}
      />
      <details className="place-search-coverage">
        <summary>Cakupan pencarian</summary>
        <p id={`${id}-hint`} className="place-search-hint">
          Pencarian mencakup halte, stasiun, serta sebagian alamat dan tempat
          dari data peta historis. Jika tempat tidak ditemukan, pilih titik di
          peta.{' '}
          <a href="https://www.openstreetmap.org/copyright">
            © OpenStreetMap contributors
          </a>
          .
        </p>
      </details>
      {!ready && (
        <p className="place-status" role="status" aria-busy="true">
          Menyiapkan pencarian tempat…
        </p>
      )}
      {value && (
        <p className="place-confirmation">
          {value.product_mode ? `${modeName(value.product_mode)} · ` : ''}
          {
            {
              STOP: 'Halte',
              STATION: 'Stasiun',
              ADDRESS: 'Alamat',
              POI: 'Tempat',
            }[value.kind]
          }{' '}
          dipilih
        </p>
      )}
      {open && matches.length > 0 && (
        <ul id={`${id}-options`} className="place-options" role="listbox">
          {matches.map((place, index) => (
            <li
              id={`${id}-option-${index}`}
              key={`${place.product_mode}:${place.place_id}`}
              role="option"
              aria-selected={index === activeIndex}
              className={index === activeIndex ? 'active' : ''}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => select(place)}
            >
              <strong>{place.name}</strong>
              <small>
                {place.product_mode ? `${modeName(place.product_mode)} · ` : ''}
                {
                  {
                    STOP: 'Halte',
                    STATION: 'Stasiun',
                    ADDRESS: 'Alamat',
                    POI: 'Tempat',
                  }[place.kind]
                }{' '}
                · {place.external_id}
                {place.kind === 'ADDRESS' || place.kind === 'POI'
                  ? ' · OpenStreetMap · cakupan terbatas'
                  : ''}
              </small>
            </li>
          ))}
        </ul>
      )}
      {open && status && (
        <p className="place-status" role="status">
          {status}
        </p>
      )}
      {open &&
        query.trim().length >= 2 &&
        matches.length === 0 &&
        status &&
        status !== 'Mencari tempat…' &&
        onChoosePin && (
          <button type="button" className="text-button" onClick={onChoosePin}>
            Pilih {label === 'Dari' ? 'titik awal' : 'tujuan'} di peta
          </button>
        )}
    </div>
  );
}
