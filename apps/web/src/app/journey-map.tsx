'use client';

import { modeName } from '../lib/passenger';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  setWorkerUrl,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  deviceAccuracyRing,
  deviceHeadingWedge,
  isValidDevicePosition,
  mapGeometryPoints,
} from '../lib/map-geometry';
import { shortHash } from '../lib/navigation';
import type { DevicePosition, MapCoordinate } from '../lib/map-geometry';
import type { Journey, JourneySegment } from '../lib/passenger';

const colors: Readonly<Record<JourneySegment['mode'], string>> = {
  WALK: '#6b7a82',
  TRANSJAKARTA: '#17697a',
  MIKROTRANS: '#537b86',
  KRL: '#3563a8',
  MRT_JAKARTA: '#a8483f',
  LRT_JAKARTA: '#4f8a4c',
  LRT_JABODEBEK: '#775aa8',
};

type Point = readonly [number, number];
type JourneyMarker = Readonly<{
  id: string;
  kind: 'origin' | 'destination' | 'boarding' | 'alighting' | 'transfer';
  symbol: 'O' | 'D' | 'B' | 'A' | 'T';
  label: string;
  point: Point;
}>;

export type JourneyMapPoint = MapCoordinate;

export type JourneyMapProps = Readonly<{
  journey?: Journey | null;
  alternativeJourney?: Journey | null;
  invalidatedSegmentSequences?: readonly number[];
  completedSegmentCount?: number;
  overviewRevision?: number;
  recenterDeviceRevision?: number;
  activeSegmentSequence?: number | null;
  devicePosition?: DevicePosition | null;
  followDevicePosition?: boolean;
  onMapPointSelect?: (point: JourneyMapPoint) => void;
  selectionMode?: 'origin' | 'destination' | null;
  originPin?: JourneyMapPoint | null;
  destinationPin?: JourneyMapPoint | null;
  onOriginPinDrag?: (point: JourneyMapPoint) => void;
  onDestinationPinDrag?: (point: JourneyMapPoint) => void;
}>;

const DEVICE_SOURCE = 'device-position';
const DEVICE_ACCURACY_LAYER = 'device-accuracy';
const DEVICE_HEADING_LAYER = 'device-heading';
const DEVICE_POINT_LAYER = 'device-point';

function validPin(
  pin: JourneyMapPoint | null | undefined,
): JourneyMapPoint | null {
  return pin &&
    Number.isFinite(pin.latitude) &&
    Number.isFinite(pin.longitude) &&
    Math.abs(pin.latitude) <= 90 &&
    Math.abs(pin.longitude) <= 180
    ? pin
    : null;
}

function makePinElement(kind: 'origin' | 'destination'): HTMLDivElement {
  const element = document.createElement('div');
  element.className = `maplibre-marker map-marker private-pin ${kind}`;
  element.textContent = kind === 'origin' ? 'O' : 'D';
  element.setAttribute('role', 'img');
  element.setAttribute(
    'aria-label',
    `Titik ${kind === 'origin' ? 'awal' : 'tujuan'} pilihan Anda; dapat digeser saat memilih titik tersebut`,
  );
  return element;
}

type DeviceFeature = {
  type: 'Feature';
  properties: { kind: 'accuracy' | 'heading' | 'position' };
  geometry:
    | { type: 'Polygon'; coordinates: [number, number][][] }
    | { type: 'Point'; coordinates: [number, number] };
};

