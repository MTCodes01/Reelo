import os
import uuid
import asyncio
import yt_dlp
import re
from pathlib import Path
from typing import Dict, Optional
import logging

from .models import FormatType, VideoInfo, JobStatus

logger = logging.getLogger(__name__)

# Job storage (in production, use Redis or a database)
jobs: Dict[str, JobStatus] = {}


def normalize_youtube_url(url: str) -> str:
    """
    Convert YouTube Shorts URLs to standard watch URLs.
    Example: youtube.com/shorts/Ir02lSLUmSQ -> youtube.com/watch?v=Ir02lSLUmSQ
    """
    shorts_pattern = r'(?:youtube\.com/shorts/)([^&\s?]+)'
    match = re.search(shorts_pattern, url)
    
    if match:
        video_id = match.group(1)
        # Preserve protocol if present
        if url.startswith('http://') or url.startswith('https://'):
            protocol = url.split('://')[0] + '://'
        else:
            protocol = 'https://'
        return f"{protocol}www.youtube.com/watch?v={video_id}"
    
    return url


class VideoConverter:
    """Handles video downloading and conversion using yt-dlp"""
    
    def __init__(self, download_dir: str = "./downloads"):
        self.download_dir = Path(download_dir)
        self.download_dir.mkdir(exist_ok=True)
    
    def get_video_info(self, url: str) -> VideoInfo:
        """Fetch video metadata without downloading"""
        # Normalize YouTube Shorts URLs
        url = normalize_youtube_url(url)
        
        ydl_opts = {
            'quiet': True,
            'no_warnings': True,
            'extract_flat': False,
        }
        
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=False)
                
                return VideoInfo(
                    title=info.get('title', 'Unknown'),
                    channel=info.get('uploader', 'Unknown'),
                    duration=int(info.get('duration', 0) or 0),
                    thumbnail=info.get('thumbnail', ''),
                    video_id=info.get('id', '')
                )
        except Exception as e:
            logger.error(f"Error fetching video info: {e}")
            raise ValueError(f"Failed to fetch video info: {str(e)}")
    
    def _get_format_options(self, format_type: FormatType, url: str) -> dict:
        """Get yt-dlp options based on format type and domain"""
        base_opts = {
            'quiet': False,
            'no_warnings': False,
            # Add resolution suffix to filename to avoid overwriting different qualities
            'outtmpl': str(self.download_dir / f'%(id)s_{format_type.value}.%(ext)s'),
            'force_ipv4': True,  # Force IPv4 to avoid 403 errors on some networks
        }
        
        is_youtube = "youtube.com" in url or "youtu.be" in url
        
        if format_type in [FormatType.MP3, FormatType.MP3_48, FormatType.MP3_64, FormatType.MP3_128, FormatType.MP3_240, FormatType.MP3_320]:
            # Determine bitrate based on format type
            bitrate = '192'  # Default
            if format_type == FormatType.MP3_48: bitrate = '48'
            elif format_type == FormatType.MP3_64: bitrate = '64'
            elif format_type == FormatType.MP3_128: bitrate = '128'
            elif format_type == FormatType.MP3_240: bitrate = '240'  # User requested 240, ffmpeg supports arbitrary
            elif format_type == FormatType.MP3_320: bitrate = '320'
            
            return {
                **base_opts,
                'format': 'bestaudio/best',
                'postprocessors': [{
                    'key': 'FFmpegExtractAudio',
                    'preferredcodec': 'mp3',
                    'preferredquality': bitrate,
                }],
            }
        
        # Video formats
        if is_youtube:
            # Strict format selection for YouTube to ensure correct resolution
            if format_type == FormatType.MP4_360:
                fmt = 'bestvideo[height<=360]+bestaudio/best[height<=360]/best'
            elif format_type == FormatType.MP4_720:
                fmt = 'bestvideo[height<=720]+bestaudio/best[height<=720]/best'
            elif format_type == FormatType.MP4_1080:
                fmt = 'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best'
            elif format_type == FormatType.MP4_1440:
                fmt = 'bestvideo[height<=1440]+bestaudio/best[height<=1440]/best'
            elif format_type == FormatType.MP4_2160:
                fmt = 'bestvideo[height<=2160]+bestaudio/best[height<=2160]/best'
            else:
                fmt = 'bestvideo+bestaudio/best'
        else:
            # Loose format selection for Instagram/others (fallback to best available)
            if format_type == FormatType.MP4_360:
                fmt = 'bestvideo[height<=360]+bestaudio/best[height<=360]/best'
            elif format_type == FormatType.MP4_720:
                fmt = 'bestvideo[height<=720]+bestaudio/best[height<=720]/best'
            elif format_type == FormatType.MP4_1080:
                fmt = 'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best'
            elif format_type == FormatType.MP4_1440:
                fmt = 'bestvideo[height<=1440]+bestaudio/best[height<=1440]/best'
            elif format_type == FormatType.MP4_2160:
                fmt = 'bestvideo[height<=2160]+bestaudio/best[height<=2160]/best'
            else:
                fmt = 'best'
                
        return {
            **base_opts,
            'format': fmt,
            'merge_output_format': 'mp4',
        }
    
    async def convert_video(self, job_id: str, url: str, format_type: FormatType):
        """Download and convert video asynchronously"""
        try:
            # Normalize YouTube Shorts URLs
            url = normalize_youtube_url(url)
            
            # Get video info first
            video_info = self.get_video_info(url)
            jobs[job_id].video_title = video_info.title
            jobs[job_id].format = format_type.value
            
            # Update job status
            jobs[job_id].status = "processing"
            jobs[job_id].message = "Starting download..."
            jobs[job_id].progress = 10
            
            ydl_opts = self._get_format_options(format_type, url)
            
            # Progress hook
            def progress_hook(d):
                if d['status'] == 'downloading':
                    try:
                        percent = d.get('_percent_str', '0%').strip('%')
                        jobs[job_id].progress = min(int(float(percent) * 0.8), 80)
                        jobs[job_id].message = f"Downloading... {percent}%"
                    except:
                        pass
                elif d['status'] == 'finished':
                    jobs[job_id].progress = 85
                    jobs[job_id].message = "Processing..."
            
            ydl_opts['progress_hooks'] = [progress_hook]
            
            # Run download in thread pool to avoid blocking
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, self._download_video, url, ydl_opts)
            
            # Find the downloaded file with correct extension and format suffix
            expected_ext = '.mp3' if 'mp3' in format_type.value else '.mp4'
            file_path = self._find_downloaded_file(video_info.video_id, format_type.value, expected_ext)
            
            if not file_path:
                raise Exception("Downloaded file not found")
            
            # Update job with completion
            jobs[job_id].status = "completed"
            jobs[job_id].progress = 100
            jobs[job_id].message = "Conversion complete!"
            jobs[job_id].file_path = str(file_path)
            
            logger.info(f"Job {job_id} completed successfully")
            
        except Exception as e:
            logger.error(f"Job {job_id} failed: {e}")
            jobs[job_id].status = "failed"
            jobs[job_id].error = str(e)
    
    def _download_video(self, url: str, ydl_opts: dict):
        """Synchronous download function"""
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
    
    def _find_downloaded_file(self, video_id: str, format_suffix: str, expected_ext: str = None) -> Optional[Path]:
        """Find the downloaded file by video ID and format suffix"""
        # Look for files matching the specific format pattern
        # Pattern: {video_id}_{format_suffix}.{ext}
        pattern = f"{video_id}_{format_suffix}.*"
        
        for file in self.download_dir.glob(pattern):
            if file.is_file():
                # If expected extension is specified, only return matching files
                if expected_ext is None or file.suffix == expected_ext:
                    return file
        return None
    
    def get_file_path(self, job_id: str) -> Optional[Path]:
        """Get the file path for a completed job"""
        job = jobs.get(job_id)
        if job and job.status == "completed" and hasattr(job, 'file_path'):
            return Path(job.file_path)
        return None


# Global converter instance
converter = VideoConverter()


def create_job(url: str, format_type: FormatType) -> str:
    """Create a new conversion job"""
    job_id = str(uuid.uuid4())
    jobs[job_id] = JobStatus(
        job_id=job_id,
        status="pending",
        progress=0,
        message="Job created",
        format=format_type.value
    )
    return job_id


def get_job_status(job_id: str) -> Optional[JobStatus]:
    """Get the status of a job"""
    return jobs.get(job_id)
