import os
import random
import gc
import uuid
import asyncio
import ctypes
import yt_dlp
import re
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Dict, Optional
from datetime import datetime
import logging

from .models import FormatType, VideoInfo, JobStatus

logger = logging.getLogger(__name__)


def _release_memory():
    """Force Python to release unused heap memory back to the OS.

    Python's allocator (pymalloc) keeps freed objects in an internal pool
    and never returns them to the OS on its own.  After a large job:
      1. gc.collect() — frees any reference-cycle garbage
      2. malloc_trim(0) — tells glibc to return the now-empty pages to the OS
    This is Linux-only (no-op on other platforms) and safe to call anytime.
    """
    gc.collect()
    try:
        ctypes.CDLL('libc.so.6').malloc_trim(0)
    except Exception:
        pass  # Non-Linux (Windows/macOS dev machines) — silently skip

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


def _is_instagram(url: str) -> bool:
    """Return True if the URL points to Instagram content."""
    return any(domain in url for domain in ('instagram.com', 'instagr.am'))


# ── Instagram anti-detection constants ─────────────────────────────────────────
# A pool of recent, real-world Chrome User-Agent strings.  We pick one at random
# per request so that repeated downloads don't share a single fingerprint.
_CHROME_USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
]


class VideoConverter:
    """Handles video downloading and conversion using yt-dlp"""

    def __init__(self, download_dir: str = "./downloads"):
        self.download_dir = Path(download_dir)
        self.download_dir.mkdir(exist_ok=True)

    # ── Instagram-specific option overrides ──────────────────────────────────
    @staticmethod
    def _instagram_overrides() -> dict:
        """Return yt-dlp options that help avoid Instagram's bot detection.

        These are merged on top of the base options and override any
        YouTube-specific settings that would be meaningless or harmful
        for Instagram (e.g. player_client extractor args).
        """
        overrides: dict = {
            # ── Identity ───────────────────────────────────────────────────
            # Instagram fingerprints the default yt-dlp User-Agent and
            # rejects it outright.  A real Chrome UA passes the check.
            'user_agent': random.choice(_CHROME_USER_AGENTS),
            'http_headers': {
                'Referer': 'https://www.instagram.com/',
                'Accept-Language': 'en-US,en;q=0.9',
            },

            # ── Rate-limiting / stealth ────────────────────────────────────
            # Pause between metadata API calls to stay under the anonymous
            # rate-limit window.
            'sleep_requests': 1.5,
            # Random pre-download delay (2-5 s) mimics a human clicking.
            'sleep_interval': 2,
            'max_sleep_interval': 5,

            # ── Reliability ───────────────────────────────────────────────
            # Instagram's CDN intermittently 403s; extra retries usually
            # succeed on a different edge server.
            'extractor_retries': 5,
            'fragment_retries': 10,
            'socket_timeout': 20,

            # ── Remove YouTube-only options ───────────────────────────────
            # geo_bypass / geo_bypass_country are YT-specific and can
            # confuse other extractors; extractor_args with player_client
            # is meaningless for Instagram.
            'geo_bypass': False,
        }

        # Optional cookie file for authenticated downloads — lets the
        # deployer use a burner account for higher reliability without
        # code changes.
        cookie_path = os.getenv('INSTAGRAM_COOKIES_FILE')
        if cookie_path and os.path.isfile(cookie_path):
            overrides['cookiefile'] = cookie_path
            logger.info('Using Instagram cookie file for authenticated download')

        return overrides

    async def get_video_info(self, url: str) -> VideoInfo:
        """Fetch video metadata without downloading"""
        # Normalize YouTube Shorts URLs
        url = normalize_youtube_url(url)

        instagram = _is_instagram(url)

        ydl_opts = {
            'quiet': True,
            'no_warnings': True,
            'extract_flat': False,
            # Don't load/parse format list — we only need basic metadata
            'skip_download': True,
            # Tight timeout for metadata-only fetch: fail fast and let the
            # caller show an error rather than waiting 20 s per retry.
            'socket_timeout': 10,
            'extractor_retries': 1,
        }

        if instagram:
            # Apply Instagram-specific anti-detection overrides
            ydl_opts.update(self._instagram_overrides())
            # Remove YouTube-only extractor args (not applicable)
            ydl_opts.pop('extractor_args', None)
        else:
            # YouTube: use mobile clients — they bypass bot checks fastest
            # and don't need JS challenge solving.
            ydl_opts['extractor_args'] = {'youtube': ['player_client=ios,android']}

        def _fetch():
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=False)
                # Drop the huge 'formats' list immediately — we only need basic
                # metadata fields and this dict can be 5–10 MB for long videos.
                if info:
                    info.pop('formats', None)
                    info.pop('thumbnails', None)
                    info.pop('automatic_captions', None)
                    info.pop('subtitles', None)
                return info

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

    def _get_format_options(
        self,
        format_type: FormatType,
        url: str,
        website_url: str = "http://localhost:7654",
        duration: int = 0,
        job_id: str = "",
    ) -> dict:
        """Get yt-dlp options based on format type and domain.

        *duration* (seconds) drives two I/O optimisations for long videos:
          - Skip thumbnail embedding (saves one full ffmpeg read+write pass)
          - Prefer pre-muxed streams (saves the separate video+audio merge step)
        """
        # Videos longer than 30 minutes are treated as "long". Thumbnail
        # embedding on a 3-hour file means ffmpeg reads and rewrites ~8 GB
        # just to attach a tiny image — skip it to cut I/O roughly in half.
        LONG_VIDEO_THRESHOLD = 30 * 60  # 30 minutes in seconds
        long_video = duration > LONG_VIDEO_THRESHOLD

        is_youtube = "youtube.com" in url or "youtu.be" in url


        instagram = _is_instagram(url)

        base_opts = {
            # ── Output verbosity ───────────────────────────────────────────
            # Keep quiet=True so yt-dlp doesn't buffer large log strings in
            # memory. Progress is delivered via the progress_hook instead.
            'quiet': True,
            'no_warnings': True,
            'nocolor': True,

            # ── Output path ────────────────────────────────────────────────
            # Use the job_id (a plain UUID) as the on-disk filename so we
            # never have to worry about special characters in video titles
            # (|, :, –, etc.) breaking ffmpeg's output file open call.
            # The user-visible filename is set separately in the download
            # route via Content-Disposition, so nothing changes for users.
            'outtmpl': str(self.download_dir / f'{job_id}.%(ext)s'),

            # ── Network / anti-403 ─────────────────────────────────────────
            'force_ipv4': True,
            'nocheckcertificate': True,
            'extractor_retries': 3,
            'fragment_retries': 10,
            'skip_unavailable_fragments': True,
            'socket_timeout': 30,

            # ── Metadata ───────────────────────────────────────────────────
            'add_metadata': True,
            'postprocessor_args': {
                'ffmpeg': ['-metadata', f'comment={website_url}']
            },
        }

        if instagram:
            # Merge Instagram anti-detection overrides on top of base_opts
            base_opts.update(self._instagram_overrides())
            # Ensure we don't send YouTube-only keys
            base_opts.pop('extractor_args', None)
            base_opts.pop('geo_bypass_country', None)
        else:
            # YouTube-specific options
            base_opts['geo_bypass'] = True
            base_opts['geo_bypass_country'] = 'US'
            base_opts['extractor_args'] = {'youtube': ['player_client=ios,android,web']}

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
                # Only embed thumbnail for short videos — for long videos the
                # ffmpeg re-write pass costs as much I/O as the download itself.
                'writethumbnail': not long_video,
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
                    *(
                        [{
                            # EmbedThumbnail removes the standalone image file
                            # after embedding it — no orphan .webp/.jpg left.
                            'key': 'EmbedThumbnail',
                            'already_have_thumbnail': False,
                        }]
                        if not long_video else []
                    ),
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
            # Always request separate video+audio streams for YouTube — YouTube
            # only offers pre-muxed streams up to ~480p, so requesting
            # best[height<=1080][ext=mp4] would silently return a 480p stream
            # when the user asked for 1080p.
            # The merge I/O cost is unavoidable for high-res; the thumbnail skip
            # above already handles the main avoidable I/O for long videos.
            fmt = (
                f'bestvideo[height<={h}]+bestaudio'
                f'/best[height<={h}]'
                f'/best'
            )
        else:
            fmt = 'bestvideo+bestaudio/best' if is_youtube else 'best'


        return {
            **base_opts,
            'format': fmt,
            'merge_output_format': 'mp4',
            # Skip thumbnail for long videos — same reason as above.
            'writethumbnail': not long_video,
            'postprocessors': [
                {
                    'key': 'FFmpegMetadata',
                    'add_metadata': True,
                },
                *(
                    [{
                        'key': 'EmbedThumbnail',
                        'already_have_thumbnail': False,
                    }]
                    if not long_video else []
                ),
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

            ydl_opts = self._get_format_options(
                format_type, url, website_url,
                duration=video_info.duration,
                job_id=job_id,
            )

            # Progress hook — runs inside the worker thread, so only mutate
            # simple Python objects (no async calls here).
            def progress_hook(d):
                if d['status'] == 'downloading':
                    try:
                        percent_str = d.get('_percent_str', '0%')
                        match = re.search(r'([0-9.]+)', percent_str)
                        if match:
                            clean_percent = match.group(1)
                            jobs[job_id].progress = min(int(float(clean_percent) * 0.8), 80)
                            jobs[job_id].message = f"Downloading... {clean_percent}%"
                    except Exception as e:
                        logger.warning(f"Error parsing progress hook: {e}")
                elif d['status'] == 'finished':
                    jobs[job_id].progress = 85
                    jobs[job_id].message = "Processing..."

            ydl_opts['progress_hooks'] = [progress_hook]

            # Run the blocking download/ffmpeg work in the bounded thread pool
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(_executor, self._download_video, url, ydl_opts)

            # Find the file yt-dlp wrote — it's named {job_id}.{ext}
            expected_ext = '.mp3' if 'mp3' in format_type.value else '.mp4'
            file_path = self._find_downloaded_file(job_id, expected_ext)

            if not file_path:
                raise Exception("Downloaded file not found")

            # Clean up any leftover thumbnail files
            self._cleanup_thumbnails(job_id)

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

        finally:
            # Always release memory after a job ends (success or failure).
            # This returns the heap pages used by yt-dlp's info dicts and
            # ffmpeg buffers back to the OS so the container RAM drops back
            # to its idle baseline.
            _release_memory()
            logger.debug(f"Memory released after job {job_id}")

    def _download_video(self, url: str, ydl_opts: dict):
        """Synchronous download function — runs inside the thread pool."""
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])

    def _cleanup_thumbnails(self, job_id: str):
        """Delete any leftover thumbnail image files for this job.

        yt-dlp should remove them via EmbedThumbnail, but if ffmpeg fails to
        embed the .webp / .jpg file stays behind.
        """
        if not self.download_dir.exists():
            return
        for ext in ('.webp', '.jpg', '.jpeg', '.png'):
            candidate = self.download_dir / f"{job_id}{ext}"
            if candidate.exists():
                try:
                    candidate.unlink()
                    logger.debug(f"Removed leftover thumbnail: {candidate.name}")
                except Exception as e:
                    logger.warning(f"Could not remove thumbnail {candidate}: {e}")

    def _find_downloaded_file(self, job_id: str, expected_ext: str) -> Optional[Path]:
        """Find the file yt-dlp wrote for this job (named {job_id}.{ext})."""
        # Direct match first
        candidate = self.download_dir / f"{job_id}{expected_ext}"
        if candidate.exists():
            logger.info(f"Found downloaded file: {candidate.name}")
            return candidate

        # Fallback: scan directory in case extension differs slightly
        for file in self.download_dir.iterdir():
            if file.is_file() and file.stem == job_id:
                logger.info(f"Found downloaded file (fallback): {file.name}")
                return file

        logger.warning(f"No file found for job {job_id} with extension {expected_ext}")
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
