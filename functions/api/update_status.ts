// functions/api/update_status.ts
// Updates intake status + triage fields via PUT /api/update_status
// Body: { id, status, triage_owner?, triage_notes? }

function corsHeaders(extra: Record<string, string> = {}): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    ...extra,
  };
}

const ALLOWED_STATUSES = [
  "New",
  "Triage Review",
  "Prioritized",
  "Sent to Epic",
  "In Progress",
  "Complete",
  "Blocked",
  "Cancelled",
];

export const onRequest: PagesFunction<{ DB: D1Database }> = async (context) => {
  const { request, env } = context;
  const method = request.method.toUpperCase();

  // CORS preflight
  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(),
    });
  }

  if (method !== "PUT") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      {
        status: 405,
        headers: corsHeaders({ "Content-Type": "application/json" }),
      }
    );
  }

  let payload: any;
  try {
    payload = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON body" }),
      {
        status: 400,
        headers: corsHeaders({ "Content-Type": "application/json" }),
      }
    );
  }

  const id = String(payload.id || "").trim();
  const newStatus = String(payload.status || "").trim();
  const triageOwnerInput =
    payload.triage_owner !== undefined ? String(payload.triage_owner) : undefined;
  const triageNotesInput =
    payload.triage_notes !== undefined ? String(payload.triage_notes) : undefined;

  if (!id) {
    return new Response(
      JSON.stringify({ error: "Missing id" }),
      {
        status: 400,
        headers: corsHeaders({ "Content-Type": "application/json" }),
      }
    );
  }

  if (!ALLOWED_STATUSES.includes(newStatus)) {
    return new Response(
      JSON.stringify({
        error: "Invalid status",
        allowed: ALLOWED_STATUSES,
      }),
      {
        status: 400,
        headers: corsHeaders({ "Content-Type": "application/json" }),
      }
    );
  }

  try {
    // Load existing triage fields so we can preserve if not provided
    const existingResult = await env.DB.prepare(
      "SELECT id, status, triage_owner, triage_notes FROM intake_requests WHERE id = ?"
    )
      .bind(id)
      .all();

    const existingRows = existingResult.results || [];
    if (existingRows.length === 0) {
      return new Response(
        JSON.stringify({ error: "Not found" }),
        {
          status: 404,
          headers: corsHeaders({ "Content-Type": "application/json" }),
        }
      );
    }

    const existing = existingRows[0] as any;

    const triageOwner =
      triageOwnerInput !== undefined ? triageOwnerInput : (existing.triage_owner ?? "");
    const triageNotes =
      triageNotesInput !== undefined ? triageNotesInput : (existing.triage_notes ?? "");

    const updatedAt = new Date().toISOString();

    await env.DB.prepare(
      "UPDATE intake_requests SET status = ?, triage_owner = ?, triage_notes = ?, updated_at = ? WHERE id = ?"
    )
      .bind(newStatus, triageOwner, triageNotes, updatedAt, id)
      .run();

    return new Response(
      JSON.stringify({
        success: true,
        id,
        status: newStatus,
        triage_owner: triageOwner,
        triage_notes: triageNotes,
      }),
      {
        status: 200,
        headers: corsHeaders({ "Content-Type": "application/json" }),
      }
    );
  } catch (err: any) {
    console.error("Error updating status/triage:", err);
    return new Response(
      JSON.stringify({ error: String(err?.message || err) }),
      {
        status: 500,
        headers: corsHeaders({ "Content-Type": "application/json" }),
      }
    );
  }
};
