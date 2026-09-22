import logging
import os
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Literal, Optional

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity
from sqlalchemy import func
from sqlalchemy.orm import Session
import numpy as np

try:
    from .database import Base, SessionLocal, engine, get_db
    from .db_models import ActivityDB, NGODB, IssueDB, VolunteerDB
    from .issue_service import (
        ISSUE_STATUSES,
        create_issue,
        delete_issue,
        get_issue_by_complaint_id,
        get_issue_stats,
        get_issues,
        update_issue_status,
    )
    from .issue_ai_pipeline import process_issue
except ImportError:
    from database import Base, SessionLocal, engine, get_db
    from db_models import ActivityDB, NGODB, IssueDB, VolunteerDB
    from issue_service import (
        ISSUE_STATUSES,
        create_issue,
        delete_issue,
        get_issue_by_complaint_id,
        get_issue_stats,
        get_issues,
        update_issue_status,
    )
    from issue_ai_pipeline import process_issue


logger = logging.getLogger(__name__)

UPLOAD_DIR = Path(__file__).resolve().parent / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_IMAGE_TYPES = {
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/bmp",
    "image/tiff",
}

ALLOWED_DOCUMENT_TYPES = {
    "application/pdf",
    "image/jpeg",
    "image/png",
}

MAX_IMAGES = 6
MAX_IMAGE_SIZE = 10 * 1024 * 1024  # 10 MB per file


