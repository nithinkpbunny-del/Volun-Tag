from datetime import datetime

from sqlalchemy import (
    JSON, Column, DateTime, Float, ForeignKey, Index, Integer, String, Text,
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
    urgency = Column(String, nullable=True, default="medium")

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