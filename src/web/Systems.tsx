import { useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Database,
  GitBranch,
  Layers,
  Radio,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import benchmark from '../../docs/benchmarks/latest.json';
const concepts = [
  {
    id: 'ownership',
    category: 'CORRECTNESS',
    title: 'One seat. One owner.',
    name: 'Transactional locking',
    icon: Database,
    mechanism:
      'PostgreSQL locks selected seats in a deterministic order. The order, ownership changes, and audit entry commit together. Database constraints reject malformed ownership.',
    tradeoff:
      'Contending buyers wait briefly for a row lock. A 1.5-second lock deadline bounds contention; the API returns a retryable 503 instead of occupying the pool indefinitely.',
    proof:
      '100 concurrent buyers, overlapping seat groups, two API replicas, and a held-lock timeout are exercised by the integration suite.',
    file: 'service.ts · migrations/0001_initial.sql',
    source: 'PostgreSQL: explicit locking',
    url: 'https://www.postgresql.org/docs/current/explicit-locking.html',
  },
  {
    id: 'replay',
    category: 'CORRECTNESS',
    title: 'A lost response is recoverable.',
    name: 'Durable idempotency',
    icon: GitBranch,
    mechanism:
      'A session-scoped request key has a database uniqueness constraint and a transaction-scoped advisory lock. Committed keys are looked up before admission and Redis gates. Changed selections return 409.',
    tradeoff:
      'Replays return the current order resource, including expiry or confirmation. Keys last for the lifetime of the order; this demo has no archival policy.',
    proof:
      'Concurrent retries return one order across replicas. A committed reservation remains replayable after admission expires, and mismatched payloads are rejected.',
    file: 'service.ts · routes/checkout.ts',
    source: 'Stripe: idempotent requests',
    url: 'https://docs.stripe.com/api/idempotent_requests',
  },
  {
    id: 'admission',
    category: 'TRAFFIC',
    title: 'Fair access. Durable limits.',
    name: 'FIFO admission leases',
    icon: Layers,
    mechanism:
      'Redis sequence scores preserve arrival order, while server-time heartbeats remove inactive waiters after 30 seconds. A PostgreSQL advisory lock guards the durable pool of 25 admission leases.',
    tradeoff:
      'Queue order resets after Redis data loss. The durable capacity limit survives it. Admission pauses during a cache outage; existing orders can still complete.',
    proof:
      'Fill the admission pool, erase Redis, and attempt 40 more joins: the database still contains only 25 leases. An abandoned queue head cannot block a live waiter.',
    file: 'queue.ts',
    source: 'Redis: atomic Lua scripts',
    url: 'https://redis.io/docs/latest/develop/programmability/eval-intro/',
  },
  {
    id: 'rate',
    category: 'TRAFFIC',
    title: 'Smooth the burst.',
    name: 'Atomic token bucket',
    icon: Zap,
    mechanism:
      'A Lua script refills session tokens using Redis TIME and consumes a token atomically. A session can burst to 120 requests and sustains two requests per second. Related queue keys share an event hash tag.',
    tradeoff:
      'A session quota is one layer of abuse control. This showcase does not claim bot protection or a global edge limit; deployment should add an ingress policy.',
    proof:
      '130 concurrent requests consume exactly 120 available tokens; 10 receive a rate-limit error. Responses include Retry-After.',
    file: 'queue.ts',
    source: 'Redis: scripting guarantees',
    url: 'https://redis.io/docs/latest/develop/programmability/eval-intro/',
  },
  {
    id: 'circuit',
    category: 'RESILIENCE',
    title: 'Let a dependency recover.',
    name: 'Circuit breaker',
    icon: ShieldCheck,
    mechanism:
      'Three Redis failures open the circuit for five seconds. A single half-open probe tests recovery. Redis connection and command deadlines are 600 milliseconds.',
    tradeoff:
      'The circuit belongs to each API process. One replica can recover before another; readiness therefore distinguishes database availability from admission availability.',
    proof:
      'Deterministic clock tests verify open, half-open, single-probe exclusion, and successful close transitions.',
    file: 'resilience.ts · db.ts',
    source: 'AWS: timeouts, retries, and jitter',
    url: 'https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/',
  },
  {
    id: 'bulkhead',
    category: 'RESILIENCE',
    title: 'Protect the work in flight.',
    name: 'Bulkheads & load shedding',
    icon: ShieldCheck,
    mechanism:
      'Each API has separate bounded lanes for reads, reservations, and payments. An exhausted lane rejects new work with 503 and Retry-After. There is no unbounded application request queue.',
    tradeoff:
      'A bulkhead limits in-flight work, not request rate. The shared database pool is still a common dependency, bounded by connection, statement, and lock deadlines.',
    proof:
      'Permit tests verify overflow and release. The 100-request HTTP benchmark records load shedding separately from inventory conflicts.',
    file: 'resilience.ts · app.ts',
    source: 'AWS: overload and retry control',
    url: 'https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/',
  },
  {
    id: 'outbox',
    category: 'DURABILITY',
    title: 'Commit now. Deliver safely.',
    name: 'Transactional outbox',
    icon: Database,
    mechanism:
      'A payment transition and pending event commit together. Workers claim up to 10 events with SKIP LOCKED and a 30-second lease, release the claim transaction, then deliver concurrently.',
    tradeoff:
      'Delivery is at least once. A provider must honor event ID as its idempotency key; a database transaction cannot undo a remote side effect.',
    proof:
      'Two workers do not own the same live claim. Crashes before delivery commit and after delivery commit both recover without duplicate local effects.',
    file: 'worker.ts · service.ts',
    source: 'AWS: transactional outbox',
    url: 'https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html',
  },
  {
    id: 'fencing',
    category: 'DURABILITY',
    title: 'Old workers cannot win.',
    name: 'Fencing & dead letters',
    icon: GitBranch,
    mechanism:
      'Acknowledgement and failure updates require the current claim token. Expired leases are recoverable. Five unsuccessful attempts move an event to a visible dead-letter queue, with full-jitter backoff.',
    tradeoff:
      'A provider call has a three-second deadline, shorter than the lease. Operators can replay failed work; each replay is audited. Provider idempotency remains essential.',
    proof:
      'A stale worker cannot overwrite a newer claim. Exhausted retries become inspectable and a controlled replay drains the event.',
    file: 'worker.ts · routes/operations.ts',
    source: 'AWS: retry backoff with jitter',
    url: 'https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/',
  },
  {
    id: 'saga',
    category: 'CORRECTNESS',
    title: 'Late payment has a path.',
    name: 'Compensating workflow',
    icon: GitBranch,
    mechanism:
      'Expiry releases a held seat durably. A success event arriving after expiry creates a refund job instead of reclaiming the seat. Duplicate or unordered payment success events cannot create another confirmation.',
    tradeoff:
      'The application uses a sandbox payment provider. A live integration needs provider-specific event types, amount verification, reconciliation, and refund confirmation.',
    proof:
      'A seat can be reassigned and sold, then a late payment for the former owner is refunded without changing the new ownership.',
    file: 'service.ts · worker.ts',
    source: 'Stripe: webhook delivery',
    url: 'https://docs.stripe.com/webhooks',
  },
  {
    id: 'push',
    category: 'REAL TIME',
    title: 'Push a hint. Read the truth.',
    name: 'Cross-replica invalidation',
    icon: Radio,
    mechanism:
      'Committed audit inserts trigger PostgreSQL NOTIFY. One listener per API fans out coalesced SSE invalidations to up to 200 browsers. Clients fetch an authorized snapshot after each hint.',
    tradeoff:
      'Notifications are transient. Reconnects fetch fresh state, and a 15-second reconciliation poll repairs missed hints. SSE IDs are diagnostic revisions, not a durable event replay log.',
    proof:
      'An order written through one process triggers an event on a client connected to another process. Inventory stays authoritative in PostgreSQL.',
    file: 'events.ts · App.tsx',
    source: 'PostgreSQL: NOTIFY semantics',
    url: 'https://www.postgresql.org/docs/current/sql-notify.html',
  },
  {
    id: 'telemetry',
    category: 'OPERATIONS',
    title: 'Make behavior inspectable.',
    name: 'Metrics & trace correlation',
    icon: Radio,
    mechanism:
      'Requests emit structured logs, W3C trace context, and Prometheus counters and histograms with route-template labels. Trace IDs travel into outbox jobs. The console shows bounded recent request samples and durable backlog age.',
    tradeoff:
      'Live latency samples are per process and reset at restart. Scrape every replica for service-wide metrics. Trace correlation is implemented; a full OpenTelemetry exporter is a future integration.',
    proof:
      'Tests assert route templates instead of order IDs, trace propagation, and operator access checks. The local benchmark publishes actual HTTP percentiles.',
    file: 'telemetry.ts · routes/operations.ts',
    source: 'Prometheus: histograms',
    url: 'https://prometheus.io/docs/practices/histograms/',
  },
  {
    id: 'delivery',
    category: 'OPERATIONS',
    title: 'Reproduce the evidence.',
    name: 'Versioned migrations & CI',
    icon: Check,
    mechanism:
      'Ordered SQL migrations carry checksums and run under an advisory lock. CI starts PostgreSQL and Redis, builds the app, and runs concurrency and process-crash tests. A separate benchmark resets only its dedicated database.',
    tradeoff:
      'This is a single-region design with one PostgreSQL writer. There is no claim of multi-region consensus, production availability, or unlimited throughput.',
    proof:
      'The repository includes an interview walkthrough, operational runbook, architecture decisions, a two-replica deployment, and a machine-readable benchmark with environment details.',
    file: 'migrate.ts · .github/workflows/ci.yml',
    source: 'Hono: application structure',
    url: 'https://hono.dev/docs/guides/best-practices',
  },
] as const;
export function Systems({ onLab }: { onLab: () => void }) {
  const [selected, setSelected] = useState<(typeof concepts)[number]['id']>('ownership');
  const current = concepts.find((c) => c.id === selected) ?? concepts[0];
  const Icon = current.icon;
  return (
    <div className="systems-atlas">
      <section className="systems-hero">
        <div>
          <p className="eyebrow">RUSH / ENGINEERING FIELD GUIDE</p>
          <h2>
            Built for the pressure.
            <br />
            <span>Open to inspection.</span>
          </h2>
          <p>
            A scarce seat is a distributed systems problem.
            <br />
            Follow the request. Challenge the guarantees.
          </p>
          <button className="button primary" onClick={onLab}>
            Run an experiment <ArrowUpRight size={17} />
          </button>
        </div>
        <div className="system-map" aria-label="Request flow">
          <div className="map-node">
            <Radio size={18} />
            <span>
              01 / EXPERIENCE<strong>React client</strong>
            </span>
            <small>Snapshot + SSE</small>
          </div>
          <div className="map-connector">
            <i />
            validated request
            <i />
          </div>
          <button
            className={`map-node ${['rate', 'circuit', 'bulkhead'].includes(selected) ? 'selected' : ''}`}
            onClick={() => setSelected('bulkhead')}
          >
            <Layers size={18} />
            <span>
              02 / EDGE OF THE APPLICATION<strong>Bun + Hono × 2</strong>
            </span>
            <small>Bounded work</small>
          </button>
          <div className="map-stores">
            <button onClick={() => setSelected('ownership')}>
              <Database size={18} />
              <strong>PostgreSQL</strong>
              <small>Ownership + outbox</small>
            </button>
            <button onClick={() => setSelected('admission')}>
              <Zap size={18} />
              <strong>Redis</strong>
              <small>Queue + rate limits</small>
            </button>
          </div>
          <div className="map-connector">
            <i />
            durable event · leased claim
            <i />
          </div>
          <button className="map-node" onClick={() => setSelected('outbox')}>
            <GitBranch size={18} />
            <span>
              03 / ASYNCHRONOUS WORK<strong>Delivery workers</strong>
            </span>
            <small>Retry + deduplicate</small>
          </button>
        </div>
      </section>
      <div className="systems-index-head">
        <div>
          <p className="eyebrow">TWELVE CONCEPTS. WORKING CODE.</p>
          <h2>The decisions behind the moment.</h2>
        </div>
        <span>
          SELECT A CONCEPT TO EXPLORE <ArrowRight size={15} />
        </span>
      </div>
      <div className="concept-explorer">
        <nav aria-label="System design concepts">
          {concepts.map((c, i) => (
            <button
              key={c.id}
              onClick={() => setSelected(c.id)}
              aria-pressed={selected === c.id}
              className={selected === c.id ? 'active' : ''}
            >
              <span>{String(i + 1).padStart(2, '0')}</span>
              <strong>{c.name}</strong>
              <ArrowRight size={14} />
            </button>
          ))}
        </nav>
        <article className="concept-detail" key={current.id}>
          <div className="concept-category">
            <span>{current.category}</span>
            <Icon size={25} />
          </div>
          <h3>{current.title}</h3>
          <p className="concept-mechanism">{current.mechanism}</p>
          <div className="concept-fact">
            <span>THE TRADEOFF</span>
            <p>{current.tradeoff}</p>
          </div>
          <div className="concept-fact proof">
            <span>
              <ShieldCheck size={14} /> HOW WE CHECK IT
            </span>
            <p>{current.proof}</p>
          </div>
          <div className="concept-location">
            <span>IMPLEMENTATION</span>
            <code>{current.file}</code>
          </div>
          <a href={current.url} target="_blank" rel="noreferrer">
            Read the primary source: {current.source} <ArrowUpRight size={14} />
          </a>
        </article>
      </div>
      <section className="evidence-section">
        <div className="evidence-heading">
          <div>
            <p className="eyebrow">MEASURED, WITH CONTEXT</p>
            <h2>Evidence you can rerun.</h2>
            <p>Two API replicas. Real PostgreSQL and Redis. Local HTTP requests.</p>
          </div>
          <span className="evidence-badge">
            <Check size={15} />
            {benchmark.passed ? 'INVARIANTS VERIFIED' : 'REVIEW REQUIRED'}
          </span>
        </div>
        <div className="benchmark-table table-scroll">
          <table>
            <thead>
              <tr>
                <th>Experiment</th>
                <th>Requests</th>
                <th>p50</th>
                <th>p95</th>
                <th>p99</th>
                <th>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {benchmark.results.map((r) => (
                <tr key={r.name}>
                  <td>
                    <strong>{r.name}</strong>
                  </td>
                  <td>{r.requests}</td>
                  <td>{r.p50Ms} ms</td>
                  <td>{r.p95Ms} ms</td>
                  <td>{r.p99Ms} ms</td>
                  <td>
                    <span className="evidence-outcome">
                      {Object.entries(r.statuses)
                        .map(([status, count]) => `${count} × ${status}`)
                        .join(' · ')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="benchmark-context">
          {benchmark.environment.cpu} · {benchmark.environment.memoryGiB} GiB · Bun{' '}
          {benchmark.environment.bun} · {new Date(benchmark.generatedAt).toLocaleDateString()}
          <br />
          503 means the reservation lane shed excess work. These timings include rejections and
          describe this workload on this machine. They are not a production capacity estimate.
        </p>
      </section>
      <div className="architecture-note">
        <ShieldCheck />
        <p>
          <strong>Know the boundary.</strong> The hosted experience is a browser sandbox. The Bun
          backend, tests, container deployment, and benchmark are in the project source. One region,
          one database writer, sandbox payments. Each concept above describes what is implemented
          and where it stops.
        </p>
      </div>
    </div>
  );
}