app = FastAPI(
    title="VolunTag API",
    description="AI-powered volunteer-NGO matching platform",
    version="2.0.0",
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── AI Matching Model ─────────────────────────────────────────────
model = SentenceTransformer("all-MiniLM-L6-v2")


# ─── Category keywords for weighted matching ───────────────────────
CATEGORY_KEYWORDS = {
    "Education": [
        "teaching",
        "tutoring",
        "mentoring",
        "training",
        "curriculum",
        "literacy",
        "school",
        "education",
        "learning",
        "academic",
        "student",
        "instructor",
    ],
    "Health": [
        "medical",
        "nursing",
        "health",
        "wellness",
        "therapy",
        "first aid",
        "mental health",
        "counseling",
        "healthcare",
        "clinical",
        "nutrition",
        "fitness",
    ],
    "Environment": [
        "conservation",
        "recycling",
        "sustainability",
        "ecology",
        "wildlife",
        "climate",
        "green",
        "environmental",
        "nature",
        "cleanup",
        "reforestation",
        "pollution",
    ],
    "Animal Welfare": [
        "animal",
        "pet",
        "shelter",
        "veterinary",
        "rescue",
        "wildlife",
        "adoption",
        "foster",
        "canine",
        "feline",
        "habitat",
        "species",
    ],
    "Social Services": [
        "community",
        "outreach",
        "support",
        "welfare",
        "advocacy",
        "housing",
        "food bank",
        "poverty",
        "homeless",
        "elderly",
        "youth",
        "disability",
    ],
}

CATEGORY_BOOST = 0.15


# ─── Pydantic Models ───────────────────────────────────────────────
class Volunteer(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    email: str = Field(..., min_length=1)
    contact_number: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)
    age: int = Field(..., ge=1, le=120)
    designation: str = Field(..., min_length=1)
    gender: str = Field(..., min_length=1)

    # Existing matching fields.
    skills: str = Field(..., min_length=1)
    location: str = Field(..., min_length=1)
    availability: str = Field(..., min_length=1)
    experience: Optional[str] = ""


class NGO(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    requirement: Optional[str] = ""
    category: Optional[str] = ""
    location: Optional[str] = ""
    urgency: Optional[str] = "medium"


class IssueCreate(BaseModel):
    """Public input for a report; AI and recommendation fields are server-owned."""

    reporter_name: Optional[str] = Field(default=None, max_length=100)
    contact_information: Optional[str] = Field(default=None, max_length=255)
    user_description: str = Field(..., min_length=1, max_length=5000)
    location: str = Field(..., min_length=1, max_length=500)
    image_paths: Optional[list[str]] = Field(default=None, max_length=10)

    @field_validator("user_description", "location")
    @classmethod
    def required_text_cannot_be_blank(cls, value: str) -> str:
        value = value.strip()

        if not value:
            raise ValueError("must not be empty or whitespace only")

        return value

    @field_validator("reporter_name", "contact_information")
    @classmethod
    def optional_text_is_trimmed(
        cls,
        value: Optional[str],
    ) -> Optional[str]:
        if value is None:
            return None

        value = value.strip()

        return value or None

    @field_validator("image_paths")
    @classmethod
    def image_paths_are_valid(
        cls,
        value: Optional[list[str]],
    ) -> Optional[list[str]]:
        if value is None:
            return None

        cleaned_paths = [path.strip() for path in value]

        if any(not path for path in cleaned_paths):
            raise ValueError("image paths must not be empty")

        if any(len(path) > 1000 for path in cleaned_paths):
            raise ValueError("image paths must be 1000 characters or fewer")

        return cleaned_paths


class IssueStatusUpdate(BaseModel):
    status: Literal[
        "Reported",
        "Accepted",
        "In Progress",
        "Resolved",
        "Rejected",
    ]


class IssueResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    complaint_id: str
    reporter_name: Optional[str]
    contact_information: Optional[str]
    user_description: str
    location: str
    image_paths: Optional[list[str]]
    ai_image_caption: Optional[str]
    ai_scene_category: Optional[str]
    merged_problem_description: Optional[str]
    status: str
    recommended_ngos: Optional[list[Any]]
    recommendation_explanations: Optional[list[Any]]
    created_at: datetime
    updated_at: datetime


class IssueStatsResponse(BaseModel):
    total_issues: int
    reported: int
    accepted: int
    in_progress: int
    resolved: int
    rejected: int


class IssueDeleteResponse(BaseModel):
    message: str
    complaint_id: str


class VolunteerDashboardResponse(BaseModel):
    name: str
    email: str
    contact_number: str
    age: int
    designation: str
    gender: str
    skills: Optional[str]
    location: Optional[str]
    availability: Optional[str]
    experience: Optional[str]


class NGODashboardResponse(BaseModel):
    name: str
    email: Optional[str]
    contact_number: Optional[str]
    category: Optional[str]
    location: Optional[str]
    requirement: Optional[str]
    urgency: Optional[str]
    year_founded: Optional[int]
    website_url: Optional[str]
    verification_status: str
    verification_notes: Optional[str]
    work_images: Optional[list[str]]


class EventCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = ""
    required_skills: str = Field(..., min_length=1)
    location: Optional[str] = ""
    event_date: Optional[datetime] = None
    spots_available: Optional[int] = None


class EventResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    ngo_id: int
    title: str
    description: Optional[str]
    required_skills: str
    location: Optional[str]
    event_date: Optional[datetime]
    spots_available: Optional[int]
    created_at: datetime


class NGOEventsResponse(BaseModel):
    ngo_name: str
    total_events: int
    events: list[EventResponse]


class VolunteerMatchEntry(BaseModel):
    ngo_name: str
    ngo_category: Optional[str]
    ngo_location: Optional[str]
    event_title: Optional[str]
    match_percentage: Optional[float]


class VolunteerMatchesResponse(BaseModel):
    volunteer_name: str
    matches: list[VolunteerMatchEntry]


# ─── Sample Seed Data ───────────────────────────────────────────────
SEED_NGOS = [
        # ── Education ──
    NGO(
        name="Bright Horizons Foundation",
        requirement="Looking for volunteers to support after-school tutoring programs, exam preparation, and study skill workshops for high school students in low-income areas.",
        category="Education",
        location="Ahmedabad, India",
        urgency="medium",
    ),
    NGO(
        name="Rising Stars Youth Mission",
        requirement="Need volunteers to run summer learning camps, distribute school supplies, and mentor first-generation learners on college readiness.",
        category="Education",
        location="Indore, India",
        urgency="low",
    ),

    # ── Health ──
    NGO(
        name="Compass Care Network",
        requirement="Seeking healthcare volunteers including nurses, paramedics, and health educators to run mobile health clinics and vaccination drives in rural districts.",
        category="Health",
        location="Bhopal, India",
        urgency="high",
    ),
    NGO(
        name="Wellspring Charitable Trust",
        requirement="Looking for volunteer counselors and psychologists to provide mental health support groups and stress-management workshops for frontline workers.",
        category="Health",
        location="Patna, India",
        urgency="medium",
    ),

    # ── Environment ──
    NGO(
        name="Rooted Community Alliance",
        requirement="Need volunteers for tree plantation drives, urban gardening projects, and composting awareness campaigns to promote sustainable living.",
        category="Environment",
        location="Coimbatore, India",
        urgency="medium",
    ),
    NGO(
        name="Clear Skies Environmental Trust",
        requirement="Seeking volunteers with backgrounds in environmental science and data collection to monitor river water quality and run cleanup drives.",
        category="Environment",
        location="Guwahati, India",
        urgency="high",
    ),

    # ── Animal Welfare ──
    NGO(
        name="Second Chance Animal Sanctuary",
        requirement="Looking for volunteers to assist with animal shelter upkeep, feeding schedules, adoption drives, and basic veterinary support for rescued strays.",
        category="Animal Welfare",
        location="Nagpur, India",
        urgency="low",
    ),
    NGO(
        name="Anchor Point Foundation",
        requirement="Need volunteers for street animal sterilization drives, rescue transport, and community education on responsible pet ownership.",
        category="Animal Welfare",
        location="Surat, India",
        urgency="medium",
    ),

    # ── Social Services ──
    NGO(
        name="Common Ground Welfare Society",
        requirement="Seeking volunteers for disaster relief coordination, shelter support for displaced families, and basic needs distribution during emergencies.",
        category="Social Services",
        location="Bhubaneswar, India",
        urgency="high",
    ),
    NGO(
        name="Hearts United Trust",
        requirement="Looking for volunteers to support elder-care visits, distribute daily meals to homeless individuals, and coordinate winter blanket drives.",
        category="Social Services",
        location="Kanpur, India",
        urgency="medium",
    ),
    NGO(
        name="Teach For Tomorrow",
        requirement="Need volunteers who can teach mathematics, science, and English to underprivileged children in rural schools. Must be patient and good at explaining concepts simply.",
        category="Education",
        location="Jaipur, India",
        urgency="high",
    ),
    NGO(
        name="GreenEarth Foundation",
        requirement="Looking for volunteers passionate about reforestation, waste management, and environmental awareness campaigns. Experience with community mobilization preferred.",
        category="Environment",
        location="Bangalore, India",
        urgency="medium",
    ),
    NGO(
        name="HealthFirst India",
        requirement="Seeking medical professionals and health workers to conduct free health camps, first aid training, and mental health counseling in underserved areas.",
        category="Health",
        location="Mumbai, India",
        urgency="high",
    ),
    NGO(
        name="PawsCare Animal Rescue",
        requirement="Need animal lovers to help with rescue operations, shelter management, foster care coordination, and veterinary assistance for stray animals.",
        category="Animal Welfare",
        location="Delhi, India",
        urgency="medium",
    ),
    NGO(
        name="HopeHarbor Community Center",
        requirement="Looking for social workers, counselors, and community organizers to run outreach programs for homeless and elderly populations.",
        category="Social Services",
        location="Chennai, India",
        urgency="high",
    ),
    NGO(
        name="Code4Kids Academy",
        requirement="Seeking software developers and tech professionals to teach coding, web development, and digital literacy to children aged 10-16.",
        category="Education",
        location="Hyderabad, India",
        urgency="low",
    ),
    NGO(
        name="CleanAir Initiative",
        requirement="Need environmental scientists, data analysts, and campaigners to monitor air quality, analyze pollution data, and run public awareness drives.",
        category="Environment",
        location="Delhi, India",
        urgency="high",
    ),
    NGO(
        name="NutriLife Foundation",
        requirement="Looking for nutritionists, dietitians, and health educators to design meal plans and conduct nutrition workshops for malnourished children.",
        category="Health",
        location="Kolkata, India",
        urgency="medium",
    ),
    NGO(
        name="Wildlife Warriors Trust",
        requirement="Seeking wildlife enthusiasts and conservation biologists to help with habitat restoration, species monitoring, and anti-poaching awareness.",
        category="Animal Welfare",
        location="Pune, India",
        urgency="low",
    ),
    NGO(
        name="YouthRise Foundation",
        requirement="Need mentors, career counselors, and life skills trainers to guide underprivileged youth through education and career development programs.",
        category="Social Services",
        location="Lucknow, India",
        urgency="medium",
    ),
]


SEED_VOLUNTEERS = [
    Volunteer(
        name="Aditya Rao",
        email="aditya.rao.seed@voluntag.test",
        contact_number="9999990031",
        password="seed123",
        age=27,
        designation="Employee",
        gender="Male",
        skills="Curriculum design, teaching high school science, lab demonstrations, exam coaching",
        location="Bangalore, India",
        availability="Weekends",
        experience="Experienced",
    ),
    Volunteer(
        name="Nandini Bose",
        email="nandini.bose.seed@voluntag.test",
        contact_number="9999990032",
        password="seed123",
        age=23,
        designation="Student",
        gender="Female",
        skills="Public health awareness, first aid training, blood donation camps, community health surveys",
        location="Kolkata, India",
        availability="Flexible",
        experience="Beginner",
    ),
    Volunteer(
        name="Farhan Ansari",
        email="farhan.ansari.seed@voluntag.test",
        contact_number="9999990033",
        password="seed123",
        age=31,
        designation="Employee",
        gender="Male",
        skills="Solar energy installation, renewable energy advocacy, sustainability audits, green building consulting",
        location="Ahmedabad, India",
        availability="Part-time",
        experience="Expert",
    ),
    Volunteer(
        name="Ritika Chawla",
        email="ritika.chawla.seed@voluntag.test",
        contact_number="9999990034",
        password="seed123",
        age=25,
        designation="Employee",
        gender="Female",
        skills="Dog training, animal behavior, shelter volunteering, rescue coordination, pet adoption events",
        location="Chandigarh, India",
        availability="Weekends",
        experience="Intermediate",
    ),
    Volunteer(
        name="Devansh Malhotra",
        email="devansh.malhotra.seed@voluntag.test",
        contact_number="9999990035",
        password="seed123",
        age=29,
        designation="Employee",
        gender="Male",
        skills="Homeless shelter support, food distribution, disaster relief logistics, emergency response coordination",
        location="Delhi, India",
        availability="Full-time",
        experience="Experienced",
    ),
    Volunteer(
        name="Ishita Ghosh",
        email="ishita.ghosh.seed@voluntag.test",
        contact_number="9999990036",
        password="seed123",
        age=22,
        designation="Student",
        gender="Female",
        skills="Primary school tutoring, storytelling for children, literacy programs, reading circles",
        location="Pune, India",
        availability="Weekends",
        experience="Beginner",
    ),
    Volunteer(
        name="Rajat Kapoor",
        email="rajat.kapoor.seed@voluntag.test",
        contact_number="9999990037",
        password="seed123",
        age=34,
        designation="Employee",
        gender="Male",
        skills="Emergency medicine, trauma care, ambulance response, paramedic training",
        location="Mumbai, India",
        availability="Full-time",
        experience="Expert",
    ),
    Volunteer(
        name="Simran Kaur",
        email="simran.kaur.seed@voluntag.test",
        contact_number="9999990038",
        password="seed123",
        age=26,
        designation="Employee",
        gender="Female",
        skills="Wetland conservation, bird sanctuary management, ecological surveys, nature trail guiding",
        location="Chandigarh, India",
        availability="Flexible",
        experience="Intermediate",
    ),
    Volunteer(
        name="Yash Thakur",
        email="yash.thakur.seed@voluntag.test",
        contact_number="9999990039",
        password="seed123",
        age=24,
        designation="Student",
        gender="Male",
        skills="Wildlife photography, species documentation, forest patrol assistance, conservation awareness campaigns",
        location="Dehradun, India",
        availability="Weekends",
        experience="Beginner",
    ),
    Volunteer(
        name="Aarushi Bhatia",
        email="aarushi.bhatia.seed@voluntag.test",
        contact_number="9999990040",
        password="seed123",
        age=28,
        designation="Employee",
        gender="Female",
        skills="Elderly care, old-age home visits, companionship programs, geriatric health support",
        location="Jaipur, India",
        availability="Part-time",
        experience="Experienced",
    ),
    Volunteer(
        name="Kabir Malik",
        email="kabir.malik.seed@voluntag.test",
        contact_number="9999990041",
        password="seed123",
        age=32,
        designation="Employee",
        gender="Male",
        skills="STEM education, robotics workshops, science fair mentoring, coding bootcamps for teenagers",
        location="Hyderabad, India",
        availability="Weekends",
        experience="Expert",
    ),
    Volunteer(
        name="Neha Pandey",
        email="neha.pandey.seed@voluntag.test",
        contact_number="9999990042",
        password="seed123",
        age=27,
        designation="Employee",
        gender="Female",
        skills="Maternal health, prenatal counseling, nutrition for pregnant women, community health worker training",
        location="Lucknow, India",
        availability="Weekdays",
        experience="Experienced",
    ),
    Volunteer(
        name="Siddharth Jain",
        email="siddharth.jain.seed@voluntag.test",
        contact_number="9999990043",
        password="seed123",
        age=30,
        designation="Employee",
        gender="Male",
        skills="Plastic waste reduction, recycling drives, zero-waste workshops, circular economy advocacy",
        location="Indore, India",
        availability="Flexible",
        experience="Intermediate",
    ),
    Volunteer(
        name="Ayesha Siddiqui",
        email="ayesha.siddiqui.seed@voluntag.test",
        contact_number="9999990044",
        password="seed123",
        age=25,
        designation="Employee",
        gender="Female",
        skills="Feral cat rescue, TNR programs, animal sterilization camps, stray animal feeding drives",
        location="Bhopal, India",
        availability="Weekends",
        experience="Intermediate",
    ),
    Volunteer(
        name="Vivaan Chatterjee",
        email="vivaan.chatterjee.seed@voluntag.test",
        contact_number="9999990045",
        password="seed123",
        age=33,
        designation="Employee",
        gender="Male",
        skills="Rural employment programs, skill development training, microfinance literacy, livelihood support",
        location="Kolkata, India",
        availability="Full-time",
        experience="Expert",
    ),
    Volunteer(
        name="Riya D'Souza",
        email="riya.dsouza.seed@voluntag.test",
        contact_number="9999990046",
        password="seed123",
        age=21,
        designation="Student",
        gender="Female",
        skills="Special needs tutoring, inclusive education, sign language basics, classroom assistance",
        location="Goa, India",
        availability="Weekends",
        experience="Beginner",
    ),
    Volunteer(
        name="Aryan Chauhan",
        email="aryan.chauhan.seed@voluntag.test",
        contact_number="9999990047",
        password="seed123",
        age=29,
        designation="Employee",
        gender="Male",
        skills="Disaster preparedness training, flood relief, emergency shelter setup, crisis communication",
        location="Guwahati, India",
        availability="Full-time",
        experience="Experienced",
    ),
    Volunteer(
        name="Tanvi Shah",
        email="tanvi.shah.seed@voluntag.test",
        contact_number="9999990048",
        password="seed123",
        age=26,
        designation="Employee",
        gender="Female",
        skills="Organic farming, permaculture design, seed banking, sustainable agriculture training",
        location="Nashik, India",
        availability="Flexible",
        experience="Intermediate",
    ),
    Volunteer(
        name="Om Prakash",
        email="om.prakash.seed@voluntag.test",
        contact_number="9999990049",
        password="seed123",
        age=37,
        designation="Employee",
        gender="Male",
        skills="Vocational training, carpentry instruction, tailoring workshops, livelihood skill building for youth",
        location="Kanpur, India",
        availability="Part-time",
        experience="Expert",
    ),
    Volunteer(
        name="Diya Menon",
        email="diya.menon.seed@voluntag.test",
        contact_number="9999990050",
        password="seed123",
        age=24,
        designation="Student",
        gender="Female",
        skills="Bird rescue, wildlife first aid, aviary maintenance, exotic animal care",
        location="Kochi, India",
        availability="Weekends",
        experience="Beginner",
    ),
    Volunteer(
        name="Reyansh Oberoi",
        email="reyansh.oberoi.seed@voluntag.test",
        contact_number="9999990051",
        password="seed123",
        age=35,
        designation="Employee",
        gender="Male",
        skills="Preventive cardiology, community health screenings, diabetes awareness camps, chronic disease education",
        location="Chennai, India",
        availability="Weekdays",
        experience="Expert",
    ),
    Volunteer(
        name="Kritika Suri",
        email="kritika.suri.seed@voluntag.test",
        contact_number="9999990052",
        password="seed123",
        age=28,
        designation="Employee",
        gender="Female",
        skills="Slum rehabilitation, affordable housing advocacy, community sanitation drives, urban poverty alleviation",
        location="Mumbai, India",
        availability="Full-time",
        experience="Experienced",
    ),
    Volunteer(
        name="Aniket Joshi",
        email="aniket.joshi.seed@voluntag.test",
        contact_number="9999990053",
        password="seed123",
        age=22,
        designation="Student",
        gender="Male",
        skills="Environmental education, school eco-clubs, plantation drives, waste segregation awareness",
        location="Pune, India",
        availability="Weekends",
        experience="Beginner",
    ),
    Volunteer(
        name="Mahima Bansal",
        email="mahima.bansal.seed@voluntag.test",
        contact_number="9999990054",
        password="seed123",
        age=30,
        designation="Employee",
        gender="Female",
        skills="Adult literacy programs, women's education, vocational counseling, self-help group facilitation",
        location="Chandigarh, India",
        availability="Part-time",
        experience="Experienced",
    ),
    Volunteer(
        name="Zaid Khan",
        email="zaid.khan.seed@voluntag.test",
        contact_number="9999990055",
        password="seed123",
        age=26,
        designation="Employee",
        gender="Male",
        skills="Physiotherapy for elderly, home-based rehabilitation, mobility aid training, post-surgery care support",
        location="Hyderabad, India",
        availability="Weekdays",
        experience="Intermediate",
    ),
    Volunteer(
        name="Vanya Kohli",
        email="vanya.kohli.seed@voluntag.test",
        contact_number="9999990056",
        password="seed123",
        age=23,
        designation="Student",
        gender="Female",
        skills="Marine conservation, beach cleanup drives, coral reef awareness, coastal ecology research",
        location="Goa, India",
        availability="Flexible",
        experience="Beginner",
    ),
    Volunteer(
        name="Harsh Vardhan",
        email="harsh.vardhan.seed@voluntag.test",
        contact_number="9999990057",
        password="seed123",
        age=31,
        designation="Employee",
        gender="Male",
        skills="Legal literacy workshops, tenant rights advocacy, RTI filing assistance, paralegal support for underserved communities",
        location="Delhi, India",
        availability="Part-time",
        experience="Expert",
    ),
    Volunteer(
        name="Sanya Grover",
        email="sanya.grover.seed@voluntag.test",
        contact_number="9999990058",
        password="seed123",
        age=27,
        designation="Employee",
        gender="Female",
        skills="Horse rescue, equine therapy assistance, farm animal sanctuary support, livestock welfare",
        location="Jaipur, India",
        availability="Weekends",
        experience="Intermediate",
    ),
    Volunteer(
        name="Ishaan Bakshi",
        email="ishaan.bakshi.seed@voluntag.test",
        contact_number="9999990059",
        password="seed123",
        age=29,
        designation="Employee",
        gender="Male",
        skills="Career mentoring for engineering students, resume workshops, mock interview coaching, campus placement guidance",
        location="Bangalore, India",
        availability="Flexible",
        experience="Experienced",
    ),
    Volunteer(
        name="Alia Fernandes",
        email="alia.fernandes.seed@voluntag.test",
        contact_number="9999990060",
        password="seed123",
        age=25,
        designation="Employee",
        gender="Female",
        skills="Oral hygiene camps, dental health education, pediatric dentistry outreach, hygiene awareness programs",
        location="Goa, India",
        availability="Weekdays",
        experience="Intermediate",
    ),
    Volunteer(
        name="Dhruv Sethi",
        email="dhruv.sethi.seed@voluntag.test",
        contact_number="9999990061",
        password="seed123",
        age=33,
        designation="Employee",
        gender="Male",
        skills="Renewable energy policy research, carbon footprint auditing, corporate sustainability consulting",
        location="Gurgaon, India",
        availability="Part-time",
        experience="Expert",
    ),
    Volunteer(
        name="Navya Iyer",
        email="navya.iyer.seed@voluntag.test",
        contact_number="9999990062",
        password="seed123",
        age=24,
        designation="Student",
        gender="Female",
        skills="Peer counseling, adolescent mental health support, school wellness programs, stress workshops for teens",
        location="Chennai, India",
        availability="Weekends",
        experience="Beginner",
    ),
    Volunteer(
        name="Kunal Wadhwa",
        email="kunal.wadhwa.seed@voluntag.test",
        contact_number="9999990063",
        password="seed123",
        age=36,
        designation="Employee",
        gender="Male",
        skills="Slum school infrastructure, classroom building projects, education access advocacy, school supply drives",
        location="Mumbai, India",
        availability="Full-time",
        experience="Expert",
    ),
    Volunteer(
        name="Prisha Anand",
        email="prisha.anand.seed@voluntag.test",
        contact_number="9999990064",
        password="seed123",
        age=26,
        designation="Employee",
        gender="Female",
        skills="Snake rescue and relocation, reptile handling, wildlife helpline coordination, urban wildlife conflict mitigation",
        location="Bangalore, India",
        availability="Flexible",
        experience="Intermediate",
    ),
    Volunteer(
        name="Rehan Qureshi",
        email="rehan.qureshi.seed@voluntag.test",
        contact_number="9999990065",
        password="seed123",
        age=28,
        designation="Employee",
        gender="Male",
        skills="Refugee resettlement support, migrant worker assistance, cross-cultural communication, humanitarian aid coordination",
        location="Delhi, India",
        availability="Part-time",
        experience="Experienced",
    ),
    Volunteer(
        name="Aditi Vyas",
        email="aditi.vyas.seed@voluntag.test",
        contact_number="9999990066",
        password="seed123",
        age=22,
        designation="Student",
        gender="Female",
        skills="Girls' education advocacy, menstrual hygiene workshops, school dropout prevention counseling",
        location="Udaipur, India",
        availability="Weekends",
        experience="Beginner",
    ),
    Volunteer(
        name="Veer Chopra",
        email="veer.chopra.seed@voluntag.test",
        contact_number="9999990067",
        password="seed123",
        age=34,
        designation="Employee",
        gender="Male",
        skills="Watershed restoration, groundwater recharge projects, rainwater harvesting consultation, drought relief planning",
        location="Nagpur, India",
        availability="Full-time",
        experience="Expert",
    ),
    Volunteer(
        name="Myra Kapadia",
        email="myra.kapadia.seed@voluntag.test",
        contact_number="9999990068",
        password="seed123",
        age=27,
        designation="Employee",
        gender="Female",
        skills="Palliative care support, hospice volunteering, end-of-life counseling, caregiver respite support",
        location="Mumbai, India",
        availability="Weekdays",
        experience="Experienced",
    ),
    Volunteer(
        name="Arnav Trivedi",
        email="arnav.trivedi.seed@voluntag.test",
        contact_number="9999990069",
        password="seed123",
        age=25,
        designation="Employee",
        gender="Male",
        skills="Digital literacy for seniors, basic computer training, smartphone usage workshops, online safety education",
        location="Surat, India",
        availability="Flexible",
        experience="Intermediate",
    ),
    Volunteer(
        name="Larisa D'Costa",
        email="larisa.dcosta.seed@voluntag.test",
        contact_number="9999990070",
        password="seed123",
        age=23,
        designation="Student",
        gender="Female",
        skills="Turtle conservation, nesting site monitoring, marine wildlife rehabilitation, beach patrol volunteering",
        location="Goa, India",
        availability="Weekends",
        experience="Beginner",
    ),
    Volunteer(
        name="Uday Ranganathan",
        email="uday.ranganathan.seed@voluntag.test",
        contact_number="9999990071",
        password="seed123",
        age=32,
        designation="Employee",
        gender="Male",
        skills="Vaccination drive logistics, cold-chain management, immunization awareness campaigns, rural health outreach",
        location="Coimbatore, India",
        availability="Full-time",
        experience="Expert",
    ),
    Volunteer(
        name="Zoya Merchant",
        email="zoya.merchant.seed@voluntag.test",
        contact_number="9999990072",
        password="seed123",
        age=29,
        designation="Employee",
        gender="Female",
        skills="Domestic violence support, women's shelter counseling, crisis hotline staffing, survivor advocacy",
        location="Pune, India",
        availability="Part-time",
        experience="Experienced",
    ),
    Volunteer(
        name="Shaurya Bedi",
        email="shaurya.bedi.seed@voluntag.test",
        contact_number="9999990073",
        password="seed123",
        age=21,
        designation="Student",
        gender="Male",
        skills="Coral nursery maintenance, scuba-assisted reef cleanup, underwater photography for research, dive training",
        location="Andaman, India",
        availability="Flexible",
        experience="Beginner",
    ),
    Volunteer(
        name="Anushka Bhalla",
        email="anushka.bhalla.seed@voluntag.test",
        contact_number="9999990074",
        password="seed123",
        age=26,
        designation="Employee",
        gender="Female",
        skills="Foster care support, orphanage volunteering, child welfare advocacy, adoption process assistance",
        location="Delhi, India",
        availability="Weekends",
        experience="Intermediate",
    ),
    Volunteer(
        name="Rudra Pillai",
        email="rudra.pillai.seed@voluntag.test",
        contact_number="9999990075",
        password="seed123",
        age=38,
        designation="Employee",
        gender="Male",
        skills="Mangrove restoration, coastal erosion mitigation, community fisheries management, blue carbon research",
        location="Kochi, India",
        availability="Full-time",
        experience="Expert",
    ),
    Volunteer(
        name="Esha Nanda",
        email="esha.nanda.seed@voluntag.test",
        contact_number="9999990076",
        password="seed123",
        age=24,
        designation="Student",
        gender="Female",
        skills="Pet grooming, animal shelter cleaning, volunteer coordination for adoption fairs, small animal care",
        location="Jaipur, India",
        availability="Weekends",
        experience="Beginner",
    ),
    Volunteer(
        name="Nikhil Sarin",
        email="nikhil.sarin.seed@voluntag.test",
        contact_number="9999990077",
        password="seed123",
        age=30,
        designation="Employee",
        gender="Male",
        skills="Financial literacy workshops, microloan counseling, budgeting classes for low-income families, savings group facilitation",
        location="Ahmedabad, India",
        availability="Part-time",
        experience="Experienced",
    ),
    Volunteer(
        name="Pihu Sachdeva",
        email="pihu.sachdeva.seed@voluntag.test",
        contact_number="9999990078",
        password="seed123",
        age=27,
        designation="Employee",
        gender="Female",
        skills="Speech therapy support, communication disorder awareness, early childhood intervention, special education advocacy",
        location="Chandigarh, India",
        availability="Weekdays",
        experience="Experienced",
    ),
    Volunteer(
        name="Vihaan Rastogi",
        email="vihaan.rastogi.seed@voluntag.test",
        contact_number="9999990079",
        password="seed123",
        age=25,
        designation="Other",
        gender="Other",
        skills="Urban farming workshops, rooftop gardening, community composting, food security advocacy",
        location="Bangalore, India",
        availability="Flexible",
        experience="Intermediate",
    ),
    Volunteer(
        name="Trisha Kulshreshtha",
        email="trisha.kulshreshtha.seed@voluntag.test",
        contact_number="9999990080",
        password="seed123",
        age=28,
        designation="Employee",
        gender="Female",
        skills="Disability rights advocacy, accessible infrastructure consulting, inclusive employment programs, assistive technology training",
        location="Mumbai, India",
        availability="Part-time",
        experience="Experienced",
    ),
    Volunteer(
        name="Ravi Kumar",
        email="ravi.seed@voluntag.test",
        contact_number="9999990001",
        password="seed123",
        age=25,
        designation="Employee",
        gender="Male",
        skills="Teaching, mathematics, tutoring, mentoring, curriculum design, patience with children",
        location="Jaipur, India",
        availability="Weekends",
        experience="Experienced",
    ),
    Volunteer(
        name="Priya Sharma",
        email="priya.seed@voluntag.test",
        contact_number="9999990002",
        password="seed123",
        age=24,
        designation="Employee",
        gender="Female",
        skills="Environmental science, reforestation, sustainability projects, waste management, community engagement",
        location="Bangalore, India",
        availability="Flexible",
        experience="Expert",
    ),
    Volunteer(
        name="Ankit Patel",
        email="ankit.seed@voluntag.test",
        contact_number="9999990003",
        password="seed123",
        age=28,
        designation="Employee",
        gender="Male",
        skills="First aid, nursing, health camps, blood donation drives, patient care",
        location="Mumbai, India",
        availability="Weekdays",
        experience="Intermediate",
    ),
    Volunteer(
        name="Sneha Reddy",
        email="sneha.seed@voluntag.test",
        contact_number="9999990004",
        password="seed123",
        age=26,
        designation="Employee",
        gender="Female",
        skills="Animal rescue, shelter management, pet fostering, veterinary assistance, adoption coordination",
        location="Delhi, India",
        availability="Flexible",
        experience="Experienced",
    ),
    Volunteer(
        name="Arjun Nair",
        email="arjun.seed@voluntag.test",
        contact_number="9999990005",
        password="seed123",
        age=30,
        designation="Employee",
        gender="Male",
        skills="Social work, community outreach, elderly care, youth mentorship, counseling",
        location="Chennai, India",
        availability="Part-time",
        experience="Expert",
    ),
    Volunteer(
        name="Meera Joshi",
        email="meera.seed@voluntag.test",
        contact_number="9999990006",
        password="seed123",
        age=23,
        designation="Student",
        gender="Female",
        skills="Python programming, web development, teaching coding to kids, digital literacy training",
        location="Hyderabad, India",
        availability="Weekends",
        experience="Experienced",
    ),
    Volunteer(
        name="Vikram Singh",
        email="vikram.seed@voluntag.test",
        contact_number="9999990007",
        password="seed123",
        age=32,
        designation="Employee",
        gender="Male",
        skills="Data analysis, air quality monitoring, environmental campaigning, public policy research",
        location="Delhi, India",
        availability="Full-time",
        experience="Expert",
    ),
    Volunteer(
        name="Kavitha Menon",
        email="kavitha.seed@voluntag.test",
        contact_number="9999990008",
        password="seed123",
        age=29,
        designation="Employee",
        gender="Female",
        skills="Nutrition, dietetics, meal planning, health education, childhood nutrition programs",
        location="Kolkata, India",
        availability="Weekdays",
        experience="Experienced",
    ),
    Volunteer(
        name="Rahul Deshmukh",
        email="rahul.seed@voluntag.test",
        contact_number="9999990009",
        password="seed123",
        age=27,
        designation="Employee",
        gender="Male",
        skills="Wildlife conservation, habitat restoration, bird watching, anti-poaching campaigns, ecology research",
        location="Pune, India",
        availability="Weekends",
        experience="Intermediate",
    ),
    Volunteer(
        name="Anita Desai",
        email="anita.seed@voluntag.test",
        contact_number="9999990010",
        password="seed123",
        age=31,
        designation="Employee",
        gender="Female",
        skills="Career counseling, mentoring youth, resume building, interview coaching, life skills training",
        location="Lucknow, India",
        availability="Flexible",
        experience="Expert",
    ),
    Volunteer(
        name="Suresh Iyer",
        email="suresh.seed@voluntag.test",
        contact_number="9999990011",
        password="seed123",
        age=29,
        designation="Employee",
        gender="Male",
        skills="Mathematics teaching, science education, school tutoring, exam preparation, student mentoring",
        location="Chennai, India",
        availability="Part-time",
        experience="Experienced",
    ),
    Volunteer(
        name="Deepa Krishnan",
        email="deepa.seed@voluntag.test",
        contact_number="9999990012",
        password="seed123",
        age=25,
        designation="Employee",
        gender="Female",
        skills="Graphic design, content writing, social media management, marketing campaigns, event planning",
        location="Bangalore, India",
        availability="Flexible",
        experience="Intermediate",
    ),
    Volunteer(
        name="Amit Gupta",
        email="amit.seed@voluntag.test",
        contact_number="9999990013",
        password="seed123",
        age=35,
        designation="Employee",
        gender="Male",
        skills="Medical doctor, clinical practice, health awareness, preventive healthcare, rural health camps",
        location="Mumbai, India",
        availability="Weekends",
        experience="Expert",
    ),
    Volunteer(
        name="Fatima Khan",
        email="fatima.seed@voluntag.test",
        contact_number="9999990014",
        password="seed123",
        age=26,
        designation="Employee",
        gender="Female",
        skills="Recycling programs, eco-friendly workshops, climate change awareness, green energy advocacy",
        location="Delhi, India",
        availability="Part-time",
        experience="Intermediate",
    ),
    Volunteer(
        name="Rajesh Verma",
        email="rajesh.seed@voluntag.test",
        contact_number="9999990015",
        password="seed123",
        age=33,
        designation="Employee",
        gender="Male",
        skills="Carpentry, construction, building maintenance, infrastructure repair, manual labor",
        location="Jaipur, India",
        availability="Full-time",
        experience="Experienced",
    ),
    Volunteer(
        name="Lakshmi Sundaram",
        email="lakshmi.seed@voluntag.test",
        contact_number="9999990016",
        password="seed123",
        age=28,
        designation="Employee",
        gender="Female",
        skills="Yoga instruction, fitness training, mental wellness, meditation coaching, stress management",
        location="Mumbai, India",
        availability="Weekdays",
        experience="Expert",
    ),
    Volunteer(
        name="Sanjay Bhatt",
        email="sanjay.seed@voluntag.test",
        contact_number="9999990017",
        password="seed123",
        age=34,
        designation="Employee",
        gender="Male",
        skills="Legal aid, human rights advocacy, policy drafting, community welfare, dispute resolution",
        location="Delhi, India",
        availability="Part-time",
        experience="Experienced",
    ),
    Volunteer(
        name="Pooja Agarwal",
        email="pooja.seed@voluntag.test",
        contact_number="9999990018",
        password="seed123",
        age=24,
        designation="Student",
        gender="Female",
        skills="Photography, videography, documentary filmmaking, event coverage, visual storytelling",
        location="Kolkata, India",
        availability="Flexible",
        experience="Intermediate",
    ),
    Volunteer(
        name="Karthik Rajan",
        email="karthik.seed@voluntag.test",
        contact_number="9999990019",
        password="seed123",
        age=27,
        designation="Employee",
        gender="Male",
        skills="Software engineering, app development, database management, tech workshops, hackathon mentoring",
        location="Hyderabad, India",
        availability="Weekends",
        experience="Experienced",
    ),
    Volunteer(
        name="Nisha Tiwari",
        email="nisha.seed@voluntag.test",
        contact_number="9999990020",
        password="seed123",
        age=23,
        designation="Student",
        gender="Female",
        skills="Public speaking, debate coaching, communication skills training, English language teaching",
        location="Lucknow, India",
        availability="Weekdays",
        experience="Intermediate",
    ),
    Volunteer(
        name="Manoj Pillai",
        email="manoj.seed@voluntag.test",
        contact_number="9999990021",
        password="seed123",
        age=36,
        designation="Employee",
        gender="Male",
        skills="Plumbing, electrical work, housing repair, shelter construction for homeless, infrastructure support",
        location="Chennai, India",
        availability="Full-time",
        experience="Experienced",
    ),
    Volunteer(
        name="Swati Kulkarni",
        email="swati.seed@voluntag.test",
        contact_number="9999990022",
        password="seed123",
        age=30,
        designation="Employee",
        gender="Female",
        skills="Child psychology, special education, learning disability support, behavioral therapy, counseling children",
        location="Pune, India",
        availability="Flexible",
        experience="Expert",
    ),
    Volunteer(
        name="Rohan Saxena",
        email="rohan.seed@voluntag.test",
        contact_number="9999990023",
        password="seed123",
        age=29,
        designation="Employee",
        gender="Male",
        skills="Event management, fundraising, donor outreach, grant writing, NGO administration",
        location="Delhi, India",
        availability="Part-time",
        experience="Experienced",
    ),
    Volunteer(
        name="Divya Nambiar",
        email="divya.seed@voluntag.test",
        contact_number="9999990024",
        password="seed123",
        age=26,
        designation="Employee",
        gender="Female",
        skills="Water conservation, river cleanup drives, watershed management, environmental impact assessment",
        location="Bangalore, India",
        availability="Weekends",
        experience="Intermediate",
    ),
    Volunteer(
        name="Arun Prakash",
        email="arun.seed@voluntag.test",
        contact_number="9999990025",
        password="seed123",
        age=32,
        designation="Employee",
        gender="Male",
        skills="Physiotherapy, rehabilitation, sports medicine, elderly mobility support, occupational therapy",
        location="Mumbai, India",
        availability="Weekdays",
        experience="Expert",
    ),
    Volunteer(
        name="Geeta Rao",
        email="geeta.seed@voluntag.test",
        contact_number="9999990026",
        password="seed123",
        age=28,
        designation="Employee",
        gender="Female",
        skills="Food distribution, soup kitchen management, food bank coordination, hunger relief programs",
        location="Chennai, India",
        availability="Flexible",
        experience="Experienced",
    ),
    Volunteer(
        name="Imran Sheikh",
        email="imran.seed@voluntag.test",
        contact_number="9999990027",
        password="seed123",
        age=30,
        designation="Employee",
        gender="Male",
        skills="Translation, Urdu-English-Hindi, multilingual communication, documentation, interpretation services",
        location="Lucknow, India",
        availability="Part-time",
        experience="Experienced",
    ),
    Volunteer(
        name="Bhavna Mehta",
        email="bhavna.seed@voluntag.test",
        contact_number="9999990028",
        password="seed123",
        age=25,
        designation="Student",
        gender="Female",
        skills="Dance instruction, performing arts, cultural event organization, music teaching, art therapy",
        location="Jaipur, India",
        availability="Weekends",
        experience="Intermediate",
    ),
    Volunteer(
        name="Venkat Subramanian",
        email="venkat.seed@voluntag.test",
        contact_number="9999990029",
        password="seed123",
        age=38,
        designation="Employee",
        gender="Male",
        skills="Agricultural science, organic farming, crop management, farmer training, soil conservation",
        location="Hyderabad, India",
        availability="Full-time",
        experience="Expert",
    ),
    Volunteer(
        name="Tanya Chopra",
        email="tanya.seed@voluntag.test",
        contact_number="9999990030",
        password="seed123",
        age=29,
        designation="Employee",
        gender="Female",
        skills="Mental health counseling, crisis intervention, substance abuse support, emotional well-being workshops",
        location="Delhi, India",
        availability="Flexible",
        experience="Experienced",
    ),
]


# ─── Startup / Seed Data ───────────────────────────────────────────
@app.on_event("startup")
def seed_data():
    """Load sample data on server startup."""

    Base.metadata.create_all(bind=engine)

    db = SessionLocal()

    try:
        seeded_volunteers = 0
        seeded_ngos = 0

        if db.query(func.count(VolunteerDB.id)).scalar() == 0:
            db.add_all(
                VolunteerDB(**volunteer.dict())
                for volunteer in SEED_VOLUNTEERS
            )
            seeded_volunteers = len(SEED_VOLUNTEERS)

        if db.query(func.count(NGODB.id)).scalar() == 0:
            db.add_all(
                NGODB(
                    name=ngo.name,
                    requirement=ngo.requirement or None,
                    category=ngo.category or None,
                    location=ngo.location or None,
                    urgency=ngo.urgency or "medium",
                    verification_status="Approved",
                )
                for ngo in SEED_NGOS
            )
            seeded_ngos = len(SEED_NGOS)

        if seeded_volunteers or seeded_ngos:
            db.commit()

            print(
                f"✅ Seeded {seeded_volunteers} volunteers "
                f"and {seeded_ngos} NGOs"
            )

    finally:
        db.close()


# ─── Helpers ───────────────────────────────────────────────────────
def compute_category_boost(
    skills_text: str,
    category: str,
) -> float:
    """Return a boost score if volunteer skills match NGO category keywords."""

    if not category or category not in CATEGORY_KEYWORDS:
        return 0.0

    keywords = CATEGORY_KEYWORDS[category]
    skills_lower = skills_text.lower()

    matches = sum(
        1
        for kw in keywords
        if kw in skills_lower
    )

    if matches == 0:
        return 0.0

    return min(matches / 3.0, 1.0) * CATEGORY_BOOST


def classify_confidence(score: float) -> str:
    """Classify match score into confidence tiers."""

    if score >= 0.70:
        return "high"

    if score >= 0.50:
        return "medium"

    return "low"


async def save_ngo_file(
    upload: Optional[UploadFile],
    field_name: str,
) -> Optional[str]:
    """Save one optional NGO verification document."""

    if upload is None:
        return None

    if upload.content_type not in ALLOWED_DOCUMENT_TYPES:
        raise HTTPException(
            status_code=400,
            detail=(
                f"{field_name} must be a PDF, JPG, JPEG, "
                f"or PNG file."
            ),
        )

    contents = await upload.read()

    if len(contents) > MAX_IMAGE_SIZE:
        raise HTTPException(
            status_code=400,
            detail=(
                f"{field_name} exceeds the "
                f"{MAX_IMAGE_SIZE // (1024 * 1024)} MB size limit."
            ),
        )

    ext = Path(upload.filename or "").suffix.lower()

    if ext not in {
        ".pdf",
        ".jpg",
        ".jpeg",
        ".png",
    }:
        ext = ".pdf"

    safe_name = f"ngo_{uuid.uuid4().hex}{ext}"
    destination = UPLOAD_DIR / safe_name

    with open(destination, "wb") as file:
        file.write(contents)

    return safe_name


# ─── Root ──────────────────────────────────────────────────────────
@app.get("/")
def home():
    return {
        "message": "VolunTag backend running",
        "version": "2.0.0",
    }


# ─── Report Issue ─────────────────────────────────────────────────
@app.post(
    "/report-issue",
    response_model=IssueResponse,
    status_code=201,
)
def report_issue(
    user_description: str = Form(...),
    location: str = Form(...),
    reporter_name: Optional[str] = Form(default=None),
    contact_information: Optional[str] = Form(default=None),
    images: list[UploadFile] = File(default=[]),
    db: Session = Depends(get_db),
):
    """Store a public issue report with optional image uploads and AI processing."""

    user_description = user_description.strip()
    location = location.strip()

    if not user_description:
        raise HTTPException(
            status_code=422,
            detail="user_description must not be empty",
        )

    if not location:
        raise HTTPException(
            status_code=422,
            detail="location must not be empty",
        )

    if reporter_name is not None:
        reporter_name = reporter_name.strip() or None

    if contact_information is not None:
        contact_information = (
            contact_information.strip() or None
        )

    if len(images) > MAX_IMAGES:
        raise HTTPException(
            status_code=400,
            detail=f"Too many images. Maximum is {MAX_IMAGES}.",
        )

    for img in images:
        if img.content_type not in ALLOWED_IMAGE_TYPES:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"File '{img.filename}' is not a supported "
                    f"image type. Allowed: JPEG, PNG, GIF, "
                    f"WebP, BMP, TIFF."
                ),
            )

    saved_paths: list[str] = []
    saved_full_paths: list[Path] = []

    try:
        for img in images:
            contents = img.file.read()

            if len(contents) > MAX_IMAGE_SIZE:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"File '{img.filename}' exceeds the "
                        f"{MAX_IMAGE_SIZE // (1024 * 1024)} MB "
                        f"size limit."
                    ),
                )

            ext = (
                Path(img.filename or "").suffix.lower()
                if img.filename
                else ""
            )

            if ext not in {
                ".jpg",
                ".jpeg",
                ".png",
                ".gif",
                ".webp",
                ".bmp",
                ".tiff",
                ".tif",
            }:
                ext = ".jpg"

            safe_name = f"{uuid.uuid4().hex}{ext}"
            dest = UPLOAD_DIR / safe_name

            with open(dest, "wb") as file:
                file.write(contents)

            saved_paths.append(safe_name)
            saved_full_paths.append(dest)

    except HTTPException:
        for path in saved_full_paths:
            path.unlink(missing_ok=True)

        raise

    except Exception:
        for path in saved_full_paths:
            path.unlink(missing_ok=True)

        logger.exception("Failed to save uploaded images")

        raise HTTPException(
            status_code=500,
            detail="Failed to save uploaded images.",
        )

    issue_data = {
        "user_description": user_description,
        "location": location,
        "reporter_name": reporter_name,
        "contact_information": contact_information,
        "image_paths": saved_paths if saved_paths else None,
    }

    issue = create_issue(db, issue_data)

    try:
        result = process_issue(issue, db)

        issue.ai_image_caption = result["ai_image_caption"]
        issue.ai_scene_category = result["ai_scene_category"]
        issue.merged_problem_description = (
            result["merged_problem_description"]
        )
        issue.recommended_ngos = result["recommended_ngos"]
        issue.recommendation_explanations = (
            result["recommendation_explanations"]
        )

        db.commit()
        db.refresh(issue)

    except Exception:
        logger.exception(
            "AI processing failed for issue %s; "
            "complaint saved without AI fields.",
            issue.complaint_id,
        )

        db.rollback()
        db.refresh(issue)

    return issue


