import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserWithProfile } from "@/lib/auth/roles";

export async function GET() {
  const auth = await getCurrentUserWithProfile();

  if (auth.status === "unauthenticated") {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 }
    );
  }

  if (auth.status !== "success" || auth.profile.role !== "admin") {
    return NextResponse.json(
      { error: "Admin access required." },
      { status: 403 }
    );
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("audit_logs")
    .select(
      `
      id,
      actor_id,
      actor_role,
      action,
      outcome,
      document_id,
      target_user_id,
      reason,
      details,
      created_at
    `
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("Failed to load audit logs:", error);

    return NextResponse.json(
      { error: "Could not load audit activity." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    logs: data ?? [],
  });
}