import streamlit as st
import pandas as pd
from datetime import datetime
from pathlib import Path

DATA_PATH = Path("intake_requests.csv")

PRIORITY_MAP = {"Low": 1, "Medium": 2, "High": 3}

def load_data() -> pd.DataFrame:
    if DATA_PATH.exists():
        df = pd.read_csv(DATA_PATH)
        # Ensure backward compatibility if missing columns
        if "id" not in df.columns:
            df.insert(0, "id", range(1, len(df) + 1))
        if "is_quick_win" not in df.columns:
            df["is_quick_win"] = df["priority_score"] >= 2.2
        return df
    cols = [
        "id",
        "submitted_at",
        "request_title",
        "requestor_name",
        "requestor_team",
        "problem_statement",
        "expected_outcome",
        "revenue_impact",
        "audit_risk",
        "customer_impact",
        "systems_touched",
        "data_objects",
        "required_changes",
        "complexity",
        "cross_functional_effort",
        "timeline_pressure",
        "control_impact",
        "downstream_dependencies",
        "priority_score",
        "is_quick_win",
    ]
    return pd.DataFrame(columns=cols)

def score_priority(
    rev_impact: str,
    audit_risk: str,
    complexity: str,
    xfunc_effort: str,
    timeline: str,
) -> float:
    r = PRIORITY_MAP.get(rev_impact, 0)
    a = PRIORITY_MAP.get(audit_risk, 0)
    c = PRIORITY_MAP.get(complexity, 0)
    x = PRIORITY_MAP.get(xfunc_effort, 0)
    t = PRIORITY_MAP.get(timeline, 0)

    score = (
        r * 0.35 +
        a * 0.30 +
        t * 0.20 +
        (4 - c) * 0.10 +  # lower complexity = higher score
        (4 - x) * 0.05    # fewer teams = higher score
    )
    return round(score, 2)

def is_quick_win(
    priority_score: float,
    complexity: str,
    xfunc_effort: str,
    timeline: str,
) -> bool:
    """
    Simple quick-win logic:
    - Priority score >= 2.2 (medium-high)
    - Complexity Low or Medium
    - Cross-functional effort Low or Medium
    - Timeline pressure not Low (i.e., it's relevant soon)
    """
    c = PRIORITY_MAP.get(complexity, 0)
    x = PRIORITY_MAP.get(xfunc_effort, 0)
    t = PRIORITY_MAP.get(timeline, 0)

    return (
        priority_score >= 2.2 and
        c <= 2 and
        x <= 2 and
        t >= 2
    )

def save_record(record: dict):
    df = load_data()
    # auto-increment id
    next_id = 1 if df.empty else int(df["id"].max()) + 1
    record["id"] = next_id

    df = pd.concat([df, pd.DataFrame([record])], ignore_index=True)
    df.to_csv(DATA_PATH, index=False)