# ─── Issue Routes ──────────────────────────────────────────────────
@app.get(
    "/issues",
    response_model=list[IssueResponse],
)
def list_issues(
    db: Session = Depends(get_db),
):
    """Return issue reports in newest-first order."""

    return get_issues(db)


@app.get(
    "/issues/{complaint_id}",
    response_model=IssueResponse,
)
def get_issue(
    complaint_id: str,
    db: Session = Depends(get_db),
):
    issue = get_issue_by_complaint_id(
        db,
        complaint_id,
    )

    if not issue:
        raise HTTPException(
            status_code=404,
            detail=f"Issue '{complaint_id}' not found",
        )

    return issue


@app.put(
    "/issues/{complaint_id}/status",
    response_model=IssueResponse,
)
def change_issue_status(
    complaint_id: str,
    status_update: IssueStatusUpdate,
    db: Session = Depends(get_db),
):
    issue = get_issue_by_complaint_id(
        db,
        complaint_id,
    )

    if not issue:
        raise HTTPException(
            status_code=404,
            detail=f"Issue '{complaint_id}' not found",
        )

    return update_issue_status(
        issue,
        status_update.status,
        db,
    )


@app.delete(
    "/issues/{complaint_id}",
    response_model=IssueDeleteResponse,
)
def remove_issue(
    complaint_id: str,
    db: Session = Depends(get_db),
):
    issue = get_issue_by_complaint_id(
        db,
        complaint_id,
    )

    if not issue:
        raise HTTPException(
            status_code=404,
            detail=f"Issue '{complaint_id}' not found",
        )

    delete_issue(issue, db)

    return {
        "message": f"Issue '{complaint_id}' deleted",
        "complaint_id": complaint_id,
    }


