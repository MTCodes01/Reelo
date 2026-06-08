import asyncio
import logging
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict

logger = logging.getLogger(__name__)


class FileCleanupService:
    """Background service to clean up old downloaded files and stale job records."""

    def __init__(self, download_dir: str, retention_hours: int = 1):
        self.download_dir = Path(download_dir)
        self.retention_hours = retention_hours
        self._stop_event = asyncio.Event()

    async def start(self, interval_minutes: int = 30):
        """Run cleanup on a fixed interval until stop() is called."""
        logger.info(
            f"File cleanup service started "
            f"(retention: {self.retention_hours}h, interval: {interval_minutes}m)"
        )
        backoff = 60  # seconds between retries after an error

        while not self._stop_event.is_set():
            try:
                await self._cleanup()
                backoff = 60  # reset on success
                # Wait for the interval OR until stop() is called
                try:
                    await asyncio.wait_for(
                        self._stop_event.wait(),
                        timeout=interval_minutes * 60,
                    )
                except asyncio.TimeoutError:
                    pass  # Normal — interval elapsed, run cleanup again
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.error(f"Cleanup error: {e}. Retrying in {backoff}s.")
                try:
                    await asyncio.wait_for(
                        self._stop_event.wait(),
                        timeout=backoff,
                    )
                except asyncio.TimeoutError:
                    pass
                backoff = min(backoff * 2, 600)  # cap at 10 min

        logger.info("File cleanup service stopped")

    def stop(self):
        """Signal the cleanup loop to exit cleanly."""
        self._stop_event.set()

    async def _cleanup(self):
        """Remove files and job records older than the retention period."""
        # Import here to avoid a circular import at module load time
        from .converter import jobs

        cutoff = datetime.now() - timedelta(hours=self.retention_hours)

        # ── 1. Clean up files ──────────────────────────────────────────────
        files_deleted = 0
        if self.download_dir.exists():
            for file_path in list(self.download_dir.glob("*")):
                if not file_path.is_file():
                    continue
                try:
                    mtime = datetime.fromtimestamp(file_path.stat().st_mtime)
                    if mtime < cutoff:
                        file_path.unlink()
                        files_deleted += 1
                        logger.debug(f"Deleted old file: {file_path.name}")
                except Exception as e:
                    logger.error(f"Error deleting {file_path}: {e}")

        # ── 2. Evict stale job records ─────────────────────────────────────
        # Terminal jobs (completed/failed) whose file no longer exists.
        # Orphaned jobs stuck in pending/processing past 2× the retention window
        # (can happen if the server restarted mid-conversion).
        orphan_cutoff = datetime.now() - timedelta(hours=self.retention_hours * 2)
        stale_ids = []
        for job_id, job in list(jobs.items()):
            is_terminal = job.status in ("completed", "failed")
            file_gone = not job.file_path or not Path(job.file_path).exists()

            if is_terminal and file_gone:
                stale_ids.append(job_id)
            elif not is_terminal and job.created_at:
                try:
                    created = datetime.fromisoformat(job.created_at)
                    if created < orphan_cutoff:
                        stale_ids.append(job_id)
                except ValueError:
                    pass
        for job_id in stale_ids:
            jobs.pop(job_id, None)

        if files_deleted or stale_ids:
            logger.info(
                f"Cleanup: {files_deleted} file(s) deleted, "
                f"{len(stale_ids)} job record(s) evicted"
            )


# ── Singleton ──────────────────────────────────────────────────────────────────
_cleanup_service: FileCleanupService | None = None


def get_cleanup_service(download_dir: str, retention_hours: int = 1) -> FileCleanupService:
    """Return (or create) the global cleanup service instance."""
    global _cleanup_service
    if _cleanup_service is None:
        _cleanup_service = FileCleanupService(download_dir, retention_hours)
    return _cleanup_service
