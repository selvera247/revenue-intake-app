// functions/api/backlog.ts
// Returns backlog for the cockpit at: /api/backlog

export const onRequestGet: PagesFunction<{ DB: D1Database }> = async (context) => {
  const { env } = context;

  try {
    const query = `
      SELECT
        id,                                  -- TEXT PK
        request_title           AS name,     -- for Streamlit 'name'
        requestor_team          AS source,   -- which team is requesting
        tags                    AS type,     -- treat tags as "type" for now
        status,

        -- Raw fields for readiness scoring
        problem_statement,
        expected_outcome,
        required_changes,
        systems_touched,
        data_objects,
        downstream_dependencies,
        revenue_impact,
        audit_risk,
        control_impact,

        -- Combined text view for display
        (
          'Problem: ' || COALESCE(problem_statement, '') || '\n\n' ||
          'Expected Outcome: ' || COALESCE(expected_outcome, '') || '\n\n' ||
          'Required Changes: ' || COALESCE(required_changes, '') || '\n\n' ||
          'Revenue Impact: ' || COALESCE(revenue_impact, '') || '\n\n' ||
          'Audit Risk: ' || COALESCE(audit_risk, '') || '\n\n' ||
          'Timeline Pressure: ' || COALESCE(timeline_pressure, '') || '\n\n' ||
          'Downstream Dependencies: ' || COALESCE(downstream_dependencies, '')
        )                       AS pain_points,

        -- For impact / risk logic in the cockpit
        revenue_impact          AS revenue_flow_impacted,

        -- Simple mapping: any "High" audit risk => Yes, else No
        CASE
          WHEN LOWER(audit_risk) LIKE '%high%' THEN 'Yes'
          ELSE 'No'
        END                     AS audit_critical,

        COALESCE(priority_score, 0) AS priority_score,
        jira_key,
        triage_owner,
        triage_notes
      FROM intake_requests
      ORDER BY priority_score DESC, created_at DESC
    `;

    const result = await env.DB.prepare(query).all();
    const rows = result.results || [];

    return new Response(JSON.stringify({ projects: rows }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
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
