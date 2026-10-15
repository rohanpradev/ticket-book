import { db, sql } from './db';
import { seats } from './schema';
import { makeSeats } from '../shared/model';
await db
  .insert(seats)
  .values(makeSeats().map(({ expiresAt, bookingId, ...seat }) => seat))
  .onConflictDoNothing();
console.log('100 seats ready. Existing bookings preserved.');
await sql.end();
