"""Database operations for the independent Report an Issue module."""

from uuid import uuid4

from sqlalchemy import func
from sqlalchemy.orm import Session

try:
    from .db_models import IssueDB
except ImportError:
    from db_models import IssueDB


ISSUE_STATUSES = (
    "Reported",
    "Under evaluation",
    "Accepted",
    "In Progress",
    "Resolved",
    "Rejected",
)


def generate_complaint_id(db: Session) -> str:
    """Generate a public, non-sequential identifier for an issue report."""
    while True:
        complaint_id = f"ISSUE-{uuid4().hex[:10].upper()}"
        exists = (
            db.query(IssueDB.id)
            .filter(IssueDB.complaint_id == complaint_id)
            .first()
        )
        if not exists:
            return complaint_id


def create_issue(db: Session, issue_data: dict) -> IssueDB:
    issue = IssueDB(
        complaint_id=generate_complaint_id(db),
        status="Reported",
        **issue_data,
    )
    db.add(issue)
    db.commit()
    db.refresh(issue)
    return issue


def get_issues(db: Session) -> list[IssueDB]:
    return db.query(IssueDB).order_by(IssueDB.created_at.desc(), IssueDB.id.desc()).all()


def get_issue_by_complaint_id(db: Session, complaint_id: str) -> IssueDB | None:
    return (
        db.query(IssueDB)
        .filter(IssueDB.complaint_id == complaint_id)
        .first()
    )


def update_issue_status(issue: IssueDB, status: str, db: Session) -> IssueDB:
    issue.status = status
    db.commit()
    db.refresh(issue)
    return issue


def delete_issue(issue: IssueDB, db: Session) -> None:
    db.delete(issue)
    db.commit()


def get_issue_stats(db: Session) -> dict[str, int]:
    """Return status totals with one grouped SQL query."""
    status_counts = dict(
        db.query(IssueDB.status, func.count(IssueDB.id))
        .group_by(IssueDB.status)
        .all()
    )
    return {
        "total_issues": sum(status_counts.values()),
        "reported": status_counts.get("Reported", 0),
        "accepted": status_counts.get("Accepted", 0),
        "in_progress": status_counts.get("In Progress", 0),
        "resolved": status_counts.get("Resolved", 0),
        "rejected": status_counts.get("Rejected", 0),
    }