@app.get(
    "/issue-stats",
    response_model=IssueStatsResponse,
)
def issue_stats(
    db: Session = Depends(get_db),
):
    return get_issue_stats(db)


# ─── Volunteer Registration ────────────────────────────────────────
@app.post("/add-volunteer")
def add_volunteer(
    volunteer: Volunteer,
    db: Session = Depends(get_db),
):
    if db.query(VolunteerDB).filter(
        func.lower(VolunteerDB.name)
        == volunteer.name.lower()
    ).first():
        raise HTTPException(
            status_code=400,
            detail=f"Volunteer '{volunteer.name}' already exists",
        )

    if volunteer.email:
        existing_email = db.query(VolunteerDB).filter(
            func.lower(VolunteerDB.email)
            == volunteer.email.lower()
        ).first()

        if existing_email:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Email '{volunteer.email}' "
                    f"is already registered"
                ),
            )

    db.add(
        VolunteerDB(
            name=volunteer.name,
            email=volunteer.email or None,
            contact_number=(
                volunteer.contact_number or None
            ),
            password=volunteer.password or None,
            age=volunteer.age,
            designation=volunteer.designation or None,
            gender=volunteer.gender or None,
            skills=volunteer.skills or None,
            location=volunteer.location or None,
            availability=volunteer.availability or None,
            experience=volunteer.experience or None,
        )
    )

    db.commit()

    total_volunteers = db.query(
        func.count(VolunteerDB.id)
    ).scalar()

    return {
        "message": "Volunteer added",
        "total_volunteers": total_volunteers,
    }


