-- ============================================================================
-- Migration: Upgrade empty public.audit_logs to secure append-only architecture
-- Contains ZERO secrets or predictable defaults. Fails closed until provisioned.
-- ============================================================================

DO $$
BEGIN
  -----------------------------------------------------------------------------
  -- 1. Upgrade Columns on public.audit_logs (Table has 0 rows)
  -----------------------------------------------------------------------------

  -- (a) actor_user_id -> actor_id (references auth.users(id))
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'actor_user_id'
  ) THEN
    ALTER TABLE public.audit_logs RENAME COLUMN actor_user_id TO actor_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'actor_id'
  ) THEN
    ALTER TABLE public.audit_logs
      ADD COLUMN actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;

  -- (b) success (boolean) -> outcome (text NOT NULL)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'success'
  ) THEN
    ALTER TABLE public.audit_logs DROP COLUMN success;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'outcome'
  ) THEN
    ALTER TABLE public.audit_logs ADD COLUMN outcome text NOT NULL;
  END IF;

  -- (c) metadata (jsonb) -> details (jsonb NOT NULL DEFAULT '{}'::jsonb)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'metadata'
  ) THEN
    ALTER TABLE public.audit_logs RENAME COLUMN metadata TO details;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'details'
  ) THEN
    ALTER TABLE public.audit_logs ADD COLUMN details jsonb NOT NULL DEFAULT '{}'::jsonb;
  END IF;

  -- (d) actor_role (text NOT NULL)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'actor_role'
  ) THEN
    ALTER TABLE public.audit_logs ADD COLUMN actor_role text NOT NULL;
  END IF;

  -- (e) Ensure document_id references public.documents(id)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'document_id'
  ) THEN
    ALTER TABLE public.audit_logs
      ADD COLUMN document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL;
  END IF;

  -- (f) Ensure target_user_id references public.profiles(id)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'target_user_id'
  ) THEN
    ALTER TABLE public.audit_logs
      ADD COLUMN target_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;

  -- (g) Ensure reason exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'reason'
  ) THEN
    ALTER TABLE public.audit_logs ADD COLUMN reason text;
  END IF;

  -----------------------------------------------------------------------------
  -- 2. Replace Action, Outcome, and Role Constraints
  -----------------------------------------------------------------------------
  ALTER TABLE public.audit_logs
    DROP CONSTRAINT IF EXISTS audit_logs_action_check,
    DROP CONSTRAINT IF EXISTS audit_logs_outcome_check,
    DROP CONSTRAINT IF EXISTS audit_logs_actor_role_check;

  ALTER TABLE public.audit_logs
    ADD CONSTRAINT audit_logs_action_check CHECK (
      action IN (
        'document.upload',
        'document.download',
        'document.update',
        'document.delete',
        'permission.grant',
        'permission.update',
        'permission.revoke'
      )
    );

  ALTER TABLE public.audit_logs
    ADD CONSTRAINT audit_logs_outcome_check CHECK (
      outcome IN ('allowed', 'denied', 'error')
    );

  ALTER TABLE public.audit_logs
    ADD CONSTRAINT audit_logs_actor_role_check CHECK (
      actor_role IN ('admin', 'owner', 'viewer', 'unauthenticated')
    );

END $$;

