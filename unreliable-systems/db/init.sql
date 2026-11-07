BEGIN;

CREATE TABLE events (
  event_id uuid PRIMARY KEY,
  type text NOT NULL,
  occurred_at timestamptz NOT NULL,
  data jsonb NOT NULL,
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  stored_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- The first insert is the stored event. UPDATE and DELETE would replace that fact.
-- A row trigger does not run for TRUNCATE, so the lab can still clear the tables.
CREATE FUNCTION events_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'events are immutable, event_id %', OLD.event_id;
END;
$$;

CREATE TRIGGER events_immutable
  BEFORE UPDATE OR DELETE ON events
  FOR EACH ROW
  EXECUTE FUNCTION events_immutable();

CREATE TABLE delivery_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id uuid REFERENCES events (event_id),
  sender_attempt integer,
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  outcome text NOT NULL CHECK (outcome IN ('stored', 'duplicate', 'conflict', 'invalid')),
  received_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((outcome = 'invalid') = (event_id IS NULL))
);

CREATE UNIQUE INDEX one_stored_attempt_per_event
  ON delivery_attempts (event_id)
  WHERE outcome = 'stored';

CREATE INDEX delivery_attempts_event_id_idx ON delivery_attempts (event_id);
CREATE INDEX delivery_attempts_payload_sha256_idx ON delivery_attempts (payload_sha256);

COMMIT;
