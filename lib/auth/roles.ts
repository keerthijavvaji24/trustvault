import { createClient } from '@/lib/supabase/server'

export type UserRole = 'admin' | 'owner' | 'viewer'

export const ALLOWED_ROLES: readonly UserRole[] = ['admin', 'owner', 'viewer'] as const

export function isValidRole(role: unknown): role is UserRole {
  return typeof role === 'string' && ALLOWED_ROLES.includes(role as UserRole)
}

export interface CurrentUserProfile {
  id: string
  email: string | undefined
  fullName: string | null
  role: UserRole
}

export type AuthUserWithRoleResult =
  | {
      status: 'unauthenticated'
      user: null
      profile: null
      error: string
    }
  | {
      status: 'profile_not_found'
      user: { id: string; email?: string }
      profile: null
      error: string
    }
  | {
      status: 'invalid_role'
      user: { id: string; email?: string }
      profile: null
      error: string
    }
  | {
      status: 'success'
      user: { id: string; email?: string }
      profile: CurrentUserProfile
      error: null
    }

/**
 * Server-only authorization utility that resolves the authenticated user
 * and validates their application role from public.profiles.
 *
 * Security guarantees:
 * 1. Takes NO user input, user ID, or role from caller/client.
 * 2. Authenticates the caller strictly via Supabase Auth session cookies (`auth.getUser()`).
 * 3. Uses the verified user ID (`user.id`) to query public.profiles.
 * 4. Validates that the role is strictly one of: 'admin' | 'owner' | 'viewer'.
 * 5. Fails closed: if no session, missing profile, or invalid role, no elevated access is granted.
 * 6. Uses the authenticated server Supabase client (respects Row Level Security).
 * 7. Never uses or exposes any service-role key.
 */
export async function getCurrentUserWithProfile(): Promise<AuthUserWithRoleResult> {
  if (typeof window !== 'undefined') {
    throw new Error('getCurrentUserWithProfile can only be called from a server environment.')
  }

  const supabase = await createClient()

  // 1. Verify user identity via Supabase Auth
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return {
      status: 'unauthenticated',
      user: null,
      profile: null,
      error: authError?.message || 'No authenticated user session found.',
    }
  }

  // 2. Fetch profile from public.profiles using the authenticated user's ID
  const { data: profileData, error: dbError } = await supabase
    .from('profiles')
    .select('id, full_name, role')
    .eq('id', user.id)
    .maybeSingle()

  if (dbError) {
    return {
      status: 'profile_not_found',
      user: { id: user.id, email: user.email },
      profile: null,
      error: `Failed to query profile: ${dbError.message}`,
    }
  }

  if (!profileData) {
    return {
      status: 'profile_not_found',
      user: { id: user.id, email: user.email },
      profile: null,
      error: 'User profile does not exist in public.profiles.',
    }
  }

  // 3. Validate role against strict allowlist
  if (!isValidRole(profileData.role)) {
    return {
      status: 'invalid_role',
      user: { id: user.id, email: user.email },
      profile: null,
      error: `Invalid or unrecognized role "${profileData.role}" in database. Must be one of: ${ALLOWED_ROLES.join(', ')}.`,
    }
  }

  return {
    status: 'success',
    user: { id: user.id, email: user.email },
    profile: {
      id: user.id,
      email: user.email,
      fullName: profileData.full_name,
      role: profileData.role,
    },
    error: null,
  }
}

/**
 * Convenience helper that returns the CurrentUserProfile, or null if unauthenticated,
 * missing profile, or invalid role.
 */
export async function getCurrentUserProfile(): Promise<CurrentUserProfile | null> {
  const result = await getCurrentUserWithProfile()
  if (result.status === 'success') {
    return result.profile
  }
  return null
}
