from datetime import date, datetime
from typing import Annotated

from pydantic import BaseModel, Field, StringConstraints


class MeterReadingBase(BaseModel):
    reading_date: date
    reading_value: float = Field(ge=0)
    cost_per_unit: float = Field(ge=0)


class MeterReadingCreate(MeterReadingBase):
    pass


class MeterReadingUpdate(MeterReadingBase):
    pass


class MeterReadingRead(BaseModel):
    id: int
    reading_date: date
    reading_value: float
    units_consumed: float
    cost_per_unit: float
    amount: float
    created_at: datetime

    model_config = {"from_attributes": True}


class OcrReadingResponse(BaseModel):
    reading_value: float
    extracted_text: str


class UserCreate(BaseModel):
    username: Annotated[str, StringConstraints(min_length=3, max_length=100)]
    password: Annotated[str, StringConstraints(min_length=6, max_length=128)]


class UserRead(BaseModel):
    id: int
    username: str
    created_at: datetime

    model_config = {"from_attributes": True}


class Token(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshTokenRequest(BaseModel):
    refresh_token: str
