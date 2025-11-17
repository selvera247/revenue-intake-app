export interface Env {
  DB: D1Database;
  ATTACHMENTS: R2Bucket;

  JIRA_BASE_URL: string;
  JIRA_EMAIL: string;
  JIRA_API_TOKEN: string;
  JIRA_PROJECT_KEY: string;

  ENVIRONMENT: string;
  EXPORT_API_KEY: string;
}

const CORS_ORIGIN = "https://revenue-intake-app.pages.dev";

function corsHeaders(extra: Record<string, string> = {}): Headers {
  return new Headers({
    "Access-Control-Allow-Origin": CORS_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    ...extra,
  });
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    try {
      // POST /submit
      if (pathname === "/submit" && request.method === "POST") {
        return handleSubmit(request, env);
      }

      // GET /api/intake
      if (pathname === "/api/intake" && request.method === "GET") {
        return handleListIntake(request, env);
      }

      // /api/intake/:id
      if (pathname.startsWith("/api/intake/")) {
        const id = pathname.split("/").pop() || "";

        if (request.method === "GET") {
          return handleGetIntake(id, env);
        }

        if (request.method === "PUT") {
          return handleUpdateIntake(id, request, env);
        }

        if (request.method === "DELETE") {
          return handleDeleteIntake(id, env);
        }
      }

      // GET /api/export (CSV, secured by x-api-key)
      if (pathname === "/api/export" && request.method === "GET") {
        return handleExportCSV(request, env);
      }

      return new Response("Not Found", { status: 404, headers: corsHeaders() });
    } catch (err: any) {
      console.error("Error in fetch:", err);
      const body = JSON.stringify({ error: String(err?.message || err) });
      return new Response(body, {
        status: 500,
        headers: corsHeaders({ "Content-Type": "application/json" }),
      });
    }
  },
} satisfies ExportedHandler<Env>;

// ---------- /submit ----------