function deviceFeatureCollection(position: DevicePosition | null): {
  type: 'FeatureCollection';
  features: DeviceFeature[];
} {
  if (!position || !isValidDevicePosition(position))
    return { type: 'FeatureCollection', features: [] };
  const features: DeviceFeature[] = [];
  const accuracy = deviceAccuracyRing(position, position.accuracy ?? 0);
  if (accuracy)
    features.push({
      type: 'Feature',
      properties: { kind: 'accuracy' },
      geometry: { type: 'Polygon', coordinates: [accuracy] },
    });
  const heading = deviceHeadingWedge(
    position,
    position.heading,
    Math.max(18, position.accuracy ?? 25),
  );
  if (heading)
    features.push({
      type: 'Feature',
      properties: { kind: 'heading' },
      geometry: { type: 'Polygon', coordinates: [heading] },
    });
  features.push({
    type: 'Feature',
    properties: { kind: 'position' },
    geometry: {
      type: 'Point',
      coordinates: [position.longitude, position.latitude],
    },
  });
  return { type: 'FeatureCollection', features };
}

function addDeviceLayers(map: MapLibreMap): void {
  map.addSource(DEVICE_SOURCE, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });
  map.addLayer({
    id: DEVICE_ACCURACY_LAYER,
    type: 'fill',
    source: DEVICE_SOURCE,
    filter: ['==', ['get', 'kind'], 'accuracy'],
    paint: { 'fill-color': '#1769aa', 'fill-opacity': 0.14 },
  });
  map.addLayer({
    id: DEVICE_HEADING_LAYER,
    type: 'fill',
    source: DEVICE_SOURCE,
    filter: ['==', ['get', 'kind'], 'heading'],
    paint: { 'fill-color': '#1769aa', 'fill-opacity': 0.28 },
  });
  map.addLayer({
    id: DEVICE_POINT_LAYER,
    type: 'circle',
    source: DEVICE_SOURCE,
    filter: ['==', ['get', 'kind'], 'position'],
    paint: {
      'circle-radius': 7,
      'circle-color': '#1769aa',
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 3,
    },
  });
}

// Keep endpoints clear of the evidence caption and recovery legend. Bounds
// describe real route geometry; padding changes only the viewport framing.
function routePadding(map: MapLibreMap) {
  const frame = map.getContainer().getBoundingClientRect();
  const figure = map.getContainer().closest('figure');
  const caption = figure?.querySelector('figcaption')?.getBoundingClientRect();
  const key = figure
    ?.querySelector('.recovery-map-key')
    ?.getBoundingClientRect();
  const hud = map
    .getContainer()
    .closest('.map-workspace')
    ?.querySelector('.navigation-hud')
    ?.getBoundingClientRect();
  const bottom = Math.min(
    Math.max(48, frame.height - 120),
    Math.max(48, caption ? frame.bottom - caption.top + 20 : 48),
  );
  return {
    top: Math.min(
      Math.max(48, frame.height - bottom - 100),
      Math.max(
        48,
        key ? key.bottom - frame.top + 16 : 48,
        hud ? hud.bottom - frame.top + 16 : 48,
      ),
    ),
    bottom: Math.min(
      Math.max(48, frame.height - 120),
      Math.max(48, caption ? frame.bottom - caption.top + 20 : 48),
    ),
    left: 40,
    right: 40,
  };
}

