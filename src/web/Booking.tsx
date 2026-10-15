import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Clock3,
  LockKeyhole,
  MapPin,
  Minus,
  ShieldCheck,
  Ticket as TicketIcon,
  Users,
} from 'lucide-react';
import { money, type Snapshot, type Order } from '../shared/model';
import { api } from './api';
import { LiveBadge, SeatLegend } from './components';
export function Booking({
  snapshot,
  initialOrder,
  onBack,
  onComplete,
  refresh,
  notify,
}: {
  snapshot: Snapshot;
  initialOrder?: Order | null;
  onBack: () => void;
  onComplete: (o: Order) => void;
  refresh: () => Promise<void>;
  notify: (s: string) => void;
}) {
  const [phase, setPhase] = useState<'queue' | 'seats' | 'checkout'>(
    initialOrder ? 'checkout' : 'queue',
  );
  const [position, setPosition] = useState<number | null>(null);
  const [selected, setSelected] = useState<string[]>(initialOrder?.seatIds || []);
  const [order, setOrder] = useState<Order | null>(initialOrder || null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [requestKey] = useState(() => crypto.randomUUID());
  const key = useRef(requestKey);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (position === null || phase !== 'queue') return;
    let alive = true;
    const timer = setInterval(() => {
      api
        .join()
        .then((r) => {
          if (!alive) return;
          if (r.admitted) setPhase('seats');
          else setPosition(r.position);
        })
        .catch((e) => {
          if (alive) {
            notify(e.message);
            setPosition(null);
          }
        });
    }, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [position, phase, notify]);
  const liveOrder = order ? snapshot.orders.find((o) => o.id === order.id) || order : null;
  const remaining = liveOrder
    ? Math.max(0, Math.min(300, Math.ceil((liveOrder.expiresAt - now) / 1000)))
    : 0;
  const chosen = snapshot.seats.filter((s) => selected.includes(s.id));
  const amount = chosen.reduce((n, s) => n + s.price, 0);
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
      await refresh();
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }
  function toggle(id: string) {
    if (selected.includes(id)) setSelected(selected.filter((seat) => seat !== id));
    else if (selected.length === 4) {
      notify('You can book up to four seats together.');
      return;
    } else setSelected([...selected, id]);
    key.current = crypto.randomUUID();
  }

  return (
    <main className="booking-page page-enter">
      <button className="text-button" onClick={onBack}>
        <ArrowLeft size={16} /> Back to discover
      </button>
      <div className="booking-title">
        <div>
          <p className="eyebrow">YOUR NEXT UNFORGETTABLE NIGHT</p>
          <h1>Make room for the moment.</h1>
        </div>
        <div className="steps">
          <span className={phase === 'queue' ? 'current' : ''}>
            01 <b>Join</b>
          </span>
          <i />
          <span className={phase === 'seats' ? 'current' : ''}>
            02 <b>Select</b>
          </span>
          <i />
          <span className={phase === 'checkout' ? 'current' : ''}>
            03 <b>Confirm</b>
          </span>
        </div>
      </div>
      {phase === 'queue' ? (
        <div className="queue-layout">
          <div className="queue-art">
            <div className="queue-orb" />
            <span className="queue-type">
              GOOD THINGS
              <br />
              ARE WORTH
              <br />
              <i>THE WAIT.</i>
            </span>
            <div className="queue-art-bottom">
              <span>AFTERHOURS / VOL. 001</span>
              <span>14.11.26 ↗</span>
            </div>
          </div>
          <div className="queue-info">
            <LiveBadge>THE DROP IS OPEN</LiveBadge>
            <h2>
              A fair shot.
              <br />
              For every fan.
            </h2>
            <p>We let people in at a steady pace so choosing your perfect spot stays effortless.</p>
            <div className="queue-stat">
              <Users size={20} />
              <div>
                <strong>
                  {position !== null ? `You’re #${position} in line` : 'Your night starts here'}
                </strong>
                <span>
                  {position !== null
                    ? 'Keep this page open. We’ll let you in automatically.'
                    : 'Join the waiting room to choose up to four seats.'}
                </span>
              </div>
            </div>
            <button
              className="button primary full"
              disabled={busy || position !== null}
              onClick={() =>
                act(async () => {
                  const r = await api.join();
                  if (r.admitted) setPhase('seats');
                  else setPosition(r.position);
                })
              }
            >
              {busy ? 'Joining…' : position !== null ? 'Waiting for admission…' : 'Join the drop'}
              <ArrowRight size={18} />
            </button>
            <p className="fine">
              <ShieldCheck size={15} /> Admission gives you access; seats are secured on
              reservation.
            </p>
          </div>
        </div>
      ) : (
        <div className="seat-layout">
          <section className="seat-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">THE CONSERVATORY · BENGALURU</p>
                <h2>{phase === 'checkout' ? 'Your view is reserved.' : 'Find your place.'}</h2>
              </div>
              <span className="availability">
                {snapshot.seats.filter((s) => s.status === 'available').length} available
              </span>
            </div>
            <div className="stage">
              <span>STAGE</span>
              <i />
            </div>
            <fieldset className="seat-map" aria-label="Choose your seats">
              {'ABCDEFGHIJ'.split('').map((row) => (
                <div className="seat-row" key={row}>
                  <span className="row-label">{row}</span>
                  {snapshot.seats
                    .filter((s) => s.row === row)
                    .map((s) => (
                      <button
                        key={s.id}
                        className={`seat ${s.status} ${selected.includes(s.id) ? 'selected' : ''} ${s.number === 6 ? 'aisle' : ''}`}
                        aria-label={`Seat ${s.id}, ${s.zone}, ${money(s.price)}, ${selected.includes(s.id) ? 'selected' : s.status}`}
                        aria-pressed={selected.includes(s.id)}
                        disabled={phase === 'checkout' || s.status !== 'available'}
                        onClick={() => toggle(s.id)}
                      >
                        {s.number}
                      </button>
                    ))}
                  <span className="row-label">{row}</span>
                </div>
              ))}
            </fieldset>
            <SeatLegend />
            <div className="zone-prices">
              <span>
                Front row <b>₹3,999</b>
              </span>
              <span>
                Floor <b>₹2,999</b>
              </span>
              <span>
                Balcony <b>₹1,999</b>
              </span>
            </div>
          </section>
          <aside className="booking-summary">
            <div className="mini-poster">
              AFTER<span>HOURS</span>
              <i>MONOLINK · LIVE</i>
            </div>
            <h3>Afterhours: Monolink Live</h3>
            <p>
              <Clock3 size={14} /> Sat, 14 Nov · 7:00 PM
            </p>
            <p>
              <MapPin size={14} /> The Conservatory, Bengaluru
            </p>
            <div className="summary-divider" />
            {phase === 'seats' ? (
              <>
                <div className="summary-label">
                  <span>Your seats</span>
                  <span>{selected.length} / 4</span>
                </div>
                <div className="selected-seats">
                  {chosen.length ? (
                    chosen.map((s) => (
                      <button key={s.id} onClick={() => toggle(s.id)}>
                        {s.id}
                        <Minus size={12} />
                      </button>
                    ))
                  ) : (
                    <span>Pick a seat to start your night.</span>
                  )}
                </div>
                <div className="summary-total">
                  <span>
                    Total <small>All fees included</small>
                  </span>
                  <strong>{money(amount)}</strong>
                </div>
                <button
                  className="button primary full"
                  disabled={!selected.length || busy}
                  onClick={() =>
                    act(async () => {
                      const o = await api.reserve(selected, key.current);
                      setOrder(o);
                      setPhase('checkout');
                    })
                  }
                >
                  {busy ? 'Securing seats…' : 'Reserve my seats'}
                  <ArrowRight size={17} />
                </button>
                <p className="fine center">
                  <LockKeyhole size={13} /> Five-minute hold. No payment yet.
                </p>
              </>
            ) : (
              <>
                <div className={`hold-timer ${remaining === 0 ? 'expired' : ''}`}>
                  <Clock3 size={19} />
                  <span>
                    {remaining
                      ? `Seats held for ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`
                      : 'Your hold has expired'}
                  </span>
                </div>
                <div className="summary-label">
                  <span>Seats</span>
                  <b>{liveOrder?.seatIds.join(', ')}</b>
                </div>
                <div className="summary-total">
                  <span>
                    Total <small>All fees included</small>
                  </span>
                  <strong>{money(liveOrder?.amount || 0)}</strong>
                </div>
                <div className="sandbox-note">
                  <ShieldCheck size={17} />
                  <span>
                    Sandbox checkout
                    <br />
                    <small>No card details. No real charge.</small>
                  </span>
                </div>
                <button
                  className="button primary full"
                  disabled={busy || !remaining}
                  onClick={() =>
                    act(async () => {
                      if (!order) return;
                      const paid = await api.pay(order.id);
                      onComplete(paid);
                    })
                  }
                >
                  {busy ? 'Confirming…' : 'Confirm sandbox payment'}
                  <TicketIcon size={17} />
                </button>
                {!remaining && (
                  <button
                    className="button secondary full"
                    onClick={() => {
                      setOrder(null);
                      setSelected([]);
                      key.current = crypto.randomUUID();
                      setPhase('seats');
                    }}
                  >
                    Choose new seats
                  </button>
                )}
              </>
            )}
          </aside>
        </div>
      )}
    </main>
  );
}
