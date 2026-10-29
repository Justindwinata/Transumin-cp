'use client';

import { useEffect, useState } from 'react';
import { opsApi } from '../../lib/ops-api';
import { LoginView, RoleAwareNavigation } from './auth-ui';
import { NetworkMap } from './network-map';
import type {
  ImpactView,
  OperatorPrincipal,
  ScenarioView,
  SimulationRunView,
  NetworkSnapshotView,
  NetworkStateEntityView,
  ScenarioSummary,
  RunSummary,
} from '../../lib/ops';

export function OpsDashboard({
  view,
  scenarioId,
  runId,
}: {
  view: 'network' | 'scenarios' | 'experiments' | 'scenario';
  scenarioId?: string;
  runId?: string;
}) {
  const [principal, setPrincipal] = useState<OperatorPrincipal | null>(null);
  const [authState, setAuthState] = useState<
    'loading' | 'login' | 'denied' | 'unavailable' | 'ready'
  >('loading');
  const [scenario, setScenario] = useState<ScenarioView | null>(null);
  const [snapshotId, setSnapshotId] = useState('');
  const [snapshot, setSnapshot] = useState<NetworkSnapshotView | null>(null);
  const [entities, setEntities] = useState<NetworkStateEntityView[] | null>(
    null,
  );
  const [run, setRun] = useState<SimulationRunView | null>(null);
  const [impact, setImpact] = useState<ImpactView | null>(null);
  const [error, setError] = useState('');
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([]);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [experimentsState, setExperimentsState] = useState('');
  const [nextScenarioCursor, setNextScenarioCursor] = useState<string | null>(
    null,
  );
  const [nextRunCursor, setNextRunCursor] = useState<string | null>(null);
  const [selectedRunIds, setSelectedRunIds] = useState<string[]>([]);
  const [compare, setCompare] = useState<ImpactView[] | null>(null);
  const [actionEntityId, setActionEntityId] = useState('');
  const [actionReason, setActionReason] = useState('');
  const [newScenarioName, setNewScenarioName] = useState('');
  const [mutationBusy, setMutationBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    opsApi
      .me(controller.signal)
      .then((user) => {
        if (
          !user.roles.some(
            (role) => role === 'RESEARCHER_OPERATOR' || role === 'ADMIN',
          )
        ) {
          setAuthState('denied');
          return;
        }
        setPrincipal(user);
        setAuthState('ready');
      })
      .catch((cause: Error & { status?: number }) =>
        setAuthState(
          cause.status === 401
            ? 'login'
            : cause.status === 403
              ? 'denied'
              : 'unavailable',
        ),
      );
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (authState !== 'ready') return;
    let active = true;
    const controller = new AbortController();
    const tasks: Promise<unknown>[] = [];
    if (view === 'scenarios')
      tasks.push(
        opsApi
          .listScenarios({ limit: 25 }, controller.signal)
          .then((page) => {
            if (!active) return;
            setScenarios(page.data);
            setNextScenarioCursor(page.nextCursor);
          })
          .catch((cause: Error) => {
            if (active) setError(cause.message);
          }),
      );
    if (view === 'experiments')
      tasks.push(
        opsApi
          .listRuns({ limit: 25 }, controller.signal)
          .then((page) => {
            if (!active) return;
            setRuns(page.data);
            setNextRunCursor(page.nextCursor);
          })
          .catch((cause: Error) => {
            if (active) setError(cause.message);
          }),
        opsApi
          .listExperiments({ limit: 25 }, controller.signal)
          .then((page) => {
            if (active)
              setExperimentsState(
                page.availability ??
                  `${page.data.length} stored experiment records`,
              );
          })
          .catch((cause: Error) => {
            if (active) setExperimentsState(cause.message);
          }),
      );
    if (view === 'scenario' && scenarioId)
      tasks.push(
        opsApi
          .scenario(scenarioId, controller.signal)
          .then((value) => {
            if (active) setScenario(value);
          })
          .catch((cause: Error) => {
            if (active) setError(cause.message);
          }),
      );
    if (view === 'network' && snapshotId)
      tasks.push(
        Promise.all([
          opsApi.networkSnapshot(snapshotId, controller.signal),
          opsApi.networkState(snapshotId, controller.signal),
        ])
          .then(([meta, state]) => {
            if (!active) return;
            setSnapshot(meta);
            setEntities(state.entities);
          })
          .catch((cause: Error) => {
            if (active) setError(cause.message);
          }),
      );
    if ((view === 'experiments' || view === 'network') && runId)
      tasks.push(
        opsApi
          .run(runId, controller.signal)
          .then((value) => {
            if (!active) return;
            setRun(value);
            if (value.status === 'COMPLETED')
              return opsApi
                .runImpact(value.simulation_run_id, controller.signal)
                .then((value) => {
                  if (active) setImpact(value);
                });
            return undefined;
          })
          .catch((cause: Error) => {
            if (active) setError(cause.message);
          }),
      );
    return () => {
      active = false;
      controller.abort();
      void Promise.allSettled(tasks);
    };
  }, [authState, view, scenarioId, runId, snapshotId]);

  async function loadMoreScenarios() {
    if (!nextScenarioCursor) return;
    try {
      const page = await opsApi.listScenarios({
        limit: 25,
        cursor: nextScenarioCursor,
      });
      setScenarios((current) => [...current, ...page.data]);
      setNextScenarioCursor(page.nextCursor);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  async function loadMoreRuns() {
    if (!nextRunCursor) return;
    try {
      const page = await opsApi.listRuns({ limit: 25, cursor: nextRunCursor });
      setRuns((current) => [...current, ...page.data]);
      setNextRunCursor(page.nextCursor);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  async function createScenario(event: React.FormEvent) {
    event.preventDefault();
    if (!actionEntityId || !actionReason || !newScenarioName.trim()) {
      setError('Name, one valid entity UUID, and reason are required.');
      return;
    }
    setMutationBusy(true);
    try {
      await opsApi.createScenario({
        name: newScenarioName.trim(),
        description: '',
        actions: [
          {
            mobility_entity_id: actionEntityId.trim(),
            action_type: 'BLOCK_ENTITY',
            reason: actionReason.trim(),
          },
        ],
      });
      const page = await opsApi.listScenarios({ limit: 25 });
      setScenarios(page.data);
      setNextScenarioCursor(page.nextCursor);
      setNewScenarioName('');
      setActionEntityId('');
      setActionReason('');
      setError('');
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setMutationBusy(false);
    }
  }

  async function runComparison() {
    if (selectedRunIds.length !== 2) {
      setError('Select exactly two completed runs to compare.');
      return;
    }
    try {
      setCompare(await opsApi.compareImpacts(selectedRunIds));
      setError('');
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  async function createRun(scenarioIdValue: string, snapshotIdValue: string) {
    if (!snapshotIdValue.trim()) {
      setError('Snapshot ID is required to create a run.');
      return;
    }
    setMutationBusy(true);
    try {
      await opsApi.createRun(
        scenarioIdValue,
        { network_snapshot_id: snapshotIdValue.trim(), configuration: {} },
        crypto.randomUUID(),
      );
      const page = await opsApi.listRuns({ limit: 25 });
      setRuns(page.data);
      setNextRunCursor(page.nextCursor);
      setError('');
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setMutationBusy(false);
    }
  }

  if (authState === 'loading')
    return (
      <main className="ops-auth-state" role="status">
        Checking operator session…
      </main>
    );
  if (authState === 'login') return <LoginView />;
  if (authState === 'denied')
    return (
      <main className="ops-auth-state">
        <h1>Access denied</h1>
        <p>RESEARCHER_OPERATOR or ADMIN role required.</p>
      </main>
    );
  if (authState === 'unavailable')
    return (
      <main className="ops-auth-state">
        <h1>Operator access unavailable</h1>
        <p>Could not verify authenticated session. Dashboard data withheld.</p>
      </main>
    );

  const title =
    view === 'network'
      ? 'Network intelligence'
      : view === 'scenario'
        ? 'Scenario detail'
        : view === 'scenarios'
          ? 'Scenario workbench'
          : 'Experiment runs';
  return (
    <main className="ops-shell">
      <header className="ops-header">
        <div>
          <p className="ops-eyebrow">TRANSUM-IN / FR-011</p>
          <h1>{title}</h1>
          <p>
            Scenario definitions and engine outputs · geometry reflects selected
            immutable snapshot
          </p>
        </div>
        {principal && <RoleAwareNavigation principal={principal} />}
      </header>
      <nav className="ops-nav" aria-label="Operator workspace">
        <a href="/ops/network">Network</a>
        <a href="/ops/scenarios">Scenarios</a>
        <a href="/ops/experiments">Experiments</a>
      </nav>
      <div className="ops-grid">
        <section className="ops-map" aria-label="Network map">
          <NetworkMap
            snapshotId={snapshotId || run?.network_snapshot_id || ''}
          />
          <p className="ops-attribution">
            Geometry reflects the selected snapshot&apos;s dataset versions ·
            capped and clipped per request.
          </p>
        </section>
        <aside className="ops-side">
          {error && (
            <p className="ops-form-error" role="alert">
              {error}
            </p>
          )}
          {view === 'network' && (
            <>
              <form
                className="ops-snapshot-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  setSnapshotId(
                    new FormData(event.currentTarget)
                      .get('snapshot_id')
                      ?.toString()
                      .trim() ?? '',
                  );
                  setSnapshot(null);
                  setEntities(null);
                  setError('');
                }}
              >
                <label htmlFor="snapshot_id">Network snapshot ID</label>
                <input
                  id="snapshot_id"
                  name="snapshot_id"
                  required
                  pattern="[0-9a-fA-F-]{36}"
                  defaultValue={snapshotId}
                  placeholder="UUID from network snapshot record"
                />
                <button type="submit">Load snapshot</button>
              </form>
              {snapshot && (
                <>
                  <StateBlock
                    title={`Snapshot ${snapshot.status}`}
                    detail={`${snapshot.materialized_state_count} materialized states · ${snapshot.processing_version} · cutoff ${snapshot.state_cutoff_at}`}
                  />
                  <p className="ops-meta">
                    Fingerprint {snapshot.fingerprint} · datasets{' '}
                    {snapshot.dataset_version_ids.join(', ')}
                  </p>
                  {entities?.length === 0 ? (
                    <StateBlock
                      title="No state coverage"
                      detail="This snapshot has no materialized state entities."
                    />
                  ) : (
                    entities?.map((entity) => (
                      <article
                        className="ops-action"
                        key={entity.mobility_entity_id}
                      >
                        <strong>{entity.mobility_entity_id}</strong>
                        <p>
                          {entity.availability} · {entity.evidence_type} ·{' '}
                          {entity.freshness_status}
                        </p>
                        <small>
                          {entity.provenance_ref} · observed{' '}
                          {entity.observed_at}
                        </small>
                      </article>
                    ))
                  )}
                </>
              )}
            </>
          )}
          {view === 'scenarios' && (
            <>
              <form className="ops-snapshot-form" onSubmit={createScenario}>
                <h2>Create scenario</h2>
                <label htmlFor="new_scenario_name">Name</label>
                <input
                  id="new_scenario_name"
                  required
                  minLength={1}
                  maxLength={120}
                  value={newScenarioName}
                  onChange={(event) => setNewScenarioName(event.target.value)}
                />
                <label htmlFor="action_entity_id">Entity to block (UUID)</label>
                <input
                  id="action_entity_id"
                  required
                  pattern="[0-9a-fA-F-]{36}"
                  value={actionEntityId}
                  onChange={(event) => setActionEntityId(event.target.value)}
                />
                <label htmlFor="action_reason">Reason</label>
                <input
                  id="action_reason"
                  required
                  minLength={1}
                  maxLength={500}
                  value={actionReason}
                  onChange={(event) => setActionReason(event.target.value)}
                />
                <button disabled={mutationBusy} type="submit">
                  Create scenario
                </button>
              </form>
              {scenarios.length === 0 ? (
                <StateBlock
                  title="No scenarios"
                  detail="Create a scenario against existing mobility entities. No mock scenarios are shown."
                />
              ) : (
                scenarios.map((item) => (
                  <article className="ops-action" key={item.scenario_id}>
                    <a href={`/ops/scenarios/${item.scenario_id}`}>
                      <strong>{item.name}</strong>
                    </a>
                    <p>
                      {item.status} · v{item.version} · {item.action_count}{' '}
                      actions · {item.run_count} runs
                    </p>
                    <p>{item.description}</p>
                    <small>{item.created_at}</small>
                  </article>
                ))
              )}
              {nextScenarioCursor && (
                <button type="button" onClick={() => void loadMoreScenarios()}>
                  More scenarios
                </button>
              )}
            </>
          )}
          {view === 'experiments' && (
            <>
              <StateBlock
                title="Experiment records"
                detail={experimentsState || 'Loading experiment availability…'}
              />
              <h2>Simulation runs</h2>
              <p className="ops-meta">
                Runs are SIMULATED engine outputs, not full research
                experiments.
              </p>
              {runs.length === 0 ? (
                <StateBlock
                  title="No runs"
                  detail="Create a run from scenario detail with an explicit snapshot ID."
                />
              ) : (
                runs.map((item) => (
                  <article className="ops-action" key={item.simulation_run_id}>
                    <label>
                      <input
                        type="checkbox"
                        disabled={
                          item.status !== 'COMPLETED' ||
                          (!selectedRunIds.includes(item.simulation_run_id) &&
                            selectedRunIds.length >= 2)
                        }
                        checked={selectedRunIds.includes(
                          item.simulation_run_id,
                        )}
                        onChange={(event) =>
                          setSelectedRunIds((current) =>
                            event.target.checked
                              ? [...current, item.simulation_run_id]
                              : current.filter(
                                  (id) => id !== item.simulation_run_id,
                                ),
                          )
                        }
                      />
                      {item.scenario_name} · {item.status}
                    </label>
                    <p>Run {item.simulation_run_id}</p>
                    <p>Snapshot {item.network_snapshot_id}</p>
                    <button
                      type="button"
                      onClick={() => {
                        setSnapshotId(item.network_snapshot_id);
                        void opsApi
                          .run(item.simulation_run_id)
                          .then(setRun)
                          .catch((cause: Error) => setError(cause.message));
                      }}
                    >
                      Inspect map
                    </button>
                  </article>
                ))
              )}
              {nextRunCursor && (
                <button type="button" onClick={() => void loadMoreRuns()}>
                  More runs
                </button>
              )}
              <button
                type="button"
                disabled={selectedRunIds.length !== 2}
                onClick={() => void runComparison()}
              >
                Compare selected runs
              </button>
              {compare && (
                <section className="ops-state">
                  <h2>Engine metric comparison</h2>
                  {compare.map((item, index) => (
                    <div key={item.impact_id}>
                      <strong>Run {selectedRunIds[index]}</strong>
                      <dl>
                        {Object.entries(item.metrics ?? {}).map(
                          ([key, value]) => (
                            <div key={key}>
                              <dt>{key}</dt>
                              <dd>{value}</dd>
                            </div>
                          ),
                        )}
                      </dl>
                      <small>{item.provenance.references.join(', ')}</small>
                    </div>
                  ))}
                </section>
              )}
            </>
          )}
          {view === 'scenario' &&
            (scenario ? (
              <>
                <ScenarioDetails value={scenario} />
                <RunCreator
                  busy={mutationBusy}
                  onCreate={(snapshotIdValue) =>
                    void createRun(scenario.scenario_id, snapshotIdValue)
                  }
                />
              </>
            ) : (
              <StateBlock
                title={error ? 'Scenario read failed' : 'Scenario required'}
                detail={
                  error ||
                  'Open /ops/scenarios/[id] with an existing scenario ID.'
                }
              />
            ))}
          {(view === 'experiments' || view === 'network') &&
            runId &&
            (run ? (
              <RunDetails value={run} impact={impact} />
            ) : (
              <StateBlock
                title={error ? 'Run read failed' : 'Loading run'}
                detail={error || 'Loading authoritative run state…'}
              />
            ))}
        </aside>
      </div>
    </main>
  );
}

function RunCreator({
  busy,
  onCreate,
}: {
  busy: boolean;
  onCreate: (snapshotId: string) => void;
}) {
  const [snapshotId, setSnapshotId] = useState('');
  return (
    <form
      className="ops-snapshot-form"
      onSubmit={(event) => {
        event.preventDefault();
        onCreate(snapshotId);
      }}
    >
      <h2>Run against snapshot</h2>
      <label htmlFor="run_snapshot_id">Finalized network snapshot UUID</label>
      <input
        id="run_snapshot_id"
        required
        pattern="[0-9a-fA-F-]{36}"
        value={snapshotId}
        onChange={(event) => setSnapshotId(event.target.value)}
      />
      <p>
        Run configuration is empty/default. Engine captures scenario, snapshot,
        and provenance.
      </p>
      <button disabled={busy} type="submit">
        Create simulation run
      </button>
    </form>
  );
}

function StateBlock({ title, detail }: { title: string; detail: string }) {
  return (
    <section className="ops-state">
      <span className="ops-state-mark">!</span>
      <h2>{title}</h2>
      <p>{detail}</p>
    </section>
  );
}
function ScenarioDetails({ value }: { value: ScenarioView }) {
  return (
    <section className="ops-state">
      <p className="ops-eyebrow">SCENARIO · {value.status}</p>
      <h2>{value.name}</h2>
      <p>{value.description}</p>
      <dl>
        <dt>Version</dt>
        <dd>{value.version}</dd>
        <dt>Actions</dt>
        <dd>{value.actions.length}</dd>
      </dl>
      {value.actions.map((action, index) => (
        <article
          className="ops-action"
          key={`${action.mobility_entity_id}-${index}`}
        >
          <strong>
            {action.action_type} · {action.mobility_entity_id}
          </strong>
          <p>{action.reason}</p>
          <small>Availability: {action.availability ?? 'not specified'}</small>
        </article>
      ))}
    </section>
  );
}
function RunDetails({
  value,
  impact,
}: {
  value: SimulationRunView;
  impact: ImpactView | null;
}) {
  return (
    <section className="ops-state">
      <p className="ops-eyebrow">SIMULATION RUN · {value.status}</p>
      <h2>{value.simulation_run_id}</h2>
      <p>Snapshot {value.network_snapshot_id}</p>
      {value.failure_code && <p>Failure code: {value.failure_code}</p>}
      {impact?.metrics ? (
        <dl>
          {Object.entries(impact.metrics).map(([key, metric]) => (
            <div key={key}>
              <dt>{key.replaceAll('_', ' ')}</dt>
              <dd>{metric}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p>
          {value.status === 'COMPLETED'
            ? 'Impact metrics unavailable.'
            : 'Metrics withheld until run completes.'}
        </p>
      )}
    </section>
  );
}
