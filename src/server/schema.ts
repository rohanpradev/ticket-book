import type { SeatStatus, OrderStatus } from '../shared/model';
import {
  pgTable,
  text,
  integer,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
  boolean,
} from 'drizzle-orm/pg-core';
export const seats = pgTable('seats', {
  id: text().primaryKey(),
  row: text().notNull(),
  number: integer().notNull(),
  zone: text().notNull(),
  price: integer().notNull(),
  status: text().$type<SeatStatus>().notNull().default('available'),
  bookingId: text('booking_id'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
});
export const orders = pgTable(
  'orders',
  {
    id: text().primaryKey(),
    sessionId: text('session_id').notNull(),
    key: text('idempotency_key').notNull(),
    seatIds: jsonb('seat_ids').$type<string[]>().notNull(),
    amount: integer().notNull(),
    status: text().$type<OrderStatus>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex('orders_session_key').on(t.sessionId, t.key),
    index('orders_expiry').on(t.status, t.expiresAt),
  ],
);
export const outbox = pgTable('outbox', {
  id: text().primaryKey(),
  orderId: text('order_id').notNull(),
  kind: text().notNull(),
  attempts: integer().notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
  failed: boolean().notNull().default(false),
  claimToken: text('claim_token'),
  leaseUntil: timestamp('lease_until', { withTimezone: true }),
  lastError: text('last_error'),
  traceId: text('trace_id'),
});
export const audits = pgTable('audits', {
  id: text().primaryKey(),
  at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  type: text().notNull(),
  message: text().notNull(),
  orderId: text('order_id'),
});
export const admissions = pgTable('admissions', {
  sessionId: text('session_id').primaryKey(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});
export const paymentEvents = pgTable('payment_events', {
  id: text().primaryKey(),
  orderId: text('order_id').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
});
