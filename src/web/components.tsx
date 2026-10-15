import { useEffect, useRef, type ReactNode } from 'react';
import { ArrowUpRight, AudioLines, CheckCheck, Clock3, ShieldCheck, X, Zap } from 'lucide-react';
import { money, type Order } from '../shared/model';
export function Brand() {
  return (
    <span className="brand">
      rush
      <span className="brand-mark">
        <Zap size={19} fill="currentColor" />
      </span>
    </span>
  );
}
export function Modal({
  children,
  onClose,
  label,
}: {
  children: ReactNode;
  onClose: () => void;
  label: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      d?.close();
      document.body.style.overflow = previous;
    };
  }, []);
  return (
    <dialog
      className="modal"
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      closedby="any"
      onClose={(event) => {
        // Strict Mode can reopen the dialog before a cleanup close event is delivered.
        if (!event.currentTarget.open) onClose();
      }}
      aria-label={label}
    >
      <button className="icon-button modal-close" aria-label="Close dialog" onClick={onClose}>
        <X size={21} />
      </button>
      {children}
    </dialog>
  );
}
export function Poster({ small = false }: { small?: boolean }) {
  return (
    <div
      className={`poster ${small ? 'small' : ''}`}
      aria-label="Afterhours. Monolink live. An electronic music night at The Conservatory."
    >
      <div className="poster-grain" />
      <div className="poster-top">
        <span>RUSH PRESENTS</span>
        <AudioLines size={25} />
        <span>VOL. 001</span>
      </div>
      <div className="poster-orbit orbit-one" />
      <div className="poster-orbit orbit-two" />
      <div className="poster-orbit orbit-three" />
      <div className="poster-sun" />
      <div className="poster-horizon" />
      <div className="poster-title">
        AFTER
        <br />
        <span>HOURS</span>
        <i>Lose yourself. Find your people.</i>
      </div>
      <div className="poster-bottom">
        <div>
          MONOLINK <span>LIVE</span>
          <small>WITH BLOT! & ANYASA</small>
        </div>
        <span className="poster-date">
          14 / 11
          <br />
          BENGALURU
        </span>
      </div>
    </div>
  );
}
export function Ticket({ order, onClose }: { order: Order; onClose: () => void }) {
  const confirmed = order.status === 'confirmed';
  return (
    <Modal label="Your booking" onClose={onClose}>
      <div className="ticket-head">
        <div className={`success-circle ${confirmed ? '' : 'pending'}`}>
          {confirmed ? <CheckCheck /> : <Clock3 />}
        </div>
        <p className="eyebrow">{confirmed ? 'YOU’RE ON THE LIST' : 'BOOKING UPDATE'}</p>
        <h2>
          {confirmed
            ? 'See you after hours.'
            : order.status === 'held'
              ? 'Your seats are held.'
              : order.status === 'expired'
                ? 'Your hold has expired.'
                : 'Your refund is in motion.'}
        </h2>
        <p>
          {confirmed
            ? 'The night is yours. Here’s your sandbox ticket.'
            : order.status === 'held'
              ? 'Complete sandbox checkout before your reservation expires.'
              : order.status === 'expired'
                ? 'These seats have returned to the floor. You can choose again.'
                : 'Your seat was released before payment arrived. The refund is tracked in your order.'}
        </p>
      </div>
      <div className="ticket-stub">
        <div className="ticket-event">
          <AudioLines />
          <span>
            AFTERHOURS<small>Monolink · Live</small>
          </span>
        </div>
        <div className="ticket-fields">
          <div>
            <small>WHEN</small>
            <strong>14 Nov · 7:00 PM</strong>
          </div>
          <div>
            <small>WHERE</small>
            <strong>The Conservatory</strong>
          </div>
          <div>
            <small>SEATS</small>
            <strong>{order.seatIds.join(', ')}</strong>
          </div>
          <div>
            <small>TOTAL</small>
            <strong>{money(order.amount)}</strong>
          </div>
        </div>
        <div className="barcode" aria-hidden="true" />
        <div className="ticket-code">{order.id.slice(0, 18).toUpperCase()}</div>
      </div>
      <p className="fine center">
        <ShieldCheck size={14} /> Sandbox ticket · No real payment or event admission
      </p>
      <button className="button primary full" onClick={onClose}>
        Back to Rush <ArrowUpRight size={17} />
      </button>
    </Modal>
  );
}
export function StatusPill({ status }: { status: string }) {
  return (
    <span className={`status-pill ${status}`}>
      <span />
      {status.replaceAll('_', ' ')}
    </span>
  );
}
export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <AudioLines />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}
export function DateBlock({ day, month }: { day: string; month: string }) {
  return (
    <div className="date-block">
      <strong>{day}</strong>
      <span>{month}</span>
    </div>
  );
}
export function LiveBadge({ children = 'LIVE DROP' }: { children?: ReactNode }) {
  return (
    <span className="live-badge">
      <span />
      {children}
    </span>
  );
}
export function SeatLegend() {
  return (
    <div className="seat-legend">
      <span>
        <i />
        Available
      </span>
      <span>
        <i className="selected" />
        Selected
      </span>
      <span>
        <i className="held" />
        On hold
      </span>
      <span>
        <i className="sold" />
        Sold
      </span>
    </div>
  );
}
