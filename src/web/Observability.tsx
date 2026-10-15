import { errorMessage } from '../shared/errors';
import { useCallback, useEffect, useState } from 'react';
import { Activity, ArrowRight, Check, Copy, Database, RefreshCw, ShieldCheck } from 'lucide-react';
import { api, serverMode } from './api';
import type { Telemetry, OutboxJob } from '../shared/observability';
import { EmptyState } from './components';
export function Observability({
  notify,
  onArchitecture,
}: {
  notify: (s: string) => void;
  onArchitecture: () => void;
}) {
  const [data, setData] = useState<Telemetry | null>(null),
    [jobs, setJobs] = useState<OutboxJob[]>([]),
    [error, setError] = useState(''),
    [replaying, setReplaying] = useState<string | null>(null),
    [selected, setSelected] = useState<string | null>(null);
  const refresh = useCallback(
    () =>
      Promise.all([api.telemetry(), api.jobs()]).then(
        ([d, j]) => {
          setData(d);
          setJobs(j.jobs);
          setError('');
        },
        (error) => {
          setError(errorMessage(error));
        },
      ),
    [],
  );
  useEffect(() => {
    if (!serverMode) return;
    void refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [refresh]);
  if (!serverMode)
    return (
      <div className="telemetry-sandbox">
        <div className="telemetry-orbit">
          <Activity size={44} />
        </div>
        <p className="eyebrow">REAL SIGNALS NEED A RUNNING SYSTEM</p>
        <h2>
          Connect the backend.
          <br />
          See the whole story.
        </h2>
        <p>
          Live request histograms, admission utilization, worker heartbeats,
          <br />
          trace correlation, and delivery leases are available with the Bun API.
        </p>
        <div className="telemetry-steps">
          <span>
            01 <strong>Start PostgreSQL + Redis</strong>
          </span>
          <ArrowRight size={16} />
          <span>
            02 <strong>Run the API + worker</strong>
          </span>
          <ArrowRight size={16} />
          <span>
            03 <strong>Unlock this console</strong>
          </span>
        </div>
        <button className="button dark" onClick={onArchitecture}>
          Explore the implementation <ArrowRight size={16} />
        </button>
        <small>
          The Architecture tab includes a measured two-replica benchmark. This browser sandbox does
          not fabricate server telemetry.
        </small>
      </div>
    );
  if (error)
    return (
      <div className="ops-card telemetry-error" role="alert">
        <h3>Telemetry unavailable</h3>
        <p>{error}</p>
        <button className="button secondary" onClick={refresh}>
          Retry <RefreshCw size={15} />
        </button>
      </div>
    );
  if (!data)
    return (
      <EmptyState
        title="Reading the system…"
        description="Collecting request samples and durable delivery state."
      />
    );
  return (
    <div className="observability">
      <div className="telemetry-heading">
        <div>
          <p className="eyebrow">LIVE / {data.instanceId}</p>
          <h2>Signals over assumptions.</h2>
          <p>{data.scope}</p>
        </div>
        <button className="button secondary" onClick={refresh}>
          <RefreshCw size={15} />
          Refresh
        </button>
      </div>
      <div className="metric-grid">
        {[
          [
            'Request availability',
            data.availability === null ? '—' : `${(data.availability * 100).toFixed(2)}%`,
            `${data.serverErrors} server errors · target 99.9%`,
          ],
          [
            'Request p95',
            data.latency.p95 === null ? '—' : `${data.latency.p95.toFixed(1)} ms`,
            `${data.latency.samples} samples · target <300 ms`,
          ],
          [
            'Oldest pending event',
            `${Math.floor(data.backlog.oldest_seconds)}s`,
            `${data.backlog.pending} pending · ${data.backlog.failed} dead letters`,
          ],
          [
            'Admission utilization',
            `${data.admission.active} / ${data.admission.capacity}`,
            'Durable PostgreSQL leases',
          ],
        ].map(([title, value, sub]) => (
          <div className="metric" key={title}>
            <span>
              {title}
              <Activity size={16} />
            </span>
            <strong>{value}</strong>
            <small>{sub}</small>
          </div>
        ))}
      </div>
      <div className="signals-grid">
        <section className="ops-card">
          <div className="card-title">
            <h3>Dependency & worker health</h3>
            <ShieldCheck size={18} />
          </div>
          <div className="health-row">
            <span>Redis circuit</span>
            <b className={data.circuit === 'closed' ? 'healthy-label' : 'warning-label'}>
              {data.circuit}
            </b>
          </div>
          <div className="health-row">
            <span>SSE connections</span>
            <b>{data.events.connections} / 200</b>
          </div>
          {data.workers.length ? (
            data.workers.map((w) => (
              <div className="health-row" key={w.id}>
                <span>{w.id}</span>
                <b className={w.age_seconds < 5 ? 'healthy-label' : 'warning-label'}>
                  {Math.floor(w.age_seconds)}s since heartbeat
                </b>
              </div>
            ))
          ) : (
            <p className="health-empty">
              No worker heartbeat. Start the delivery worker to process the outbox.
            </p>
          )}
        </section>
        <section className="ops-card">
          <div className="card-title">
            <h3>Bounded work in flight</h3>
            <Database size={18} />
          </div>
          {Object.entries(data.bulkheads).map(([name, lane]) => (
            <div className="lane" key={name}>
              <div>
                <span>{name}</span>
                <b>
                  {lane.active} / {lane.capacity}
                  <small>{lane.rejected} rejected</small>
                </b>
              </div>
              <progress max={lane.capacity} value={lane.active} aria-label={`${name} in flight`} />
            </div>
          ))}
        </section>
      </div>
      <section className="ops-card request-inspector">
        <div className="card-title">
          <h3>Request inspector</h3>
          <span>40 most recent · select to correlate</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Request</th>
                <th>Route template</th>
                <th>Status</th>
                <th>Duration</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {data.recent.map((r) => (
                <tr
                  key={r.requestId}
                  className={selected === r.requestId ? 'selected-request' : ''}
                >
                  <td>
                    <button
                      className="order-link"
                      onClick={() => setSelected(selected === r.requestId ? null : r.requestId)}
                      aria-expanded={selected === r.requestId}
                    >
                      {r.requestId.slice(0, 8)}
                    </button>
                    {selected === r.requestId && (
                      <div className="trace-detail">
                        <span>TRACE ID</span>
                        <code>{r.traceId}</code>
                        <button
                          aria-label="Copy trace ID"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(r.traceId);
                              notify('Trace ID copied.');
                            } catch {
                              notify('Select the trace ID to copy it.');
                            }
                          }}
                        >
                          <Copy size={14} />
                        </button>
                      </div>
                    )}
                  </td>
                  <td>
                    <code>
                      {r.method} {r.route}
                    </code>
                  </td>
                  <td>
                    <span
                      className={`http-status ${r.status >= 500 ? 'error' : r.status >= 400 ? 'warning' : 'success'}`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td>{r.durationMs.toFixed(1)} ms</td>
                  <td>{new Date(r.at).toLocaleTimeString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="ops-card delivery-ledger">
        <div className="card-title">
          <h3>Delivery ledger</h3>
          <span>50 most recent · at least once</span>
        </div>
        {!jobs.length ? (
          <EmptyState
            title="No delivery events yet."
            description="Complete a checkout to inspect a durable event and its delivery attempts."
          />
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Kind</th>
                  <th>Attempts</th>
                  <th>State</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id}>
                    <td>
                      <code title={j.id}>{j.id.slice(0, 8)}</code>
                      {j.last_error && <small className="job-error">{j.last_error}</small>}
                      {j.trace_id && (
                        <small className="job-trace">Trace {j.trace_id.slice(0, 12)}</small>
                      )}
                    </td>
                    <td>{j.kind}</td>
                    <td>{j.attempts} / 5</td>
                    <td>
                      <span
                        className={`http-status ${j.failed ? 'error' : j.processed_at ? 'success' : 'warning'}`}
                      >
                        {j.failed
                          ? 'dead letter'
                          : j.processed_at
                            ? 'delivered'
                            : j.lease_until
                              ? 'leased'
                              : 'pending'}
                      </span>
                    </td>
                    <td>
                      {j.failed ? (
                        <button
                          className="text-button"
                          disabled={!!replaying}
                          onClick={async () => {
                            setReplaying(j.id);
                            try {
                              await api.retryDeliveries(j.id);
                              await refresh();
                              notify('Delivery replay queued and audited.');
                            } catch (e) {
                              notify(errorMessage(e));
                            } finally {
                              setReplaying(null);
                            }
                          }}
                        >
                          Replay <RefreshCw size={13} />
                        </button>
                      ) : j.processed_at ? (
                        <Check size={15} />
                      ) : (
                        <span className="muted">automatic</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="telemetry-footnote">
        Targets guide design; they are not a production SLA. W3C trace IDs correlate logs and
        durable jobs. Metrics are exported in Prometheus format at the operator-protected metrics
        endpoint.
      </p>
    </div>
  );
}
