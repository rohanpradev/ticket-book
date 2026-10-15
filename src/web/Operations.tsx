import { errorMessage } from '../shared/errors';
import { useState } from 'react';
import {
  Activity,
  ArrowRight,
  Check,
  ChevronRight,
  Download,
  FlaskConical,
  Layers,
  Play,
  RefreshCw,
  Server,
  ShieldCheck,
  Terminal,
  Wifi,
  Zap,
} from 'lucide-react';
import { invariant, type Snapshot, type Order } from '../shared/model';
import { api, getToken, serverMode, setToken } from './api';
import { runExperiment, type ExperimentKind } from './experiments';
import { Systems } from './Systems';
import { Observability } from './Observability';
import { Modal, StatusPill, EmptyState } from './components';
export function Operations({
  snapshot,
  refresh,
  notify,
}: {
  snapshot: Snapshot;
  refresh: () => Promise<void>;
  notify: (s: string) => void;
}) {
  const [tab, setTab] = useState('overview');
  const [running, setRunning] = useState<string | null>(null);
  const [results, setResults] = useState<
    { name: string; detail: string; pass: boolean; at: number }[]
  >([]);
  const [selected, setSelected] = useState<Order | null>(null);
  const [token, setTokenInput] = useState('');
  const [unlocked, setUnlocked] = useState(!serverMode || !!getToken());
  const [report, setReport] = useState('');
  const sold = snapshot.seats.filter((s) => s.status === 'sold').length,
    held = snapshot.seats.filter((s) => s.status === 'held').length;
  const healthy = snapshot.consistent ?? invariant(snapshot.seats, snapshot.orders);
  const lat = [...snapshot.metrics.latencies].sort((a, b) => a - b);
  const p95 = lat[Math.max(0, Math.ceil(lat.length * 0.95) - 1)];
  async function control(action: string) {
    try {
      await api.control(action);
      await refresh();
    } catch (e) {
      notify(errorMessage(e));
    }
  }
  async function scenario(kind: ExperimentKind) {
    setRunning(kind);
    setReport('Preparing test requests…');
    try {
      const result = await runExperiment(kind, setReport);
      setResults((prev) => [result, ...prev]);
      setReport(
        result.pass
          ? 'Scenario complete. Expected behavior verified.'
          : 'Scenario complete. Review the failed assertion.',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Experiment failed.';
      notify(message);
      setReport(message);
    } finally {
      await refresh();
      setRunning(null);
    }
  }
  function download() {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            mode: snapshot.mode,
            scope: serverMode
              ? 'API integration scenarios'
              : 'Browser sandbox; not a distributed-system benchmark',
            results,
            metrics: snapshot.metrics,
          },
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'rush-lab-report.json';
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <main className="ops-page page-enter">
      <div className="ops-header">
        <div>
          <p className="eyebrow">RUSH / CONTROL ROOM</p>
          <h1>Behind the moment.</h1>
          <p>Every seat accounted for. Every failure has a plan.</p>
        </div>
        <span className={`system-state ${snapshot.redisDown ? 'warn' : ''}`}>
          <i />
          {snapshot.redisDown ? 'Degraded · admissions paused' : 'Systems operational'}
        </span>
      </div>
      <nav className="ops-tabs" aria-label="Control room sections">
        {(
          [
            ['overview', 'Overview'],
            ['lab', 'Reliability lab'],
            ['orders', 'Orders'],
            ['observability', 'Observability'],
            ['architecture', 'Architecture'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className={tab === id ? 'active' : ''}>
            {label}
            {id === 'lab' && <FlaskConical size={14} />}
          </button>
        ))}
        <span>{serverMode ? 'CONNECTED API' : 'BROWSER SANDBOX'}</span>
      </nav>
      {!unlocked ? (
        <div className="operator-login">
          <ShieldCheck size={30} />
          <h2>Operator access</h2>
          <p>Enter the ADMIN_TOKEN configured on your Rush server.</p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setToken(token);
              try {
                await api.authenticate();
              } catch (error) {
                setToken('');
                notify(errorMessage(error));
                return;
              }
              setUnlocked(true);
              await refresh();
            }}
          >
            <input
              type="password"
              aria-label="Operator token"
              value={token}
              onChange={(e) => setTokenInput(e.target.value)}
              autoComplete="off"
              required
            />
            <button className="button primary">Unlock console</button>
          </form>
        </div>
      ) : (
        <>
          {tab === 'overview' && (
            <>
              <div className="metric-grid">
                {[
                  [
                    'Tickets confirmed',
                    `${sold}`,
                    `of ${snapshot.seats.length} seats`,
                    TicketMetric,
                  ],
                  ['Active holds', `${held}`, 'Five-minute reservations', ClockMetric],
                  [
                    'Pending delivery',
                    `${snapshot.outboxPending}`,
                    snapshot.workerPaused ? 'Worker paused' : 'Worker running',
                    Layers,
                  ],
                  [
                    'Request p95',
                    p95 === undefined ? '—' : `${p95.toFixed(1)}ms`,
                    serverMode
                      ? 'This API instance · last 500'
                      : 'Local execution · not network latency',
                    Activity,
                  ],
                ].map(([title, value, sub, Icon]) => {
                  const I = Icon as typeof Activity;
                  return (
                    <div className="metric" key={String(title)}>
                      <span>
                        {String(title)}
                        <I size={17} />
                      </span>
                      <strong>{String(value)}</strong>
                      <small>{String(sub)}</small>
                    </div>
                  );
                })}
              </div>
              <div className="ops-columns">
                <section className="ops-card inventory-card">
                  <div className="card-title">
                    <h3>One night. 100 possibilities.</h3>
                    <span className="muted">Live inventory</span>
                  </div>
                  <div className="inventory-grid">
                    {snapshot.seats.map((s) => (
                      <span title={`${s.id} · ${s.status}`} key={s.id} className={s.status} />
                    ))}
                  </div>
                  <div className="inventory-key">
                    <span>
                      <i className="available" />
                      {100 - held - sold} available
                    </span>
                    <span>
                      <i className="held" />
                      {held} held
                    </span>
                    <span>
                      <i className="sold" />
                      {sold} confirmed
                    </span>
                  </div>
                  <div className="invariant">
                    <ShieldCheck size={20} />
                    <div>
                      <strong>
                        {healthy ? 'Inventory is consistent' : 'Inventory needs attention'}
                      </strong>
                      <span>
                        {serverMode
                          ? 'Ownership enforced by database transactions.'
                          : 'All active orders match their seat ownership.'}
                      </span>
                    </div>
                    <Check size={18} />
                  </div>
                </section>
                <section className="ops-card activity-card">
                  <div className="card-title">
                    <h3>The live feed</h3>
                    <span className="live-dot" />
                  </div>
                  <div className="activity-list">
                    {snapshot.activity.slice(0, 7).map((a) => (
                      <div className="activity-item" key={a.id}>
                        <span className={`activity-icon ${a.type}`}>
                          <Zap size={12} />
                        </span>
                        <div>
                          <p>{a.message}</p>
                          <small>
                            {new Date(a.at).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                              second: '2-digit',
                            })}{' '}
                            · {a.type}
                          </small>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
              <div className="lab-callout">
                <div className="lab-symbol">
                  <FlaskConical size={27} />
                </div>
                <div>
                  <h3>Don’t take reliability on faith.</h3>
                  <p>Race for a seat. Replay a payment. Pause the worker. See what holds.</p>
                </div>
                <button className="button dark" onClick={() => setTab('lab')}>
                  Enter the lab <ArrowRight size={17} />
                </button>
              </div>
            </>
          )}
          {tab === 'lab' && (
            <>
              <div className="lab-intro">
                <div>
                  <span className="eyebrow">CONTROLLED CHAOS. OBSERVABLE OUTCOMES.</span>
                  <h2>Go ahead. Push the system.</h2>
                  <p>
                    {serverMode
                      ? 'These scenarios exercise your running API and database.'
                      : 'These scenarios run in your browser. The included backend has separate PostgreSQL and Redis integration tests.'}
                  </p>
                </div>
                <button className="button secondary" onClick={download}>
                  <Download size={16} /> Export results
                </button>
              </div>
              <div className="scenario-grid">
                {[
                  {
                    id: 'race',
                    num: '01',
                    name: 'The last-seat race',
                    desc: '40 buyers. One seat. A single winner.',
                    tag: 'CONCURRENCY',
                  },
                  {
                    id: 'duplicate',
                    num: '02',
                    name: 'The double click',
                    desc: 'Replay checkout six times. Confirm once.',
                    tag: 'IDEMPOTENCY',
                  },
                  {
                    id: 'late',
                    num: '03',
                    name: 'Too late to the party',
                    desc: 'Payment arrives after expiry. Refund safely.',
                    tag: 'COMPENSATION',
                  },
                  {
                    id: 'worker',
                    num: '04',
                    name: 'Pause. Persist. Recover.',
                    desc: 'Stop delivery. Build a backlog. Resume.',
                    tag: 'DURABILITY',
                  },
                ].map((x) => (
                  <div className="scenario" key={x.id}>
                    <div className="scenario-top">
                      <span>{x.num}</span>
                      <span>{x.tag}</span>
                    </div>
                    <h3>{x.name}</h3>
                    <p>{x.desc}</p>
                    <button
                      className="text-button"
                      disabled={!!running}
                      onClick={() => scenario(x.id as ExperimentKind)}
                    >
                      {running === x.id ? (
                        <RefreshCw size={15} className="spin" />
                      ) : (
                        <Play size={14} />
                      )}{' '}
                      {running === x.id ? 'Running scenario…' : 'Run scenario'}
                      <ArrowRight size={15} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="lab-bottom">
                <section className="terminal">
                  <div className="terminal-bar">
                    <Terminal size={15} />
                    <span>Experiment log</span>
                    <span>{serverMode ? 'API' : 'SANDBOX'}</span>
                  </div>
                  <div className="terminal-body">
                    <p>
                      <span className="terminal-prompt">›</span>{' '}
                      {report || 'Ready. Select a scenario above to begin.'}
                    </p>
                    {results.map((r, i) => (
                      <div key={r.at + ':' + i} className="terminal-result">
                        <span className={r.pass ? 'pass' : 'fail'}>{r.pass ? 'PASS' : 'FAIL'}</span>
                        <div>
                          <strong>{r.name}</strong>
                          <p>{r.detail}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
                <section className="ops-card fault-controls">
                  <h3>Fault switches</h3>
                  {serverMode && (snapshot.failedDeliveries || 0) > 0 && (
                    <div className="failed-deliveries">
                      <p>{snapshot.failedDeliveries} deliveries exhausted retries.</p>
                      <button
                        className="text-button"
                        onClick={async () => {
                          try {
                            const r = await api.retryDeliveries();
                            notify(`Queued ${r.retried} events for retry.`);
                            await refresh();
                          } catch (e) {
                            notify(errorMessage(e));
                          }
                        }}
                      >
                        Replay failed deliveries <RefreshCw size={14} />
                      </button>
                    </div>
                  )}
                  <p>Explore how dependencies affect the flow.</p>
                  <button
                    className="switch-row"
                    onClick={() => control('worker')}
                    disabled={!!running}
                  >
                    <span>
                      <Server size={18} />
                      <span>
                        Pause delivery worker
                        <small>
                          {snapshot.workerPaused
                            ? 'Events accumulate durably'
                            : 'Worker is processing events'}
                        </small>
                      </span>
                    </span>
                    <i className={`switch ${snapshot.workerPaused ? 'on' : ''}`} />
                  </button>
                  <button
                    className="switch-row"
                    onClick={() => control('redis')}
                    disabled={!!running}
                  >
                    <span>
                      <Wifi size={18} />
                      <span>
                        Inject Redis outage
                        <small>
                          {snapshot.redisDown
                            ? 'New admissions are paused'
                            : 'Admission control is available'}
                        </small>
                      </span>
                    </span>
                    <i className={`switch ${snapshot.redisDown ? 'on' : ''}`} />
                  </button>
                  <p className="fine">
                    {serverMode
                      ? 'Protected controls require LAB_ENABLED=true. Outage is injected at the admission boundary.'
                      : 'Isolated browser simulation. No infrastructure is stopped.'}
                  </p>
                </section>
              </div>
            </>
          )}
          {tab === 'orders' && (
            <section className="ops-card orders-card">
              <div className="card-title">
                <h3>Order ledger</h3>
                <span>{snapshot.orders.length} orders</span>
              </div>
              {!snapshot.orders.length ? (
                <EmptyState
                  title="The ledger starts with a moment."
                  description="Book a seat or run a lab scenario to inspect an order’s lifecycle."
                />
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Order</th>
                        <th>Seats</th>
                        <th>State</th>
                        <th>Created</th>
                        <th>
                          <span className="sr-only">Inspect order</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {snapshot.orders.map((o) => (
                        <tr key={o.id}>
                          <td>
                            <button className="order-link" onClick={() => setSelected(o)}>
                              {o.id.slice(0, 8)}
                            </button>
                          </td>
                          <td>{o.seatIds.join(', ')}</td>
                          <td>
                            <StatusPill status={o.status} />
                          </td>
                          <td>{new Date(o.createdAt).toLocaleTimeString()}</td>
                          <td>
                            <ChevronRight size={16} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
          {tab === 'observability' && (
            <Observability notify={notify} onArchitecture={() => setTab('architecture')} />
          )}
          {tab === 'architecture' && <Systems onLab={() => setTab('lab')} />}
        </>
      )}
      {selected && (
        <Modal label="Order timeline" onClose={() => setSelected(null)}>
          <p className="eyebrow">ORDER / {selected.id.slice(0, 8)}</p>
          <h2>The story of a seat.</h2>
          <StatusPill
            status={snapshot.orders.find((x) => x.id === selected.id)?.status || selected.status}
          />
          <div className="order-detail">
            Seats <strong>{selected.seatIds.join(', ')}</strong>
          </div>
          <div className="timeline">
            {snapshot.activity
              .filter((a) => a.orderId === selected.id)
              .reverse()
              .map((a) => (
                <div key={a.id}>
                  <i />
                  <span>
                    <strong>{a.message}</strong>
                    <small>{new Date(a.at).toLocaleTimeString()}</small>
                  </span>
                </div>
              ))}
          </div>
        </Modal>
      )}
    </main>
  );
}
const TicketMetric = ShieldCheck,
  ClockMetric = Layers;
