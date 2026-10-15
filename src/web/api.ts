import * as sandbox from './sandbox';
import { telemetrySchema, outboxSchema } from '../shared/observability';
import {
  orderSchema,
  snapshotSchema,
  admissionSchema,
  okSchema,
  replaySchema,
} from '../shared/model';
import { createRequest } from './http';
export const serverMode = import.meta.env.VITE_API_MODE !== 'sandbox';
export const sessionId = sessionStorage.getItem('rush:session') || crypto.randomUUID();
sessionStorage.setItem('rush:session', sessionId);
export function getToken() {
  return sessionStorage.getItem('rush:operator') || '';
}
export function setToken(value: string) {
  sessionStorage.setItem('rush:operator', value);
}
export { HttpError } from './http';
const request = createRequest(getToken);
export const api = {
  telemetry: () => request('/admin/observability', telemetrySchema),
  jobs: () => request('/admin/outbox', outboxSchema),
  retryDeliveries: (id?: string) => request('/admin/outbox/retry', replaySchema, id ? { id } : {}),
  authenticate: () => request('/admin/auth', okSchema),
  snapshot: () => (serverMode ? request('/snapshot', snapshotSchema) : sandbox.snapshot()),
  join: () => (serverMode ? request('/queue', admissionSchema, {}) : sandbox.join()),
  reserve: (ids: string[], key: string) =>
    serverMode
      ? request('/reservations', orderSchema, { seatIds: ids, key })
      : sandbox.reserve(ids, key, sessionId),
  pay: (id: string) =>
    serverMode ? request(`/orders/${id}/pay`, orderSchema, {}) : sandbox.pay(id),
  control: (action: string) =>
    serverMode ? request('/admin/control', okSchema, { action }) : sandbox.control(action),
  expire: (id: string) =>
    serverMode ? request(`/admin/expire/${id}`, okSchema, {}) : sandbox.expireOrder(id),
};