# ─── NGO Registration ──────────────────────────────────────────────
@app.post("/add-ngo")
async def add_ngo(
    name: str = Form(...),
    email: str = Form(...),
    contact_number: str = Form(...),
    password: str = Form(...),
    category: str = Form(...),
    location: str = Form(...),
    requirement: str = Form(...),
    year_founded: Optional[int] = Form(default=None),
    website_url: Optional[str] = Form(default=None),

    registration_cert: Optional[UploadFile] = File(
        default=None
    ),
    pan_card: Optional[UploadFile] = File(
        default=None
    ),
    cert_12a: Optional[UploadFile] = File(
        default=None
    ),
    cert_80g: Optional[UploadFile] = File(
        default=None
    ),
    cert_fcra: Optional[UploadFile] = File(
        default=None
    ),

    work_images: list[UploadFile] = File(default=[]),

    db: Session = Depends(get_db),
):
    """
    Register an NGO using multipart/form-data.

    Verification documents are currently optional.
    New NGOs are created with Pending verification status.
    """

    # ── Clean text fields ──────────────────────────────────────────
    name = name.strip()
    email = email.strip()
    contact_number = contact_number.strip()
    category = category.strip()
    location = location.strip()
    requirement = requirement.strip()

    website_url = (
        website_url.strip()
        if website_url
        else None
    )

    # ── Validate required fields ───────────────────────────────────
    if not name:
        raise HTTPException(
            status_code=422,
            detail="Organization name is required",
        )

    if not email:
        raise HTTPException(
            status_code=422,
            detail="Email address is required",
        )

    if not contact_number:
        raise HTTPException(
            status_code=422,
            detail="Contact number is required",
        )

    if not password:
        raise HTTPException(
            status_code=422,
            detail="Password is required",
        )

    if not category:
        raise HTTPException(
            status_code=422,
            detail="Category is required",
        )

    if not location:
        raise HTTPException(
            status_code=422,
            detail="Location is required",
        )

    if not requirement:
        raise HTTPException(
            status_code=422,
            detail="Volunteer requirement is required",
        )

    # ── Duplicate NGO name ─────────────────────────────────────────
    existing_ngo = db.query(NGODB).filter(
        func.lower(NGODB.name)
        == name.lower()
    ).first()

    if existing_ngo:
        raise HTTPException(
            status_code=400,
            detail=f"NGO '{name}' already exists",
        )

    # ── Duplicate email ────────────────────────────────────────────
    existing_email = db.query(NGODB).filter(
        func.lower(NGODB.email)
        == email.lower()
    ).first()

    if existing_email:
        raise HTTPException(
            status_code=400,
            detail=f"Email '{email}' is already registered",
        )

    # ── Save optional verification documents ───────────────────────
    registration_certificate = await save_ngo_file(
        registration_cert,
        "Registration Certificate",
    )

    saved_pan_card = await save_ngo_file(
        pan_card,
        "PAN Card",
    )

    saved_12a = await save_ngo_file(
        cert_12a,
        "12A Certificate",
    )

    saved_80g = await save_ngo_file(
        cert_80g,
        "80G Certificate",
    )

    saved_fcra = await save_ngo_file(
        cert_fcra,
        "FCRA Certificate",
    )

    # ── Save optional NGO work images ───────────────────────────────
    if len(work_images) > MAX_IMAGES:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Maximum {MAX_IMAGES} work images are allowed."
            ),
        )

    saved_work_images: list[str] = []

    for image in work_images:
        if image.content_type not in ALLOWED_IMAGE_TYPES:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"'{image.filename}' is not a supported "
                    f"image type."
                ),
            )

        contents = await image.read()

        if len(contents) > MAX_IMAGE_SIZE:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"'{image.filename}' exceeds the "
                    f"{MAX_IMAGE_SIZE // (1024 * 1024)} MB "
                    f"size limit."
                ),
            )

        ext = Path(
            image.filename or ""
        ).suffix.lower()

        if ext not in {
            ".jpg",
            ".jpeg",
            ".png",
            ".gif",
            ".webp",
            ".bmp",
            ".tiff",
            ".tif",
        }:
            ext = ".jpg"

        safe_name = (
            f"ngo_work_{uuid.uuid4().hex}{ext}"
        )

        destination = UPLOAD_DIR / safe_name

        with open(destination, "wb") as file:
            file.write(contents)

        saved_work_images.append(safe_name)

    # ── Create NGO record ──────────────────────────────────────────
    ngo = NGODB(
        name=name,
        email=email,
        contact_number=contact_number,
        password=password,
        category=category,
        location=location,
        requirement=requirement,
        year_founded=year_founded,
        website_url=website_url,

        registration_certificate=(
            registration_certificate
        ),
        pan_card=saved_pan_card,
        cert_12a=saved_12a,
        cert_80g=saved_80g,
        cert_fcra=saved_fcra,

        work_images=(
            saved_work_images
            if saved_work_images
            else None
        ),

        verification_status="Pending",
    )

    db.add(ngo)
    db.commit()
    db.refresh(ngo)

    total_ngos = db.query(
        func.count(NGODB.id)
    ).scalar()

    return {
        "message": (
            "NGO registration submitted "
            "for verification"
        ),
        "verification_status": (
            ngo.verification_status
        ),
        "ngo_id": ngo.id,
        "total_ngos": total_ngos,
    }


