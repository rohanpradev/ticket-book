import { timingSafeEqual } from 'node:crypto';
const configuredSessionSecret = process.env.SESSION_SECRET;
if (!configuredSessionSecret || configuredSessionSecret.length < 32)
  throw new Error('SESSION_SECRET must contain at least 32 characters.');
const configuredAdminToken = process.env.ADMIN_TOKEN;
if (!configuredAdminToken || configuredAdminToken.length < 32)
  throw new Error('ADMIN_TOKEN must contain at least 32 characters.');
export const sessionSecret: string = configuredSessionSecret;
const adminToken: string = configuredAdminToken;
export function equal(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function admin(token: string) {
  return equal(token, adminToken);
}
