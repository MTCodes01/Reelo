from fastapi import APIRouter, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse
import logging

from .models import ConvertRequest, VideoInfo, JobStatus, ConversionResponse, ErrorResponse
from .converter import converter, create_job, get_job_status

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["converter"])


@router.get("/info", response_model=VideoInfo)
async def get_video_info(url: str):
    """
    Get video metadata without downloading
    
    - **url**: YouTube video URL
    """
    try:
        info = converter.get_video_info(url)
        return info
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error getting video info: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch video information")


@router.post("/convert", response_model=ConversionResponse)
async def convert_video(request: ConvertRequest, background_tasks: BackgroundTasks):
    """
    Start video conversion
    
    - **url**: YouTube video URL
    - **format**: Output format (mp3, mp4-360, mp4-720, mp4-1080)
    """
    try:
        # Validate URL by fetching info
        converter.get_video_info(request.url)
        
        # Create job
        job_id = create_job(request.url, request.format)
        
        # Start conversion in background
        background_tasks.add_task(
            converter.convert_video,
            job_id,
            request.url,
            request.format
        )
        
        logger.info(f"Started conversion job {job_id} for format {request.format}")
        
        return ConversionResponse(job_id=job_id)
    
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error starting conversion: {e}")
        raise HTTPException(status_code=500, detail="Failed to start conversion")


@router.get("/status/{job_id}", response_model=JobStatus)
async def get_status(job_id: str):
    """
    Get conversion job status
    
    - **job_id**: Job identifier returned from /convert
    """
    job = get_job_status(job_id)
    
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    return job


@router.get("/download/{job_id}")
async def download_file(job_id: str):
    """
    Download converted file
    
    - **job_id**: Job identifier returned from /convert
    """
    import re
    
    job = get_job_status(job_id)
    
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    if job.status != "completed":
        raise HTTPException(status_code=400, detail=f"Job is not completed (status: {job.status})")
    
    file_path = converter.get_file_path(job_id)
    
    if not file_path or not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    
    # Determine media type and create a better filename
    extension = file_path.suffix
    media_type = "audio/mpeg" if extension == ".mp3" else "video/mp4"
    
    # Create a better filename using video title if available
    if job.video_title:
        # Sanitize the title for filename (remove invalid characters)
        safe_title = re.sub(r'[<>:"/\\|?*]', '', job.video_title)
        safe_title = safe_title.strip()[:100]  # Limit length
        download_filename = f"{safe_title}{extension}"
    else:
        download_filename = file_path.name
    
    return FileResponse(
        path=str(file_path),
        media_type=media_type,
        filename=download_filename,
        headers={
            "Content-Disposition": f'attachment; filename="{download_filename}"'
        }
    )