# ─── Organize Event ────────────────────────────────────────────────
@app.post(
    "/organize-event/{email}",
    response_model=EventResponse,
    status_code=201,
)
def organize_event(
    email: str,
    event: EventCreate,
    db: Session = Depends(get_db),
):
    ngo = db.query(NGODB).filter(
        NGODB.email.isnot(None),
        func.lower(NGODB.email)
        == email.strip().lower(),
    ).first()

    if not ngo:
        raise HTTPException(
            status_code=404,
            detail=f"No NGO found with email '{email}'",
        )

    activity = ActivityDB(
        ngo_id=ngo.id,
        title=event.title,
        description=event.description,
        required_skills=event.required_skills,
        location=event.location,
        event_date=event.event_date,
        spots_available=event.spots_available,
    )

    db.add(activity)
    db.commit()
    db.refresh(activity)

    return activity


# ─── NGO Events ────────────────────────────────────────────────────
@app.get(
    "/ngo-events/{email}",
    response_model=NGOEventsResponse,
)
def get_ngo_events(
    email: str,
    db: Session = Depends(get_db),
):
    ngo = db.query(NGODB).filter(
        NGODB.email.isnot(None),
        func.lower(NGODB.email)
        == email.strip().lower(),
    ).first()

    if not ngo:
        raise HTTPException(
            status_code=404,
            detail=f"No NGO found with email '{email}'",
        )

    events = (
        db.query(ActivityDB)
        .filter(ActivityDB.ngo_id == ngo.id)
        .order_by(ActivityDB.created_at.desc())
        .all()
    )

    return NGOEventsResponse(
        ngo_name=ngo.name,
        total_events=len(events),
        events=events,
    )


