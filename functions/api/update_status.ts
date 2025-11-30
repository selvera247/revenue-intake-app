// functions/api/update_status.ts
// Updates intake status via PUT /api/update_status with JSON body { id, status }

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
    // Ensure row exists
    const existing = await env.DB.prepare(
      "SELECT id, status FROM intake_requests WHERE id = ?"
    )
      .bind(id)
      .all();

    if (!existing.results || existing.results.length === 0) {
      return new Response(
        JSON.stringify({ error: "Not found" }),
        {
          status: 404,
          headers: corsHeaders({ "Content-Type": "application/json" }),
        }
      );
    }

    const updatedAt = new Date().toISOString();

    await env.DB.prepare(
      "UPDATE intake_requests SET status = ?, updated_at = ? WHERE id = ?"
    )
      .bind(newStatus, updatedAt, id)
      .run();

    return new Response(
      JSON.stringify({ success: true, id, status: newStatus }),
      {
        status: 200,
        headers: corsHeaders({ "Content-Type": "application/json" }),
      }
    );
  } catch (err: any) {
    console.error("Error updating status:", err);
    return new Response(
      JSON.stringify({ error: String(err?.message || err) }),
      {
        status: 500,
        headers: corsHeaders({ "Content-Type": "application/json" }),
      }
    );
  }
};
