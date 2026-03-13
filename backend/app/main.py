import os
from typing import List

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile, status
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .auth import (
    create_access_token,
    create_refresh_token,
    decode_token,
    get_current_user,
    get_password_hash,
    verify_password,
)
from .database import Base, engine, get_db
from .models import MeterReading, User
from .ocr_utils import extract_reading_from_image_bytes
from .schemas import (
    MeterReadingCreate,
    MeterReadingRead,
    MeterReadingUpdate,
    OcrReadingResponse,
    RefreshTokenRequest,
    Token,
    UserCreate,
    UserRead,
)

app = FastAPI(
    title="Smart Electricity Meter Expense Tracker API",
    version="0.1.0",
)

default_origins = "http://localhost:5173,http://127.0.0.1:5173"
cors_origins = os.getenv("CORS_ALLOWED_ORIGINS", default_origins)
allow_origins = [origin.strip() for origin in cors_origins.split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    Base.metadata.create_all(bind=engine)
    # Lightweight SQLite migration for existing local DBs.
    with engine.begin() as conn:
        columns = conn.execute(text("PRAGMA table_info(meter_readings)")).fetchall()
        column_names = {column[1] for column in columns}
        if "user_id" not in column_names:
            conn.execute(text("ALTER TABLE meter_readings ADD COLUMN user_id INTEGER"))


@app.get("/")
def root():
    return {"message": "Smart Electricity Meter Expense Tracker API is running."}


@app.post("/auth/register", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def register_user(payload: UserCreate, db: Session = Depends(get_db)):
    existing_user = db.scalar(select(User).where(User.username == payload.username))
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already exists.",
        )

    user = User(
        username=payload.username,
        hashed_password=get_password_hash(payload.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@app.post("/auth/login", response_model=Token)
def login_user(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    user = db.scalar(select(User).where(User.username == form_data.username))
    if user is None or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    access_token = create_access_token(subject=user.username)
    refresh_token = create_refresh_token(subject=user.username)
    return Token(access_token=access_token, refresh_token=refresh_token)


@app.post("/auth/refresh", response_model=Token)
def refresh_access_token(payload: RefreshTokenRequest):
    username = decode_token(payload.refresh_token, expected_type="refresh")
    access_token = create_access_token(subject=username)
    refresh_token = create_refresh_token(subject=username)
    return Token(access_token=access_token, refresh_token=refresh_token)


def claim_legacy_readings(db: Session, user_id: int) -> None:
    # Existing rows created before auth rollout may have NULL user_id.
    db.execute(
        update(MeterReading).where(MeterReading.user_id.is_(None)).values(user_id=user_id)
    )


@app.get("/meter-readings", response_model=List[MeterReadingRead])
def list_meter_readings(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    claim_legacy_readings(db, current_user.id)
    db.commit()

    query = (
        select(MeterReading)
        .where(MeterReading.user_id == current_user.id)
        .order_by(MeterReading.reading_date.desc(), MeterReading.id.desc())
        .offset(skip)
        .limit(limit)
    )
    return db.scalars(query).all()


def recompute_readings(db: Session, user_id: int) -> None:
    ordered_readings = db.scalars(
        select(MeterReading)
        .where(MeterReading.user_id == user_id)
        .order_by(MeterReading.reading_date.asc(), MeterReading.id.asc())
    ).all()

    previous_value = None
    for item in ordered_readings:
        if previous_value is None:
            item.units_consumed = 0.0
        else:
            units_consumed = item.reading_value - previous_value
            if units_consumed < 0:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=(
                        f"Reading on {item.reading_date} cannot be less than the previous "
                        "reading value."
                    ),
                )
            item.units_consumed = units_consumed

        item.amount = item.units_consumed * item.cost_per_unit
        previous_value = item.reading_value


@app.post(
    "/meter-readings",
    response_model=MeterReadingRead,
    status_code=status.HTTP_201_CREATED,
)
def create_meter_reading(
    payload: MeterReadingCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    claim_legacy_readings(db, current_user.id)

    existing_same_date = db.scalar(
        select(MeterReading).where(
            MeterReading.reading_date == payload.reading_date,
            MeterReading.user_id == current_user.id,
        )
    )
    if existing_same_date:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A meter reading for this date already exists.",
        )

    meter_reading = MeterReading(
        user_id=current_user.id,
        reading_date=payload.reading_date,
        reading_value=payload.reading_value,
        units_consumed=0.0,
        cost_per_unit=payload.cost_per_unit,
        amount=0.0,
    )
    db.add(meter_reading)

    try:
        db.flush()
        recompute_readings(db, current_user.id)
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unable to create meter reading.",
        ) from exc

    db.refresh(meter_reading)
    return meter_reading


@app.put("/meter-readings/{reading_id}", response_model=MeterReadingRead)
def update_meter_reading(
    reading_id: int,
    payload: MeterReadingUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    claim_legacy_readings(db, current_user.id)

    meter_reading = db.scalar(
        select(MeterReading).where(
            MeterReading.id == reading_id,
            MeterReading.user_id == current_user.id,
        )
    )
    if meter_reading is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Meter reading not found.",
        )

    duplicate_date = db.scalar(
        select(MeterReading).where(
            MeterReading.reading_date == payload.reading_date,
            MeterReading.id != reading_id,
            MeterReading.user_id == current_user.id,
        )
    )
    if duplicate_date:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A meter reading for this date already exists.",
        )

    meter_reading.reading_date = payload.reading_date
    meter_reading.reading_value = payload.reading_value
    meter_reading.cost_per_unit = payload.cost_per_unit

    try:
        db.flush()
        recompute_readings(db, current_user.id)
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unable to update meter reading.",
        ) from exc

    db.refresh(meter_reading)
    return meter_reading


@app.delete("/meter-readings/{reading_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_meter_reading(
    reading_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    claim_legacy_readings(db, current_user.id)

    meter_reading = db.scalar(
        select(MeterReading).where(
            MeterReading.id == reading_id,
            MeterReading.user_id == current_user.id,
        )
    )
    if meter_reading is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Meter reading not found.",
        )

    db.delete(meter_reading)
    try:
        db.flush()
        recompute_readings(db, current_user.id)
        db.commit()
    except HTTPException:
        db.rollback()
        raise


@app.post("/ocr/extract-reading", response_model=OcrReadingResponse)
async def extract_reading_from_image(
    file: UploadFile = File(...),
    _: User = Depends(get_current_user),
):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file must be an image.",
        )

    image_bytes = await file.read()
    if not image_bytes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is empty.",
        )

    try:
        reading_value, extracted_text = extract_reading_from_image_bytes(image_bytes)
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc

    return OcrReadingResponse(reading_value=reading_value, extracted_text=extracted_text)