# ─── Data Retrieval ────────────────────────────────────────────────
@app.get("/volunteers")
def get_volunteers(
    db: Session = Depends(get_db),
):
    volunteers = (
        db.query(VolunteerDB)
        .order_by(VolunteerDB.id)
        .all()
    )

    return [
        {
            "name": v.name,
            "skills": v.skills,
            "location": v.location,
            "availability": v.availability,
            "experience": v.experience,
        }
        for v in volunteers
    ]



# ─── Volunteer Dashboard ───────────────────────────────────────────
@app.get(
    "/volunteer-dashboard/{email}",
    response_model=VolunteerDashboardResponse,
)
def get_volunteer_dashboard(
    email: str,
    db: Session = Depends(get_db),
):
    volunteer = db.query(VolunteerDB).filter(
        func.lower(VolunteerDB.email)
        == email.strip().lower()
    ).first()

    if not volunteer:
        raise HTTPException(
            status_code=404,
            detail=f"No volunteer found with email '{email}'",
        )

    return volunteer


@app.get("/ngos")
def get_ngos(
    db: Session = Depends(get_db),
):
    ngos = (
        db.query(NGODB)
        .order_by(NGODB.id)
        .all()
    )

    return [
        {
            "name": n.name,
            "requirement": n.requirement,
            "category": n.category,
            "location": n.location,
            "urgency": n.urgency,
            "verification_status": (
                n.verification_status
            ),
        }
        for n in ngos
    ]



