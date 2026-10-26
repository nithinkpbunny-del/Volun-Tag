from datetime import datetime

from sqlalchemy import (
    JSON, Column, DateTime, Float, ForeignKey, Index, Integer, LargeBinary,
    String, Text, UniqueConstraint,
)

try:
    from .database import Base
except ImportError:
    from database import Base


class VolunteerDB(Base):
    __tablename__ = "volunteers"

    id = Column(Integer, primary_key=True, autoincrement=True)

    # Registration details
    name = Column(String, unique=True, nullable=False)
    email = Column(String, unique=True, nullable=False)
    contact_number = Column(String, nullable=False)
    password = Column(String, nullable=True)
    age = Column(Integer, nullable=False)
    designation = Column(String, nullable=False)
    gender = Column(String, nullable=False)

    # Matching-related details
    # These are kept so the existing volunteer-NGO matching system
    # continues to work.
    skills = Column(String, nullable=True)
    location = Column(String, nullable=True)
    availability = Column(String, nullable=True)
    experience = Column(String, nullable=True)


class NGODB(Base):
    __tablename__ = "ngos"

    id = Column(Integer, primary_key=True, autoincrement=True)

    # ── Existing NGO / matching fields ─────────────────────────────
    # These fields must remain because the existing matching system
    # depends on them.
    name = Column(String, unique=True, nullable=False)
    category = Column(String, nullable=True)
    location = Column(String, nullable=True)

    # ── NGO account / registration details ─────────────────────────
    email = Column(String, unique=True, nullable=True)
    contact_number = Column(String, nullable=True)
    password = Column(String, nullable=True)
    year_founded = Column(Integer, nullable=True)
    website_url = Column(String, nullable=True)
    motto = Column(String, nullable=True)
    legal_structure = Column(String, nullable=True)

    # ── Verification documents ─────────────────────────────────────
    # These store server-side file paths/names.
    registration_certificate = Column(String, nullable=True)
    pan_card = Column(String, nullable=True)
    cert_12a = Column(String, nullable=True)
    cert_80g = Column(String, nullable=True)
    cert_fcra = Column(String, nullable=True)
    trust_deed = Column(String, nullable=True)
    society_registration_certificate = Column(String, nullable=True)
    society_moa = Column(String, nullable=True)
    section8_incorporation_certificate = Column(String, nullable=True)
    section8_moa_aoa = Column(String, nullable=True)

    # Optional photos showing NGO work.
    work_images = Column(JSON, nullable=True)

    # ── Verification workflow ──────────────────────────────────────
    # New registrations will be explicitly set to "Pending".
    verification_status = Column(
        String(20),
        nullable=False,
        default="Pending",
    )

    verification_notes = Column(Text, nullable=True)

    verified_at = Column(
        DateTime,
        nullable=True,
    )


