'use client';

// FR-011: same installed MapLibre/OSM foundation as passenger JourneyMap.
import { useEffect, useRef, useState } from 'react';
import { Map as MapLibreMap, NavigationControl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { opsApi } from '../../lib/ops-api';
import type { GeometryView } from '../../lib/ops';

export function NetworkMap({ snapshotId }: { snapshotId: string }) {
  const node = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<GeometryView | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!node.current || !snapshotId) return;
    let alive = true;
    let request: AbortController | undefined;
    const map = new MapLibreMap({
      container: node.current,
      center: [106.8456, -6.2088],
      zoom: 12,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors',
          },
        },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
      },
    });
    map.addControl(new NavigationControl({ showCompass: false }));
    const load = async () => {
      request?.abort();
      request = new AbortController();
      const b = map.getBounds();
      const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].join(
        ',',
      );
      setLoading(true);
      setError('');
      setData(null);
      const source = map.getSource('network') as
        { setData: (value: unknown) => void } | undefined;
      source?.setData({ type: 'FeatureCollection', features: [] });
      try {
        const result = await opsApi.geometry(snapshotId, bbox, request.signal);
        if (!alive || request.signal.aborted) return;
        setData(result);
        source?.setData({
          type: 'FeatureCollection',
          features: result.features,
        });
      } catch (cause) {
        if (alive && !(cause instanceof Error && cause.name === 'AbortError'))
          setError(
            'Network geometry unavailable. Use snapshot state and run details.',
          );
      } finally {
        if (alive) setLoading(false);
      }
    };
    map.on('load', () => {
      map.addSource('network', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'network-lines',
        type: 'line',
        source: 'network',
        filter: ['==', ['geometry-type'], 'LineString'],
        paint: {
          'line-color': [
            'match',
            ['get', 'kind'],
            'walking_edge',
            '#58676f',
            'rail_topology_edge',
            '#775aa8',
            '#17697a',
          ],
          'line-width': 2,
        },
      });
      map.addLayer({
        id: 'network-stops',
        type: 'circle',
        source: 'network',
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-radius': 4,
          'circle-color': '#17697a',
          'circle-stroke-color': '#f8fafb',
          'circle-stroke-width': 1,
        },
      });
      void load();
      map.on('moveend', () => {
        void load();
      });
    });
    map.on('error', () => {
      if (alive)
        setError('Map layer unavailable. Text records remain available.');
    });
    return () => {
      alive = false;
      request?.abort();
      map.remove();
    };
  }, [snapshotId]);
  return (
    <figure className="journey-map">
      <div
        className="map-frame maplibre-frame"
        ref={node}
        role="region"
        aria-label="Snapshot network geometry; pan and zoom to inspect coverage"
      />
      <figcaption aria-live="polite">
        {!snapshotId
          ? 'Load a snapshot or select a run to view geometry.'
          : loading
            ? 'Loading viewport geometry…'
            : error ||
              (data?.coverage ??
                `${data?.features.length ?? 0} features in viewport${data?.truncated ? ' · capped at 5,000; zoom in' : ''}`)}
        <span>
          Stops: teal points · transit segments: teal · walking edges: gray ·
          rail topology: purple (topology only). Geometry is not live
          availability.
        </span>
        {data?.dataset_version_ids && (
          <span className="ops-meta">
            Snapshot {data.snapshot_id} · datasets{' '}
            {data.dataset_version_ids.join(', ')}
          </span>
        )}
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer"
        >
          © OpenStreetMap contributors
        </a>
      </figcaption>
    </figure>
  );
}
