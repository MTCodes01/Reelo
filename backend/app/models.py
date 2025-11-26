from pydantic import BaseModel, Field, HttpUrl
from typing import Optional
from enum import Enum


class FormatType(str, Enum):
    """Supported conversion formats"""
    MP3 = "mp3"
    MP4_360 = "mp4-360"
    MP4_720 = "mp4-720"
    MP4_1080 = "mp4-1080"


class ConvertRequest(BaseModel):
    """Request model for video conversion"""
    url: str = Field(..., description="YouTube video URL")
    format: FormatType = Field(..., description="Output format")

    class Config:
        json_schema_extra = {
            "example": {
                "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
                "format": "mp3"
            }
        }


class VideoInfo(BaseModel):
    """Video metadata response"""
    title: str
    channel: str
    duration: int  # in seconds
    thumbnail: str
    video_id: str


class JobStatus(BaseModel):
    """Conversion job status"""
    job_id: str
    status: str  # 'pending', 'processing', 'completed', 'failed'
    progress: int = 0  # 0-100
    message: Optional[str] = None
    error: Optional[str] = None
    file_path: Optional[str] = None  # Path to downloaded file when completed
    video_title: Optional[str] = None  # Video title for better filename
    format: Optional[str] = None  # Requested format (mp3, mp4-360, etc.)


class ConversionResponse(BaseModel):
    """Response after starting conversion"""
    job_id: str
    message: str = "Conversion started"


class ErrorResponse(BaseModel):
    """Error response model"""
    detail: str
    error_code: Optional[str] = None
