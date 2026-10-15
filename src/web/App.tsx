import { errorMessage } from '../shared/errors';
import { useCallback, useEffect, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  AudioLines,
  Check,
  ChevronDown,
  Clock3,
  FlaskConical,
  MapPin,
  Menu,
  Radio,
  ShieldCheck,
  X,
  Zap,
} from 'lucide-react';
import { api, serverMode, sessionId } from './api';
import { type Order, type Snapshot } from '../shared/model';
import { Booking } from './Booking';
import { Operations } from './Operations';
import {
  Brand,
  DateBlock,
  EmptyState,
  LiveBadge,
  Modal,
  Poster,
  StatusPill,
  Ticket,
} from './components';
type Page = 'discover' | 'booking' | 'operations' | 'tickets';
export function App() {
  const [page, setPage] = useState<Page>('discover');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [toast, setToast] = useState('');
  const [ticket, setTicket] = useState<Order | null>(null);
  const [resumeOrder, setResumeOrder] = useState<Order | null>(null);
  const [category, setCategory] = useState('All experiences');
  const [info, setInfo] = useState<string | null>(null);
  const [mobile, setMobile] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('rush:saved') || '[]');
    } catch {
      return [];
    }
  });
  const notify = useCallback((message: string) => setToast(message), []);
  const refresh = useCallback(
    () =>
      api.snapshot().then(
        (data) => {
          setSnapshot(data);
          setError('');
        },
        (error) => {
          setError(errorMessage(error));
        },
      ),
    [],
  );
  useEffect(() => {
    void refresh();
    const stream = serverMode ? new EventSource('/api/events') : null;
    stream?.addEventListener('invalidate', () => {
      void refresh();
    });
    const t = setInterval(refresh, serverMode ? 15000 : 3000);
    const listener = () => {
      void refresh();
    };
    window.addEventListener('storage', listener);
    window.addEventListener('rush-update', listener);
    return () => {
      stream?.close();
      clearInterval(t);
      window.removeEventListener('storage', listener);
      window.removeEventListener('rush-update', listener);
    };
  }, [refresh]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 6000);
    return () => clearTimeout(t);
  }, [toast]);
  function navigate(p: Page) {
    setPage(p);
    setMobile(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function save(name: string) {
    setSaved((prev) => {
      const next = prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name];
      localStorage.setItem('rush:saved', JSON.stringify(next));
      return next;
    });
    notify(saved.includes(name) ? 'Reminder removed.' : 'Saved to your watchlist in this browser.');
  }
  const ownOrders =
    snapshot?.orders.filter(
      (o) => o.sessionId === (serverMode ? snapshot?.viewerSessionId : sessionId),
    ) || [];
  const available = snapshot?.seats.filter((s) => s.status === 'available').length ?? 100;
  return (
    <>
      <header className="site-header">
        <div className="header-inner">
          <button
            className="brand-button"
            aria-label="Rush home"
            onClick={() => navigate('discover')}
          >
            <Brand />
          </button>
          <nav aria-label="Main navigation" className={mobile ? 'open' : ''}>
            <button
              className={page === 'discover' || page === 'booking' ? 'active' : ''}
              onClick={() => navigate('discover')}
            >
              Discover
            </button>
            <button
              className={page === 'tickets' ? 'active' : ''}
              onClick={() => navigate('tickets')}
            >
              My tickets
              {ownOrders.filter((o) => o.status === 'confirmed').length > 0 && (
                <span className="nav-count">
                  {ownOrders.filter((o) => o.status === 'confirmed').length}
                </span>
              )}
            </button>
            <button
              className={page === 'operations' ? 'active' : ''}
              onClick={() => navigate('operations')}
            >
              Control room <ArrowUpRight size={13} />
            </button>
          </nav>
          <div className="header-right">
            <span className="sandbox-label">
              <i />
              {serverMode ? 'LOCAL API' : 'SANDBOX'}
            </span>
            <button
              className="avatar"
              aria-label="View my tickets"
              onClick={() => navigate('tickets')}
            >
              R
            </button>
            <button
              className="icon-button mobile-menu"
              aria-label="Toggle navigation"
              onClick={() => setMobile(!mobile)}
            >
              {mobile ? <X /> : <Menu />}
            </button>
          </div>
        </div>
      </header>
      {error && (
        <div className="error-banner" role="alert">
          {error}
          <button onClick={refresh}>Retry connection</button>
        </div>
      )}
      {page === 'discover' && (
        <main className="discover page-enter">
          <div className="intro-row">
            <p className="eyebrow">
              <span className="tiny-star">✳</span> FOR THE NIGHTS YOU’LL TALK ABOUT
            </p>
            <button className="location" onClick={() => setInfo('location')}>
              <MapPin size={15} /> Bengaluru <ChevronDown size={14} />
            </button>
          </div>
          <div className="hero-heading">
            <h1>
              Be there.
              <br />
              <span>Feel everything.</span>
            </h1>
            <div className="hero-description">
              <p>
                Great music. Your people.
                <br />
                The kind of night that stays with you.
              </p>
              <span>
                LIVE EXPERIENCES, WITHOUT THE FRICTION <ArrowDownIcon />
              </span>
            </div>
          </div>
          <section className="featured-event">
            <Poster />
            <div className="featured-info">
              <div className="featured-top">
                <LiveBadge />
                <span className="event-number">001 / THE NEXT CHAPTER</span>
              </div>
              <div className="featured-copy">
                <div className="genre-tags">
                  <span>ELECTRONIC</span>
                  <span>LIVE SET</span>
                </div>
                <h2>
                  Some nights
                  <br />
                  change your
                  <br />
                  <i>frequency.</i>
                </h2>
                <p>
                  Monolink brings his signature blend of soulful vocals and hypnotic electronic
                  sound to an intimate, open-air stage.
                </p>
              </div>
              <div className="featured-bottom">
                <div className="event-detail-row">
                  <DateBlock day="14" month="NOV" />
                  <div>
                    <strong>Saturday, 7:00 PM onwards</strong>
                    <span>The Conservatory · Bengaluru</span>
                  </div>
                </div>
                <div className="booking-cta">
                  <div>
                    <small>TICKETS FROM</small>
                    <strong>
                      ₹1,999 <span>/ person</span>
                    </strong>
                  </div>
                  <button
                    className="button primary"
                    onClick={() => {
                      setResumeOrder(null);
                      navigate('booking');
                    }}
                  >
                    Get into the night <ArrowUpRight size={19} />
                  </button>
                </div>
                <div className="featured-foot">
                  <span>
                    <ShieldCheck size={14} /> Fair queue. Secure reservations.
                  </span>
                  <span>{available} seats left</span>
                </div>
              </div>
            </div>
          </section>
          <div className="trust-strip">
            <span>
              <ShieldCheck size={17} /> ONE SEAT. ONE OWNER.
            </span>
            <span>
              <Clock3 size={17} /> FIVE MINUTES TO MAKE IT YOURS
            </span>
            <span>
              <Zap size={17} /> BUILT FOR THE RUSH
            </span>
            <button onClick={() => navigate('operations')}>
              See how it works <ArrowUpRight size={14} />
            </button>
          </div>
          <section className="upcoming">
            <div className="section-heading">
              <div>
                <p className="eyebrow">MORE REASONS TO STEP OUT</p>
                <h2>Find your next feeling.</h2>
              </div>
              <div className="filters">
                {['All experiences', 'Electronic', 'Jazz & soul'].map((c) => (
                  <button
                    className={category === c ? 'active' : ''}
                    key={c}
                    onClick={() => setCategory(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
            <div className="upcoming-grid">
              {category !== 'Jazz & soul' && (
                <article className="upcoming-card">
                  <div className="event-art art-solar">
                    <span className="art-label">OPEN AIR / ELECTRONIC</span>
                    <div className="solar-disc" />
                    <h3>
                      GOLDEN
                      <br />
                      <i>HOUR</i>
                    </h3>
                    <div className="art-footer">
                      <span>ANJUNADEEP EXPLORATIONS</span>
                      <span>21.11.26</span>
                    </div>
                  </div>
                  <div className="upcoming-meta">
                    <div>
                      <p>21 NOV · 4:00 PM</p>
                      <h3>Golden Hour Sessions</h3>
                      <span>Embassy Springs · Bengaluru</span>
                    </div>
                    <button
                      aria-label={
                        saved.includes('Golden Hour Sessions')
                          ? 'Remove Golden Hour reminder'
                          : 'Save Golden Hour reminder'
                      }
                      className={`save-event ${saved.includes('Golden Hour Sessions') ? 'saved' : ''}`}
                      onClick={() => save('Golden Hour Sessions')}
                    >
                      {saved.includes('Golden Hour Sessions') ? (
                        <Check size={19} />
                      ) : (
                        <ArrowUpRight size={20} />
                      )}
                    </button>
                  </div>
                  <span className="upcoming-note">
                    {saved.includes('Golden Hour Sessions')
                      ? 'On your watchlist'
                      : 'Drop opening soon'}
                  </span>
                </article>
              )}
              {category !== 'Electronic' && (
                <article className="upcoming-card">
                  <div className="event-art art-blue">
                    <span className="art-label">INTIMATE / JAZZ & SOUL</span>
                    <div className="blue-lines" />
                    <h3>
                      BLUE
                      <br />
                      <i>NOTES.</i>
                    </h3>
                    <div className="art-footer">
                      <span>A LITTLE SOUL, AFTER DARK</span>
                      <span>28.11.26</span>
                    </div>
                  </div>
                  <div className="upcoming-meta">
                    <div>
                      <p>28 NOV · 8:00 PM</p>
                      <h3>Blue Notes After Dark</h3>
                      <span>The Piano Room · Bengaluru</span>
                    </div>
                    <button
                      aria-label={
                        saved.includes('Blue Notes After Dark')
                          ? 'Remove Blue Notes reminder'
                          : 'Save Blue Notes reminder'
                      }
                      className={`save-event ${saved.includes('Blue Notes After Dark') ? 'saved' : ''}`}
                      onClick={() => save('Blue Notes After Dark')}
                    >
                      {saved.includes('Blue Notes After Dark') ? (
                        <Check size={19} />
                      ) : (
                        <ArrowUpRight size={20} />
                      )}
                    </button>
                  </div>
                  <span className="upcoming-note">
                    {saved.includes('Blue Notes After Dark')
                      ? 'On your watchlist'
                      : 'Drop opening soon'}
                  </span>
                </article>
              )}
            </div>
          </section>
          <section className="engineering-banner">
            <div>
              <span className="eyebrow">GOOD EXPERIENCES HAVE GREAT ENGINEERING.</span>
              <h2>
                All the energy.
                <br />
                None of the uncertainty.
              </h2>
              <p>
                Go behind the scenes. Watch reservations happen,
                <br />
                challenge the system, and explore how Rush recovers.
              </p>
              <button className="button dark" onClick={() => navigate('operations')}>
                Explore the control room <ArrowUpRight size={17} />
              </button>
            </div>
            <div className="engineering-visual" aria-hidden="true">
              <div className="engine-ring r1" />
              <div className="engine-ring r2" />
              <div className="engine-ring r3" />
              <div className="engine-center">
                <Zap size={44} fill="currentColor" />
              </div>
              <div className="engine-badge b1">
                <i /> Inventory consistent
              </div>
              <div className="engine-badge b2">
                <ShieldCheck size={15} /> Every seat accounted for
              </div>
            </div>
          </section>
        </main>
      )}
      {page === 'booking' && snapshot && (
        <Booking
          initialOrder={resumeOrder}
          snapshot={snapshot}
          onBack={() => navigate('discover')}
          onComplete={(o) => {
            setTicket(o);
            navigate('tickets');
          }}
          refresh={refresh}
          notify={notify}
        />
      )}
      {page === 'operations' && snapshot && (
        <Operations snapshot={snapshot} refresh={refresh} notify={notify} />
      )}
      {page === 'tickets' && (
        <main className="tickets-page page-enter">
          <p className="eyebrow">YOUR UPCOMING MOMENTS</p>
          <h1>Good nights, kept close.</h1>
          <p className="muted">Your reservations and sandbox tickets live here.</p>
          {!ownOrders.length ? (
            <>
              <EmptyState
                title="Your next story is waiting."
                description="Find a night that feels like you. Your tickets will be right here."
              />
              <button className="button primary" onClick={() => navigate('discover')}>
                Discover experiences <ArrowRight size={17} />
              </button>
            </>
          ) : (
            <div className="my-tickets">
              {ownOrders.map((o) => (
                <button
                  className="my-ticket"
                  key={o.id}
                  onClick={() => {
                    if (o.status === 'held' && o.expiresAt > Date.now()) {
                      setResumeOrder(o);
                      navigate('booking');
                    } else setTicket(o);
                  }}
                >
                  <div className="ticket-thumbnail">
                    AFTER
                    <br />
                    HOURS
                  </div>
                  <div>
                    <StatusPill status={o.status} />
                    <h3>Afterhours: Monolink Live</h3>
                    <p>14 Nov · The Conservatory</p>
                    <span>Seats {o.seatIds.join(', ')}</span>
                  </div>
                  <ArrowUpRight size={22} />
                </button>
              ))}
            </div>
          )}
          {saved.length > 0 && (
            <section className="watchlist">
              <h2>On your radar</h2>
              {saved.map((s) => (
                <div key={s}>
                  <AudioLines size={19} />
                  <strong>{s}</strong>
                  <span>Drop opening soon</span>
                  <button className="text-button" onClick={() => save(s)}>
                    Remove
                  </button>
                </div>
              ))}
            </section>
          )}
        </main>
      )}
      {!snapshot && page !== 'discover' && (
        <div className="loading-state">
          <span className="spin">
            <Radio />
          </span>
          <p>Connecting to Rush…</p>
        </div>
      )}
      <footer className="site-footer">
        <Brand />
        <span>Made for the moment. Engineered for the rush.</span>
        <div>
          <button onClick={() => setInfo('about')}>
            About this project <ArrowUpRight size={13} />
          </button>
          <span>© 2026 Rush</span>
        </div>
      </footer>
      <div className="sandbox-footer">
        <span>
          <FlaskConical size={12} />
          {serverMode
            ? 'Connected to the Bun API · Sandbox payments'
            : 'Interactive sandbox · Data stays in this browser · No real payments'}
        </span>
        <button onClick={() => navigate('operations')}>
          Open reliability lab <ArrowUpRight size={12} />
        </button>
      </div>
      {toast && (
        <output className="toast">
          <span>{toast}</span>
          <button aria-label="Dismiss notification" onClick={() => setToast('')}>
            <X size={16} />
          </button>
        </output>
      )}
      {ticket && (
        <Ticket
          order={snapshot?.orders.find((o) => o.id === ticket.id) || ticket}
          onClose={() => setTicket(null)}
        />
      )}
      {info && (
        <Modal
          label={info === 'location' ? 'Choose city' : 'About Rush'}
          onClose={() => setInfo(null)}
        >
          {info === 'location' ? (
            <>
              <p className="eyebrow">ONE CITY. ENDLESS POSSIBILITIES.</p>
              <h2>Meet us in Bengaluru.</h2>
              <p>
                Our first curated drop is live in Bengaluru. More cities are part of the future of
                Rush.
              </p>
              <button className="city-option" onClick={() => setInfo(null)}>
                <MapPin size={20} />
                <strong>Bengaluru</strong>
                <Check size={20} />
              </button>
            </>
          ) : (
            <>
              <p className="eyebrow">THE RUSH PROJECT</p>
              <h2>An experience you can inspect.</h2>
              <p>
                Rush is a system-design showcase built around a real challenge: fair access to
                scarce inventory under pressure.
              </p>
              <p>
                The source includes React, TypeScript, Bun, Hono, Drizzle, PostgreSQL, and Redis.
                This{' '}
                {serverMode
                  ? 'local app uses the running API'
                  : 'hosted preview is a browser-local sandbox'}
                ; all events and payments are fictional.
              </p>
              <button
                className="button primary full"
                onClick={() => {
                  setInfo(null);
                  navigate('operations');
                }}
              >
                Explore the architecture <ArrowRight size={17} />
              </button>
            </>
          )}
        </Modal>
      )}
    </>
  );
}
function ArrowDownIcon() {
  return <span aria-hidden="true">↘</span>;
}