-------------------------------------------------------------------------------
-- 3. Indexes for Query Performance & Compliance Auditing
-------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_audit_logs_document_id_created_at
  ON public.audit_logs (document_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_id_created_at
  ON public.audit_logs (actor_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at
  ON public.audit_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_target_user_id
  ON public.audit_logs (target_user_id)
  WHERE target_user_id IS NOT NULL;

-------------------------------------------------------------------------------
-- 4. Server Attestation Configuration Table
-------------------------------------------------------------------------------
-- Stores ONLY the SHA-256 hash of the server attestation token.
-- Starts completely empty: NO default secret or predictable hash is inserted.
-- Completely locked down: no access granted to client roles (anon, authenticated).
CREATE TABLE IF NOT EXISTS public.audit_security_config (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  server_token_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.audit_security_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audit_security_config FROM anon, authenticated;

-------------------------------------------------------------------------------
-- 5. Row Level Security & Privilege Lockdown (Append-Only Enforcement)
-------------------------------------------------------------------------------
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- 1. Revoke ALL direct table mutations from client roles
REVOKE ALL ON public.audit_logs FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.audit_logs FROM authenticated;
GRANT SELECT ON public.audit_logs TO authenticated;

-- 2. Drop legacy / direct INSERT policies
DROP POLICY IF EXISTS "Users can view their own audit events" ON public.audit_logs;
DROP POLICY IF EXISTS "Authenticated users can insert own audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Admins and document owners can view audit logs" ON public.audit_logs;

-- 3. Create canonical SELECT policy
CREATE POLICY "Admins and document owners can view audit logs"
  ON public.audit_logs
  FOR SELECT
  TO authenticated
  USING (
    -- Admin role can read all audit logs
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE profiles.id = (select auth.uid())
        AND profiles.role = 'admin'
    )
    OR
    -- Document owners can read audit logs for their own documents
    (
      document_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.documents
        WHERE documents.id = public.audit_logs.document_id
          AND documents.owner_id = (select auth.uid())
      )
    )
  );

-------------------------------------------------------------------------------
-- 6. Server-Attested Audit Append Function (Fail-Closed Role Resolution)
-------------------------------------------------------------------------------
-- Authenticated users can invoke this function, but it FAILS CLOSED unless:
-- 1. The caller is authenticated (auth.uid() IS NOT NULL).
-- 2. Configuration exists (public.audit_security_config has row id=1).
-- 3. The caller provides a token whose SHA-256 hash matches the stored hash.
-- 4. A valid profile exists in public.profiles with an allowlisted role.
-- 5. Action and outcome match strict allowlists.
CREATE OR REPLACE FUNCTION public.record_audit_log(
  p_action text,
  p_outcome text,
  p_document_id uuid DEFAULT NULL,
  p_target_user_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_details jsonb DEFAULT '{}'::jsonb,
  p_server_token text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_id uuid;
  v_actor_role text;
  v_expected_hash text;
  v_audit_id uuid;
BEGIN
  -- 1. Verify caller has an active authenticated session
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required: unauthenticated callers cannot record audit events.';
  END IF;

  -- 2. Verify token parameter is provided
  IF p_server_token IS NULL OR trim(p_server_token) = '' THEN
    RAISE EXCEPTION 'Unauthorized: audit logs can only be created via the trusted application server.';
  END IF;

  -- 3. Retrieve stored token hash; fail closed if unprovisioned
  SELECT server_token_hash INTO v_expected_hash
  FROM public.audit_security_config
  WHERE id = 1;

  IF v_expected_hash IS NULL OR trim(v_expected_hash) = '' THEN
    RAISE EXCEPTION 'Configuration error: audit security is not provisioned. Server writes are blocked.';
  END IF;

  -- 4. Verify token hash against stored hash
  IF encode(sha256(p_server_token::bytea), 'hex') <> v_expected_hash THEN
    RAISE EXCEPTION 'Forbidden: invalid server attestation token. Direct audit log creation is prohibited.';
  END IF;

  -- 5. Validate action against strict allowlist
  IF p_action NOT IN (
    'document.upload',
    'document.download',
    'document.update',
    'document.delete',
    'permission.grant',
    'permission.update',
    'permission.revoke'
  ) THEN
    RAISE EXCEPTION 'Invalid audit action: %', p_action;
  END IF;

  -- 6. Validate outcome against strict allowlist
  IF p_outcome NOT IN ('allowed', 'denied', 'error') THEN
    RAISE EXCEPTION 'Invalid audit outcome: %', p_outcome;
  END IF;

  -- 7. Derive actor role from public.profiles; FAIL CLOSED on missing profile or invalid role
  SELECT role INTO v_actor_role
  FROM public.profiles
  WHERE id = v_actor_id;

  IF v_actor_role IS NULL THEN
    RAISE EXCEPTION 'Access denied: user profile does not exist in public.profiles.';
  END IF;

  IF v_actor_role NOT IN ('admin', 'owner', 'viewer') THEN
    RAISE EXCEPTION 'Access denied: user has an invalid application role: %', v_actor_role;
  END IF;

  -- 8. Insert audit record as privileged definer
  INSERT INTO public.audit_logs (
    document_id,
    actor_id,
    actor_role,
    action,
    outcome,
    target_user_id,
    reason,
    details
  ) VALUES (
    p_document_id,
    v_actor_id,
    v_actor_role,
    p_action,
    p_outcome,
    p_target_user_id,
    p_reason,
    COALESCE(p_details, '{}'::jsonb)
  )
  RETURNING id INTO v_audit_id;

  RETURN v_audit_id;
END;
$$;

-- Grant execute to authenticated users (protected by internal token check)
REVOKE ALL ON FUNCTION public.record_audit_log(text, text, uuid, uuid, text, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_audit_log(text, text, uuid, uuid, text, jsonb, text) TO authenticated;