# ─── NGO Dashboard ────────────────────────────────────────────────
@app.get(
    "/ngo-dashboard/{email}",
    response_model=NGODashboardResponse,
)
def get_ngo_dashboard(
    email: str,
    db: Session = Depends(get_db),
):
    ngo = db.query(NGODB).filter(
        NGODB.email.isnot(None),
        func.lower(NGODB.email)
        == email.strip().lower(),
    ).first()

    if not ngo:
        raise HTTPException(
            status_code=404,
            detail=f"No NGO found with email '{email}'",
        )

    return ngo


# ─── Delete Volunteer ──────────────────────────────────────────────
@app.delete("/delete-volunteer/{name}")
def delete_volunteer(
    name: str,
    db: Session = Depends(get_db),
):
    volunteer = db.query(VolunteerDB).filter(
        func.lower(VolunteerDB.name)
        == name.lower()
    ).first()

    if not volunteer:
        raise HTTPException(
            status_code=404,
            detail=f"Volunteer '{name}' not found",
        )

    db.delete(volunteer)
    db.commit()

    remaining = db.query(
        func.count(VolunteerDB.id)
    ).scalar()

    return {
        "message": f"Volunteer '{name}' deleted",
        "remaining": remaining,
    }


# ─── Delete NGO ────────────────────────────────────────────────────
@app.delete("/delete-ngo/{name}")
def delete_ngo(
    name: str,
    db: Session = Depends(get_db),
):
    ngo = db.query(NGODB).filter(
        func.lower(NGODB.name)
        == name.lower()
    ).first()

    if not ngo:
        raise HTTPException(
            status_code=404,
            detail=f"NGO '{name}' not found",
        )

    db.delete(ngo)
    db.commit()

    remaining = db.query(
        func.count(NGODB.id)
    ).scalar()

    return {
        "message": f"NGO '{name}' deleted",
        "remaining": remaining,
    }


# ─── Volunteer ↔ Activity Matching ─────────────────────────────────
@app.get(
    "/volunteer-matches/{email}",
    response_model=VolunteerMatchesResponse,
)
def get_volunteer_matches(
    email: str,
    db: Session = Depends(get_db),
):
    volunteer = db.query(VolunteerDB).filter(
        func.lower(VolunteerDB.email)
        == email.strip().lower()
    ).first()

    if not volunteer:
        raise HTTPException(
            status_code=404,
            detail=f"No volunteer found with email '{email}'",
        )

    if not volunteer.skills:
        return VolunteerMatchesResponse(
            volunteer_name=volunteer.name,
            matches=[],
        )

    # NGOs with Approved/Pending status that have at least one activity.
    ngos_with_events = (
        db.query(NGODB)
        .filter(
            NGODB.verification_status.in_(
                ["Approved", "Pending"]
            )
        )
        .join(
            ActivityDB,
            ActivityDB.ngo_id == NGODB.id,
        )
        .distinct()
        .all()
    )

    if not ngos_with_events:
        return VolunteerMatchesResponse(
            volunteer_name=volunteer.name,
            matches=[],
        )

    # For each NGO, get the most recently created event.
    ngo_latest_events = []

    for ngo in ngos_with_events:
        latest_event = (
            db.query(ActivityDB)
            .filter(ActivityDB.ngo_id == ngo.id)
            .order_by(
                ActivityDB.created_at.desc()
            )
            .first()
        )

        if latest_event:
            ngo_latest_events.append(
                (ngo, latest_event)
            )

    if not ngo_latest_events:
        return VolunteerMatchesResponse(
            volunteer_name=volunteer.name,
            matches=[],
        )

    # Compute cosine similarity between volunteer skills
    # and each event's required_skills.
    event_texts = [
        ev.required_skills
        for _, ev in ngo_latest_events
    ]

    vol_embedding = model.encode(
        [volunteer.skills]
    )

    event_embeddings = model.encode(
        event_texts
    )

    scores = cosine_similarity(
        vol_embedding,
        event_embeddings,
    )[0]

    matches = []

    for idx, (ngo, event) in enumerate(
        ngo_latest_events
    ):
        score = float(scores[idx])

        matches.append(
            VolunteerMatchEntry(
                ngo_name=ngo.name,
                ngo_category=ngo.category,
                ngo_location=ngo.location,
                event_title=event.title,
                match_percentage=round(
                    score * 100, 1
                ),
            )
        )

    matches.sort(
        key=lambda m: m.match_percentage or 0,
        reverse=True,
    )

    return VolunteerMatchesResponse(
        volunteer_name=volunteer.name,
        matches=matches,
    )


# ─── Volunteer ↔ NGO Matching ─────────────────────────────────────
@app.get("/match")
def match_volunteers(
    category: Optional[str] = Query(
        None,
        description="Filter by NGO category",
    ),
    min_score: Optional[float] = Query(
        None,
        ge=0,
        le=1,
        description="Minimum match score",
    ),
    top_n: Optional[int] = Query(
        3,
        ge=1,
        le=10,
        description="Number of top matches per volunteer",
    ),
    sort_by: Optional[str] = Query(
        "score",
        description="Sort by: score, name",
    ),
    db: Session = Depends(get_db),
):
    volunteers = (
        db.query(VolunteerDB)
        .filter(VolunteerDB.skills.isnot(None))
        .filter(VolunteerDB.skills != "")
        .order_by(VolunteerDB.id)
        .all()
    )

    # Only approved NGOs participate in matching.
    ngos = (
        db.query(NGODB)
        .filter(
            NGODB.verification_status.in_(
                ["Approved", "Pending"]
            )
        )
        .order_by(NGODB.id)
        .all()
    )

    if not volunteers or not ngos:
        return {
            "message": "Add volunteers and NGOs first",
            "matches": [],
        }

    # Filter NGOs by category.
    filtered_ngos = ngos

    if category:
        filtered_ngos = [
            n
            for n in ngos
            if n.category
            and n.category.lower()
            == category.lower()
        ]

        if not filtered_ngos:
            return {
                "message": (
                    f"No NGOs found in category "
                    f"'{category}'"
                ),
                "matches": [],
            }

    volunteer_texts = [
        v.skills
        for v in volunteers
    ]

    ngo_texts = [
        n.requirement or ""
        for n in filtered_ngos
    ]

    vol_embeddings = model.encode(
        volunteer_texts
    )

    ngo_embeddings = model.encode(
        ngo_texts
    )

    similarity_matrix = cosine_similarity(
        vol_embeddings,
        ngo_embeddings,
    )

    # Apply category boost.
    for i, volunteer in enumerate(volunteers):
        for j, ngo in enumerate(filtered_ngos):
            boost = compute_category_boost(
                volunteer.skills or "",
                ngo.category or "",
            )

            similarity_matrix[i][j] = min(
                similarity_matrix[i][j] + boost,
                1.0,
            )

    results = []

    for i, volunteer in enumerate(volunteers):
        scores = similarity_matrix[i]

        top_indices = np.argsort(scores)[::-1][:top_n]

        volunteer_matches = []

        for idx in top_indices:
            score = float(scores[idx])

            if (
                min_score is not None
                and score < min_score
            ):
                continue

            matched_ngo = filtered_ngos[idx]

            volunteer_matches.append(
                {
                    "ngo": matched_ngo.name,
                    "ngo_category": (
                        matched_ngo.category
                        or "Uncategorized"
                    ),
                    "ngo_requirement": (
                        matched_ngo.requirement
                    ),
                    "score": round(score, 4),
                    "percentage": round(
                        score * 100,
                        1,
                    ),
                    "confidence": classify_confidence(
                        score
                    ),
                }
            )

        if volunteer_matches:
            results.append(
                {
                    "volunteer": volunteer.name,
                    "volunteer_skills": (
                        volunteer.skills
                    ),
                    "volunteer_location": (
                        volunteer.location or ""
                    ),
                    "matches": volunteer_matches,
                    "best_score": (
                        volunteer_matches[0]["score"]
                    ),
                    "best_match": (
                        volunteer_matches[0]["ngo"]
                    ),
                }
            )

    if sort_by == "score":
        results.sort(
            key=lambda x: x["best_score"],
            reverse=True,
        )

    elif sort_by == "name":
        results.sort(
            key=lambda x: x["volunteer"]
        )

    return {
        "matches": results,
        "total_volunteers": len(volunteers),
        "total_ngos": len(filtered_ngos),
        "total_matches": len(results),
    }


# ─── Platform Stats ────────────────────────────────────────────────
@app.get("/stats")
def get_stats(
    db: Session = Depends(get_db),
):
    """Return platform statistics."""

    volunteers = (
        db.query(VolunteerDB)
        .order_by(VolunteerDB.id)
        .all()
    )

    ngos = (
        db.query(NGODB)
        .order_by(NGODB.id)
        .all()
    )

    category_counts = {}

    for ngo in ngos:
        category = (
            ngo.category
            or "Uncategorized"
        )

        category_counts[category] = (
            category_counts.get(category, 0) + 1
        )

    return {
        "total_volunteers": len(volunteers),
        "total_ngos": len(ngos),
        "categories": category_counts,
        "category_list": list(
            CATEGORY_KEYWORDS.keys()
        ),
    }