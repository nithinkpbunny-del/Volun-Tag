from datetime import datetime

from sqlalchemy import JSON, Column, DateTime, Integer, String, Text

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
    requirement = Column(String, nullable=True)
    urgency = Column(String, nullable=True, default="medium")

    # ── NGO account / registration details ─────────────────────────
    email = Column(String, unique=True, nullable=True)
    contact_number = Column(String, nullable=True)
    password = Column(String, nullable=True)
    year_founded = Column(Integer, nullable=True)
    website_url = Column(String, nullable=True)

    # ── Verification documents ─────────────────────────────────────
    # These store server-side file paths/names.
    registration_certificate = Column(String, nullable=True)
    pan_card = Column(String, nullable=True)
    cert_12a = Column(String, nullable=True)
    cert_80g = Column(String, nullable=True)
    cert_fcra = Column(String, nullable=True)

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


class IssueDB(Base):
    """Public issue reports, kept separate from volunteer-to-NGO matching data."""

    __tablename__ = "issues"

    id = Column(Integer, primary_key=True, autoincrement=True)
    complaint_id = Column(String(32), unique=True, index=True, nullable=False)

    reporter_name = Column(String(100), nullable=True)
    contact_information = Column(String(255), nullable=True)

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