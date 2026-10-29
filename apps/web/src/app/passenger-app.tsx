'use client';

import {
  BusIcon,
  MapTrifoldIcon,
  PathIcon,
  ChartBarIcon,
  MapPinIcon,
  ArrowsDownUpIcon,
  ArrowRightIcon,
  UserIcon,
  ListBulletsIcon,
  CornersOutIcon,
  PersonSimpleWalkIcon,
  TrainIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import Image from 'next/image';
import {
  PassengerApiError,
  reportAttemptHash,
  acceptanceReconcileOutcome,
  canCommitRecovery,
  passengerApi,
  recoveryProposalKey,
  nextRecoveryAttempt,
  recoverySource,
  type RecoverySource,
} from '../lib/passenger-api';
import { DEMO_REPLAY } from '../lib/demo-replay';
import { useDeviceLocation } from '../lib/use-device-location';
import { gpsNavigationReady, gpsMapReady } from '../lib/device-location';
import { ExternalHandoff } from '../components/external-handoff';
import {
  OFF_ROUTE_HISTORY,
  distanceToPathMeters,
  isOffRoute,
  isWalkingMode,
  manuallyAdvanceManeuver,
  modeNavLabel,
  navigationMode,
  navigationScopeKey,
  nextGuidance,
  pathPoints,
  prepareWalkNavigation,
  initialWalkProgress,
  walkGeometryIdentity,
  updateWalkProgress,
  type WalkProgress,
  type NavMode,
} from '../lib/navigation';
import type { JourneyMapPoint } from './journey-map';
import { PlaceSearch } from './place-search';
import { JourneyMap } from './journey-map';
import { OperatorSchedules } from '../components/operator-schedules';
import { NavigationHud } from '../components/navigation-hud';
import { CopilotDrawer } from '../components/copilot-drawer';
import {
  recoveryComparisonSource,
  canReplayPendingReport,
  easiestAmongShown,
  alertIsCurrent,
  evidenceLabel,
  operationalStateLabel,
  freshnessLabel,
  errorMessage,
  formatClock,
  formatDistance,
  formatDuration,
  initialJakartaDateTime,
  journeyProgressDateTime,
  journeySearchFailure,
  modeName,
  parsePoint,
  passengerRouteName,
  rankingExplanation,
  rankingFingerprint,
  sameRankingCandidate,
  recoveryPart,
  recoveryPartLabel,
  recoverySummary,
  remainingReportTargets,
  isValidReportDescription,
  passengerReportStatusLabel,
  passengerReportCategoryLabel,
  samePassengerLeg,
  segmentPosition,
  toJakartaIso,
  transferLabel,
  type Journey,
  type JourneyPreference,
  type JourneyAlert,
  type PassengerReport,
  type Recovery,
  type RecoveryAcceptance,
  type TransitPlace,
} from '../lib/passenger';

const journeyKey = 'transumin.passenger.journey';
const recoveryKey = 'transumin.passenger.recovery';
const activationKey = 'transumin.passenger.activation';
const reportPendingKey = 'transumin.passenger.report-pending';
const REPORT_PENDING_TTL_MS = 12 * 60 * 60 * 1000;

function ModeIcon({ mode }: { mode: Journey['segments'][number]['mode'] }) {
  const Icon =
    mode === 'WALK'
      ? PersonSimpleWalkIcon
      : mode === 'TRANSJAKARTA' || mode === 'MIKROTRANS'
        ? BusIcon
        : TrainIcon;
  return <Icon size={18} weight="regular" aria-hidden="true" />;
}

export function PassengerApp() {
  const [workspaceView, setWorkspaceView] = useState<
    'plan' | 'active' | 'disruptions' | 'map'
  >('plan');
  const [detailExpanded, setDetailExpanded] = useState(false);
  const [mapOverviewRevision, setMapOverviewRevision] = useState(0);
  const [deviceRecenterRevision, setDeviceRecenterRevision] = useState(0);
  const mapReturnView = useRef<'plan' | 'active' | 'disruptions'>('plan');
  const [snapshotId, setSnapshotId] = useState('');
  const [originPlace, setOriginPlace] = useState<TransitPlace | null>(null);
  const [destinationPlace, setDestinationPlace] = useState<TransitPlace | null>(
    null,
  );
  const [advancedCoordinates, setAdvancedCoordinates] = useState(false);
  const [originLat, setOriginLat] = useState('');
  const [originLon, setOriginLon] = useState('');
  const [destinationLat, setDestinationLat] = useState('');
  const [destinationLon, setDestinationLon] = useState('');
  const [departure, setDeparture] = useState('');
  const [preference, setPreference] = useState<JourneyPreference>('BALANCED');
  const preferenceRef = useRef<JourneyPreference>('BALANCED');
  const [rankingMessage, setRankingMessage] = useState('');
  const [progressAt, setProgressAt] = useState('');
  const [alternatives, setAlternatives] = useState<Journey[]>([]);
  const [selected, setSelected] = useState<Journey | null>(null);
  const [active, setActive] = useState<Journey | null>(null);
  const activeRef = useRef<Journey | null>(null);
  activeRef.current = active;
  const [alerts, setAlerts] = useState<JourneyAlert[]>([]);
  const [recovery, setRecovery] = useState<Recovery | null>(null);
  const [acceptance, setAcceptance] = useState<RecoveryAcceptance | null>(null);
  const comparisonSource = useRef<{
    recoveryId: string;
    journey: Journey;
  } | null>(null);
  const acceptKey = useRef<string | null>(null);
  // G1-A: recoveries and acceptance follow later-over-wins request identity;
  // only the newest in-flight proposal/acceptance may commit frontend state.
  const recoveryRequestId = useRef(0);
  const recoveryRequest = useRef<{
    id: number;
    controller: AbortController;
  } | null>(null);
  // G1-A identity: a mounted snapshot is stale as soon as a newer journey
  // generation (remount, current-journey switch, restored recovery, or new
  // progress) supersedes it. `recoverySource` is the latest live journey;
  // `activeGeneration` never moves backwards within one mount.
  const recoveryJourney = useRef<RecoverySource | null>(null);
  const recoveryAttempt = useRef<{
    scope: string;
    nonce: number;
    known: boolean;
  } | null>(null);
  const activeGeneration = useRef(0);
  const [recoveryStatus, setRecoveryStatus] = useState<
    'NEEDS_RECONCILE' | 'RECONCILING' | null
  >(null);
  const acceptingRecovery = useRef<{ key: string; id: number } | null>(null);
  const [alertError, setAlertError] = useState('');
  const [streamStatus, setStreamStatus] = useState<
    'CONNECTING' | 'CONNECTED' | 'RECONNECTING' | 'OFFLINE'
  >('OFFLINE');
  const [busy, setBusy] = useState<
    | 'search'
    | 'activate'
    | 'progress'
    | 'boarding'
    | 'alighting'
    | 'recovery'
    | 'report'
    | null
  >(null);
  const device = useDeviceLocation();
  useEffect(() => {
    if (active && active.status !== 'ACTIVE') device.stop();
  }, [active?.status, device.stop]);
  const [followDevice, setFollowDevice] = useState(true);
  const [navigationPaused, setNavigationPaused] = useState(false);
  const navLegKey = useRef<string | null>(null);
  const navHistory = useRef<Array<{ distance: number | null }>>([]);
  const lastNavSampleTimestamp = useRef<number | null>(null);
  const [walkState, setWalkState] = useState<{
    key: string | null;
    progress: WalkProgress;
  }>({
    key: null,
    progress: initialWalkProgress(),
  });
  const walkStateRef = useRef(walkState);
  walkStateRef.current = walkState;
  const walkNavigation = useRef<ReturnType<typeof prepareWalkNavigation>>(null);
  const [selectionMode, setSelectionMode] = useState<
    'origin' | 'destination' | null
  >(null);
  const [inputModes, setInputModes] = useState<
    Record<
      'origin' | 'destination',
      'place' | 'pin' | 'current' | 'coordinates'
    >
  >({ origin: 'place', destination: 'place' });
  const [originPin, setOriginPin] = useState<JourneyMapPoint | null>(null);
  const [destinationPin, setDestinationPin] = useState<JourneyMapPoint | null>(
    null,
  );
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [reportCategory, setReportCategory] = useState('SERVICE');
  const [reportObservedAt, setReportObservedAt] = useState('');
  const [reportDescription, setReportDescription] = useState('');
  const [reportStatus, setReportStatus] = useState('');
  const [reportFormError, setReportFormError] = useState('');
  const [reportTargetKey, setReportTargetKey] = useState('');
  const [showAllReportTargets, setShowAllReportTargets] = useState(false);
  const [reports, setReports] = useState<PassengerReport[]>([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportsError, setReportsError] = useState('');
  const [reportNeedsReconcile, setReportNeedsReconcile] = useState(false);
  const reportKey = useRef<{ fingerprint: string; key: string } | null>(null);
  // Identity only; never persist report contents or device coordinates.
  const localReportAttemptKey = useRef<string | null>(null);
  const planRequest = useRef<{
    id: number;
    controller: AbortController;
  } | null>(null);
  const [planningHealth, setPlanningHealth] = useState<{
    status: 'AVAILABLE' | 'UNAVAILABLE';
    checkedAt: string;
  } | null>(null);
  const [planningHealthBusy, setPlanningHealthBusy] = useState(false);
  const planRequestId = useRef(0);
  const lastPlan = useRef<{
    origin: { latitude: number; longitude: number };
    destination: { latitude: number; longitude: number };
    departure: string;
  } | null>(null);
  const lastBest = useRef<ReturnType<typeof rankingFingerprint> | null>(null);

  function toggleMapView() {
    setWorkspaceView((current) => {
      if (current === 'map') return mapReturnView.current;
      mapReturnView.current = current;
      return 'map';
    });
  }

  function commitCurrentJourney(journey: Journey) {
    activeGeneration.current += 1;
    activeRef.current = journey;
    recoveryJourney.current = recoverySource(journey);
    setActive(journey);
    setProgressAt(journeyProgressDateTime(journey));
    setSelected(null);
    setWorkspaceView('active');
  }

  async function loadPersistedReports(journeyId: string) {
    setReportsLoading(true);
    setReportsError('');
    try {
      setReports(await passengerApi.listReports(journeyId));
    } catch (cause) {
      setReportsError(errorMessage(cause));
    } finally {
      setReportsLoading(false);
    }
  }

  useEffect(() => {
    let mounted = true;
    const startupGeneration = activeGeneration.current;
    setDeparture(DEMO_REPLAY.departure);
    setProgressAt(initialJakartaDateTime());
    setReportObservedAt(initialJakartaDateTime());
    let storedJourney: string | null = null;
    try {
      storedJourney = localStorage.getItem(journeyKey);
    } catch {
      setError(
        'Penyimpanan browser tidak tersedia. Pemulihan perjalanan dan pengiriman laporan memerlukan penyimpanan yang tersedia.',
      );
    }
    if (storedJourney) {
      void passengerApi
        .getJourney(storedJourney)
        .then(async (journey) => {
          // Never let a slow startup read overwrite a newer generation:
          // a future remount or a switched current journey makes this older
          // mount stale even if it resolves last.
          if (!mounted || startupGeneration !== activeGeneration.current)
            return;
          commitCurrentJourney(journey);
          const generation = activeGeneration.current;
          const source = recoverySource(journey);
          void loadPersistedReports(journey.journey_id);
          const pendingReport = localStorage.getItem(
            `${reportPendingKey}.${journey.journey_id}`,
          );
          if (pendingReport) {
            try {
              const parsed = JSON.parse(pendingReport) as {
                fingerprint?: unknown;
                key?: unknown;
                createdAt?: unknown;
              };
              const createdAt =
                typeof parsed.createdAt === 'number'
                  ? parsed.createdAt
                  : Date.now();
              const stale = Date.now() - createdAt > REPORT_PENDING_TTL_MS;
              const validKey =
                typeof parsed.key === 'string' &&
                /^[A-Za-z0-9._:-]{8,128}$/.test(parsed.key);
              if (stale || !validKey) {
                localStorage.removeItem(
                  `${reportPendingKey}.${journey.journey_id}`,
                );
              } else if (
                typeof parsed.fingerprint === 'string' &&
                typeof parsed.key === 'string'
              ) {
                // Old pending records stored raw JSON; retain them once by
                // re-hashing so unresolved identity is not silently lost.
                const digest = /^sha256:[0-9a-f]{64}$/.test(parsed.fingerprint)
                  ? parsed.fingerprint
                  : `sha256:${await reportAttemptHash(JSON.parse(parsed.fingerprint))}`;
                const pendingKey = parsed.key;
                reportKey.current = { fingerprint: digest, key: pendingKey };
                localStorage.setItem(
                  `${reportPendingKey}.${journey.journey_id}`,
                  JSON.stringify({
                    fingerprint: digest,
                    key: pendingKey,
                    createdAt,
                  }),
                );
                setReportNeedsReconcile(true);
              }
            } catch {
              localStorage.removeItem(
                `${reportPendingKey}.${journey.journey_id}`,
              );
            }
          }
          const storedRecovery = localStorage.getItem(
            `${recoveryKey}.${journey.journey_id}`,
          );
          if (storedRecovery) {
            const requestId = ++recoveryRequestId.current;
            recoveryRequest.current?.controller.abort();
            const controller = new AbortController();
            recoveryRequest.current = { id: requestId, controller };
            void passengerApi
              .getRecovery(storedRecovery, controller.signal)
              .then((recovered) => {
                if (
                  mounted &&
                  canCommitRecovery({
                    requestId,
                    latestRequestId: recoveryRequestId.current,
                    generation,
                    latestGeneration: activeGeneration.current,
                    captured: source,
                    latest: recoveryJourney.current,
                  }) &&
                  recovered.original_journey_id === source.journeyId
                )
                  setRecovery(recovered);
              })
              .catch(() => {
                if (
                  mounted &&
                  canCommitRecovery({
                    requestId,
                    latestRequestId: recoveryRequestId.current,
                    generation,
                    latestGeneration: activeGeneration.current,
                    captured: source,
                    latest: recoveryJourney.current,
                  })
                )
                  localStorage.removeItem(
                    `${recoveryKey}.${journey.journey_id}`,
                  );
              });
          }
        })
        .catch((cause: unknown) => {
          if (!mounted || startupGeneration !== activeGeneration.current)
            return;
          const expiredSession =
            cause instanceof PassengerApiError &&
            cause.status === 403 &&
            cause.code === 'INVALID_SESSION';
          if (
            expiredSession ||
            (cause instanceof PassengerApiError && cause.status === 404)
          ) {
            // Forget only the inaccessible local pointer. Never renew ownership
            // or retry protected reads with a newly minted passenger session.
            localStorage.removeItem(journeyKey);
            activeGeneration.current += 1;
            activeRef.current = null;
            recoveryJourney.current = null;
            setActive(null);
            setSelected(null);
            setRecovery(null);
            setError(
              expiredSession
                ? 'Sesi perjalanan tersimpan sudah berakhir. Cari rute baru untuk memulai sesi baru.'
                : 'Perjalanan tersimpan tidak ditemukan. Silakan mulai lagi.',
            );
          } else {
            setError(errorMessage(cause));
          }
        });
    }
    void refreshPlanningHealth();
    void passengerApi
      .config()
      .then((config) => {
        if (mounted) setSnapshotId(config.network_snapshot_id);
      })
      .catch((cause: unknown) => {
        if (mounted) setError(errorMessage(cause));
      });
    return () => {
      mounted = false;
      activeGeneration.current += 1;
      recoveryRequestId.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!active || active.status !== 'ACTIVE') return;
    let mounted = true;
    const controller = new AbortController();
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let lastEventId: string | null = null;
    let reconnectAttempt = 0;
    const journeyId = active.journey_id;
    const refresh = async () => {
      try {
        const result = await passengerApi.alerts(journeyId);
        if (mounted) {
          setAlerts(result);
          setAlertError('');
        }
      } catch (cause) {
        if (mounted) setAlertError(errorMessage(cause));
      }
    };
    const connect = async () => {
      if (!mounted) return;
      setStreamStatus(reconnectAttempt === 0 ? 'CONNECTING' : 'RECONNECTING');
      try {
        await passengerApi.streamAlerts(
          journeyId,
          lastEventId,
          controller.signal,
          (event) => {
            if (!mounted) return;
            setStreamStatus('CONNECTED');
            reconnectAttempt = 0;
            if (event.type !== 'heartbeat' && event.id) lastEventId = event.id;
            if (
              event.type === 'journey.alert.created' ||
              event.type === 'heartbeat'
            )
              void refresh();
          },
          () => {
            if (!mounted) return;
            setStreamStatus('CONNECTED');
            reconnectAttempt = 0;
            void refresh();
          },
        );
      } catch (cause) {
        if (mounted && !controller.signal.aborted)
          setAlertError(errorMessage(cause));
      }
      if (mounted && !controller.signal.aborted) {
        setStreamStatus('RECONNECTING');
        void refresh();
        reconnectAttempt += 1;
        reconnectTimer = setTimeout(
          () => void connect(),
          Math.min(15_000, 1000 * 2 ** Math.min(reconnectAttempt, 4)),
        );
      }
    };
    void refresh();
    void connect();
    return () => {
      mounted = false;
      controller.abort();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [active?.journey_id, active?.status]);

  // Device-local navigation; scope resets on recovery/geometry replacement.
  useEffect(() => {
    const leg =
      active?.status === 'ACTIVE'
        ? active.segments.find(
            (segment) =>
              segment.sequence ===
              (active.progress?.completed_segment_count ?? 0),
          )
        : null;
    if (!active || !leg || leg.mode !== 'WALK') {
      if (
        navLegKey.current !== null ||
        navHistory.current.length > 0 ||
        walkNavigation.current !== null ||
        walkStateRef.current.key !== null
      ) {
        navHistory.current = [];
        navLegKey.current = null;
        lastNavSampleTimestamp.current = null;
        walkNavigation.current = null;
        const reset = { key: null, progress: initialWalkProgress() };
        walkStateRef.current = reset;
        setWalkState(reset);
      }
      return;
    }
    const key = navigationScopeKey(
      active.journey_id,
      active.accepted_recovery_id,
      leg,
    );
    const changed = navLegKey.current !== key;
    if (changed) {
      navLegKey.current = key;
      navHistory.current = [];
      lastNavSampleTimestamp.current = null;
      walkNavigation.current = prepareWalkNavigation(leg);
      const reset = { key, progress: initialWalkProgress() };
      walkStateRef.current = reset;
      setWalkState(reset);
    }
    const prepared = walkNavigation.current;
    const fix = device.position;
    const base =
      walkStateRef.current.key === key
        ? walkStateRef.current.progress
        : initialWalkProgress();
    if (navigationPaused) {
      navHistory.current = [];
      const paused = {
        ...base,
        reliableFixes: 0,
        alongMeters: null,
        lastTimestamp: null,
        status: 'PAUSED' as const,
      };
      walkStateRef.current = { key, progress: paused };
      setWalkState({ key, progress: paused });
      return;
    }
    if (!fix) return;
    if (!device.navigationGrade || device.state !== 'GPS_TRACKING') {
      if (base.status !== 'UNCERTAIN' || base.reliableFixes !== 0) {
        const uncertain = {
          ...base,
          reliableFixes: 0,
          status: 'UNCERTAIN' as const,
        };
        walkStateRef.current = { key, progress: uncertain };
        setWalkState({ key, progress: uncertain });
      }
      navHistory.current = [];
      return;
    }
    if (base.status === 'PAUSED') {
      const resumed = {
        ...base,
        reliableFixes: 0,
        status: 'UNCERTAIN' as const,
      };
      walkStateRef.current = { key, progress: resumed };
      setWalkState({ key, progress: resumed });
    }
    if (fix.timestamp === lastNavSampleTimestamp.current) return;
    lastNavSampleTimestamp.current = fix.timestamp;
    if (prepared) {
      const next = updateWalkProgress(prepared, base, fix, Date.now());
      walkStateRef.current = { key, progress: next };
      setWalkState({ key, progress: next });
    }
    navHistory.current = [
      ...navHistory.current.slice(-(OFF_ROUTE_HISTORY - 1)),
      { distance: distanceToPathMeters(fix, pathPoints(leg)) },
    ];
  }, [
    active,
    device.position?.timestamp,
    device.navigationGrade,
    device.state,
    navigationPaused,
  ]);

  async function refreshPlanningHealth() {
    if (planningHealthBusy) return;
    setPlanningHealthBusy(true);
    try {
      const health = await passengerApi.planningHealth();
      setPlanningHealth({
        status: health.status,
        checkedAt: health.checked_at,
      });
    } catch {
      setPlanningHealth({
        status: 'UNAVAILABLE',
        checkedAt: new Date().toISOString(),
      });
    } finally {
      setPlanningHealthBusy(false);
    }
  }

  async function planJourney(
    origin: {
      latitude: number;
      longitude: number;
    },
    destination: { latitude: number; longitude: number },
    departureAt: string,
    requested: JourneyPreference,
  ) {
    const priorPref = preferenceRef.current;
    const priorFingerprint =
      lastPlan.current &&
      lastPlan.current.origin.latitude === origin.latitude &&
      lastPlan.current.origin.longitude === origin.longitude &&
      lastPlan.current.destination.latitude === destination.latitude &&
      lastPlan.current.destination.longitude === destination.longitude &&
      lastPlan.current.departure === departureAt
        ? lastBest.current
        : null;
    const requestId = ++planRequestId.current;
    planRequest.current?.controller.abort();
    const controller = new AbortController();
    planRequest.current = { id: requestId, controller };
    lastPlan.current = { origin, destination, departure: departureAt };
    setError('');
    setMessage('');
    setRankingMessage('');
    setBusy('search');
    setAlternatives([]);
    setSelected(null);
    try {
      if (!snapshotId)
        throw new Error(
          'Routing snapshot is not ready. Check the passenger configuration.',
        );
      const results = await passengerApi.plan(
        {
          origin: { latitude: origin.latitude, longitude: origin.longitude },
          destination: {
            latitude: destination.latitude,
            longitude: destination.longitude,
          },
          departure_at: toJakartaIso(departureAt),
          network_snapshot_id: snapshotId,
          preference: requested,
        },
        controller.signal,
      );
      if (requestId !== planRequestId.current) return;
      setAlternatives(results);
      const best = results[0];
      setSelected(best ?? null);
      preferenceRef.current = requested;
      const fingerprint = best ? rankingFingerprint(best) : null;
      lastBest.current = fingerprint;
      if (best && fingerprint) {
        if (
          priorFingerprint &&
          requested !== priorPref &&
          sameRankingCandidate(priorFingerprint, fingerprint)
        ) {
          setRankingMessage(
            rankingExplanation(
              priorPref,
              requested,
              fingerprint,
              results.length,
            ),
          );
        }
      } else {
        setMessage(
          'No journey was found for this place and departure time. Try another time or destination.',
        );
      }
    } catch (cause) {
      if (requestId !== planRequestId.current) return;
      const feedback = journeySearchFailure(cause);
      if (feedback.empty) setMessage(feedback.message);
      else setError(feedback.message);
    } finally {
      if (requestId === planRequestId.current) {
        planRequest.current = null;
        setBusy(null);
      }
    }
  }

  function invalidatePlanningInputs() {
    planRequestId.current += 1;
    planRequest.current?.controller.abort();
    planRequest.current = null;
    lastPlan.current = null;
    lastBest.current = null;
    setAlternatives([]);
    setSelected(null);
    setRankingMessage('');
    setBusy((current) => (current === 'search' ? null : current));
  }

  function changePreference(next: JourneyPreference) {
    // Preference state updates visibly even when replanning is not allowed.
    setRankingMessage('');
    setPreference(next);
    if (!lastPlan.current) return;
    try {
      void planJourney(
        endpointCoords('origin'),
        endpointCoords('destination'),
        departure,
        next,
      );
    } catch (cause) {
      invalidatePlanningInputs();
      setError(errorMessage(cause));
    }
  }

  function chooseEndpointMode(
    endpoint: 'origin' | 'destination',
    mode: 'place' | 'pin' | 'current' | 'coordinates',
  ) {
    invalidatePlanningInputs();
    setInputModes((current) => ({ ...current, [endpoint]: mode }));
    if (mode === 'place') {
      if (endpoint === 'origin') setOriginPin(null);
      else setDestinationPin(null);
      if (selectionMode === endpoint) setSelectionMode(null);
    } else if (mode === 'pin') {
      if (endpoint === 'origin') {
        setOriginPlace(null);
        setOriginPin(null);
      } else {
        setDestinationPlace(null);
        setDestinationPin(null);
      }
      setSelectionMode(endpoint);
    } else if (mode === 'current') {
      if (selectionMode === endpoint) setSelectionMode(null);
      if (endpoint === 'origin') {
        setOriginPlace(null);
        setOriginPin(null);
      } else {
        setDestinationPlace(null);
        setDestinationPin(null);
      }
      device.start();
    } else {
      if (selectionMode === endpoint) setSelectionMode(null);
      if (mode === 'coordinates') setAdvancedCoordinates(true);
    }
  }

  function endpointCoords(endpoint: 'origin' | 'destination'): {
    latitude: number;
    longitude: number;
  } {
    const current = device.position;
    const fresh = gpsNavigationReady(current, device.state) ? current : null;
    if (endpoint === 'origin') {
      if (inputModes.origin === 'coordinates')
        return parsePoint(originLat, originLon);
      if (inputModes.origin === 'current') {
        if (!fresh)
          throw new Error(
            'GPS belum cukup akurat. Tunggu sinyal membaik atau gunakan titik peta yang Anda konfirmasi.',
          );
        return { latitude: fresh.latitude, longitude: fresh.longitude };
      }
      if (inputModes.origin === 'pin') {
        if (!originPin) throw new Error('Pilih titik awal pada peta.');
        return originPin;
      }
      if (!originPlace)
        throw new Error(
          'Pilih titik awal dari saran tempat, atau gunakan titik peta.',
        );
      return originPlace;
    }
    if (inputModes.destination === 'coordinates')
      return parsePoint(destinationLat, destinationLon);
    if (inputModes.destination === 'current') {
      if (!fresh)
        throw new Error(
          'GPS belum cukup akurat. Tunggu sinyal membaik atau gunakan titik peta yang Anda konfirmasi.',
        );
      return { latitude: fresh.latitude, longitude: fresh.longitude };
    }
    if (inputModes.destination === 'pin') {
      if (!destinationPin) throw new Error('Pilih titik tujuan pada peta.');
      return destinationPin;
    }
    if (!destinationPlace)
      throw new Error(
        'Pilih tujuan dari saran tempat, atau gunakan titik peta.',
      );
    return destinationPlace;
  }

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const origin = endpointCoords('origin');
      const destination = endpointCoords('destination');
      await planJourney(origin, destination, departure, preference);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function loadScenario() {
    setError('');
    setMessage('');
    setInputModes({ origin: 'place', destination: 'place' });
    setSelectionMode(null);
    setOriginPin(null);
    setDestinationPin(null);
    setOriginPlace(DEMO_REPLAY.origin);
    setDestinationPlace(DEMO_REPLAY.destination);
    setDeparture(DEMO_REPLAY.departure);
    setPreference('FEWEST_TRANSFERS');
    setAdvancedCoordinates(false);
    await planJourney(
      DEMO_REPLAY.origin,
      DEMO_REPLAY.destination,
      DEMO_REPLAY.departure,
      'FEWEST_TRANSFERS',
    );
  }

  async function activate() {
    if (!selected) return;
    setBusy('activate');
    setError('');
    setMessage('');
    try {
      const historical = Date.parse(selected.start_at) < Date.now() - 60_000;
      const keyName = `${activationKey}.${selected.journey_id}`;
      const attemptKey = localStorage.getItem(keyName) ?? crypto.randomUUID();
      localStorage.setItem(keyName, attemptKey);
      const journey = await passengerApi.activate(
        selected,
        attemptKey,
        historical ? selected.start_at : undefined,
      );
      localStorage.removeItem(keyName);
      commitCurrentJourney(journey);
      setRecoveryStatus(null);
      acceptingRecovery.current = null;
      setAlerts([]);
      setRecovery(null);
      localStorage.setItem(journeyKey, journey.journey_id);
      setReports([]);
      setReportsError('');
      setReportStatus('');
      setReportFormError('');
      void loadPersistedReports(journey.journey_id);
      setMessage(
        historical
          ? 'Perjalanan uji dimulai memakai jadwal historis. Tandai tahapan secara manual.'
          : 'Perjalanan dimulai. Tandai tahapan secara manual; lokasi perangkat bersifat opsional.',
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  }

  async function confirmBoarding() {
    if (!active || currentLeg === null) return;
    setBusy('boarding');
    setError('');
    try {
      const updated = await passengerApi.confirmBoarding(
        active.journey_id,
        currentLeg.sequence,
        toJakartaIso(progressAt),
        active.accepted_recovery_id ?? null,
      );
      commitCurrentJourney(updated);
      setMessage(
        `Naik dicatat pada bagian ${currentLeg.sequence + 1}: ${currentLeg.from.name}.`,
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  }

  async function confirmAlighting() {
    if (!active || currentLeg === null) return;
    setBusy('alighting');
    setError('');
    try {
      const alighted = await passengerApi.confirmAlighting(
        active.journey_id,
        currentLeg.sequence,
        toJakartaIso(progressAt),
        active.accepted_recovery_id ?? null,
      );
      commitCurrentJourney(alighted);
      setMessage(
        `Turun dicatat pada bagian ${currentLeg.sequence + 1}: ${currentLeg.to.name}.`,
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  }

  async function advanceLeg() {
    if (!active) return;
    const next = (active.progress?.completed_segment_count ?? 0) + 1;
    if (next > active.segments.length) return;
    setBusy('progress');
    setError('');
    try {
      const updated = await passengerApi.progress(
        active.journey_id,
        next,
        active.segments.length,
        toJakartaIso(progressAt),
        active.accepted_recovery_id ?? null,
      );
      commitCurrentJourney(updated);
      setMessage(
        updated.status === 'COMPLETED'
          ? 'Perjalanan selesai.'
          : `${next} dari ${updated.segments.length} bagian perjalanan selesai.`,
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  }

  function resetReportAttempt() {
    if (reportNeedsReconcile) return;
    reportKey.current = null;
  }

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      const journeyId = activeRef.current?.journey_id;
      if (!journeyId || event.key !== `${reportPendingKey}.${journeyId}`)
        return;
      if (event.newValue) {
        try {
          const pending = JSON.parse(event.newValue) as {
            fingerprint?: unknown;
            key?: unknown;
          };
          if (
            typeof pending.fingerprint === 'string' &&
            /^sha256:[0-9a-f]{64}$/.test(pending.fingerprint) &&
            typeof pending.key === 'string' &&
            /^[A-Za-z0-9._:-]{8,128}$/.test(pending.key)
          )
            reportKey.current = {
              fingerprint: pending.fingerprint,
              key: pending.key,
            };
        } catch {
          return;
        }
      }
      if (!reportKey.current) return;
      setReportNeedsReconcile(true);
      setReportStatus(
        'Status laporan berubah pada tab lain. Periksa status laporan untuk menyamakan hasil server.',
      );
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  async function replayPendingReport() {
    if (!active || !reportNeedsReconcile || !reportKey.current) return;
    const target =
      reportTargets.find((item) => item.key === reportTargetKey) ?? null;
    if (
      !target ||
      !canReplayPendingReport(
        reportKey.current.key,
        localReportAttemptKey.current,
        !!target && isValidReportDescription(reportDescription),
      )
    ) {
      setReportsError(
        'Isi laporan asli tidak tersedia. Periksa status; jangan membuat laporan baru sampai hasil upaya ini diketahui.',
      );
      return;
    }
    let observedAt: string;
    try {
      observedAt = new Date(toJakartaIso(reportObservedAt)).toISOString();
    } catch {
      setReportsError('Waktu laporan asli tidak valid; replay dibatalkan.');
      return;
    }
    const input = {
      active_journey_id: active.journey_id,
      category: reportCategory,
      observed_at: observedAt,
      mobility_entity_id: target.id,
      entity_type: target.type,
      description: reportDescription.trim(),
    };
    const pending = reportKey.current;
    if (`sha256:${await reportAttemptHash(input)}` !== pending.fingerprint) {
      setReportsError(
        'Isi laporan berubah sejak upaya tertunda. Kembalikan isi asli lalu replay, atau periksa status tanpa mengirim.',
      );
      return;
    }
    setReportsLoading(true);
    setReportsError('');
    try {
      const send = async () => {
        // Revalidate journey ownership after session changes, before any replay.
        const journey = await passengerApi.getJourney(active.journey_id);
        if (journey.status === 'COMPLETED')
          throw new Error(
            'Perjalanan selesai; hanya pemeriksaan status tersedia.',
          );
        const existing = await passengerApi.lookupReport(pending.key);
        return existing ?? passengerApi.submitReport(input, pending.key);
      };
      const report = navigator.locks
        ? await navigator.locks.request(
            `transumin-report:${active.journey_id}`,
            { mode: 'exclusive' },
            send,
          )
        : await send();
      if (!report)
        throw new Error(
          'Status laporan belum tersedia. Periksa kembali sebelum mengirim ulang.',
        );
      if (activeRef.current?.journey_id !== active.journey_id) return;
      applyReconciledReport(report, active.journey_id);
    } catch (cause) {
      setReportsError(`Replay aman belum selesai: ${errorMessage(cause)}`);
      setReportNeedsReconcile(true);
    } finally {
      setReportsLoading(false);
    }
  }

  function applyReconciledReport(report: PassengerReport, journeyId: string) {
    if (report.active_journey_id !== journeyId)
      throw new Error('Laporan ini milik perjalanan lain.');
    setReports((current) => [
      report,
      ...current.filter((item) => item.report_id !== report.report_id),
    ]);
    setReportStatus(
      `Laporan tersimpan ${report.report_id} · Belum diverifikasi. Tidak ada pengiriman ulang.`,
    );
    setReportDescription('');
    setReportFormError('');
    setReportNeedsReconcile(false);
    localStorage.removeItem(`${reportPendingKey}.${journeyId}`);
    reportKey.current = null;
  }

  async function submitPassengerReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!active || reportNeedsReconcile) return;
    setReportFormError('');
    setReportStatus('');
    const target =
      reportTargets.find((item) => item.key === reportTargetKey) ?? null;
    if (!target) {
      setReportFormError(
        'Pilih lokasi atau layanan pada sisa perjalanan sebelum mengirim.',
      );
      return;
    }
    if (!isValidReportDescription(reportDescription)) {
      setReportFormError(
        'Keterangan wajib 1–2000 karakter dan tidak boleh memuat karakter kontrol.',
      );
      return;
    }
    let observedAt: string;
    try {
      observedAt = new Date(toJakartaIso(reportObservedAt)).toISOString();
    } catch {
      setReportFormError('Pilih waktu kejadian yang valid (WIB).');
      return;
    }
    const input = {
      active_journey_id: active.journey_id,
      category: reportCategory,
      observed_at: observedAt,
      mobility_entity_id: target.id,
      entity_type: target.type,
      description: reportDescription.trim(),
    };
    const fingerprintHash = `sha256:${await reportAttemptHash(input)}`;
    const storageKey = `${reportPendingKey}.${active.journey_id}`;
    const allocateAttempt = () => {
      let storedAttempt: {
        fingerprint?: unknown;
        key?: unknown;
        createdAt?: unknown;
      } | null = null;
      try {
        const stored = localStorage.getItem(storageKey);
        storedAttempt = stored ? JSON.parse(stored) : null;
      } catch {
        try {
          localStorage.removeItem(storageKey);
        } catch {
          void 0;
        }
      }
      const isSameLogicalAttempt =
        storedAttempt?.fingerprint === fingerprintHash;
      const notExpired =
        typeof storedAttempt?.createdAt === 'number' &&
        Date.now() - storedAttempt.createdAt <= REPORT_PENDING_TTL_MS;
      const storedKey =
        typeof storedAttempt?.key === 'string' &&
        /^[A-Za-z0-9._:-]{8,128}$/.test(storedAttempt.key)
          ? storedAttempt.key
          : null;
      if (storedKey && notExpired && !isSameLogicalAttempt) {
        reportKey.current = {
          fingerprint: String(storedAttempt?.fingerprint),
          key: storedKey,
        };
        setReportNeedsReconcile(true);
        setReportFormError(
          'Tab lain memiliki laporan tertunda. Periksa status sebelum membuat laporan baru.',
        );
        return null;
      }
      const attempt = {
        fingerprint: fingerprintHash,
        key:
          isSameLogicalAttempt && notExpired && storedKey
            ? storedKey
            : reportKey.current?.fingerprint === fingerprintHash
              ? reportKey.current.key
              : crypto.randomUUID(),
      };
      try {
        localStorage.setItem(
          storageKey,
          JSON.stringify({
            ...attempt,
            createdAt:
              isSameLogicalAttempt && notExpired
                ? storedAttempt?.createdAt
                : Date.now(),
          }),
        );
      } catch {
        setReportFormError(
          'Penyimpanan browser tidak tersedia. Laporan tidak dikirim.',
        );
        return null;
      }
      return attempt;
    };
    const attempt = navigator.locks
      ? await navigator.locks.request(
          `transumin-report:${active.journey_id}`,
          { mode: 'exclusive' },
          allocateAttempt,
        )
      : allocateAttempt();
    if (!attempt) return;
    reportKey.current = attempt;
    localReportAttemptKey.current = attempt.key;
    setBusy('report');
    try {
      const report = await passengerApi.submitReport(input, attempt.key);
      setReports((current) => [
        report,
        ...current.filter((item) => item.report_id !== report.report_id),
      ]);
      setReportStatus(
        `Laporan tersimpan ${report.report_id} · ${passengerReportStatusLabel(
          report.verification_status,
        )}. Laporan bukan konfirmasi penutupan layanan dan tetap tersimpan setelah refresh.`,
      );
      setReportDescription('');
      setReportNeedsReconcile(false);
      localStorage.removeItem(`${reportPendingKey}.${active.journey_id}`);
      reportKey.current = null;
    } catch (cause) {
      if (
        active &&
        cause instanceof PassengerApiError &&
        (cause.code === 'REQUEST_TIMEOUT' || cause.code === 'NETWORK_ERROR')
      ) {
        setReportFormError(
          cause.code === 'REQUEST_TIMEOUT'
            ? 'Permintaan batas waktu habis. Status laporan belum pasti. Periksa status laporan sebelum mengirim lagi.'
            : 'Koneksi terputus. Status laporan belum pasti. Periksa status laporan sebelum mengirim lagi.',
        );
        setReportNeedsReconcile(true);
        return;
      }
      if (
        cause instanceof PassengerApiError &&
        cause.code === 'INVALID_RESPONSE'
      ) {
        setReportFormError(
          'Respons server tidak valid. Muat status nyata sebelum mengirim laporan berikutnya.',
        );
        setReportNeedsReconcile(true);
        return;
      }
      const apiError = cause instanceof PassengerApiError ? cause : null;
      if (apiError?.status === 429 && apiError.code === 'RATE_LIMITED') {
        // Authoritative pre-insert rejection, not an unknown mutation. Keep
        // identity in memory for deliberate retry; reload has no pending write.
        setReportNeedsReconcile(false);
        try {
          localStorage.removeItem(storageKey);
        } catch {
          // In-memory identity still prevents a new key on deliberate retry.
        }
        const retry =
          typeof apiError.retryAfterSeconds === 'number'
            ? ` Coba lagi dalam ${apiError.retryAfterSeconds} detik.`
            : '';
        setReportFormError(
          `Batas pengiriman laporan telah tercapai. Anda dapat mencoba kembali setelah periode pembatasan berakhir.${retry}`,
        );
        return;
      }
      setReportFormError(
        `Laporan gagal dikirim: ${errorMessage(cause)} Coba lagi.`,
      );
    } finally {
      setBusy(null);
    }
  }

  async function reconcileUnknownReport() {
    const pending = reportKey.current;
    const journeyId = active?.journey_id;
    if (!pending || !journeyId) return;
    // Exact identity: the server persists (owner, idempotency key) uniquely, so
    // a key lookup is a definitive committed-or-not answer for this attempt.
    setReportsLoading(true);
    setReportsError('');
    try {
      let found = await passengerApi.lookupReport(pending.key);
      for (const delay of [1000, 2000]) {
        if (found) break;
        await new Promise((resolve) => setTimeout(resolve, delay));
        found = await passengerApi.lookupReport(pending.key);
      }
      if (activeRef.current?.journey_id !== journeyId) return;
      if (found && found.active_journey_id !== journeyId)
        throw new Error('Laporan ini milik perjalanan lain.');
      if (found) {
        applyReconciledReport(found, journeyId);
      } else {
        // Null is deliberately ambiguous: the transaction may still be running,
        // or this browser may now have a different owner session. Keep the key
        // blocked; never replay it under an owner that cannot be proven equal.
        setReportStatus(
          'Laporan belum terlihat setelah 3 pemeriksaan. Permintaan awal mungkin masih diproses atau sesi telah berubah. Jangan kirim ulang; periksa kembali status nanti.',
        );
        setReportNeedsReconcile(true);
      }
    } catch (cause) {
      setReportsError(
        `Status laporan belum dapat dipastikan: ${errorMessage(cause)}`,
      );
    } finally {
      setReportsLoading(false);
    }
  }

  async function refreshPassengerReport(reportId: string) {
    setBusy('report');
    setReportsError('');
    try {
      const report = await passengerApi.getReport(reportId);
      setReports((current) =>
        current.map((item) =>
          item.report_id === report.report_id ? report : item,
        ),
      );
      setReportStatus(
        `Laporan ${report.report_id} · ${passengerReportStatusLabel(
          report.verification_status,
        )}. Status menunjukkan riwayat pemeriksaan. Lihat informasi gangguan untuk masa berlaku pembatasan.`,
      );
    } catch (cause) {
      setReportsError(
        `Status laporan tidak dapat dimuat ulang: ${errorMessage(cause)}`,
      );
    } finally {
      setBusy(null);
    }
  }

  async function proposeRecovery(alert: JourneyAlert, fresh = false) {
    setWorkspaceView('disruptions');
    const current = activeRef.current;
    if (!current || !alertIsCurrent(alert)) return;
    const scope = `${current.journey_id}:${alert.impact_id}:${current.progress?.revision ?? 0}:${current.accepted_recovery_id ?? 'G0'}`;
    if (fresh && (!recovery || recoveryAttempt.current?.known !== true)) {
      setError(
        'Hasil pemulihan belum pasti. Coba lagi dengan identitas yang sama.',
      );
      return;
    }
    if (fresh) {
      setRecovery(null);
      setAcceptance(null);
      setRecoveryStatus(null);
      comparisonSource.current = null;
    }
    const prior =
      recoveryAttempt.current?.scope === scope ? recoveryAttempt.current : null;
    const attempt = nextRecoveryAttempt(prior, fresh);
    const attemptNonce = attempt.nonce;
    recoveryAttempt.current = { scope, ...attempt };
    const requestId = ++recoveryRequestId.current;
    recoveryRequest.current?.controller.abort();
    const controller = new AbortController();
    const source = recoverySource(current);
    const generation = activeGeneration.current;
    recoveryRequest.current = { id: requestId, controller };
    setBusy('recovery');
    setError('');
    try {
      const key = recoveryProposalKey({
        journeyId: current.journey_id,
        impactId: alert.impact_id,
        revision: source.revision,
        acceptedRecoveryId: source.acceptedRecoveryId,
        attemptNonce,
      });
      const timeKey = `transumin.recovery-at.${key}`;
      let recoveryAt = localStorage.getItem(timeKey);
      if (!recoveryAt) {
        recoveryAt = current.progress?.recorded_at ?? new Date().toISOString();
        localStorage.setItem(timeKey, recoveryAt);
      }
      const result = await passengerApi.recovery(
        current.journey_id,
        alert.impact_id,
        key,
        recoveryAt,
        controller.signal,
      );
      if (
        !canCommitRecovery({
          requestId,
          latestRequestId: recoveryRequestId.current,
          generation,
          latestGeneration: activeGeneration.current,
          captured: source,
          latest: recoveryJourney.current,
        }) ||
        result.original_journey_id !== source.journeyId
      )
        return;
      recoveryAttempt.current = { ...recoveryAttempt.current, known: true };
      comparisonSource.current = {
        recoveryId: result.recovery_id,
        journey: current,
      };
      setRecovery(result);
      setAcceptance(null);
      acceptKey.current = null;
      localStorage.setItem(
        `${recoveryKey}.${current.journey_id}`,
        result.recovery_id,
      );
      setMessage(
        result.status === 'COMPLETED'
          ? 'Rute pengganti tersedia. Perjalanan aktif Anda belum berubah.'
          : recoverySummary(result),
      );
    } catch (cause) {
      if (requestId !== recoveryRequestId.current) return;
      if (
        cause instanceof Error &&
        (cause.name === 'AbortError' ||
          (cause as { cause?: unknown }).cause instanceof DOMException)
      )
        return;
      setError(errorMessage(cause));
    } finally {
      if (requestId === recoveryRequestId.current) {
        recoveryRequest.current = null;
        setBusy(null);
      }
    }
  }

  async function acceptRecovery(readOnly = false) {
    const current = activeRef.current;
    const proposal = recovery;
    if (
      !current ||
      !proposal ||
      acceptingRecovery.current ||
      proposal.original_journey_id !== current.journey_id
    )
      return;
    if (!readOnly && recoveryStatus) return;
    if (
      !readOnly &&
      (proposal.status !== 'COMPLETED' ||
        !proposal.proposed_journey ||
        (current.progress?.revision ?? 0) !== proposal.progress_revision)
    ) {
      setError(
        'Perjalanan sudah berubah atau proposal tidak aman. Cari rute pengganti terbaru.',
      );
      return;
    }
    const original = recoveryComparisonSource(
      current,
      proposal,
      comparisonSource.current,
    );
    if (original)
      comparisonSource.current = {
        recoveryId: proposal.recovery_id,
        journey: original,
      };
    const source = recoverySource(current);
    const generation = activeGeneration.current;
    const requestId = ++recoveryRequestId.current;
    const controller = new AbortController();
    recoveryRequest.current?.controller.abort();
    recoveryRequest.current = { id: requestId, controller };
    acceptingRecovery.current = { key: proposal.recovery_id, id: requestId };
    const canCommit = () =>
      canCommitRecovery({
        requestId,
        latestRequestId: recoveryRequestId.current,
        generation,
        latestGeneration: activeGeneration.current,
        captured: source,
        latest: recoveryJourney.current,
      });
    setBusy('recovery');
    setError('');
    setMessage('');
    let receipt: RecoveryAcceptance | null = null;
    let postFailure: unknown = null;
    try {
      if (!readOnly) {
        if (!acceptKey.current) acceptKey.current = crypto.randomUUID();
        try {
          receipt = await passengerApi.acceptRecovery(
            proposal.recovery_id,
            proposal.progress_revision,
            acceptKey.current,
            controller.signal,
          );
        } catch (cause) {
          postFailure = cause;
        }
      }
      if (!canCommit()) return;
      setRecoveryStatus('RECONCILING');
      // POST outcome may be unknown. Only authoritative reads decide what
      // happened; a retry of this branch never issues another mutation.
      const authoritative = await passengerApi.reconcileRecovery(
        current.journey_id,
        proposal.recovery_id,
        controller.signal,
      );
      if (!canCommit()) return;
      const outcome = acceptanceReconcileOutcome({
        journey: authoritative.journey,
        recoveryId: proposal.recovery_id,
      });
      commitCurrentJourney(authoritative.journey);
      setRecovery(authoritative.recovery);
      setRecoveryStatus(null);
      if (outcome === 'APPLIED') {
        setAcceptance(receipt);
        setMessage(
          'Rute pengganti diterima. Rute aktif mengikuti rute pengganti.',
        );
      } else {
        setAcceptance(null);
        setError(
          postFailure
            ? errorMessage(postFailure)
            : 'Rute pengganti ini belum menjadi rute aktif. Tinjau status server sebelum mencoba lagi.',
        );
      }
    } catch (cause) {
      if (!canCommit()) return;
      setRecoveryStatus('NEEDS_RECONCILE');
      setError(
        receipt
          ? 'Recovery diterima server, tetapi rute aktif belum dapat dimuat. Muat ulang status; jangan kirim penerimaan baru.'
          : `Status penerimaan belum dapat dipastikan. Muat ulang status tanpa mengirim penerimaan baru. ${errorMessage(cause)}`,
      );
    } finally {
      if (requestId === recoveryRequestId.current) {
        recoveryRequest.current = null;
        acceptingRecovery.current = null;
        setBusy(null);
      }
    }
  }

  const recoveryWorkspace =
    workspaceView === 'disruptions' ||
    (workspaceView === 'map' && mapReturnView.current === 'disruptions');
  const activeWorkspace =
    workspaceView === 'active' ||
    recoveryWorkspace ||
    (workspaceView === 'map' && mapReturnView.current === 'active');
  const displayed = activeWorkspace ? active : selected;
  const displayingActive =
    !!displayed && !!active && displayed.journey_id === active.journey_id;
  const completed = active?.progress?.completed_segment_count ?? 0;
  const currentLeg =
    displayingActive && active.status === 'ACTIVE'
      ? (active.segments.find((segment) => segment.sequence === completed) ??
        null)
      : null;
  const boardedLeg =
    active?.progress?.boarding_confirmed_segment_sequence ?? null;
  const alightedLeg =
    active?.progress?.alighting_confirmed_segment_sequence ?? null;
  const journeyFinished = active?.status === 'COMPLETED';
  const isTransitLeg = currentLeg !== null && currentLeg.mode !== 'WALK';
  const currentBoarded =
    currentLeg !== null && boardedLeg === currentLeg.sequence;
  const currentAlighted =
    currentLeg !== null && alightedLeg === currentLeg.sequence;
  const easiestIds = easiestAmongShown(alternatives);
  const reportTargets =
    active?.status === 'ACTIVE'
      ? remainingReportTargets(active, completed)
      : [];
  const reportTargetValid = reportTargets.some(
    (item) => item.key === reportTargetKey,
  );
  const reportReplayAvailable = canReplayPendingReport(
    reportKey.current?.key ?? null,
    localReportAttemptKey.current,
    reportTargetValid && isValidReportDescription(reportDescription),
  );
  const originalComparison = recoveryComparisonSource(
    active,
    recovery,
    comparisonSource.current,
  );
  const currentAlerts = alerts.filter(alertIsCurrent);
  const historicalAlerts = alerts.filter((alert) => !alertIsCurrent(alert));
  const boarding: { boarded: boolean; alighted: boolean } = {
    boarded: currentLeg !== null && boardedLeg === currentLeg.sequence,
    alighted: currentLeg !== null && alightedLeg === currentLeg.sequence,
  };
  const segments = active?.segments ?? [];
  const navMode: NavMode =
    displayingActive && active.status === 'ACTIVE'
      ? navigationMode(segments, completed, boarding)
      : 'PREPARING';
  const currentWalkLeg = currentLeg?.mode === 'WALK' ? currentLeg : null;
  const currentWalkNavigation = currentWalkLeg
    ? prepareWalkNavigation(currentWalkLeg)
    : null;
  // ponytail: concise hash identity; never emit full geometry/steps JSON to DOM.
  const walkScopeKey =
    active && currentWalkLeg
      ? `${active.journey_id}:${active.accepted_recovery_id ?? 'ORIGINAL'}:${walkGeometryIdentity(currentWalkLeg)}`
      : null;
  const scopedWalkProgress =
    currentWalkNavigation && walkState.key === walkScopeKey
      ? walkState.progress
      : null;
  const navGuidance =
    displayingActive && active.status === 'ACTIVE'
      ? nextGuidance(
          segments,
          completed,
          boarding,
          scopedWalkProgress ?? undefined,
        )
      : null;
  const offRouteActive =
    displayingActive && active.status === 'ACTIVE' && isWalkingMode(navMode)
      ? isOffRoute(navHistory.current, pathPoints(currentLeg))
      : false;
  const offRoute = displayingActive && !navigationPaused && offRouteActive;
  return (
    <main className="passenger-shell">
      <header className="passenger-header">
        <a
          className="passenger-brand"
          href="#search-heading"
          onClick={() => setWorkspaceView('plan')}
        >
          <span className="brand-symbol">
            <Image
              src="/nexus-mark.png"
              alt=""
              width={41}
              height={41}
              unoptimized
            />
          </span>
          TRANSUM-IN NEXUS
        </a>
        <nav className="workspace-nav" aria-label="Navigasi penumpang">
          <button
            type="button"
            aria-current={workspaceView === 'plan' ? 'page' : undefined}
            onClick={() => setWorkspaceView('plan')}
          >
            <PathIcon size={22} />
            <span>Rencanakan</span>
          </button>
          <button
            type="button"
            disabled={!active}
            aria-current={workspaceView === 'active' ? 'page' : undefined}
            onClick={() => {
              setWorkspaceView('active');
            }}
          >
            <BusIcon size={22} />
            <span>Perjalanan Aktif</span>
          </button>
          <button
            type="button"
            disabled={!active}
            aria-current={workspaceView === 'disruptions' ? 'page' : undefined}
            onClick={() => {
              setWorkspaceView('disruptions');
            }}
          >
            <WarningCircleIcon size={23} />
            <span>Gangguan</span>
          </button>
          <button
            type="button"
            aria-current={workspaceView === 'map' ? 'page' : undefined}
            onClick={toggleMapView}
          >
            <MapTrifoldIcon size={22} />
            <span>Peta</span>
          </button>
          <a href="/ops/login">
            <ChartBarIcon size={22} />
            <span>Analisis</span>
          </a>
        </nav>
        <span className="workspace-region">
          <MapPinIcon size={20} />
          Jakarta &amp; Jabodetabek
        </span>
        <a
          className="workspace-account"
          href="/ops/login"
          aria-label="Masuk akun"
        >
          <UserIcon size={18} />
        </a>
      </header>
      {workspaceView !== 'plan' && error && (
        <div className="workspace-error feedback error" role="alert">
          <p>{error}</p>
          <div className="text-button-row">
            <button
              type="button"
              className="text-button"
              onClick={() => window.location.reload()}
            >
              Muat ulang halaman
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => setError('')}
            >
              Tutup pesan
            </button>
          </div>
        </div>
      )}
      <div className="passenger-layout" data-view={workspaceView}>
        <section className="passenger-main" aria-labelledby="search-heading">
          <div className="planner-panel">
            <div className="section-intro">
              <h1 id="search-heading" aria-label="Rencanakan perjalanan">
                Rencanakan Perjalanan
              </h1>
              <p>Temukan rute transportasi umum di Jakarta dan sekitarnya.</p>
              <details className="service-details">
                <summary>Status layanan &amp; contoh perjalanan</summary>
                <p className="endpoint-note" role="status">
                  {planningHealth
                    ? `Layanan pencarian: ${
                        planningHealth.status === 'AVAILABLE'
                          ? `tersedia (diperiksa ${planningHealth.checkedAt})`
                          : `belum tersedia sejak ${planningHealth.checkedAt}; perjalanan aktif tetap tersimpan`
                      }.`
                    : 'Status layanan pencarian belum diperiksa.'}{' '}
                  <button
                    type="button"
                    className="text-button"
                    disabled={planningHealthBusy}
                    onClick={() => void refreshPlanningHealth()}
                  >
                    {planningHealthBusy
                      ? 'Memeriksa…'
                      : 'Periksa layanan pencarian'}
                  </button>
                </p>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy !== null || !snapshotId}
                  onClick={() => void loadScenario()}
                >
                  Muat contoh perjalanan (Gambir → Pejaten, rute 6H)
                </button>
              </details>
            </div>
            {DEMO_REPLAY.label && (
              <p className="replay-banner" role="note">
                <strong>{DEMO_REPLAY.label}</strong>
                <span>
                  Jadwal historis · 2 Oktober 2026 · {DEMO_REPLAY.timezone} ·
                  bukan posisi atau jadwal kendaraan saat ini
                </span>
              </p>
            )}
            <OperatorSchedules />
            <form
              className="search-form"
              onSubmit={(event) => void search(event)}
              onInput={(event) => {
                if (event.target instanceof HTMLInputElement)
                  invalidatePlanningInputs();
              }}
            >
              <div className="place-grid endpoint-grid">
                <button
                  type="button"
                  className="swap-endpoints"
                  aria-label="Tukar titik awal dan tujuan"
                  onClick={() => {
                    invalidatePlanningInputs();
                    setOriginPlace(destinationPlace);
                    setDestinationPlace(originPlace);
                    setOriginLat(destinationLat);
                    setOriginLon(destinationLon);
                    setDestinationLat(originLat);
                    setDestinationLon(originLon);
                    setOriginPin(destinationPin);
                    setDestinationPin(originPin);
                    setInputModes({
                      origin: inputModes.destination,
                      destination: inputModes.origin,
                    });
                    setSelectionMode(null);
                  }}
                >
                  <ArrowsDownUpIcon size={23} />
                </button>
                {(['origin', 'destination'] as const).map((endpoint) => (
                  <div className="endpoint-input" key={endpoint}>
                    <div
                      className="endpoint-modes"
                      role="group"
                      aria-label={`${endpoint === 'origin' ? 'Dari' : 'Ke'} — cara memilih lokasi`}
                    >
                      {(
                        ['place', 'pin', 'current', 'coordinates'] as const
                      ).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          className={
                            inputModes[endpoint] === mode ? 'selected' : ''
                          }
                          aria-pressed={inputModes[endpoint] === mode}
                          onClick={() => chooseEndpointMode(endpoint, mode)}
                        >
                          {mode === 'place'
                            ? 'Tempat'
                            : mode === 'pin'
                              ? 'Titik peta'
                              : mode === 'current'
                                ? 'Lokasi saya'
                                : 'Koordinat'}
                        </button>
                      ))}
                    </div>
                    {inputModes[endpoint] === 'place' && (
                      <PlaceSearch
                        label={endpoint === 'origin' ? 'Dari' : 'Ke'}
                        onChoosePin={() => chooseEndpointMode(endpoint, 'pin')}
                        snapshotId={snapshotId}
                        value={
                          endpoint === 'origin' ? originPlace : destinationPlace
                        }
                        onSelect={
                          endpoint === 'origin'
                            ? (place) => {
                                invalidatePlanningInputs();
                                setOriginPlace(place);
                              }
                            : (place) => {
                                invalidatePlanningInputs();
                                setDestinationPlace(place);
                              }
                        }
                      />
                    )}
                    {inputModes[endpoint] === 'pin' && (
                      <p className="endpoint-note" role="status">
                        {(endpoint === 'origin' ? originPin : destinationPin)
                          ? `Titik ${endpoint === 'origin' ? 'awal' : 'tujuan'} dipilih. Ketuk peta atau geser penanda untuk mengubahnya.`
                          : `Ketuk peta untuk memilih titik ${endpoint === 'origin' ? 'awal' : 'tujuan'}. Pilih cara lain untuk membatalkan.`}
                      </p>
                    )}
                    {inputModes[endpoint] === 'current' && (
                      <p className="endpoint-note" role="status">
                        {device.state === 'GPS_TRACKING'
                          ? 'Lokasi siap digunakan.'
                          : device.state === 'GPS_MAP_CONTEXT'
                            ? `Lokasi perkiraan tersedia (akurasi ±${Math.round(device.position?.accuracy ?? 0)} m). Belum cukup akurat untuk navigasi; konfirmasi sebagai titik peta.`
                            : device.state === 'GPS_ACCURACY_LOW'
                              ? 'Lokasi belum cukup akurat. Menunggu sinyal yang lebih baik.'
                              : device.state === 'GPS_REQUESTING_PERMISSION'
                                ? 'Meminta izin lokasi perangkat…'
                                : 'Lokasi belum tersedia. Izinkan lokasi atau pilih tempat, titik peta, atau koordinat.'}
                      </p>
                    )}
                    {inputModes[endpoint] === 'coordinates' && (
                      <p className="endpoint-note">
                        Isi koordinat{' '}
                        {endpoint === 'origin' ? 'titik awal' : 'tujuan'}
                        di bagian <strong>Masukkan koordinat</strong> di bawah.
                      </p>
                    )}
                  </div>
                ))}
              </div>
              {active?.status !== 'ACTIVE' &&
                (inputModes.origin === 'current' ||
                  inputModes.destination === 'current' ||
                  (device.state !== 'GPS_OFF' &&
                    device.state !== 'GPS_STOPPED')) && (
                  <section
                    className="endpoint-note"
                    aria-label="Kontrol lokasi pencarian"
                    data-gps-state={device.state}
                  >
                    <p>
                      GPS hanya digunakan setelah izin Anda. Sinyal yang segar
                      dan akurat diperlukan untuk pencarian langsung; lokasi
                      perkiraan dapat Anda konfirmasi sebagai pin.
                    </p>
                    <div className="text-button-row">
                      <button
                        type="button"
                        className="text-button"
                        onClick={device.retry}
                      >
                        Coba GPS lagi
                      </button>
                      <button
                        type="button"
                        className="text-button"
                        onClick={device.stop}
                      >
                        Berhenti berbagi lokasi
                      </button>
                      {(inputModes.origin === 'current' ||
                        inputModes.destination === 'current') &&
                        gpsMapReady(device.position, device.state) &&
                        !device.navigationGrade && (
                          <button
                            type="button"
                            className="text-button"
                            onClick={() => {
                              const position = device.position;
                              if (!gpsMapReady(position, device.state)) return;
                              invalidatePlanningInputs();
                              const endpoint =
                                inputModes.origin === 'current'
                                  ? 'origin'
                                  : 'destination';
                              setInputModes((current) => ({
                                ...current,
                                [endpoint]: 'pin',
                              }));
                              const point = {
                                latitude: position.latitude,
                                longitude: position.longitude,
                              };
                              if (endpoint === 'origin') setOriginPin(point);
                              else setDestinationPin(point);
                              setSelectionMode(endpoint);
                            }}
                          >
                            Gunakan perkiraan sebagai pin
                          </button>
                        )}
                    </div>
                  </section>
                )}
              <details
                className="coordinate-details"
                open={advancedCoordinates}
                onToggle={(event) => {
                  setAdvancedCoordinates(event.currentTarget.open);
                  if (event.currentTarget.open) {
                    if (inputModes.origin === 'place' && !originPlace)
                      chooseEndpointMode('origin', 'coordinates');
                    if (inputModes.destination === 'place' && !destinationPlace)
                      chooseEndpointMode('destination', 'coordinates');
                  }
                }}
              >
                <summary>Masukkan koordinat</summary>
                <p>
                  Gunakan jika tempat belum ditemukan. Anda juga dapat memilih
                  titik di peta.
                </p>
                <div className="place-grid">
                  <div>
                    <label htmlFor="origin-lat">Lintang titik awal</label>
                    <input
                      id="origin-lat"
                      inputMode="decimal"
                      value={originLat}
                      onChange={(event) => setOriginLat(event.target.value)}
                    />
                    <label htmlFor="origin-lon">Bujur titik awal</label>
                    <input
                      id="origin-lon"
                      inputMode="decimal"
                      value={originLon}
                      onChange={(event) => setOriginLon(event.target.value)}
                    />
                  </div>
                  <div>
                    <label htmlFor="destination-lat">Lintang tujuan</label>
                    <input
                      id="destination-lat"
                      inputMode="decimal"
                      value={destinationLat}
                      onChange={(event) =>
                        setDestinationLat(event.target.value)
                      }
                    />
                    <label htmlFor="destination-lon">Bujur tujuan</label>
                    <input
                      id="destination-lon"
                      inputMode="decimal"
                      value={destinationLon}
                      onChange={(event) =>
                        setDestinationLon(event.target.value)
                      }
                    />
                  </div>
                </div>
              </details>
              <div className="search-actions">
                <label>
                  Urutkan berdasarkan
                  <select
                    value={preference}
                    onChange={(event) =>
                      changePreference(event.target.value as JourneyPreference)
                    }
                  >
                    <option value="BALANCED">Seimbang</option>
                    <option value="FASTEST">Tercepat</option>
                    <option value="FEWEST_TRANSFERS">
                      Paling sedikit pindah
                    </option>
                    <option value="LEAST_WALKING">
                      Paling sedikit berjalan
                    </option>
                  </select>
                </label>
                <label>
                  Berangkat (WIB)
                  <input
                    required
                    type="datetime-local"
                    value={departure}
                    onChange={(event) => setDeparture(event.target.value)}
                    onInput={(event) => setDeparture(event.currentTarget.value)}
                  />
                </label>
                <button
                  className="primary-button"
                  aria-label={
                    busy === 'search' ? 'Mencari rute…' : 'Cari perjalanan'
                  }
                  type="submit"
                  disabled={busy !== null || !snapshotId}
                >
                  {busy === 'search' ? (
                    'Mencari rute…'
                  ) : (
                    <>
                      Cari Perjalanan <ArrowRightIcon size={25} />
                    </>
                  )}
                </button>
              </div>
            </form>
            {error && (
              <div className="feedback error" role="alert">
                {error}
              </div>
            )}
            {message && (
              <div className="feedback" role="status">
                {message}
              </div>
            )}
            {rankingMessage && (
              <p className="ranking-note" role="status">
                {rankingMessage}
              </p>
            )}
            {active && (
              <p className="fine-print">
                Pengurutan berlaku untuk pencarian baru. Perjalanan aktif Anda
                tetap tersimpan.
              </p>
            )}
          </div>
          <section
            className="alternatives"
            aria-labelledby="alternatives-heading"
            aria-busy={busy === 'search'}
          >
            <div className="section-line">
              <h2 id="alternatives-heading" aria-label="Pilihan perjalanan">
                {alternatives.length
                  ? `${alternatives.length} pilihan perjalanan`
                  : 'Hasil Perjalanan'}
              </h2>
              <span>
                {alternatives.length > 0
                  ? `${alternatives.length} ditemukan`
                  : ''}
              </span>
            </div>
            {busy === 'search' && (
              <div
                className="loading-rows"
                role="status"
                aria-label="Mencari perjalanan"
              >
                <div />
                <div />
                <div />
              </div>
            )}
            {busy !== 'search' && alternatives.length === 0 && (
              <p className="empty-state">
                Masukkan titik awal dan tujuan, lalu pilih Cari Perjalanan.
              </p>
            )}
            {alternatives.length > 1 && (
              <p className="fine-print">
                {preference === 'FASTEST'
                  ? 'Diurutkan dari waktu tempuh tersingkat.'
                  : preference === 'LEAST_WALKING'
                    ? 'Diurutkan dari jarak jalan kaki terpendek.'
                    : preference === 'FEWEST_TRANSFERS'
                      ? 'Diurutkan dari jumlah pindah paling sedikit.'
                      : 'Urutan mempertimbangkan waktu, jalan kaki, dan perpindahan.'}
              </p>
            )}
            {alternatives.map((journey, index) => (
              <button
                key={journey.journey_id}
                type="button"
                className={`alternative ${selected?.journey_id === journey.journey_id ? 'selected' : ''}`}
                data-journey-id={journey.journey_id}
                onClick={() => setSelected(journey)}
                onFocus={() => setSelected(journey)}
                aria-pressed={selected?.journey_id === journey.journey_id}
              >
                <span className="route-card-badge">
                  {index === 0 ? 'Direkomendasikan' : `Pilihan ${index + 1}`}
                </span>
                <strong className="route-card-duration">
                  {formatDuration(journey.duration_seconds)}
                </strong>
                <span className="alternative-time">
                  {formatClock(journey.start_at)} <span>→</span>{' '}
                  {formatClock(journey.end_at)}
                </span>
                <span className="alternative-route">
                  {journey.segments.map((leg, legIndex) => (
                    <span
                      className="mode-symbol"
                      data-mode={leg.mode}
                      key={leg.sequence}
                    >
                      {legIndex > 0 && <span aria-hidden="true">→</span>}
                      <ModeIcon mode={leg.mode} />
                      <span>
                        {modeName(leg.mode)}
                        {passengerRouteName(leg)
                          ? ` ${passengerRouteName(leg)}`
                          : ''}
                      </span>
                    </span>
                  ))}
                </span>
                <span className="alternative-meta">
                  {transferLabel(journey.transfer_count)} ·{' '}
                  {formatDistance(journey.walking_distance_meters)} berjalan
                </span>
                <span className="alternative-index">
                  {alternatives.length > 1 &&
                    easiestIds.includes(journey.journey_id) && (
                      <strong>Paling praktis · </strong>
                    )}
                  Pilihan {index + 1}
                </span>
              </button>
            ))}
          </section>
          {selected && !displayingActive && (
            <div className="plan-start-action">
              <button
                type="button"
                className="primary-button full"
                disabled={busy !== null}
                onClick={() => void activate()}
              >
                {busy === 'activate' ? 'Memulai…' : 'Mulai Perjalanan'}
              </button>
            </div>
          )}
        </section>
        <aside
          className="journey-detail"
          data-expanded={detailExpanded}
          aria-labelledby="detail-heading"
        >
          <div className="section-line">
            <h2
              id="detail-heading"
              aria-label={
                displayingActive ? 'Perjalanan aktif Anda' : 'Detail perjalanan'
              }
            >
              {displayingActive ? 'Perjalanan Aktif' : 'Detail perjalanan'}
            </h2>
          </div>
          {!displayed && (
            <>
              <p className="empty-state">
                Pilih rute untuk melihat halte, kendaraan, dan langkah
                perjalanan sebelum mulai.
              </p>
            </>
          )}
          {displayed && (
            <>
              {displayingActive &&
                Date.parse(displayed.start_at) < Date.now() - 60_000 && (
                  <p className="feedback">
                    Jadwal historis · bukan layanan saat ini.
                  </p>
                )}
              <div className="journey-summary">
                <strong>
                  {formatClock(displayed.start_at)} –{' '}
                  {formatClock(displayed.end_at)}
                </strong>
                <span>
                  {formatDuration(displayed.duration_seconds)} ·{' '}
                  {transferLabel(displayed.transfer_count)}
                </span>
              </div>
              {displayingActive && navGuidance && (
                <section
                  className="next-step-preview"
                  aria-label="Langkah berikutnya"
                >
                  <span>Langkah berikutnya</span>
                  <strong className="mode-symbol">
                    {currentLeg && <ModeIcon mode={currentLeg.mode} />}
                    {modeNavLabel(navMode)}
                  </strong>
                  <p>{navGuidance.destination}</p>
                  <details>
                    <summary>Ketepatan lokasi</summary>
                    <p>{navGuidance.detail}</p>
                  </details>
                  {currentLeg && navMode !== 'WAIT_FOR_TRANSIT' && (
                    <p>
                      ±{formatDistance(currentLeg.distance_meters)} ·{' '}
                      {formatDuration(currentLeg.duration_seconds)}
                    </p>
                  )}
                </section>
              )}
              <details
                className="journey-steps"
                open={!displayingActive || detailExpanded}
                onToggle={(event) => {
                  if (displayingActive)
                    setDetailExpanded(event.currentTarget.open);
                }}
              >
                <summary>Urutan seluruh perjalanan</summary>
                <ol className="leg-list">
                  {displayed.segments.map((segment) => {
                    const position = displayingActive
                      ? segmentPosition(segment.sequence, completed)
                      : null;
                    return (
                      <li
                        key={`${segment.sequence}-${segment.mode}`}
                        className={position ?? ''}
                        data-segment-sequence={String(segment.sequence)}
                        data-leg-fingerprint={walkGeometryIdentity(segment)}
                      >
                        <div className="leg-heading">
                          <span className="mode-symbol">
                            <ModeIcon mode={segment.mode} />
                            {modeName(segment.mode)}
                            {passengerRouteName(segment)
                              ? ` ${passengerRouteName(segment)}`
                              : ''}
                          </span>
                          <time>{formatClock(segment.start_at)}</time>
                        </div>
                        <p>
                          {segment.from.name} <span>→</span> {segment.to.name}
                        </p>
                        <small>
                          {formatDuration(segment.duration_seconds)}
                          {segment.mode === 'WALK'
                            ? ` · ${formatDistance(segment.distance_meters)} perkiraan rute · akses jalan perlu diperiksa`
                            : ''}
                          {position
                            ? ` · ${{ completed: 'sudah dilalui', current: 'tahap sekarang', upcoming: 'berikutnya' }[position]}`
                            : ''}
                        </small>
                      </li>
                    );
                  })}
                </ol>
              </details>
              {displayed.fare_status === 'UNKNOWN' && (
                <p className="fine-print">Informasi tarif belum tersedia.</p>
              )}

              <details className="evidence-details">
                <summary>Rincian jadwal dan sumber data</summary>
                <p>
                  Mesin rute: {displayed.routing_context.provider}{' '}
                  {displayed.routing_context.provider_version}. Versi jaringan:{' '}
                  {displayed.routing_context.network_snapshot_id}. Tanggal
                  jadwal: {displayed.routing_context.common_service_date} (
                  {displayed.routing_context.timezone}). Keberangkatan yang
                  dihitung dari frekuensi layanan dapat berubah.
                </p>
              </details>
              {displayingActive && active && (
                <div
                  className="progress-actions"
                  data-completed={journeyFinished}
                >
                  <p>
                    {completed} dari {active.segments.length} tahap selesai.
                    Konfirmasikan saat sampai, naik, atau turun.
                  </p>
                  <div
                    className={`navigation-card${navigationPaused ? ' paused' : ''}${offRoute ? ' off-route' : ''}`}
                    role="region"
                    aria-label={`${modeNavLabel(navMode)}${navGuidance?.title ? `: ${navGuidance.title}` : ''}`}
                    data-provenance={navGuidance?.provenance ?? 'NO_DEVICE'}
                    data-walk-evidence={
                      currentWalkNavigation?.evidence ?? 'NONE'
                    }
                    data-maneuver-index={
                      scopedWalkProgress ? scopedWalkProgress.maneuverIndex : -1
                    }
                    data-maneuver-total={
                      currentWalkNavigation?.maneuvers.length ?? 0
                    }
                    data-walk-status={scopedWalkProgress?.status ?? 'none'}
                    data-navigation-scope={walkScopeKey ?? 'none'}
                    data-navigation-paused={navigationPaused ? 'true' : 'false'}
                    data-walk-reposition={
                      scopedWalkProgress?.needsManualReposition
                        ? 'true'
                        : 'false'
                    }
                  >
                    <strong className="navigation-title">
                      {navGuidance ? navGuidance.title : modeNavLabel(navMode)}
                    </strong>
                    {navGuidance && (
                      <details>
                        <summary>Informasi navigasi</summary>
                        <p className="fine-print">{navGuidance.detail}</p>
                        <p>
                          Petunjuk dari data rute. Perhatikan rambu dan kondisi
                          jalan.
                        </p>
                      </details>
                    )}
                    {navGuidance?.provenance === 'SCHEMATIC_GEOMETRY' && (
                      <p className="fine-print">
                        Petunjuk belok belum tersedia untuk bagian ini.
                      </p>
                    )}
                    {!navGuidance && (
                      <p className="fine-print">
                        Navigasi belum tersedia. Gunakan penandaan manual di
                        bawah.
                      </p>
                    )}
                    {currentWalkNavigation?.evidence ===
                      'OTP_DERIVED_MANEUVER' && (
                      <p className="fine-print" data-testid="walk-progress">
                        Langkah {(scopedWalkProgress?.maneuverIndex ?? 0) + 1}{' '}
                        dari {currentWalkNavigation.maneuvers.length}
                        {navGuidance?.nextInstruction &&
                        navGuidance.nextDistanceMeters !== null &&
                        Number.isFinite(navGuidance.nextDistanceMeters)
                          ? ` · berikutnya ±${Math.round(navGuidance.nextDistanceMeters)} m: ${navGuidance.nextInstruction}`
                          : ''}
                        {navGuidance?.remainingMeters !== undefined &&
                        navGuidance.remainingMeters !== null &&
                        Number.isFinite(navGuidance.remainingMeters)
                          ? ` · sisa tahap ±${Math.round(navGuidance.remainingMeters)} m`
                          : ''}
                        {scopedWalkProgress?.status === 'ACQUIRING'
                          ? ' · GPS: memperoleh sinyal'
                          : scopedWalkProgress?.status === 'UNCERTAIN'
                            ? ' · GPS: tidak pasti'
                            : scopedWalkProgress?.status === 'PAUSED'
                              ? ' · GPS: dijeda'
                              : ''}
                      </p>
                    )}
                    {currentWalkNavigation?.evidence ===
                      'SCHEMATIC_GEOMETRY' && (
                      <p className="fine-print" data-testid="walk-schematic">
                        {currentWalkNavigation.reason ??
                          'Langkah belok tidak tersedia.'}
                        {navGuidance?.remainingMeters !== undefined &&
                        navGuidance.remainingMeters !== null &&
                        Number.isFinite(navGuidance.remainingMeters)
                          ? ` Sisa tahap ±${Math.round(navGuidance.remainingMeters)} m.`
                          : ''}
                      </p>
                    )}
                    {offRoute && (
                      <p
                        className="feedback warning"
                        role="alert"
                        data-provenance="SCHEMATIC_GEOMETRY"
                      >
                        Di luar jalur rute — pertimbangkan merencanakan ulang
                        atau kembali ke jalur rute yang direncanakan.
                      </p>
                    )}
                    <p className="fine-print">
                      Tujuan: {navGuidance?.destination ?? 'belum tersedia'} ·
                      Status navigasi: {modeNavLabel(navMode)}{' '}
                      {navigationPaused ? '· dijeda' : ''}
                    </p>
                    <div className="text-button-row">
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => setNavigationPaused((value) => !value)}
                      >
                        {navigationPaused
                          ? 'Lanjutkan navigasi'
                          : 'Jeda navigasi'}
                      </button>
                      {currentWalkNavigation?.evidence ===
                        'OTP_DERIVED_MANEUVER' && (
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => {
                            const prepared = walkNavigation.current;
                            if (!prepared || walkScopeKey !== walkState.key)
                              return;
                            const next = {
                              key: walkScopeKey,
                              progress: manuallyAdvanceManeuver(
                                prepared,
                                walkState.progress,
                              ),
                            };
                            walkStateRef.current = next;
                            setWalkState(next);
                          }}
                        >
                          Manuver berikutnya
                        </button>
                      )}
                    </div>
                  </div>
                  {journeyFinished ? (
                    <p className="feedback" role="status">
                      Selesaikan Perjalanan — perjalanan ini sudah selesai.
                    </p>
                  ) : (
                    <>
                      {currentLeg && (
                        <div className="current-leg">
                          <strong className="mode-symbol">
                            <ModeIcon mode={currentLeg.mode} />
                            {modeName(currentLeg.mode)}
                            {passengerRouteName(currentLeg)
                              ? ` ${passengerRouteName(currentLeg)}`
                              : ''}
                          </strong>
                          <p>
                            {currentLeg.from.name} <span>→</span>{' '}
                            {currentLeg.to.name}
                          </p>
                          <small>
                            {currentLeg.mode === 'WALK'
                              ? 'Bagian jalan kaki · lanjutkan saat Anda sampai.'
                              : currentBoarded
                                ? `Naik tercatat di ${currentLeg.from.name}. Turun di ${currentLeg.to.name}.`
                                : `Naik di ${currentLeg.from.name}, turun di ${currentLeg.to.name}.`}
                          </small>
                        </div>
                      )}
                      <label>
                        Waktu tahapan perjalanan (WIB, skenario uji)
                        <input
                          required
                          type="datetime-local"
                          step="0.001"
                          value={progressAt}
                          onChange={(event) =>
                            setProgressAt(event.target.value)
                          }
                          onInput={(event) =>
                            setProgressAt(event.currentTarget.value)
                          }
                        />
                      </label>
                      <p className="fine-print">
                        Waktu skenario uji · bukan jadwal kendaraan saat ini.
                      </p>
                      {isTransitLeg && !currentBoarded && (
                        <button
                          type="button"
                          className="primary-button full"
                          disabled={busy !== null}
                          onClick={() => void confirmBoarding()}
                        >
                          {busy === 'boarding'
                            ? 'Menyimpan…'
                            : 'Saya Sudah Naik'}
                        </button>
                      )}
                      {isTransitLeg && currentBoarded && !currentAlighted && (
                        <button
                          type="button"
                          className="primary-button full"
                          disabled={busy !== null}
                          onClick={() => void confirmAlighting()}
                        >
                          {busy === 'alighting'
                            ? 'Menyimpan…'
                            : 'Saya Sudah Turun'}
                        </button>
                      )}
                      {isTransitLeg && currentAlighted && (
                        <button
                          type="button"
                          className="primary-button full"
                          disabled={
                            busy !== null ||
                            completed + 1 > active.segments.length
                          }
                          onClick={() => void advanceLeg()}
                        >
                          {busy === 'progress'
                            ? 'Menyimpan…'
                            : 'Lanjutkan Perjalanan'}
                        </button>
                      )}
                      {!isTransitLeg && (
                        <button
                          type="button"
                          className="primary-button full"
                          disabled={
                            busy !== null || completed >= active.segments.length
                          }
                          onClick={() => void advanceLeg()}
                        >
                          {busy === 'progress'
                            ? 'Menyimpan…'
                            : completed + 1 >= active.segments.length
                              ? 'Selesaikan Perjalanan'
                              : 'Lanjutkan Perjalanan'}
                        </button>
                      )}
                      <details className="evidence-details gps-consent">
                        <summary>Lokasi perangkat (opsional)</summary>
                        <p>
                          Lokasi perangkat tidak pernah menjadi bukti otomatis
                          naik, turun, atau selesai. Anda tetap menandai
                          perjalanan secara manual.
                        </p>
                        {(device.state === 'GPS_OFF' ||
                          device.state === 'GPS_STOPPED') && (
                          <button
                            type="button"
                            className="text-button"
                            onClick={device.start}
                          >
                            Aktifkan Lokasi Langsung
                          </button>
                        )}
                        {device.state === 'GPS_REQUESTING_PERMISSION' && (
                          <p>Meminta izin lokasi…</p>
                        )}
                        {device.state === 'GPS_PERMISSION_DENIED' && (
                          <p className="feedback error" role="alert">
                            Izin lokasi ditolak. Lanjutkan menandai perjalanan
                            secara manual.
                          </p>
                        )}
                        {device.state === 'GPS_UNAVAILABLE' && (
                          <p className="fine-print">
                            Peramban ini tidak mendukung lokasi perangkat.
                            Gunakan penandaan manual.
                          </p>
                        )}
                        {[
                          'GPS_ERROR',
                          'GPS_UNAVAILABLE',
                          'GPS_PERMISSION_DENIED',
                          'GPS_STALE',
                        ].includes(device.state) && (
                          <button
                            type="button"
                            className="text-button"
                            onClick={device.retry}
                          >
                            Coba GPS lagi
                          </button>
                        )}
                        {device.state === 'GPS_ERROR' && (
                          <p className="feedback error" role="alert">
                            Lokasi tidak tersedia. Gunakan penandaan manual.
                          </p>
                        )}
                        {device.state === 'GPS_TRACKING' && (
                          <p role="status">Lokasi langsung aktif.</p>
                        )}
                        {device.state === 'GPS_MAP_CONTEXT' && (
                          <p role="status">
                            Lokasi tersedia untuk konteks peta. Akurasi belum
                            cukup untuk panduan navigasi atau deteksi keluar
                            jalur.
                          </p>
                        )}
                        {device.state === 'GPS_ACCURACY_LOW' && (
                          <p role="status">
                            Akurasi lokasi rendah. Tunggu sinyal membaik;
                            penandaan tetap manual.
                          </p>
                        )}
                        {device.state === 'GPS_STOPPED' && (
                          <p role="status">Berbagi lokasi dihentikan.</p>
                        )}
                        {device.state === 'GPS_STALE' && (
                          <p className="fine-print">
                            Lokasi terakhir sudah tidak segar. Gerakkan
                            perangkat atau buka ulang halaman untuk memperbarui.
                          </p>
                        )}
                        {device.position && device.state !== 'GPS_OFF' && (
                          <>
                            <p className="fine-print">
                              Lokasi perangkat:{' '}
                              {device.position.latitude.toFixed(5)},{' '}
                              {device.position.longitude.toFixed(5)}{' '}
                              {device.position.accuracy !== null &&
                                `· akurasi ±${Math.round(device.position.accuracy)} m`}{' '}
                              {device.position.heading !== null &&
                                `· arah ${Math.round(device.position.heading)}°`}{' '}
                              · pembaruan terakhir{' '}
                              {formatClock(
                                new Date(
                                  device.position.timestamp,
                                ).toISOString(),
                              )}
                              . Ini konteks saja, bukan posisi kendaraan.
                            </p>
                            <p className="text-button-row">
                              <button
                                type="button"
                                className="text-button"
                                onClick={() =>
                                  setFollowDevice((value) => !value)
                                }
                              >
                                {followDevice
                                  ? 'Kamera bebas (berhenti mengikuti)'
                                  : 'Ikuti lokasi saya'}
                              </button>
                              <button
                                type="button"
                                className="text-button"
                                onClick={device.stop}
                              >
                                Berhenti berbagi lokasi
                              </button>
                            </p>
                          </>
                        )}
                      </details>
                    </>
                  )}
                </div>
              )}
              {displayingActive &&
                active?.status === 'ACTIVE' &&
                !navGuidance && (
                  <button
                    type="button"
                    className="primary-button full"
                    onClick={() => setWorkspaceView('disruptions')}
                  >
                    <WarningCircleIcon size={22} aria-hidden="true" /> Ada
                    masalah
                  </button>
                )}
            </>
          )}
          {recoveryWorkspace &&
            active?.status === 'ACTIVE' &&
            active.segments.at(-1)?.to && (
              <ExternalHandoff
                key={`${active.journey_id}:${active.accepted_recovery_id ?? 'original'}`}
                destination={active.segments.at(-1)!.to}
                device={device}
              />
            )}
          {active?.status === 'ACTIVE' && (
            <section
              className="operational-section"
              aria-labelledby="report-heading"
              hidden={!recoveryWorkspace}
            >
              <div className="section-line">
                <h2 id="report-heading">Laporkan kondisi</h2>
                <span>{reports.length} tersimpan</span>
              </div>
              <p className="fine-print">
                Laporan diperiksa admin sebelum membatasi layanan.
              </p>
              {reportTargets.length === 0 ? (
                <p className="empty-state">
                  Tidak ada target sisa perjalanan yang dapat dilaporkan.
                  Selesaikan atau mulai perjalanan baru untuk melaporkan
                  kondisi.
                </p>
              ) : (
                <form
                  onSubmit={(event) => void submitPassengerReport(event)}
                  noValidate
                  aria-describedby="report-help"
                >
                  <p id="report-help" className="fine-print">
                    Pilih bagian yang bermasalah.
                  </p>
                  <label htmlFor="report-target">
                    Lokasi atau layanan pada sisa perjalanan
                    <select
                      id="report-target"
                      required
                      value={reportTargetValid ? reportTargetKey : ''}
                      onChange={(event) => {
                        if (event.target.value !== reportTargetKey)
                          resetReportAttempt();
                        setReportTargetKey(event.target.value);
                        setError('');
                      }}
                      aria-invalid={reportTargetKey ? 'false' : undefined}
                      aria-describedby="report-target-help"
                    >
                      <option value="">Pilih bagian perjalanan</option>
                      {reportTargets
                        .filter(
                          (item) =>
                            showAllReportTargets ||
                            !item.label.includes(' · kode ') ||
                            item.key === reportTargetKey,
                        )
                        .map((item) => (
                          <option key={item.key} value={item.key}>
                            {item.label}
                          </option>
                        ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setShowAllReportTargets((value) => !value)}
                  >
                    {showAllReportTargets
                      ? 'Ringkas daftar lokasi'
                      : 'Tampilkan semua pemberhentian'}
                  </button>
                  <p id="report-target-help" className="fine-print">
                    Hanya bagian perjalanan yang belum selesai dapat dipilih.
                  </p>
                  <label htmlFor="report-category">
                    Kategori laporan
                    <select
                      id="report-category"
                      value={reportCategory}
                      onChange={(event) => {
                        if (event.target.value !== reportCategory)
                          resetReportAttempt();
                        setReportCategory(event.target.value);
                      }}
                    >
                      <option value="CLEANLINESS">Kebersihan</option>
                      <option value="CROWDING">Kepadatan</option>
                      <option value="ACCESSIBILITY">Aksesibilitas</option>
                      <option value="SAFETY">Keselamatan</option>
                      <option value="SERVICE">
                        Layanan (banjir atau tidak beroperasi)
                      </option>
                      <option value="OTHER">Lainnya</option>
                    </select>
                  </label>
                  <label htmlFor="report-observed-at">
                    Waktu kejadian (WIB)
                    <input
                      id="report-observed-at"
                      type="datetime-local"
                      required
                      value={reportObservedAt}
                      onChange={(event) => {
                        if (event.target.value !== reportObservedAt)
                          resetReportAttempt();
                        setReportObservedAt(event.target.value);
                      }}
                    />
                  </label>
                  <label htmlFor="report-description">
                    Keterangan
                    <textarea
                      id="report-description"
                      required
                      maxLength={2000}
                      rows={4}
                      value={reportDescription}
                      onChange={(event) => {
                        const next = event.target.value;
                        if (next !== reportDescription) resetReportAttempt();
                        setReportDescription(next);
                      }}
                      aria-describedby="report-description-help"
                      aria-invalid={
                        reportDescription.trim().length === 0 ||
                        reportDescription.length > 2000
                          ? undefined
                          : 'false'
                      }
                      placeholder="Jelaskan kondisi yang Anda amati pada layanan atau lokasi terpilih"
                    />
                  </label>
                  <p id="report-description-help" className="fine-print">
                    {reportDescription.length}/2000 karakter
                  </p>
                  <button
                    className="primary-button full"
                    type="submit"
                    disabled={
                      busy !== null ||
                      reportNeedsReconcile ||
                      !reportTargetValid ||
                      !reportDescription.trim()
                    }
                  >
                    {busy === 'report' ? 'Mengirim…' : 'Kirim laporan'}
                  </button>
                </form>
              )}
              {reportNeedsReconcile && (
                <>
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => void reconcileUnknownReport()}
                    disabled={reportsLoading}
                  >
                    Periksa status laporan
                  </button>
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => void replayPendingReport()}
                    disabled={reportsLoading || !reportReplayAvailable}
                  >
                    Kirim ulang identitas yang sama
                  </button>
                  {!reportReplayAvailable && (
                    <p role="status" className="fine-print">
                      Isi laporan asli tidak tersedia untuk replay aman. Hanya
                      periksa status; identitas laporan tertunda tetap disimpan.
                      Jangan membuat laporan baru sampai hasilnya diketahui.
                    </p>
                  )}
                </>
              )}
              {reportFormError && (
                <p role="alert" className="feedback error">
                  {reportFormError}
                </p>
              )}
              {reportStatus && (
                <p role="status" aria-live="polite" className="feedback">
                  {reportStatus}
                </p>
              )}
              <details className="report-history">
                <summary>Laporan saya ({reports.length})</summary>
                <div
                  className="report-list"
                  aria-live="polite"
                  aria-busy={reportsLoading ? 'true' : 'false'}
                >
                  {reportsLoading && (
                    <p role="status" className="fine-print">
                      Memuat laporan…
                    </p>
                  )}
                  {reportsError && (
                    <div className="feedback error" role="alert">
                      <p>{reportsError}</p>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() =>
                          active && void loadPersistedReports(active.journey_id)
                        }
                        disabled={reportsLoading}
                      >
                        Coba lagi
                      </button>
                    </div>
                  )}
                  {!reportsLoading && !reportsError && reports.length === 0 && (
                    <p className="empty-state">Belum ada laporan.</p>
                  )}
                  {reports.map((report) => (
                    <article
                      className="alert-card"
                      key={report.report_id}
                      aria-label={`Laporan ${report.report_id}`}
                    >
                      <div className="alert-topline">
                        <strong>
                          {passengerReportCategoryLabel(report.category)} ·{' '}
                          {passengerReportStatusLabel(
                            report.verification_status,
                          )}
                        </strong>
                        <span
                          className={
                            report.verification_status === 'CONTROLLED_VERIFIED'
                              ? 'evidence simulated'
                              : 'evidence'
                          }
                        >
                          {report.verification_status === 'REPORTED_UNVERIFIED'
                            ? 'Belum diverifikasi'
                            : report.verification_status === 'ADMIN_RESTRICTED'
                              ? 'Keputusan admin'
                              : report.verification_status ===
                                  'CONTROLLED_VERIFIED'
                                ? 'SIMULASI'
                                : 'Belum diketahui'}
                        </span>
                      </div>
                      <p>{report.description}</p>
                      <details>
                        <summary>Waktu dan identitas laporan</summary>
                        <small>
                          Target: {report.mobility_entity_id} ·{' '}
                          {report.entity_type} · diamati{' '}
                          {formatClock(report.observed_at)} · diterima{' '}
                          {formatClock(report.received_at)}
                        </small>
                      </details>
                      <small className="fine-print">
                        Status ini bukan informasi kondisi langsung; periksa
                        masa berlaku pada informasi gangguan.
                      </small>
                      <button
                        className="text-button"
                        type="button"
                        disabled={busy === 'report'}
                        onClick={() =>
                          void refreshPassengerReport(report.report_id)
                        }
                      >
                        Muat ulang status
                      </button>
                    </article>
                  ))}
                </div>
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    active && void loadPersistedReports(active.journey_id)
                  }
                  disabled={reportsLoading || !active}
                >
                  Muat ulang daftar laporan
                </button>
              </details>
            </section>
          )}
          {active && (
            <section
              className="operational-section"
              aria-labelledby="alert-heading"
              hidden={!recoveryWorkspace}
            >
              <div className="section-line">
                <h2 id="alert-heading">Informasi gangguan</h2>
                <span>{currentAlerts.length} berlaku</span>
              </div>
              <p className="fine-print">
                {streamStatus === 'CONNECTED'
                  ? 'Pembaruan gangguan perjalanan tersambung.'
                  : streamStatus === 'RECONNECTING'
                    ? 'Menyambungkan kembali. Informasi terakhir tetap ditampilkan.'
                    : streamStatus === 'CONNECTING'
                      ? 'Menyambungkan pembaruan gangguan…'
                      : 'Pembaruan terputus. Muat ulang untuk mencoba lagi.'}
              </p>
              {alertError && (
                <p className="feedback error" role="alert">
                  Pembaruan gagal dimuat: {alertError}
                </p>
              )}
              {currentAlerts.length === 0 && (
                <p className="empty-state">
                  Belum ada gangguan terverifikasi pada rute ini.
                </p>
              )}
              {currentAlerts.map((alert) => (
                <article
                  key={alert.alert_id}
                  className="alert-card"
                  aria-label="Peringatan perjalanan"
                >
                  <div className="alert-topline">
                    <strong className="mode-symbol">
                      <WarningCircleIcon
                        size={19}
                        weight="regular"
                        aria-hidden="true"
                      />
                      {operationalStateLabel(alert.operational_state)}
                    </strong>
                    <span
                      className={
                        alert.evidence_type === 'SIMULATED'
                          ? 'evidence simulated'
                          : 'evidence'
                      }
                    >
                      {evidenceLabel(alert.evidence_type)}
                    </span>
                  </div>
                  <p>Rute Anda terdampak. Cari pengganti untuk melanjutkan.</p>
                  <small>
                    Tahap{' '}
                    {alert.affected_segment_sequences
                      .map((sequence) => sequence + 1)
                      .join(', ')}{' '}
                    terdampak · diamati{' '}
                    {alert.observed_at
                      ? formatClock(alert.observed_at)
                      : 'waktu belum diketahui'}{' '}
                    · {freshnessLabel(alert.freshness_status)}
                  </small>
                  <details className="evidence-details">
                    <summary>Sumber dan bukti</summary>
                    <p>
                      Sumber: {alert.source_id ?? 'belum diketahui'} ·{' '}
                      {alert.provenance_ref ??
                        'Referensi sumber belum tersedia'}{' '}
                      · berlaku sampai: {alert.expires_at ?? 'belum ditentukan'}
                      .
                    </p>
                  </details>
                  <button
                    type="button"
                    className="primary-button full"
                    disabled={
                      busy !== null || alert.operational_state === 'RECOVERING'
                    }
                    onClick={() => void proposeRecovery(alert)}
                  >
                    {busy === 'recovery'
                      ? 'Mencari rute pengganti…'
                      : 'Cari rute pengganti'}
                  </button>
                </article>
              ))}
              {historicalAlerts.length > 0 && (
                <details className="evidence-details alert-history">
                  <summary>
                    Riwayat gangguan ({historicalAlerts.length})
                  </summary>
                  <ul className="compact-legs">
                    {historicalAlerts.map((alert) => (
                      <li key={alert.alert_id}>
                        <span className="structure-tag completed">
                          {alert.resolved_at
                            ? 'Selesai ditangani'
                            : 'Kedaluwarsa'}
                        </span>
                        <strong>
                          {operationalStateLabel(alert.operational_state)}
                        </strong>
                        <small>
                          {alert.message} ·{' '}
                          {alert.resolved_at
                            ? `closed ${formatClock(alert.resolved_at)}`
                            : 'sudah tidak berlaku'}
                        </small>
                      </li>
                    ))}
                  </ul>
                  <p>
                    Riwayat tetap tersimpan. Gangguan yang sudah berakhir tidak
                    lagi membatasi rute saat ini.
                  </p>
                </details>
              )}
            </section>
          )}
          {active &&
            recovery &&
            recovery.original_journey_id === active.journey_id && (
              <section
                className="operational-section"
                aria-labelledby="recovery-heading"
              >
                <div className="section-line">
                  <h2 id="recovery-heading">Rute pengganti</h2>
                </div>
                {recoveryStatus && (
                  <div className="feedback warning" role="status">
                    <p>
                      Status penerimaan perlu dicocokkan dengan server. Rute
                      tampilan belum dipastikan.
                    </p>
                    <button
                      type="button"
                      className="text-button"
                      disabled={busy !== null}
                      onClick={() => void acceptRecovery(true)}
                    >
                      Muat ulang status (tanpa menerima ulang)
                    </button>
                  </div>
                )}
                {recovery.proposed_journey && (
                  <article className="recovery-route-card">
                    <span className="route-card-badge">
                      Alternatif perjalanan
                    </span>
                    <strong className="route-card-duration">
                      {formatDuration(
                        recovery.proposed_journey.duration_seconds,
                      )}
                    </strong>
                    <p>
                      {formatClock(recovery.proposed_journey.start_at)} →{' '}
                      {formatClock(recovery.proposed_journey.end_at)} ·{' '}
                      {transferLabel(recovery.proposed_journey.transfer_count)}
                    </p>
                    <div className="alternative-route">
                      {recovery.proposed_journey.segments.map((leg) => (
                        <span className="mode-symbol" key={leg.sequence}>
                          <ModeIcon mode={leg.mode} />
                          {passengerRouteName(leg) || modeName(leg.mode)}
                        </span>
                      ))}
                    </div>
                    <small>
                      {acceptance || recovery.accepted
                        ? 'Rute ini sudah digunakan.'
                        : 'Periksa rute sebelum digunakan.'}
                    </small>
                  </article>
                )}
                <p className="recovery-summary">{recoverySummary(recovery)}</p>
                {!acceptance &&
                  !recovery.accepted &&
                  recovery.proposed_journey && (
                    <p className="fine-print">
                      Pilih Gunakan rute pengganti ini jika sesuai.
                    </p>
                  )}
                {!acceptance &&
                  !recovery.accepted &&
                  active.progress?.revision !== recovery.progress_revision && (
                    <p className="feedback error" role="status">
                      Tahapan perjalanan sudah berubah. Cari rute pengganti
                      terbaru sebelum melanjutkan.
                    </p>
                  )}
                {(() => {
                  const freshAlert =
                    currentAlerts.find(
                      (a) => a.impact_id === recovery.impact_id,
                    ) ??
                    currentAlerts[0] ??
                    null;
                  const known = recoveryAttempt.current?.known === true;
                  const freshAllowed = !!freshAlert && busy === null && known;
                  return freshAlert ? (
                    <button
                      type="button"
                      className="text-button"
                      disabled={!freshAllowed}
                      onClick={() => void proposeRecovery(freshAlert, true)}
                      aria-label="Cari alternatif terbaru"
                      data-known={known ? 'true' : 'false'}
                    >
                      Cari alternatif terbaru
                    </button>
                  ) : null;
                })()}
                {recovery.status === 'COMPLETED' &&
                  recovery.proposed_journey &&
                  (acceptance || recovery.accepted ? (
                    <p className="feedback" role="status">
                      Rute pengganti diterima{' '}
                      {formatClock(
                        acceptance?.accepted_at ?? recovery.accepted_at!,
                      )}
                      . Perjalanan sudah diperbarui.
                    </p>
                  ) : (
                    <button
                      type="button"
                      className="primary-button full"
                      disabled={
                        busy !== null ||
                        active.progress?.revision !== recovery.progress_revision
                      }
                      onClick={() => void acceptRecovery()}
                    >
                      {busy === 'recovery'
                        ? 'Menerapkan rute pengganti…'
                        : 'Gunakan rute pengganti ini'}
                    </button>
                  ))}
                <details className="recovery-comparison">
                  <summary>Lihat perubahan rute</summary>
                  <div className="comparison-grid">
                    <div>
                      <h3>Sisa rute awal</h3>
                      <ol className="compact-legs">
                        {originalComparison ? (
                          originalComparison.segments
                            .filter(
                              (segment) =>
                                segment.sequence >=
                                recovery.completed_segment_count,
                            )
                            .map((segment) => (
                              <li key={segment.sequence}>
                                <span
                                  className={`structure-tag ${recoveryPart(segment.sequence, recovery).toLowerCase()}`}
                                >
                                  {alerts.some(
                                    (alert) =>
                                      alert.impact_id === recovery.impact_id &&
                                      alert.affected_segment_sequences.includes(
                                        segment.sequence,
                                      ),
                                  )
                                    ? 'Terdampak gangguan'
                                    : recoveryPartLabel(
                                        recoveryPart(
                                          segment.sequence,
                                          recovery,
                                        ),
                                      )}
                                </span>
                                <strong>
                                  {modeName(segment.mode)}
                                  {passengerRouteName(segment)
                                    ? ` ${passengerRouteName(segment)}`
                                    : ''}
                                </strong>
                                <small>
                                  {segment.from.name} → {segment.to.name}
                                </small>
                              </li>
                            ))
                        ) : (
                          <li>
                            Rincian rute sebelumnya belum tersedia setelah
                            halaman dimuat ulang.
                          </li>
                        )}
                      </ol>
                    </div>
                    <div>
                      <h3>Rute yang disarankan</h3>
                      {recovery.proposed_journey ? (
                        <ol className="compact-legs">
                          {recovery.proposed_journey.segments.map((segment) => (
                            <li key={segment.sequence}>
                              <span className="structure-tag">
                                {originalComparison?.segments.some(
                                  (original) =>
                                    recovery.rejoined_segments.includes(
                                      original.sequence,
                                    ) && samePassengerLeg(original, segment),
                                )
                                  ? 'Kembali ke rute awal'
                                  : originalComparison?.segments.some(
                                        (original) =>
                                          recovery.preserved_segments.includes(
                                            original.sequence,
                                          ) &&
                                          samePassengerLeg(original, segment),
                                      )
                                    ? 'Tetap digunakan'
                                    : originalComparison
                                      ? 'Sambungan baru'
                                      : 'Pembanding rute awal tidak tersedia'}
                              </span>
                              <strong>
                                {modeName(segment.mode)}
                                {passengerRouteName(segment)
                                  ? ` ${passengerRouteName(segment)}`
                                  : ''}
                              </strong>
                              <small>
                                {segment.from.name} → {segment.to.name}
                              </small>
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <p>
                          Belum ada rute pengganti yang memenuhi pemeriksaan
                          sistem.
                        </p>
                      )}
                    </div>
                  </div>
                </details>
                <p className="fine-print">
                  {recovery.rejoin_status === 'REJOINED'
                    ? 'Rute pengganti tersambung kembali ke bagian rute awal yang dapat digunakan.'
                    : recovery.rejoin_status === 'SUFFIX_REPLANNED'
                      ? 'Sisa perjalanan dihitung ulang karena tidak dapat disambungkan ke rute awal.'
                      : 'Sambungan yang memenuhi pemeriksaan sistem belum ditemukan.'}
                </p>
                <details className="evidence-details">
                  <summary>Rincian perhitungan dan sumber data</summary>
                  <p>
                    Perhitungan ulang dari titik pemulihan yang sama:{' '}
                    {recovery.baseline_journey
                      ? `${formatDuration(recovery.baseline_journey.duration_seconds)}, ${recovery.baseline_journey.transfer_count} kali pindah`
                      : 'rute belum tersedia'}
                    . Mempertahankan {recovery.preserved_segment_count} tahap
                    sisa dan mengganti {recovery.changed_segment_count} tahap.
                    Versi jaringan {recovery.network_snapshot_id}; proyeksi{' '}
                    {recovery.mobility_projection_version}. Kode pemulihan{' '}
                    {recovery.recovery_id}.
                  </p>
                </details>
              </section>
            )}
          {workspaceView === 'disruptions' &&
            !recovery &&
            currentAlerts.length > 0 && (
              <p className="recovery-empty">
                Pilih Cari rute pengganti pada peringatan yang tersedia.
              </p>
            )}
          <details className="optional-copilot">
            <summary>Bantuan memahami perjalanan</summary>
            <CopilotDrawer
              key={
                recovery?.recovery_id
                  ? `recovery:${recovery.recovery_id}`
                  : active
                    ? `journey:${active.journey_id}`
                    : 'none'
              }
              journeyId={
                recovery?.recovery_id
                  ? undefined
                  : (active?.journey_id ?? selected?.journey_id ?? undefined)
              }
              recoveryId={recovery?.recovery_id ?? undefined}
              defaultQuestion={
                recovery?.recovery_id
                  ? 'Jelaskan rute pengganti ini dan dasar rekomendasinya.'
                  : 'Jelaskan rute ini dan langkah perjalanannya.'
              }
            />
          </details>
        </aside>
        <section className="map-workspace" aria-label="Peta perjalanan">
          <JourneyMap
            journey={displayed ?? undefined}
            overviewRevision={mapOverviewRevision}
            recenterDeviceRevision={deviceRecenterRevision}
            alternativeJourney={
              recoveryWorkspace &&
              recovery &&
              !acceptance &&
              !recovery.accepted &&
              active?.journey_id === recovery.original_journey_id &&
              active.progress?.revision === recovery.progress_revision
                ? recovery.proposed_journey
                : undefined
            }
            invalidatedSegmentSequences={
              recoveryWorkspace && recovery && !acceptance && !recovery.accepted
                ? recovery.invalidated_segments
                : undefined
            }
            completedSegmentCount={completed}
            activeSegmentSequence={
              !recoveryWorkspace && displayingActive
                ? (currentLeg?.sequence ?? null)
                : null
            }
            devicePosition={
              device.position
                ? {
                    ...device.position,
                    accuracy: device.position.accuracy ?? undefined,
                  }
                : undefined
            }
            followDevicePosition={
              followDevice &&
              !navigationPaused &&
              (!displayed || (activeWorkspace && !recoveryWorkspace)) &&
              (displayingActive
                ? gpsNavigationReady(device.position, device.state)
                : gpsMapReady(device.position, device.state))
            }
            selectionMode={selectionMode}
            originPin={originPin}
            destinationPin={destinationPin}
            onMapPointSelect={(point) => {
              invalidatePlanningInputs();
              if (selectionMode === 'origin') setOriginPin(point);
              else if (selectionMode === 'destination')
                setDestinationPin(point);
              setSelectionMode(null);
            }}
            onOriginPinDrag={(point) => {
              invalidatePlanningInputs();
              setOriginPin(point);
            }}
            onDestinationPinDrag={(point) => {
              invalidatePlanningInputs();
              setDestinationPin(point);
            }}
          />
          {displayingActive &&
            !recoveryWorkspace &&
            navGuidance &&
            active?.status === 'ACTIVE' && (
              <NavigationHud
                guidance={navGuidance}
                direction={
                  currentWalkNavigation?.evidence === 'OTP_DERIVED_MANEUVER'
                    ? currentWalkNavigation.maneuvers[
                        scopedWalkProgress?.maneuverIndex ?? 0
                      ]?.relativeDirection
                    : undefined
                }
                paused={navigationPaused}
                locationReady={gpsNavigationReady(
                  device.position,
                  device.state,
                )}
                onPause={() => setNavigationPaused((value) => !value)}
                onLocate={() => {
                  setFollowDevice(true);
                  if (gpsMapReady(device.position, device.state))
                    setDeviceRecenterRevision((revision) => revision + 1);
                  else device.retry();
                }}
                onReport={() => {
                  setWorkspaceView('disruptions');
                  requestAnimationFrame(() =>
                    document
                      .getElementById('report-heading')
                      ?.scrollIntoView({ block: 'start' }),
                  );
                }}
              />
            )}
          <div className="map-workspace-dock" aria-label="Tampilan rute">
            <button
              type="button"
              onClick={() => {
                if (workspaceView === 'map')
                  setWorkspaceView(mapReturnView.current);
                setFollowDevice(false);
                setMapOverviewRevision((revision) => revision + 1);
                setDetailExpanded(false);
              }}
            >
              <MapTrifoldIcon size={20} />
              Ringkasan rute
            </button>
            <button
              type="button"
              aria-expanded={displayingActive ? undefined : detailExpanded}
              onClick={() => {
                if (!displayingActive) setDetailExpanded(true);
                if (workspaceView === 'map')
                  setWorkspaceView(displayingActive ? 'active' : 'plan');
                requestAnimationFrame(() =>
                  document
                    .querySelector(
                      displayingActive ? '.progress-actions' : '.leg-list',
                    )
                    ?.scrollIntoView({ block: 'start' }),
                );
              }}
            >
              <ListBulletsIcon size={20} />
              {displayingActive
                ? 'Tandai tahap perjalanan'
                : 'Detail setiap langkah'}
            </button>
            <button type="button" onClick={toggleMapView}>
              <CornersOutIcon size={20} />
              {workspaceView === 'map' ? 'Kembali' : 'Lihat peta lebih luas'}
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
