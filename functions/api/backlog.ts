// functions/api/backlog.ts
// Returns backlog for the cockpit at: /api/backlog

export const onRequestGet: PagesFunction<{ DB: D1Database }> = async (context) => {
  const { env } = context;

  try {
    const query = `
      SELECT
        id,                                  -- TEXT PK from your schema
        request_title           AS name,     -- for Streamlit 'name'
        requestor_team          AS source,   -- which team is requesting
        tags                    AS type,     -- use tags as Type for now
        status,                              -- New / Triage / etc.

        -- Combine key context fields into a single 'pain_points' blob
        (
          'Problem: ' || COALESCE(problem_statement, '') || '\n\n' ||
          'Expected Outcome: ' || COALESCE(expected_outcome, '') || '\n\n' ||
          'Revenue Impact: ' || COALESCE(revenue_impact, '') || '\n\n' ||
          'Customer Impact: ' || COALESCE(customer_impact, '') || '\n\n' ||
          'Required Changes: ' || COALESCE(required_changes, '') || '\n\n' ||
          'Timeline Pressure: ' || COALESCE(timeline_pressure, '') || '\n\n' ||
          'Downstream Dependencies: ' || COALESCE(downstream_dependencies, '')
        )                       AS pain_points,

        systems_touched,                    -- direct mapping
        revenue_impact          AS revenue_flow_impacted,

        -- Simple mapping: any "High" audit risk => Yes, else No
        CASE
          WHEN LOWER(audit_risk) LIKE '%high%' THEN 'Yes'
          ELSE 'No'
        END                     AS audit_critical,

        COALESCE(priority_score, 0) AS priority_score,
        jira_key                             -- expose Jira key to cockpit
      FROM intake_requests
      ORDER BY priority_score DESC, created_at DESC
    `;

    const result = await env.DB.prepare(query).all();
    const rows = result.results || [];

    return new Response(JSON.stringify({ projects: rows }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*", // allow Streamlit
      },
    });
  } catch (err: any) {
    console.error("Error in /api/backlog:", err);
    return new Response(
      JSON.stringify({ error: String(err?.message || err) }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }
};
