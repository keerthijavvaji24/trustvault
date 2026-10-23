-- ============================================================================
-- Migration: Create secure append-only public.audit_logs table
-- ============================================================================

-- 1. Create public.audit_logs table
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_role text NOT NULL,
  action text NOT NULL,
  outcome text NOT NULL,
  reason text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),

  -- Constraint: Supported actor roles
  CONSTRAINT audit_logs_actor_role_check CHECK (
    actor_role IN ('admin', 'owner', 'viewer', 'unauthenticated')
  ),

  -- Constraint: Supported audit actions
  CONSTRAINT audit_logs_action_check CHECK (
    action IN (
      'document.upload',
      'document.download',
      'document.update',
      'document.delete',
      'permission.grant',
      'permission.update',
      'permission.revoke'
    )
  ),

  -- Constraint: Supported outcomes
  CONSTRAINT audit_logs_outcome_check CHECK (
    outcome IN ('allowed', 'denied', 'error')
  )
);

-- 2. Indexes for efficient querying by document, actor, and time range
CREATE INDEX IF NOT EXISTS idx_audit_logs_document_id_created_at
  ON public.audit_logs (document_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_id_created_at
  ON public.audit_logs (actor_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at
  ON public.audit_logs (created_at DESC);

-- 3. Enable Row Level Security (RLS)
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- 4. Explicit Table Privileges: Grant only SELECT and INSERT to authenticated users.
--    Revoke UPDATE and DELETE entirely to guarantee append-only immutability at the privilege level.
REVOKE ALL ON public.audit_logs FROM anon;
REVOKE UPDATE, DELETE ON public.audit_logs FROM authenticated;
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;

-- 5. RLS INSERT Policy:
--    Authenticated users can insert audit records only when actor_id matches their verified auth.uid().
--    Clients cannot spoof actor_id or insert audit records on behalf of other actors.
DROP POLICY IF EXISTS "Authenticated users can insert own audit logs" ON public.audit_logs;
CREATE POLICY "Authenticated users can insert own audit logs"
  ON public.audit_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    actor_id = (select auth.uid())
  );

-- 6. RLS SELECT Policy:
--    - Admins can read all audit logs across the application.
--    - Document owners can read audit logs strictly for documents they own.
--    - Viewers cannot read system-wide audit logs.
--    - No RLS recursion: subqueries inspect public.profiles and public.documents,
--      neither of which reference public.audit_logs.
DROP POLICY IF EXISTS "Admins and document owners can view audit logs" ON public.audit_logs;
CREATE POLICY "Admins and document owners can view audit logs"
  ON public.audit_logs
  FOR SELECT
  TO authenticated
  USING (
    -- Admins have visibility into all audit records
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE profiles.id = (select auth.uid())
        AND profiles.role = 'admin'
    )
    OR
    -- Document owners can view audit logs for their own documents
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

-- Note on Immutability:
-- No UPDATE or DELETE policies are created for public.audit_logs.
-- Under PostgreSQL Row Level Security, operations without a matching policy default to DENY (fail closed).
-- In addition, table-level UPDATE and DELETE privileges have been revoked from authenticated and anon roles,
-- ensuring that no application user, including an admin, can alter or remove existing audit records.