async function handleSubmit(request: Request, env: Env): Promise<Response> {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("multipart/form-data")) {
    return new Response("Expected multipart/form-data", {
      status: 400,
      headers: corsHeaders(),
    });
  }

  const formData = await request.formData();

  const record: any = {
    id: crypto.randomUUID(),
    request_title: formData.get("request_title")?.toString() || "",
    requestor_name: formData.get("requestor_name")?.toString() || "",
    requestor_team: formData.get("requestor_team")?.toString() || "",
    problem_statement: formData.get("problem_statement")?.toString() || "",
    expected_outcome: formData.get("expected_outcome")?.toString() || "",
    revenue_impact: formData.get("revenue_impact")?.toString() || "",
    audit_risk: formData.get("audit_risk")?.toString() || "",
    customer_impact: formData.get("customer_impact")?.toString() || "",
    systems_touched: (formData.getAll("systems_touched") as string[]).join(";"),
    data_objects: formData.get("data_objects")?.toString() || "",
    required_changes: formData.get("required_changes")?.toString() || "",
    complexity: formData.get("complexity")?.toString() || "",
    cross_functional_effort:
      formData.get("cross_functional_effort")?.toString() || "",
    timeline_pressure: formData.get("timeline_pressure")?.toString() || "",
    control_impact: formData.get("control_impact")?.toString() || "",
    downstream_dependencies:
      formData.get("downstream_dependencies")?.toString() || "",
    tags: (formData.getAll("tags") as string[]).join(";"),
    priority_score: 0.0,
    status: "New",
    created_at: new Date().toISOString(),
    updated_at: null,
    jira_key: null,
  };

  // Validate required fields
  const required = [
    "request_title",
    "requestor_name",
    "requestor_team",
    "problem_statement",
    "expected_outcome",
  ];
  for (const field of required) {
    if (!record[field]) {
      return new Response(`Missing ${field}`, {
        status: 400,
        headers: corsHeaders(),
      });
    }
  }
  if (record.request_title.length > 255) {
    return new Response("Title too long", {
      status: 400,
      headers: corsHeaders(),
    });
  }

  // Priority score (same formula as your Python)
  const PRIORITY_MAP: Record<string, number> = {
    Low: 1,
    Medium: 2,
    High: 3,
  };
  const r = PRIORITY_MAP[record.revenue_impact] ?? 0;
  const a = PRIORITY_MAP[record.audit_risk] ?? 0;
  const c = PRIORITY_MAP[record.complexity] ?? 0;
  const x = PRIORITY_MAP[record.cross_functional_effort] ?? 0;
  const t = PRIORITY_MAP[record.timeline_pressure] ?? 0;

  record.priority_score = Number(
    (
      r * 0.35 +
      a * 0.3 +
      t * 0.2 +
      (4 - c) * 0.1 +
      (4 - x) * 0.05
    ).toFixed(2)
  );

  // Insert into D1
  await env.DB.prepare(
    `
      INSERT INTO intake_requests (
        id, request_title, requestor_name, requestor_team, problem_statement, expected_outcome,
        revenue_impact, audit_risk, customer_impact, systems_touched, data_objects, required_changes,
        complexity, cross_functional_effort, timeline_pressure, control_impact, downstream_dependencies,
        tags, priority_score, status, created_at, jira_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  )
    .bind(
      record.id,
      record.request_title,
      record.requestor_name,
      record.requestor_team,
      record.problem_statement,
      record.expected_outcome,
      record.revenue_impact,
      record.audit_risk,
      record.customer_impact,
      record.systems_touched,
      record.data_objects,
      record.required_changes,
      record.complexity,
      record.cross_functional_effort,
      record.timeline_pressure,
      record.control_impact,
      record.downstream_dependencies,
      record.tags,
      record.priority_score,
      record.status,
      record.created_at,
      record.jira_key
    )
    .run();

  // Create Jira issue (if env variables present)
  let jiraKey: string | null = null;
  if (
    env.JIRA_BASE_URL &&
    env.JIRA_EMAIL &&
    env.JIRA_API_TOKEN &&
    env.JIRA_PROJECT_KEY
  ) {
    jiraKey = await createJiraIssue(env, record);
    if (jiraKey) {
      await env.DB.prepare(
        "UPDATE intake_requests SET jira_key = ? WHERE id = ?"
      )
        .bind(jiraKey, record.id)
        .run();
      record.jira_key = jiraKey;
    }
  }

  // Handle attachments to R2 + optionally Jira
  const attachments: string[] = [];
  if (env.ATTACHMENTS) {
    for (const [, value] of formData.entries()) {
      if (value instanceof File && value.name) {
        const filename = `${record.id}_${value.name}`;
        await env.ATTACHMENTS.put(filename, value.stream());
        attachments.push(filename);

        if (jiraKey) {
          await attachFileToJira(env, jiraKey, filename);
        }
      }
    }
  }

  let msg = `Request submitted. Priority score: ${record.priority_score}`;
  if (attachments.length) {
    msg += ` • ${attachments.length} attachment(s)`;
  }
  if (jiraKey) {
    msg += ` • Jira Task: ${jiraKey}`;
  }

  return new Response(msg, { status: 200, headers: corsHeaders() });
}

async function createJiraIssue(env: Env, record: any): Promise<string | null> {
  const url = env.JIRA_BASE_URL.replace(/\/$/, "") + "/rest/api/3/issue";
  const summary = record.request_title || "Revenue Request";

  const descriptionParts = [
    `*Requestor:* ${record.requestor_name} (${record.requestor_team})`,
    "",
    "*Problem Statement*",
    record.problem_statement || "-",
    "",
    "*Expected Outcome*",
    record.expected_outcome || "-",
    "",
    "*Systems Touched*",
    record.systems_touched || "-",
    "",
    "*Tags*",
    record.tags || "-",
    "",
    `*Priority Score:* ${record.priority_score}`,
  ];

  const description = descriptionParts.join("\n");

  const payload = {
    fields: {
      project: { key: env.JIRA_PROJECT_KEY },
      summary,
      description,
      issuetype: { name: "Task" },
    },
  };

  const auth = btoa(`${env.JIRA_EMAIL}:${env.JIRA_API_TOKEN}`);

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify(payload),
  });

  if (resp.status === 429) {
    console.warn("Jira rate limit hit for issue creation");
    return null;
  }

  if (!resp.ok) {
    const text = await resp.text();
    console.error("Jira error:", resp.status, text);
    return null;
  }

  const data = await resp.json();
  return data.key ?? null;
}

async function attachFileToJira(
  env: Env,
  jiraKey: string,
  filename: string
): Promise<void> {
  try {
    const object = await env.ATTACHMENTS.get(filename);
    if (!object) {
      console.warn("R2 object not found for attachment:", filename);
      return;
    }

    const arrayBuffer = await object.arrayBuffer();
    const blob = new Blob([arrayBuffer], {
      type: "application/octet-stream",
    });

    const formData = new FormData();
    formData.append("file", blob, filename);

    const url =
      env.JIRA_BASE_URL.replace(/\/$/, "") +
      `/rest/api/3/issue/${encodeURIComponent(jiraKey)}/attachments`;
    const auth = btoa(`${env.JIRA_EMAIL}:${env.JIRA_API_TOKEN}`);

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "X-Atlassian-Token": "no-check",
      },
      body: formData,
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error(
        `Failed to attach ${filename} to Jira: ${resp.status} - ${text}`
      );
    }
  } catch (err) {
    console.error("Error attaching file to Jira:", err);
  }
}

// ---------- /api/intake (list) ----------

async function handleListIntake(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const team = url.searchParams.get("team");
  const status = url.searchParams.get("status");
  const search = url.searchParams.get("search");

  let query = "SELECT * FROM intake_requests WHERE 1=1";
  const params: any[] = [];

  if (team) {
    query += " AND requestor_team = ?";
    params.push(team);
  }

  if (status) {
    query += " AND status = ?";
    params.push(status);
  }

  if (search) {
    query += " AND (request_title LIKE ? OR requestor_name LIKE ?)";
    params.push(`%${search}%`, `%${search}%`);
  }

  query += " ORDER BY priority_score DESC, created_at DESC LIMIT 100";

  const result = await env.DB.prepare(query).bind(...params).all();
  const rows = result.results || [];

  return new Response(JSON.stringify(rows), {
    status: 200,
    headers: corsHeaders({ "Content-Type": "application/json" }),
  });
}

// ---------- /api/intake/:id (GET) ----------

async function handleGetIntake(id: string, env: Env): Promise<Response> {
  const result = await env.DB.prepare(
    "SELECT * FROM intake_requests WHERE id = ?"
  )
    .bind(id)
    .all();
  const rows = result.results || [];
  if (!rows.length) {
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: corsHeaders({ "Content-Type": "application/json" }),
    });
  }

  return new Response(JSON.stringify(rows[0]), {
    status: 200,
    headers: corsHeaders({ "Content-Type": "application/json" }),
  });
}

// ---------- /api/intake/:id (PUT) ----------

async function handleUpdateIntake(
  id: string,
  request: Request,
  env: Env
): Promise<Response> {
  const data = await request.json();

  const validStatuses = [
    "New",
    "In Progress",
    "Complete",
    "Blocked",
    "Cancelled",
  ];

  if (!data.status || !validStatuses.includes(data.status)) {
    return new Response(JSON.stringify({ error: "Invalid status" }), {
      status: 400,
      headers: corsHeaders({ "Content-Type": "application/json" }),
    });
  }

  const updatedAt = new Date().toISOString();

  await env.DB.prepare(
    "UPDATE intake_requests SET status = ?, updated_at = ? WHERE id = ?"
  )
    .bind(data.status, updatedAt, id)
    .run();

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: corsHeaders({ "Content-Type": "application/json" }),
  });
}

// ---------- /api/intake/:id (DELETE) ----------

async function handleDeleteIntake(id: string, env: Env): Promise<Response> {
  await env.DB.prepare("DELETE FROM intake_requests WHERE id = ?")
    .bind(id)
    .run();

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: corsHeaders({ "Content-Type": "application/json" }),
  });
}

// ---------- /api/export (CSV, secured) ----------

async function handleExportCSV(
  request: Request,
  env: Env
): Promise<Response> {
  // Require x-api-key header
  const providedKey = request.headers.get("x-api-key");
  if (!providedKey || providedKey !== env.EXPORT_API_KEY) {
    return new Response("Unauthorized", {
      status: 401,
      headers: corsHeaders(),
    });
  }

  const result = await env.DB.prepare(
    "SELECT * FROM intake_requests ORDER BY created_at DESC"
  ).all();
  const rows = result.results || [];

  if (!rows.length) {
    return new Response("No data to export", {
      status: 404,
      headers: corsHeaders(),
    });
  }

  const headersList = Object.keys(rows[0]);
  const escapeCell = (value: any): string => {
    const s = value === null || value === undefined ? "" : String(value);
    const escaped = s.replace(/"/g, '""');
    return `"${escaped}"`;
  };

  const headerLine = headersList.join(",");
  const lines = rows.map((row) =>
    headersList.map((h) => escapeCell((row as any)[h])).join(",")
  );

  const csv = [headerLine, ...lines].join("\n");

  return new Response(csv, {
    status: 200,
    headers: corsHeaders({
      "Content-Type": "text/csv",
      "Content-Disposition": 'attachment; filename="requests.csv"',
    }),
  });
}
