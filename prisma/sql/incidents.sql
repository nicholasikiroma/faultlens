DO $$ BEGIN
  CREATE TYPE "ProcessingState" AS ENUM ('RECEIVED', 'QUEUED', 'PROCESSED', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "TrustTier" AS ENUM ('A', 'B', 'C');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "VerificationState" AS ENUM ('RECEIVED', 'VERIFIED', 'REJECTED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "HandlerState" AS ENUM ('PENDING', 'PROCESSED', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "SourceKind" AS ENUM ('DELIVERY_ATTEMPT', 'WEBHOOK_EVENT', 'FIXTURE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "FailureClass" AS ENUM (
    'AUTH_FAILURE',
    'RATE_LIMIT',
    'NETWORK_TIMEOUT',
    'UPSTREAM_5XX',
    'SCHEMA_MISMATCH',
    'INVALID_SIGNATURE',
    'DUPLICATE_DELIVERY',
    'OUT_OF_ORDER',
    'UNKNOWN'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "IncidentStatus" AS ENUM ('OPEN', 'INVESTIGATING', 'RESOLVED', 'ARCHIVED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "RunMode" AS ENUM ('RULES', 'AI_ASSISTED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "RunState" AS ENUM (
    'NOT_STARTED', 'QUEUED', 'RUNNING', 'NEEDS_REVIEW', 'COMPLETED', 'FAILED', 'CANCELLED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "FeedbackRating" AS ENUM ('USEFUL', 'INCORRECT');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AuditAction" AS ENUM ('INCIDENT_STATUS_CHANGED', 'FINDING_RATED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AuditObjectType" AS ENUM ('INCIDENT', 'FINDING');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS integrations (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  endpoint_token text NOT NULL,
  signing_secret text NOT NULL,
  environment text NOT NULL DEFAULT 'local',
  endpoint text NOT NULL DEFAULT '/'
);

ALTER TABLE integrations
  ADD COLUMN IF NOT EXISTS environment text NOT NULL DEFAULT 'local',
  ADD COLUMN IF NOT EXISTS endpoint text NOT NULL DEFAULT '/';

CREATE UNIQUE INDEX IF NOT EXISTS integrations_endpoint_token_key
  ON integrations (endpoint_token);

CREATE TABLE IF NOT EXISTS ingest_keys (
  id text PRIMARY KEY,
  integration_id text NOT NULL REFERENCES integrations (id) ON DELETE CASCADE ON UPDATE CASCADE,
  workspace_id text NOT NULL,
  environment text NOT NULL,
  key_hash text NOT NULL,
  created_at timestamp(3) NOT NULL,
  revoked_at timestamp(3)
);

CREATE UNIQUE INDEX IF NOT EXISTS ingest_keys_key_hash_key
  ON ingest_keys (key_hash);

CREATE INDEX IF NOT EXISTS ingest_keys_workspace_id_integration_id_idx
  ON ingest_keys (workspace_id, integration_id);

CREATE TABLE IF NOT EXISTS webhook_events (
  id text PRIMARY KEY,
  integration_id text NOT NULL REFERENCES integrations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  external_event_id text,
  event_type text,
  occurred_at timestamp(3),
  first_received_at timestamp(3) NOT NULL,
  trace_id text,
  payload_digest text NOT NULL,
  redacted_payload_json jsonb,
  processing_state "ProcessingState" NOT NULL,
  workspace_id text NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS webhook_events_integration_id_external_event_id_key
  ON webhook_events (integration_id, external_event_id);

CREATE TABLE IF NOT EXISTS delivery_attempts (
  id text PRIMARY KEY,
  event_id text REFERENCES webhook_events (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  integration_id text NOT NULL REFERENCES integrations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  received_at timestamp(3) NOT NULL,
  http_status integer,
  duration_ms integer,
  sender_wait_ms integer,
  verification_state "VerificationState" NOT NULL,
  handler_state "HandlerState" NOT NULL,
  error_code text,
  correlation_id text NOT NULL,
  workspace_id text NOT NULL
);

ALTER TABLE delivery_attempts
  ADD COLUMN IF NOT EXISTS sender_wait_ms integer;

CREATE TABLE IF NOT EXISTS evidence (
  id text PRIMARY KEY,
  source_kind "SourceKind" NOT NULL,
  source_record_id text NOT NULL,
  summary text NOT NULL,
  sha256_digest text NOT NULL,
  trust_tier "TrustTier" NOT NULL,
  workspace_id text NOT NULL
);

CREATE TABLE IF NOT EXISTS outbox (
  id text PRIMARY KEY,
  event_id text REFERENCES webhook_events (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  attempt_id text NOT NULL REFERENCES delivery_attempts (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  enqueued_at timestamp(3)
);

CREATE TABLE IF NOT EXISTS incidents (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  fingerprint text NOT NULL,
  integration_id text NOT NULL,
  environment text NOT NULL,
  failure_class "FailureClass" NOT NULL,
  endpoint text NOT NULL,
  rule_version text NOT NULL,
  status "IncidentStatus" NOT NULL,
  first_seen_at timestamp(3) NOT NULL,
  last_seen_at timestamp(3) NOT NULL,
  event_count integer NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS incidents_workspace_id_fingerprint_rule_version_key
  ON incidents (workspace_id, fingerprint, rule_version);

CREATE TABLE IF NOT EXISTS incident_events (
  incident_id text NOT NULL REFERENCES incidents (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  event_id text NOT NULL REFERENCES webhook_events (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  linked_at timestamp(3) NOT NULL,
  PRIMARY KEY (incident_id, event_id)
);

CREATE TABLE IF NOT EXISTS findings (
  id text PRIMARY KEY,
  incident_id text NOT NULL REFERENCES incidents (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  event_id text NOT NULL REFERENCES webhook_events (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  rule_id text NOT NULL,
  rule_version text NOT NULL,
  failure_class "FailureClass" NOT NULL,
  explanation text NOT NULL,
  certainty text NOT NULL,
  workspace_id text NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS findings_event_id_rule_id_rule_version_key
  ON findings (event_id, rule_id, rule_version);

CREATE TABLE IF NOT EXISTS finding_evidence (
  finding_id text NOT NULL REFERENCES findings (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  evidence_id text NOT NULL REFERENCES evidence (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  PRIMARY KEY (finding_id, evidence_id)
);

CREATE TABLE IF NOT EXISTS investigation_runs (
  id text PRIMARY KEY,
  incident_id text NOT NULL REFERENCES incidents (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  event_id text NOT NULL REFERENCES webhook_events (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  mode "RunMode" NOT NULL,
  state "RunState" NOT NULL,
  ruleset_version text NOT NULL,
  started_at timestamp(3) NOT NULL,
  ended_at timestamp(3) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS investigation_runs_event_id_incident_id_mode_ruleset_versio_key
  ON investigation_runs (event_id, incident_id, mode, ruleset_version);

-- CREATE TABLE IF NOT EXISTS does not change keys that already exist.
ALTER TABLE incident_events DROP CONSTRAINT IF EXISTS incident_events_incident_id_fkey;
ALTER TABLE incident_events DROP CONSTRAINT IF EXISTS incident_events_event_id_fkey;
ALTER TABLE incident_events
  ADD CONSTRAINT incident_events_incident_id_fkey
  FOREIGN KEY (incident_id) REFERENCES incidents (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE incident_events
  ADD CONSTRAINT incident_events_event_id_fkey
  FOREIGN KEY (event_id) REFERENCES webhook_events (id) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE findings DROP CONSTRAINT IF EXISTS findings_incident_id_fkey;
ALTER TABLE findings DROP CONSTRAINT IF EXISTS findings_event_id_fkey;
ALTER TABLE findings
  ADD CONSTRAINT findings_incident_id_fkey
  FOREIGN KEY (incident_id) REFERENCES incidents (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE findings
  ADD CONSTRAINT findings_event_id_fkey
  FOREIGN KEY (event_id) REFERENCES webhook_events (id) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE finding_evidence DROP CONSTRAINT IF EXISTS finding_evidence_finding_id_fkey;
ALTER TABLE finding_evidence DROP CONSTRAINT IF EXISTS finding_evidence_evidence_id_fkey;
ALTER TABLE finding_evidence
  ADD CONSTRAINT finding_evidence_finding_id_fkey
  FOREIGN KEY (finding_id) REFERENCES findings (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE finding_evidence
  ADD CONSTRAINT finding_evidence_evidence_id_fkey
  FOREIGN KEY (evidence_id) REFERENCES evidence (id) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE investigation_runs DROP CONSTRAINT IF EXISTS investigation_runs_incident_id_fkey;
ALTER TABLE investigation_runs DROP CONSTRAINT IF EXISTS investigation_runs_event_id_fkey;
ALTER TABLE investigation_runs
  ADD CONSTRAINT investigation_runs_incident_id_fkey
  FOREIGN KEY (incident_id) REFERENCES incidents (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE investigation_runs
  ADD CONSTRAINT investigation_runs_event_id_fkey
  FOREIGN KEY (event_id) REFERENCES webhook_events (id) ON DELETE RESTRICT ON UPDATE CASCADE;

DROP INDEX IF EXISTS investigation_runs_event_incident_mode_version_key;

CREATE TABLE IF NOT EXISTS feedback (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  finding_id text NOT NULL,
  actor text NOT NULL,
  rating "FeedbackRating" NOT NULL,
  note text,
  created_at timestamp(3) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS feedback_finding_id_actor_key
  ON feedback (finding_id, actor);

CREATE INDEX IF NOT EXISTS feedback_workspace_id_finding_id_idx
  ON feedback (workspace_id, finding_id);

CREATE TABLE IF NOT EXISTS audit_events (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  actor text NOT NULL,
  action "AuditAction" NOT NULL,
  object_type "AuditObjectType" NOT NULL,
  object_id text NOT NULL,
  old_state text,
  new_state text NOT NULL,
  "timestamp" timestamp(3) NOT NULL
);

CREATE INDEX IF NOT EXISTS audit_events_workspace_id_object_type_object_id_timestamp_idx
  ON audit_events (workspace_id, object_type, object_id, "timestamp");

ALTER TABLE feedback DROP CONSTRAINT IF EXISTS feedback_finding_id_fkey;
ALTER TABLE feedback
  ADD CONSTRAINT feedback_finding_id_fkey
  FOREIGN KEY (finding_id) REFERENCES findings (id) ON DELETE RESTRICT ON UPDATE CASCADE;
