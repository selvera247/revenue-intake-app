from js import Response, Request
import os
import json
import requests
from requests.auth import HTTPBasicAuth
from datetime import datetime
import uuid

# Environment variables
JIRA_BASE_URL = os.environ.get("JIRA_BASE_URL")
JIRA_EMAIL = os.environ.get("JIRA_EMAIL")
JIRA_API_TOKEN = os.environ.get("JIRA_API_TOKEN")
JIRA_PROJECT_KEY = os.environ.get("JIRA_PROJECT_KEY")

async def on_fetch(request: Request, env, ctx):
    url = request.url
    path = url.pathname
    method = request.method

    # CORS headers
    cors_headers = {
        "Access-Control-Allow-Origin": "https://revenue-intake-form.your-subdomain.pages.dev",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    }

    if method == "OPTIONS":
        return Response(None, headers=cors_headers)

    try:
        # POST /submit - Form submission
        if path == "/submit" and method == "POST":
            form_data = await request.form_data()
            record = {
                "id": str(uuid.uuid4()),
                "request_title": form_data.get("request_title"),
                "requestor_name": form_data.get("requestor_name"),
                "requestor_team": form_data.get("requestor_team"),
                "problem_statement": form_data.get("problem_statement"),
                "expected_outcome": form_data.get("expected_outcome"),
                "revenue_impact": form_data.get("revenue_impact"),
                "audit_risk": form_data.get("audit_risk"),
                "customer_impact": form_data.get("customer_impact"),
                "systems_touched": ";".join(form_data.getall("systems_touched")),
                "data_objects": form_data.get("data_objects"),
                "required_changes": form_data.get("required_changes"),
                "complexity": form_data.get("complexity"),
                "cross_functional_effort": form_data.get("cross_functional_effort"),
                "timeline_pressure": form_data.get("timeline_pressure"),
                "control_impact": form_data.get("control_impact"),
                "downstream_dependencies": form_data.get("downstream_dependencies"),
                "tags": ";".join(form_data.getall("tags")),
                "priority_score": 0.0,
                "status": "New",
                "created_at": datetime.utcnow().isoformat(),
                "updated_at": None,
                "jira_key": None,
            }

            # Validate required fields
            required = ["request_title", "requestor_name", "requestor_team", "problem_statement", "expected_outcome"]
            for field in required:
                if not record[field]:
                    return Response(f"Missing {field}", status=400, headers=cors_headers)
            if len(record["request_title"]) > 255:
                return Response("Title too long", status=400, headers=cors_headers)

            # Calculate priority score
            PRIORITY_MAP = {"Low": 1, "Medium": 2, "High": 3}
            r = PRIORITY_MAP.get(record["revenue_impact"], 0)
            a = PRIORITY_MAP.get(record["audit_risk"], 0)
            c = PRIORITY_MAP.get(record["complexity"], 0)
            x = PRIORITY_MAP.get(record["cross_functional_effort"], 0)
            t = PRIORITY_MAP.get(record["timeline_pressure"], 0)
            record["priority_score"] = round(r * 0.35 + a * 0.30 + t * 0.20 + (4 - c) * 0.10 + (4 - x) * 0.05, 2)

            # Store in D1
            await env.DB.prepare("""
                INSERT INTO intake_requests (
                    id, request_title, requestor_name, requestor_team, problem_statement, expected_outcome,
                    revenue_impact, audit_risk, customer_impact, systems_touched, data_objects, required_changes,
                    complexity, cross_functional_effort, timeline_pressure, control_impact, downstream_dependencies,
                    tags, priority_score, status, created_at, jira_key
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """).bind(
                record["id"], record["request_title"], record["requestor_name"], record["requestor_team"],
                record["problem_statement"], record["expected_outcome"], record["revenue_impact"],
                record["audit_risk"], record["customer_impact"], record["systems_touched"], record["data_objects"],
                record["required_changes"], record["complexity"], record["cross_functional_effort"],
                record["timeline_pressure"], record["control_impact"], record["downstream_dependencies"],
                record["tags"], record["priority_score"], record["status"], record["created_at"], record["jira_key"]
            ).run()

            # Create Jira task
            jira_key = None
            if all([JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY]):
                url = f"{JIRA_BASE_URL.rstrip('/')}/rest/api/3/issue"
                summary = record.get("request_title", "Revenue Request")
                description_parts = [
                    f"*Requestor:* {record.get('requestor_name', '')} ({record.get('requestor_team', '')})",
                    "", "*Problem Statement*", record.get("problem_statement", "") or "-",
                    "", "*Expected Outcome*", record.get("expected_outcome", "") or "-",
                    "", "*Systems Touched*", record.get("systems_touched", "") or "-",
                    "", "*Tags*", record.get("tags", "") or "-",
                    "", f"*Priority Score:* {record['priority_score']}"
                ]
                description = "\n".join(description_parts)
                payload = {
                    "fields": {
                        "project": {"key": JIRA_PROJECT_KEY},
                        "summary": summary,
                        "description": description,
                        "issuetype": {"name": "Task"},
                    }
                }
                resp = requests.post(
                    url, json=payload, auth=HTTPBasicAuth(JIRA_EMAIL, JIRA_API_TOKEN),
                    headers={"Accept": "application/json", "Content-Type": "application/json"},
                    timeout=15
                )
                if resp.status_code in (200, 201):
                    jira_key = resp.json().get("key")
                    # Update D1 with Jira key
                    await env.DB.prepare(
                        "UPDATE intake_requests SET jira_key = ? WHERE id = ?"
                    ).bind(jira_key, record["id"]).run()
                elif resp.status_code == 429:
                    return Response("Jira rate limit exceeded", status=429, headers=cors_headers)

            # Handle attachments (R2, optional)
            attachments = []
            if hasattr(env, "ATTACHMENTS"):
                for key in form_data.keys():
                    if hasattr(key, "filename") and key.filename:
                        filename = f"{record['id']}_{key.filename}"
                        await env.ATTACHMENTS.put(filename, key)
                        attachments.append(filename)
                        if jira_key:
                            jira_url = f"{JIRA_BASE_URL.rstrip('/')}/rest/api/3/issue/{jira_key}/attachments"
                            file_content = await env.ATTACHMENTS.get(filename)
                            files = {"file": (filename, file_content, "application/octet-stream")}
                            resp = requests.post(
                                jira_url, auth=HTTPBasicAuth(JIRA_EMAIL, JIRA_API_TOKEN),
                                headers={"X-Atlassian-Token": "no-check"}, files=files, timeout=15
                            )
                            if resp.status_code not in (200, 204):
                                print(f"Failed to attach {filename}")

            # Response
            msg = f"Request submitted. Priority score: {record['priority_score']}"
            if attachments:
                msg += f" • {len(attachments)} attachment(s)"
            if jira_key:
                msg += f" • Jira Task: {jira_key}"
            return Response(msg, status=200, headers=cors_headers)

        # GET /api/intake - List submissions
        if path == "/api/intake" and method == "GET":
            team = url.search_params.get("team")
            status = url.search_params.get("status")
            search = url.search_params.get("search")
            query = "SELECT * FROM intake_requests WHERE 1=1"
            params = []
            if team:
                query += " AND requestor_team = ?"
                params.append(team)
            if status:
                query += " AND status = ?"
                params.append(status)
            if search:
                query += " AND (request_title LIKE ? OR requestor_name LIKE ?)"
                params.append(f"%{search}%", f"%{search}%")
            query += " ORDER BY priority_score DESC, created_at DESC LIMIT 100"
            results = await env.DB.prepare(query).bind(*params).all()
            return Response(json.dumps(results["results"]), headers={**cors_headers, "Content-Type": "application/json"})

        # GET /api/intake/:id - Get submission
        if path.startswith("/api/intake/") and method == "GET":
            id = path.split("/")[-1]
            results = await env.DB.prepare("SELECT * FROM intake_requests WHERE id = ?").bind(id).all()
            if not results["results"]:
                return Response(json.dumps({"error": "Not found"}), status=404, headers=cors_headers)
            return Response(json.dumps(results["results"][0]), headers={**cors_headers, "Content-Type": "application/json"})

        # PUT /api/intake/:id - Update status
        if path.startswith("/api/intake/") and method == "PUT":
            id = path.split("/")[-1]
            data = await request.json()
            if "status" not in data or data["status"] not in ["New", "In Progress", "Complete", "Blocked", "Cancelled"]:
                return Response(json.dumps({"error": "Invalid status"}), status=400, headers=cors_headers)
            await env.DB.prepare(
                "UPDATE intake_requests SET status = ?, updated_at = ? WHERE id = ?"
            ).bind(data["status"], datetime.utcnow().isoformat(), id).run()
            return Response(json.dumps({"success": True}), headers={**cors_headers, "Content-Type": "application/json"})

        # DELETE /api/intake/:id - Delete submission
        if path.startswith("/api/intake/") and method == "DELETE":
            id = path.split("/")[-1]
            await env.DB.prepare("DELETE FROM intake_requests WHERE id = ?").bind(id).run()
            return Response(json.dumps({"success": True}), headers={**cors_headers, "Content-Type": "application/json"})

        # GET /api/export - CSV export
        if path == "/api/export" and method == "GET":
            results = await env.DB.prepare("SELECT * FROM intake_requests ORDER BY created_at DESC").all()
            if not results["results"]:
                return Response("No data", status=404, headers=cors_headers)
            headers = results["results"][0].keys()
            csv = ",".join(headers) + "\n" + "\n".join(
                ",".join(f'"{str(v).replace('"', '""')}"' for v in row.values()) for row in results["results"]
            )
            return Response(csv, headers={**cors_headers, "Content-Type": "text/csv", "Content-Disposition": "attachment; filename=requests.csv"})

        return Response("Not Found", status=404, headers=cors_headers)

    except Exception as e:
        return Response(json.dumps({"error": str(e)}), status=500, headers={**cors_headers, "Content-Type": "application/json"})

class Default:
    async def fetch(self, request: Request, env, ctx):
        return await on_fetch(request, env, ctx)
