import os
import uuid
import asyncio
import yt_dlp
import re
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Dict, Optional
from datetime import datetime
import logging

from .models import FormatType, VideoInfo, JobStatus

logger = logging.getLogger(__name__)

# Job storage (in production, use Redis or a database)
jobs: Dict[str, JobStatus] = {}

# ── Bounded thread pool ────────────────────────────────────────────────────────
# Limits concurrent yt-dlp / ffmpeg processes so the container doesn't OOM when
# multiple users hit the API simultaneously.  2 workers = 2 concurrent downloads.
_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="yt-dlp")


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

    async def get_video_info(self, url: str) -> VideoInfo:
        """Fetch video metadata without downloading"""
        # Normalize YouTube Shorts URLs
        url = normalize_youtube_url(url)

        ydl_opts = {
            'quiet': True,
            'no_warnings': True,
            'extract_flat': False,
            # Don't load/parse format list — we only need basic metadata
            'skip_download': True,
        }

        def _fetch():
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                return ydl.extract_info(url, download=False)

        try:
            loop = asyncio.get_running_loop()
            info = await loop.run_in_executor(_executor, _fetch)

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

    def _get_format_options(self, format_type: FormatType, url: str, website_url: str = "http://localhost:7654") -> dict:
        """Get yt-dlp options based on format type and domain"""
        base_opts = {
            # ── Output verbosity ───────────────────────────────────────────
            # Keep quiet=True so yt-dlp doesn't buffer large log strings in
            # memory. Progress is delivered via the progress_hook instead.
            'quiet': True,
            'no_warnings': True,

            # ── Output path ────────────────────────────────────────────────
            'outtmpl': str(self.download_dir / f'%(title)s [{format_type.value}].%(ext)s'),

            # ── Network / anti-403 ─────────────────────────────────────────
            'force_ipv4': True,
            'nocheckcertificate': True,
            'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'referer': 'https://www.youtube.com/',
            'extractor_retries': 3,
            'fragment_retries': 10,
            'skip_unavailable_fragments': True,
            'geo_bypass': True,
            'geo_bypass_country': 'US',
            'socket_timeout': 30,
            'http_headers': {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-us,en;q=0.5',
                'Sec-Fetch-Mode': 'navigate',
            },

            # ── Resource limits ────────────────────────────────────────────
            # Download one fragment at a time — reduces peak memory usage
            # significantly for DASH/HLS streams (e.g. long YouTube videos).
            'concurrent_fragment_downloads': 1,
            # Keep the in-memory download buffer small so data is flushed to
            # disk continuously rather than accumulated in RAM.  Without this,
            # a 3+ hour video can push memory up by hundreds of MB purely from
            # buffered network reads.
            'buffersize': 16 * 1024,       # 16 KB write-to-disk buffer
            'http_chunk_size': 10 * 1024 * 1024,  # fetch in 10 MB HTTP chunks

            # ── Metadata ───────────────────────────────────────────────────
            'add_metadata': True,
            'postprocessor_args': {
                'ffmpeg': ['-metadata', f'comment={website_url}']
            },
        }

        is_youtube = "youtube.com" in url or "youtu.be" in url

        if format_type in [FormatType.MP3, FormatType.MP3_48, FormatType.MP3_64,
                           FormatType.MP3_128, FormatType.MP3_240, FormatType.MP3_320]:
            # Determine bitrate based on format type
            bitrate_map = {
                FormatType.MP3_48: '48',
                FormatType.MP3_64: '64',
                FormatType.MP3_128: '128',
                FormatType.MP3_240: '240',
                FormatType.MP3_320: '320',
            }
            bitrate = bitrate_map.get(format_type, '192')

            return {
                **base_opts,
                'format': 'bestaudio/best',
                # writethumbnail saves a separate image file which yt-dlp
                # embeds as album art then leaves on disk.  We enable it but
                # add EmbedThumbnail so yt-dlp cleans it up automatically.
                'writethumbnail': True,
                'postprocessors': [
                    {
                        'key': 'FFmpegExtractAudio',
                        'preferredcodec': 'mp3',
                        'preferredquality': bitrate,
                    },
                    {
                        'key': 'FFmpegMetadata',
                        'add_metadata': True,
                    },
                    {
                        # EmbedThumbnail removes the standalone image file
                        # after embedding it — no orphan .webp/.jpg left behind.
                        'key': 'EmbedThumbnail',
                        'already_have_thumbnail': False,
                    },
                ],
            }

        # ── Video formats ──────────────────────────────────────────────────
        height_map = {
            FormatType.MP4_360: 360,
            FormatType.MP4_720: 720,
            FormatType.MP4_1080: 1080,
            FormatType.MP4_1440: 1440,
            FormatType.MP4_2160: 2160,
        }
        h = height_map.get(format_type)

        if h:
            fmt = f'bestvideo[height<={h}]+bestaudio/best[height<={h}]/best'
        else:
            fmt = 'bestvideo+bestaudio/best' if is_youtube else 'best'

        return {
            **base_opts,
            'format': fmt,
            'merge_output_format': 'mp4',
            'writethumbnail': True,
            'postprocessors': [
                {
                    'key': 'FFmpegMetadata',
                    'add_metadata': True,
                },
                {
                    # Cleans up the standalone thumbnail file after embedding.
                    'key': 'EmbedThumbnail',
                    'already_have_thumbnail': False,
                },
            ],
        }

    async def convert_video(
        self,
        job_id: str,
        url: str,
        format_type: FormatType,
        website_url: str = "http://localhost:7654",
        prefetched_info: Optional["VideoInfo"] = None,
    ):
        """Download and convert video asynchronously.

        Pass *prefetched_info* to skip a redundant yt-dlp metadata call when
        the caller already validated the URL.
        """
        try:
            # Normalize YouTube Shorts URLs
            url = normalize_youtube_url(url)

            # Re-use already-fetched info when available to avoid a second
            # network round-trip.
            video_info = prefetched_info or await self.get_video_info(url)
            jobs[job_id].video_title = video_info.title
            jobs[job_id].format = format_type.value

            # Update job status
            jobs[job_id].status = "processing"
            jobs[job_id].message = "Starting download..."
            jobs[job_id].progress = 10

            ydl_opts = self._get_format_options(format_type, url, website_url)

            # Progress hook — runs inside the worker thread, so only mutate
            # simple Python objects (no async calls here).
            def progress_hook(d):
                if d['status'] == 'downloading':
                    try:
                        percent_str = d.get('_percent_str', '0%').strip().rstrip('%')
                        jobs[job_id].progress = min(int(float(percent_str) * 0.8), 80)
                        jobs[job_id].message = f"Downloading... {percent_str}%"
                    except Exception:
                        pass
                elif d['status'] == 'finished':
                    jobs[job_id].progress = 85
                    jobs[job_id].message = "Processing..."

            ydl_opts['progress_hooks'] = [progress_hook]

            # Run the blocking download/ffmpeg work in the bounded thread pool
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(_executor, self._download_video, url, ydl_opts)

            # Find the downloaded file with correct extension and format suffix
            expected_ext = '.mp3' if 'mp3' in format_type.value else '.mp4'
            file_path = self._find_downloaded_file(video_info.title, format_type.value, expected_ext)

            if not file_path:
                raise Exception("Downloaded file not found")

            # Clean up any leftover thumbnail files for this video title
            self._cleanup_thumbnails(video_info.title, format_type.value)

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
        """Synchronous download function — runs inside the thread pool."""
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])

    def _cleanup_thumbnails(self, title: str, format_suffix: str):
        """Delete any leftover thumbnail image files for this video.

        yt-dlp should remove them via EmbedThumbnail, but if ffmpeg fails to
        embed (e.g. missing AtomicParsley) the .webp / .jpg file stays behind.
        """
        if not self.download_dir.exists():
            return
        stem_prefix = f"{title} [{format_suffix}]"
        for ext in ('.webp', '.jpg', '.jpeg', '.png'):
            candidate = self.download_dir / f"{stem_prefix}{ext}"
            if candidate.exists():
                try:
                    candidate.unlink()
                    logger.debug(f"Removed leftover thumbnail: {candidate.name}")
                except Exception as e:
                    logger.warning(f"Could not remove thumbnail {candidate}: {e}")

    def _find_downloaded_file(self, title: str, format_suffix: str, expected_ext: str = None) -> Optional[Path]:
        """Find the downloaded file by video title and format suffix"""
        matching_files = []
        for file in self.download_dir.iterdir():
            if file.is_file():
                if f"[{format_suffix}]" in file.name:
                    if expected_ext is None or file.suffix == expected_ext:
                        matching_files.append(file)

        if matching_files:
            most_recent = max(matching_files, key=lambda f: f.stat().st_mtime)
            logger.info(f"Found downloaded file: {most_recent.name}")
            return most_recent

        logger.warning(f"No file found with format suffix [{format_suffix}] and extension {expected_ext}")
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
        format=format_type.value,
        created_at=datetime.utcnow().isoformat(),
    )
    return job_id


def get_job_status(job_id: str) -> Optional[JobStatus]:
    """Get the status of a job"""
    return jobs.get(job_id)