class ActivityDB(Base):
    __tablename__ = "activities"

    id = Column(Integer, primary_key=True, autoincrement=True)
    ngo_id = Column(Integer, ForeignKey("ngos.id"), nullable=False)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    required_skills = Column(Text, nullable=False)
    location = Column(String, nullable=True)
    event_date = Column(DateTime, nullable=True)
    spots_available = Column(Integer, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    status = Column(String(20), nullable=False, default="Active")

class ActivitySignupDB(Base):
    __tablename__ = "activity_signups"

    __table_args__ = (
        UniqueConstraint("activity_id", "volunteer_id", name="uq_signup_activity_volunteer"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    activity_id = Column(Integer, ForeignKey("activities.id"), nullable=False)
    volunteer_id = Column(Integer, ForeignKey("volunteers.id"), nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    # Set when the NGO approves the volunteer for the event.
    approved_at = Column(DateTime, nullable=True)

    # Attendance / feedback phase. attendance_status is NULL until the NGO
    # submits feedback; attended_at is set only when it is "attended".
    attendance_status = Column(String(20), nullable=True)  # "attended", "not_attended" or NULL
    attended_at = Column(DateTime, nullable=True)
    feedback = Column(Text, nullable=True)
    rating = Column(Integer, nullable=True)

class IssueDB(Base):
    """Public issue reports, kept separate from volunteer-to-NGO matching data."""

    __tablename__ = "issues"

    id = Column(Integer, primary_key=True, autoincrement=True)
    complaint_id = Column(String(32), unique=True, index=True, nullable=False)

    reporter_name = Column(String(100), nullable=True)
    contact_information = Column(String(255), nullable=True)
    reporter_email = Column(String(255), nullable=True)

    user_description = Column(Text, nullable=False)
    location = Column(String(500), nullable=False)
    image_paths = Column(JSON, nullable=True)

    # AI image understanding
    ai_image_caption = Column(Text, nullable=True)
    ai_scene_category = Column(String(100), nullable=True)

    # AI-generated merged description
    merged_problem_description = Column(Text, nullable=True)

    # AI NGO recommendations
    recommended_ngos = Column(JSON, nullable=True)
    recommendation_explanations = Column(JSON, nullable=True)

    status = Column(String(20), nullable=False, default="Reported")

    created_at = Column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
    )

    updated_at = Column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )


class IssueResolutionDB(Base):
    """Proof submitted by an NGO that it solved a reported issue."""

    __tablename__ = "issue_resolutions"

    id = Column(Integer, primary_key=True, autoincrement=True)

    # complaint_id is stored without a foreign key so the issue row stays independent.
    complaint_id = Column(String(32), index=True, nullable=False)
    ngo_id = Column(Integer, ForeignKey("ngos.id"), nullable=False)

    solution_type = Column(String(10), nullable=False)  # "written" | "document"
    solution_text = Column(Text, nullable=True)
    document_path = Column(String(255), nullable=True)
    document_name = Column(String(255), nullable=True)

    before_photo = Column(String(255), nullable=False)
    after_photo = Column(String(255), nullable=False)

    # "Under evaluation" | "Approved" | "Rejected" | "Closed"
    status = Column(String(20), nullable=False, default="Under evaluation")
    reject_reason = Column(Text, nullable=True)

    submitted_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    decided_at = Column(DateTime, nullable=True)


class MessageDB(Base):
    """Direct messages between volunteers and NGOs."""

    __tablename__ = "messages"

    __table_args__ = (
        Index("ix_messages_sender_recipient", "sender_email", "recipient_email"),
        Index("ix_messages_created_at", "created_at"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)

    # Participants
    sender_email = Column(String(255), nullable=False)
    sender_role = Column(String(20), nullable=False)       # "volunteer" | "ngo"
    recipient_email = Column(String(255), nullable=False)
    recipient_role = Column(String(20), nullable=False)     # "volunteer" | "ngo"

    # Content
    message_type = Column(String(20), nullable=False, default="text")  # text|image|document|location
    body = Column(Text, nullable=True)

    # File attachment (for image / document types)
    file_path = Column(String(500), nullable=True)
    file_name = Column(String(255), nullable=True)
    file_size = Column(Integer, nullable=True)
    mime_type = Column(String(100), nullable=True)

    # Location sharing (for location type)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)

    # Timestamps
    created_at = Column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
    )

    read_at = Column(DateTime, nullable=True)


class EmbeddingDB(Base):
    """Cached sentence-transformer vectors so matching does not re-encode text."""

    __tablename__ = "embeddings"

    __table_args__ = (
        UniqueConstraint("owner_type", "owner_id", name="uq_embeddings_owner"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)

    # "volunteer_skills" | "ngo_motto" | "ngo_motto_raw" | "event_skills"
    owner_type = Column(String, nullable=False)
    owner_id = Column(Integer, nullable=False)

    # sha256 hex of the exact text that was encoded
    text_hash = Column(String(64), nullable=False)

    # numpy float32 bytes
    vector = Column(LargeBinary, nullable=False)
    dim = Column(Integer, nullable=False)

    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
    )


class AdminSessionDB(Base):
    """A logged-in admin console session. Only a hash of the token is stored."""

    __tablename__ = "admin_sessions"

    id = Column(Integer, primary_key=True, autoincrement=True)

    # sha256 hex of the bearer token handed to the browser
    token_hash = Column(String(64), unique=True, index=True, nullable=False)

    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=False)
    last_used_at = Column(DateTime, nullable=True)


class AdminActionDB(Base):
    """Audit log of actions taken in the admin console."""

    __tablename__ = "admin_actions"

    id = Column(Integer, primary_key=True, autoincrement=True)

    action = Column(String(50), nullable=False)       # e.g. "login", "approve_resolution"
    target_type = Column(String(50), nullable=True)   # e.g. "resolution", "session"
    target_id = Column(String(64), nullable=True)

    # JSON-encoded dict of extra context; never contains passwords or tokens
    details = Column(Text, nullable=True)

    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
