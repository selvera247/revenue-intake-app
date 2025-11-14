from js import Response, Request
import os
import json
import requests
from requests.auth import HTTPBasicAuth
from datetime import datetime

# Env vars from wrangler.toml
JIRA_BASE_URL = os.environ.get("JIRA_BASE_URL")
JIRA_EMAIL = os.environ.get("JIRA_EMAIL")
JIRA_API_TOKEN = os.environ.get("JIRA_API_TOKEN")
JIRA_PROJECT_KEY = os.environ.get("JIRA_PROJECT_KEY")

async def on_fetch(request: Request, env, ctx):
    if request.method != "POST":
        return Response("Method not allowed", status=405)

    # Parse form data
    form_data = await request.form_data()
    record = {
        "submitted_at": datetime.utcnow().isoformat(),
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
    }

    # Calculate priority score
    PRIORITY_MAP = {"Low": 1, "Medium": 2, "High": 3}
    r = PRIORITY_MAP.get(record["revenue_impact"], 0)
    a = PRIORITY_MAP.get(record["audit_risk"], 0)
    c = PRIORITY_MAP.get(record["complexity"], 0)
    x = PRIORITY_MAP.get(record["cross_functional_effort"], 0)
    t = PRIORITY_MAP.get(record["timeline_pressure"], 0)
    priority_score = round(r * 0.35 + a * 0.30 + t * 0.20 + (4 - c) * 0.10 + (4 - x) * 0.05, 2)
    record["priority_score"] = priority_score

    # Handle attachments (log filenames; extend with R2 for storage if needed)
    attachments = []
    for key in form_data.keys():
        if hasattr(key, 'filename') and key.filename:  # Check for file
            attachments.append(key.filename)  # In production, upload to R2

    # Create Jira task immediately
    jira_key = None
    if all([JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY]):
        url = f"{JIRA_BASE_URL.rstrip('/')}/rest/api/3/issue"
        summary = record.get("request_title", "Revenue Request")
        description_parts = [
            f"*Requestor:* {record.get('requestor_name', '')} ({record.get('requestor_team', '')})",
            "",
            "*Problem Statement*",
            record.get("problem_statement", "") or "-",
            "",
            "*Expected Outcome*",
            record.get("expected_outcome", "") or "-",
            "",
            "*Systems Touched*",
            record.get("systems_touched", "") or "-",
            "",
            "*Tags*",
            record.get("tags", "") or "-",
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

        try:
            resp = requests.post(
                url,
                json=payload,
                auth=HTTPBasicAuth(JIRA_EMAIL, JIRA_API_TOKEN),
                headers={"Accept": "application/json", "Content-Type": "application/json"},
                timeout=15,
            )
            if resp.status_code in (200, 201):
                jira_key = resp.json().get("key")
        except Exception as e:
            print(f"Error creating Jira task: {e}")

    # Response to user
    msg = f"Request submitted. Priority score: {priority_score}"
    if attachments:
        msg += f" • {len(attachments)} attachment(s) noted"
    if jira_key:
        msg += f" • Jira Task Created: {jira_key}"
    else:
        msg += " • Error creating Jira task"
    return Response(msg, status=200)

# Default entrypoint for Worker
class Default:
    async def fetch(self, request: Request, env, ctx):
        return await on_fetch(request, env, ctx)