def main():
    st.set_page_config(page_title="Revenue Project Intake", layout="wide")
    st.title("📥 Revenue Project Intake")

    st.markdown(
        "Use this form to capture **all** revenue-related requests "
        "from RevOps, Accounting, IT, Sales Ops, and FP&A."
    )

    with st.form("intake_form"):
        st.subheader("1. Request Basics")
        col1, col2 = st.columns(2)
        with col1:
            request_title = st.text_input("Request title")
        with col2:
            requestor_name = st.text_input("Requestor name")
        requestor_team = st.selectbox(
            "Requestor team",
            ["RevOps", "Accounting", "Sales Ops", "IT", "FP&A", "Other"],
        )
        problem_statement = st.text_area("Problem statement (What is broken or manual?)")
        expected_outcome = st.text_area("Expected outcome (What does 'good' look like?)")

        st.subheader("2. Business Impact")
        col3, col4, col5 = st.columns(3)
        with col3:
            revenue_impact = st.selectbox("Revenue impact", ["Low", "Medium", "High"])
        with col4:
            audit_risk = st.selectbox("Compliance / audit risk", ["Low", "Medium", "High"])
        with col5:
            customer_impact = st.selectbox(
                "Customer / partner impact",
                ["Internal only", "Some external impact", "Direct customer/partner impact"],
            )

        st.subheader("3. Systems & Data")
        systems_touched = st.multiselect(
            "Systems touched",
            ["Salesforce", "Oracle", "Tableau", "Other"],
        )
        data_objects = st.text_input(
            "Key data objects (e.g., Opportunity, Quote, Invoice, GL, Subscription)"
        )
        required_changes = st.text_area(
            "Required data / system changes (as you understand them today)"
        )

        st.subheader("4. Effort & Timing")
        col6, col7, col8 = st.columns(3)
        with col6:
            complexity = st.selectbox("Complexity", ["Low", "Medium", "High"])
        with col7:
            cross_functional_effort = st.selectbox(
                "Cross-functional effort (number of teams involved)",
                ["Low", "Medium", "High"],
            )
        with col8:
            timeline_pressure = st.selectbox(
                "Timeline pressure",
                ["Low", "Medium", "High"],
            )

        st.subheader("5. Controls & Dependencies")
        control_impact = st.text_input(
            "Impact on controls (SOX, revenue recognition, approvals)",
        )
        downstream_dependencies = st.text_area(
            "Downstream dependencies (Reporting, FP&A, audit, etc.)",
        )

        submitted = st.form_submit_button("Submit request")

        if submitted:
            priority_score = score_priority(
                revenue_impact,
                audit_risk,
                complexity,
                cross_functional_effort,
                timeline_pressure,
            )
            quick_win = is_quick_win(
                priority_score,
                complexity,
                cross_functional_effort,
                timeline_pressure,
            )

            record = {
                "submitted_at": datetime.utcnow().isoformat(),
                "request_title": request_title,
                "requestor_name": requestor_name,
                "requestor_team": requestor_team,
                "problem_statement": problem_statement,
                "expected_outcome": expected_outcome,
                "revenue_impact": revenue_impact,
                "audit_risk": audit_risk,
                "customer_impact": customer_impact,
                "systems_touched": ";".join(systems_touched),
                "data_objects": data_objects,
                "required_changes": required_changes,
                "complexity": complexity,
                "cross_functional_effort": cross_functional_effort,
                "timeline_pressure": timeline_pressure,
                "control_impact": control_impact,
                "downstream_dependencies": downstream_dependencies,
                "priority_score": priority_score,
                "is_quick_win": quick_win,
            }

            save_record(record)
            msg = f"Request submitted. Priority score: {priority_score}"
            if quick_win:
                msg += " ✅ Marked as QUICK WIN"
            st.success(msg)

    st.markdown("---")
    st.subheader("📊 Current Backlog (sorted by priority)")

    df = load_data()
    if not df.empty:
        df_sorted = df.sort_values("priority_score", ascending=False)

        st.markdown("**Top backlog view**")
        st.dataframe(
            df_sorted[
                [
                    "id",
                    "priority_score",
                    "is_quick_win",
                    "request_title",
                    "requestor_team",
                    "revenue_impact",
                    "audit_risk",
                    "timeline_pressure",
                    "systems_touched",
                    "submitted_at",
                ]
            ],
            use_container_width=True,
        )

        st.markdown("---")
        st.subheader("🔍 Request Detail View")

        # Select a specific request to see full detail
        options = [
            f"#{row.id} – {row.request_title}"
            for _, row in df_sorted.iterrows()
        ]
        selected = st.selectbox("Select a request to view details", options)

        if selected:
            selected_id = int(selected.split("–")[0].strip("# ").strip())
            row = df_sorted[df_sorted["id"] == selected_id].iloc[0]

            st.markdown(f"### Request #{row.id}: {row.request_title}")
            st.markdown(
                f"**Team:** {row.requestor_team} • "
                f"**Requester:** {row.requestor_name} • "
                f"**Priority:** {row.priority_score} • "
                f"**Quick win:** {'Yes' if row.is_quick_win else 'No'}"
            )

            colA, colB = st.columns(2)
            with colA:
                st.markdown("**Problem Statement**")
                st.write(row.problem_statement or "-")
                st.markdown("**Expected Outcome**")
                st.write(row.expected_outcome or "-")
                st.markdown("**Systems Touched**")
                st.write(row.systems_touched or "-")
                st.markdown("**Data Objects**")
                st.write(row.data_objects or "-")
            with colB:
                st.markdown("**Required Changes**")
                st.write(row.required_changes or "-")
                st.markdown("**Controls Impact**")
                st.write(row.control_impact or "-")
                st.markdown("**Downstream Dependencies**")
                st.write(row.downstream_dependencies or "-")

    else:
        st.info("No requests submitted yet.")

if __name__ == "__main__":
    main()