export function JourneyMap({
  journey,
  alternativeJourney,
  invalidatedSegmentSequences,
  completedSegmentCount = 0,
  overviewRevision = 0,
  recenterDeviceRevision = 0,
  activeSegmentSequence = null,
  devicePosition,
  followDevicePosition = false,
  onMapPointSelect,
  selectionMode = null,
  originPin,
  destinationPin,
  onOriginPinDrag,
  onDestinationPinDrag,
}: JourneyMapProps) {
  const labelId = useId().replaceAll(':', '-');
  const mapNode = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const handledOverview = useRef(0);
  const handledDeviceRecenter = useRef(0);
  const pinMarkers = useRef<Partial<Record<'origin' | 'destination', Marker>>>(
    {},
  );
  const [mapError, setMapError] = useState('');
  const [mapReady, setMapReady] = useState(false);
  const selectionModeRef = useRef(selectionMode);
  const selectRef = useRef(onMapPointSelect);
  const followRef = useRef(followDevicePosition);
  const originDragRef = useRef(onOriginPinDrag);
  const destinationDragRef = useRef(onDestinationPinDrag);
  const selectables = useMemo(
    () => ({
      origin: validPin(originPin),
      destination: validPin(destinationPin),
    }),
    [originPin, destinationPin],
  );
  const validDevice = isValidDevicePosition(devicePosition)
    ? devicePosition
    : null;
  const deviceRef = useRef(validDevice);
  deviceRef.current = validDevice;
  useEffect(() => {
    selectionModeRef.current = selectionMode;
    selectRef.current = onMapPointSelect;
    followRef.current = followDevicePosition;
    originDragRef.current = onOriginPinDrag;
    destinationDragRef.current = onDestinationPinDrag;
  });
  const segments = useMemo(
    () =>
      (journey?.segments ?? []).map((segment) => ({
        ...segment,
        points: toPoints(segment.geometry?.coordinates ?? []),
      })),
    [journey?.segments],
  );
  const generation =
    (journey as { accepted_recovery_id?: string | null } | null)
      ?.accepted_recovery_id ?? 'ORIGINAL';
  const renderableSegments = useMemo(
    () => segments.filter((segment) => segment.points.length >= 2),
    [segments],
  );
  const markers = useMemo(
    () => (journey ? journeyMarkers(journey) : []),
    [journey],
  );

  useEffect(() => {
    if (!mapNode.current) return;
    // The div survives map replacement. Never expose the previous journey's
    // readiness while a new canvas/worker source is still loading.
    for (const name of [
      'data-route-rendered-count',
      'data-route-loaded-count',
      'data-route-source-count',
      'data-recovery-rendered-count',
    ]) {
      mapNode.current.setAttribute(name, '0');
    }
    mapNode.current.removeAttribute('data-route-render-journey');
    mapNode.current.removeAttribute('data-route-source-fingerprint');
    const firstPoint = renderableSegments[0]?.points[0];
    setWorkerUrl('/vendor/maplibre/maplibre-gl-worker.mjs');
    const map = new MapLibreMap({
      container: mapNode.current,
      attributionControl: false,
      interactive: true,
      locale: {
        'Map.Title': 'Peta',
        'NavigationControl.ZoomIn': 'Perbesar peta',
        'NavigationControl.ZoomOut': 'Perkecil peta',
        'NavigationControl.ResetBearing': 'Hadapkan peta ke utara',
      },
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
        layers: [
          {
            id: 'background',
            type: 'background',
            paint: { 'background-color': '#f4f8fa' },
          },
          {
            id: 'osm',
            type: 'raster',
            source: 'osm',
            paint: { 'raster-opacity': 0.62, 'raster-saturation': -0.25 },
          },
        ],
      },
      center: firstPoint
        ? [firstPoint[0]!, firstPoint[1]!]
        : validPin(originPin ?? destinationPin ?? null)
          ? [
              validPin(originPin ?? destinationPin ?? null)!.longitude,
              validPin(originPin ?? destinationPin ?? null)!.latitude,
            ]
          : [106.8456, -6.2088],
      zoom: firstPoint ? 10 : 12,
    });
    mapRef.current = map;
    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(mapNode.current);
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    map.on('click', (event) => {
      if (!selectionModeRef.current || !selectRef.current) return;
      selectRef.current({
        latitude: event.lngLat.lat,
        longitude: event.lngLat.lng,
      });
    });
    const onError = () =>
      setMapError(
        'Peta atau garis rute gagal dimuat. Petunjuk tertulis tetap dapat digunakan.',
      );
    map.on('error', onError);
    map.on('moveend', () => {
      const center = map.getCenter();
      mapNode.current?.setAttribute(
        'data-map-view',
        `${center.lng.toFixed(5)},${center.lat.toFixed(5)},${map.getZoom().toFixed(2)}`,
      );
    });
    // Source fingerprints prove input identity; rendered features prove that
    // the canvas actually displays route geometry in its current viewport.
    map.on('render', () => {
      const layerIds = renderableSegments
        .map(
          (leg) =>
            `journey-${journey!.journey_id}-${generation}-segment-${leg.sequence}`,
        )
        .filter((id) => Boolean(map.getLayer(id)));
      if (!map.isStyleLoaded() && !layerIds.length) return;
      mapNode.current?.setAttribute(
        'data-route-render-journey',
        journey?.journey_id ?? 'none',
      );
      mapNode.current?.setAttribute(
        'data-route-loaded-count',
        String(layerIds.filter((id) => map.isSourceLoaded(id)).length),
      );
      mapNode.current?.setAttribute(
        'data-map-canvas-size',
        `${map.getCanvas().width},${map.getCanvas().height}`,
      );
      mapNode.current?.setAttribute(
        'data-route-rendered-count',
        String(
          layerIds.length
            ? map.queryRenderedFeatures({ layers: layerIds }).length
            : 0,
        ),
      );
      mapNode.current?.setAttribute(
        'data-recovery-rendered-count',
        String(
          map.getLayer('recovery-preview')
            ? map.queryRenderedFeatures({ layers: ['recovery-preview'] }).length
            : 0,
        ),
      );
    });
    map.on('load', () => {
      const all = renderableSegments.flatMap((segment) => segment.points);
      setMapReady(true);
      const pinPoints: [number, number][] = [];
      for (const pin of [validPin(originPin), validPin(destinationPin)])
        if (pin) pinPoints.push([pin.longitude, pin.latitude]);
      const fit = [...all, ...pinPoints];
      if (validDevice && (followRef.current || fit.length === 0))
        fit.push([validDevice.longitude, validDevice.latitude]);
      if (fit.length > 0) {
        const bounds = fit.reduce(
          (result, point) => result.extend(point as [number, number]),
          new LngLatBounds(
            fit[0] as [number, number],
            fit[0] as [number, number],
          ),
        );
        map.fitBounds(bounds, {
          padding: routePadding(map),
          maxZoom: 14,
          duration: 0,
        });
        mapNode.current?.setAttribute(
          'data-fit-bounds',
          bounds.toArray().flat().join(','),
        );
      }
      mapNode.current?.setAttribute(
        'data-route-source-count',
        String(renderableSegments.length),
      );
      const fingerprint: string[] = [];
      mapNode.current?.setAttribute(
        'data-route-point-count',
        String(
          renderableSegments.reduce(
            (count, segment) => count + segment.points.length,
            0,
          ),
        ),
      );
      mapNode.current?.setAttribute(
        'data-marker-count',
        String(markers.length),
      );
      for (const segment of renderableSegments) {
        const id = `journey-${journey!.journey_id}-${generation}-segment-${segment.sequence}`;
        map.addSource(id, {
          type: 'geojson',
          data: {
            type: 'Feature',
            id: segment.sequence,
            properties: { sequence: segment.sequence, mode: segment.mode },
            geometry: { type: 'LineString', coordinates: segment.points },
          },
        });
        map.addLayer({
          id,
          type: 'line',
          source: id,
          paint: {
            'line-color': colors[segment.mode],
            'line-width': segment.mode === 'WALK' ? 3 : 5,
            'line-opacity': 0.92,
            ...(segment.mode === 'WALK'
              ? { 'line-dasharray': [1.5, 1.5] }
              : {}),
          },
          layout: { 'line-cap': 'round', 'line-join': 'round' },
        });
        const serialized = map.getSource(id)?.serialize() as
          { data?: unknown } | undefined;
        fingerprint.push(
          `${journey!.journey_id}:${generation}:${id}:${shortHash(JSON.stringify(serialized?.data ?? null))}`,
        );
      }
      mapNode.current?.setAttribute(
        'data-route-source-fingerprint',
        fingerprint.join('|'),
      );
      for (const marker of markers) {
        const element = document.createElement('div');
        element.className = `maplibre-marker map-marker ${marker.kind}`;
        element.textContent = marker.symbol;
        element.setAttribute('aria-label', marker.label);
        new Marker({ element })
          .setLngLat(marker.point as [number, number])
          .addTo(map);
      }
      addDeviceLayers(map);
    });
    return () => {
      resizeObserver.disconnect();
      for (const marker of Object.values(pinMarkers.current)) marker?.remove();
      pinMarkers.current = {};
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, [journey?.journey_id, renderableSegments, markers]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const source = map.getSource(DEVICE_SOURCE) as
      { setData?: (data: unknown) => void } | undefined;
    source?.setData?.(deviceFeatureCollection(validDevice));
    if (validDevice && followRef.current) {
      map.easeTo({
        center: [validDevice.longitude, validDevice.latitude],
        ...(activeSegmentSequence !== null
          ? { zoom: Math.max(map.getZoom(), 16) }
          : {}),
        duration: 0,
      });
    }
  }, [validDevice, mapReady, followDevicePosition, activeSegmentSequence]);

  // Explicit map-context recentering does not enable navigation-grade progress.
  useEffect(() => {
    const map = mapRef.current;
    if (
      !map ||
      !mapReady ||
      recenterDeviceRevision <= handledDeviceRecenter.current
    )
      return;
    handledDeviceRecenter.current = recenterDeviceRevision;
    if (
      !validDevice ||
      typeof validDevice.timestamp !== 'number' ||
      Date.now() - validDevice.timestamp > 30_000 ||
      validDevice.timestamp > Date.now() + 5000 ||
      typeof validDevice.accuracy !== 'number' ||
      validDevice.accuracy > 250
    )
      return;
    map.easeTo({
      center: [validDevice.longitude, validDevice.latitude],
      zoom: Math.max(map.getZoom(), 15),
      duration: 0,
    });
    mapNode.current?.setAttribute(
      'data-device-recenter-revision',
      String(recenterDeviceRevision),
    );
  }, [recenterDeviceRevision, mapReady, validDevice]);

  // Decision preview draws only geometry supplied by the unaccepted recovery.
  // Each leg stays separate: missing connections are never invented.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !map.getSource(DEVICE_SOURCE)) return;
    for (const id of ['recovery-preview', 'recovery-affected']) {
      if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource(id)) map.removeSource(id);
    }
    mapNode.current?.removeAttribute('data-recovery-preview-id');
    mapNode.current?.removeAttribute('data-recovery-geometry-fingerprint');
    if (!alternativeJourney) return;
    const preview = alternativeJourney.segments
      .map((leg) => ({
        ...leg,
        points: toPoints(leg.geometry?.coordinates ?? []),
      }))
      .filter((leg) => leg.points.length >= 2);
    const affected = renderableSegments.filter((leg) =>
      invalidatedSegmentSequences?.includes(leg.sequence),
    );
    for (const [id, legs, color] of [
      ['recovery-preview', preview, '#147cff'],
      ['recovery-affected', affected, '#eb342d'],
    ] as const) {
      map.addSource(id, {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: legs.map((leg) => ({
            type: 'Feature',
            properties: { sequence: leg.sequence },
            geometry: {
              type: 'LineString',
              coordinates: leg.points.map((point) => [point[0], point[1]]),
            },
          })),
        },
      });
      map.addLayer({
        id,
        type: 'line',
        source: id,
        paint: {
          'line-color': color,
          'line-width': 5,
          ...(id === 'recovery-affected' ? { 'line-dasharray': [2, 2] } : {}),
        },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      });
    }
    mapNode.current?.setAttribute(
      'data-recovery-preview-id',
      alternativeJourney.journey_id,
    );
    mapNode.current?.setAttribute(
      'data-recovery-geometry-fingerprint',
      shortHash(JSON.stringify(preview.map((leg) => leg.points))),
    );
    const points = [
      ...preview.flatMap((leg) => leg.points),
      ...renderableSegments.flatMap((leg) => leg.points),
    ];
    if (points.length)
      map.fitBounds(
        points.reduce(
          (bounds, point) => bounds.extend(point as [number, number]),
          new LngLatBounds(
            points[0] as [number, number],
            points[0] as [number, number],
          ),
        ),
        { padding: routePadding(map), duration: 0 },
      );
  }, [
    alternativeJourney,
    invalidatedSegmentSequences,
    mapReady,
    renderableSegments,
  ]);

  // Focus the actual active leg on activation, progress and recovery changes.
  // Use only its supplied geometry; never join missing geometry or invent an
  // access path from GPS to a stop. Subsequent fixes follow the raw device above.
  useEffect(() => {
    const map = mapRef.current;
    const node = mapNode.current;
    if (!map || !node || !mapReady) return;
    const segment = renderableSegments.find(
      (leg) => leg.sequence === activeSegmentSequence,
    );
    if (!segment || selectionMode) {
      node.removeAttribute('data-navigation-target');
      node.removeAttribute('data-navigation-focus-bounds');
      return;
    }
    node.setAttribute('data-navigation-target', segment.to.name);
    const bounds = segment.points.reduce(
      (result, point) => result.extend(point as [number, number]),
      new LngLatBounds(
        segment.points[0] as [number, number],
        segment.points[0] as [number, number],
      ),
    );
    node.setAttribute(
      'data-navigation-focus-bounds',
      bounds.toArray().flat().join(','),
    );
    const position = deviceRef.current;
    if (position && followDevicePosition) {
      map.easeTo({
        center: [position.longitude, position.latitude],
        zoom: Math.max(map.getZoom(), 16),
        duration: 0,
      });
    } else {
      map.fitBounds(bounds, {
        padding: routePadding(map),
        maxZoom: 16,
        duration: 0,
      });
    }
  }, [
    activeSegmentSequence,
    renderableSegments,
    mapReady,
    selectionMode,
    followDevicePosition,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || overviewRevision <= handledOverview.current)
      return;
    const points = [
      ...renderableSegments.flatMap((leg) => leg.points),
      ...(alternativeJourney?.segments.flatMap((leg) =>
        toPoints(leg.geometry?.coordinates ?? []),
      ) ?? []),
    ];
    if (points.length) {
      const bounds = points.reduce(
        (result, point) => result.extend(point as [number, number]),
        new LngLatBounds(
          points[0] as [number, number],
          points[0] as [number, number],
        ),
      );
      map.fitBounds(bounds, {
        padding: routePadding(map),
        maxZoom: 14,
        duration: 0,
      });
    }
    handledOverview.current = overviewRevision;
    mapNode.current?.setAttribute(
      'data-map-overview-revision',
      String(overviewRevision),
    );
  }, [overviewRevision, mapReady, renderableSegments, alternativeJourney]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const pins: ReadonlyArray<'origin' | 'destination'> = [
      'origin',
      'destination',
    ];
    for (const kind of pins) {
      const pin = selectables[kind];
      const existing = pinMarkers.current[kind];
      if (!pin) {
        existing?.remove();
        delete pinMarkers.current[kind];
        continue;
      }
      const dragCallback =
        kind === 'origin' ? originDragRef : destinationDragRef;
      if (!existing) {
        const marker = new Marker({
          element: makePinElement(kind),
          draggable: selectionMode === kind,
        })
          .setLngLat([pin.longitude, pin.latitude])
          .addTo(map);
        marker.on('dragend', () => {
          const position = marker.getLngLat();
          dragCallback.current?.({
            latitude: position.lat,
            longitude: position.lng,
          });
        });
        pinMarkers.current[kind] = marker;
      } else {
        existing.setLngLat([pin.longitude, pin.latitude]);
        existing.setDraggable(selectionMode === kind);
      }
    }
    mapNode.current?.setAttribute(
      'data-pin-origin',
      selectables.origin
        ? `${selectables.origin.latitude.toFixed(6)},${selectables.origin.longitude.toFixed(6)}`
        : 'none',
    );
    mapNode.current?.setAttribute(
      'data-pin-destination',
      selectables.destination
        ? `${selectables.destination.latitude.toFixed(6)},${selectables.destination.longitude.toFixed(6)}`
        : 'none',
    );
  }, [selectables, selectionMode, mapReady]);

  useEffect(() => {
    if (!mapNode.current) return;
    if (!validDevice) {
      mapNode.current.removeAttribute('data-device-tracked-value');
      return;
    }
    mapNode.current.setAttribute(
      'data-device-tracked-value',
      `${validDevice.latitude.toFixed(6)},${validDevice.longitude.toFixed(6)}`,
    );
  }, [validDevice]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !journey) return;
    for (const segment of renderableSegments) {
      const id = `journey-${journey.journey_id}-${generation}-segment-${segment.sequence}`;
      if (!map.getLayer(id)) continue;
      const status =
        activeSegmentSequence === null
          ? 'upcoming'
          : segment.sequence === activeSegmentSequence
            ? 'active'
            : segment.sequence < activeSegmentSequence
              ? 'completed'
              : 'upcoming';
      map.setPaintProperty(
        id,
        'line-opacity',
        activeSegmentSequence === null
          ? 0.92
          : status === 'active'
            ? 1
            : status === 'completed'
              ? 0.15
              : 0.4,
      );
      map.setPaintProperty(
        id,
        'line-width',
        status === 'active'
          ? segment.mode === 'WALK'
            ? 5
            : 7
          : segment.mode === 'WALK'
            ? 3
            : 5,
      );
    }
    mapNode.current?.setAttribute(
      'data-active-segment',
      activeSegmentSequence === null ? 'none' : String(activeSegmentSequence),
    );
    mapNode.current?.setAttribute(
      'data-completed-segments',
      String(
        activeSegmentSequence === null
          ? completedSegmentCount
          : Math.min(completedSegmentCount, activeSegmentSequence),
      ),
    );
  }, [
    activeSegmentSequence,
    completedSegmentCount,
    mapReady,
    journey?.journey_id,
    renderableSegments,
    journey,
  ]);

  const unavailableSegments = segments.filter(
    (segment) => segment.points.length < 2,
  );
  const emptyRoute = !journey;
  const invalidRoute =
    !!journey && journey.segments.length > 0 && renderableSegments.length === 0;
  if (invalidRoute)
    return (
      <p className="fine-print">
        Garis rute belum tersedia. Ikuti urutan perjalanan tertulis.
      </p>
    );

  return (
    <figure
      className={`journey-map${selectionMode ? ` selecting-${selectionMode}` : ''}`}
      aria-labelledby={`${labelId}-caption`}
    >
      <div
        ref={mapNode}
        className="map-frame maplibre-frame"
        role="application"
        aria-label="Peta rute terpilih. Geser atau perbesar peta; petunjuk tertulis juga tersedia."
        data-selection-mode={selectionMode ?? 'none'}
        data-device-tracked={validDevice ? 'true' : 'false'}
      />
      {alternativeJourney && (
        <div className="recovery-map-key">
          <span>Rute aktif</span>
          <span>Usulan belum diterima</span>
          <span>Bagian terdampak</span>
        </div>
      )}
      <span className="sr-only" role="status">
        {mapReady ? 'Peta perjalanan siap.' : 'Memuat peta perjalanan.'}
      </span>
      {!mapReady && !mapError && (
        <p className="fine-print" role="status">
          Memuat peta perjalanan…
        </p>
      )}
      {mapError && (
        <p className="feedback error" role="status">
          {mapError}
        </p>
      )}
      {unavailableSegments.length > 0 && (
        <p className="fine-print" role="status">
          Garis untuk {unavailableSegments.length} tahap belum tersedia. Periksa
          urutan perjalanan tertulis untuk tahap tersebut.
        </p>
      )}
      {emptyRoute && (
        <p className="fine-print" role="status">
          Pilih titik awal dan tujuan untuk melihat rute di peta.
        </p>
      )}
      <figcaption id={`${labelId}-caption`}>
        {activeSegmentSequence !== null && (
          <p className="fine-print" role="status">
            Tujuan segmen aktif:{' '}
            {journey?.segments.find(
              (segment) => segment.sequence === activeSegmentSequence,
            )?.to.name ?? 'belum tersedia'}
            . Posisi GPS tidak otomatis menyelesaikan segmen perjalanan.
          </p>
        )}
        {journey ? (
          <span>
            Garis rute dari {journey.routing_context.provider}{' '}
            {journey.routing_context.provider_version}, data jadwal historis.
            Garis jalan kaki bersifat perkiraan. Periksa akses dan kondisi jalan
            di sekitar Anda.
          </span>
        ) : (
          <span>
            Peta memakai data lokasi dan jadwal. Lokasi perangkat hanya
            ditampilkan setelah izin Anda.
          </span>
        )}
        <ul className="map-legend" aria-label="Penanda peta">
          {markers.length > 0 ? (
            markers.map((marker) => (
              <li key={marker.id}>
                <strong>{marker.symbol}</strong> {marker.label}
              </li>
            ))
          ) : (
            <li className="fine-print">
              Belum ada penanda rute. Pilih lokasi atau titik peta agar peta
              updates.
            </li>
          )}
        </ul>
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

function toPoints(coordinates: readonly number[][]): Point[] {
  return mapGeometryPoints(coordinates);
}

function point(endpoint: JourneySegment['from']): Point | null {
  return typeof endpoint.longitude === 'number' &&
    typeof endpoint.latitude === 'number'
    ? [endpoint.longitude, endpoint.latitude]
    : null;
}

function journeyMarkers(journey: Journey): JourneyMarker[] {
  const result: JourneyMarker[] = [];
  const first = journey.segments[0];
  const last = journey.segments.at(-1);
  const origin = first ? point(first.from) : null;
  const destination = last ? point(last.to) : null;
  if (first && origin)
    result.push({
      id: 'origin',
      kind: 'origin',
      symbol: 'O',
      label: `Awal · ${first.from.name}`,
      point: origin,
    });
  for (const segment of journey.segments) {
    if (segment.mode === 'WALK') continue;
    const from = point(segment.from);
    const to = point(segment.to);
    if (from)
      result.push({
        id: `boarding-${segment.sequence}`,
        kind: 'boarding',
        symbol: 'B',
        label: `Naik ${modeName(segment.mode)} · ${segment.from.name}`,
        point: from,
      });
    if (to)
      result.push({
        id: `alighting-${segment.sequence}`,
        kind: 'alighting',
        symbol: 'A',
        label: `Turun · ${segment.to.name}`,
        point: to,
      });
  }
  for (const segment of journey.segments) {
    if (segment.mode !== 'WALK') continue;
    const previous = journey.segments
      .slice(0, segment.sequence)
      .findLast((item) => item.mode !== 'WALK');
    const next = journey.segments
      .slice(segment.sequence + 1)
      .find((item) => item.mode !== 'WALK');
    const transfer = point(segment.from);
    if (previous && next && transfer)
      result.push({
        id: `transfer-${segment.sequence}`,
        kind: 'transfer',
        symbol: 'T',
        label: `Jalan untuk pindah · ${segment.from.name} → ${segment.to.name}`,
        point: transfer,
      });
  }
  if (last && destination)
    result.push({
      id: 'destination',
      kind: 'destination',
      symbol: 'D',
      label: `Tujuan · ${last.to.name}`,
      point: destination,
    });
  return result;
}
