-- Main table for form submissions
CREATE TABLE IF NOT EXISTS intake_requests (
  id TEXT PRIMARY KEY, -- UUID
  request_title TEXT NOT NULL,
  requestor_name TEXT NOT NULL,
  requestor_team TEXT NOT NULL,
  problem_statement TEXT NOT NULL,
  expected_outcome TEXT NOT NULL,
  revenue_impact TEXT,
  audit_risk TEXT,
  customer_impact TEXT,
  systems_touched TEXT, -- Semicolon-separated
  data_objects TEXT,
  required_changes TEXT,
  complexity TEXT,
  cross_functional_effort TEXT,
  timeline_pressure TEXT,
  control_impact TEXT,
  downstream_dependencies TEXT,
  tags TEXT, -- Semicolon-separated
  priority_score REAL,
  status TEXT DEFAULT 'New',
  created_at TEXT NOT NULL,
  updated_at TEXT,
  jira_key TEXT, -- Store Jira task key
  CHECK(status IN ('New', 'In Progress', 'Complete', 'Blocked', 'Cancelled'))
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_requestor_team ON intake_requests(requestor_team);
CREATE INDEX IF NOT EXISTS idx_status ON intake_requests(status);
CREATE INDEX IF NOT EXISTS idx_priority_score ON intake_requests(priority_score DESC);
CREATE INDEX IF NOT EXISTS idx_created_at ON intake_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_search ON intake_requests(request_title, requestor_name);
CREATE INDEX IF NOT EXISTS idx_jira_key ON intake_requests(jira_key);

-- View for high-priority requests
CREATE VIEW IF NOT EXISTS high_priority_requests AS
SELECT * FROM intake_requests 
WHERE priority_score >= 2.0
ORDER BY priority_score DESC, created_at DESC;
