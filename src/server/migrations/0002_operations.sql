ALTER TABLE outbox ADD COLUMN IF NOT EXISTS claim_token text;
ALTER TABLE outbox ADD COLUMN IF NOT EXISTS lease_until timestamptz;
ALTER TABLE outbox ADD COLUMN IF NOT EXISTS last_error text;
ALTER TABLE outbox ADD COLUMN IF NOT EXISTS trace_id text;
CREATE INDEX IF NOT EXISTS outbox_lease ON outbox(lease_until) WHERE processed_at IS NULL AND failed=false;
CREATE INDEX IF NOT EXISTS orders_session_created ON orders(session_id,created_at DESC);
CREATE INDEX IF NOT EXISTS audits_order_at ON audits(order_id,at DESC);
CREATE INDEX IF NOT EXISTS admissions_expiry ON admissions(expires_at);
CREATE TABLE IF NOT EXISTS worker_heartbeats(id text PRIMARY KEY,last_seen timestamptz NOT NULL DEFAULT now());
CREATE OR REPLACE FUNCTION rush_notify_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('rush_changes','invalidate');
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS rush_audit_change ON audits;
CREATE TRIGGER rush_audit_change AFTER INSERT ON audits FOR EACH ROW EXECUTE FUNCTION rush_notify_change();
