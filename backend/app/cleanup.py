import os
import asyncio
import logging
from pathlib import Path
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)


class FileCleanupService:
    """Background service to clean up old downloaded files"""
    
    def __init__(self, download_dir: str, retention_hours: int = 1):
        self.download_dir = Path(download_dir)
        self.retention_hours = retention_hours
        self.is_running = False
    
    async def start(self, interval_minutes: int = 30):
        """Start the cleanup service"""
        self.is_running = True
        logger.info(f"File cleanup service started (retention: {self.retention_hours}h, interval: {interval_minutes}m)")
        
        while self.is_running:
            try:
                await self.cleanup_old_files()
                await asyncio.sleep(interval_minutes * 60)
            except Exception as e:
                logger.error(f"Error in cleanup service: {e}")
                await asyncio.sleep(60)  # Wait 1 minute before retrying
    
    def stop(self):
        """Stop the cleanup service"""
        self.is_running = False
        logger.info("File cleanup service stopped")
    
    async def cleanup_old_files(self):
        """Remove files older than retention period"""
        if not self.download_dir.exists():
            return
        
        cutoff_time = datetime.now() - timedelta(hours=self.retention_hours)
        deleted_count = 0
        
        for file_path in self.download_dir.glob("*"):
            if not file_path.is_file():
                continue
            
            try:
                # Get file modification time
                file_mtime = datetime.fromtimestamp(file_path.stat().st_mtime)
                
                if file_mtime < cutoff_time:
                    file_path.unlink()
                    deleted_count += 1
                    logger.info(f"Deleted old file: {file_path.name}")
            
            except Exception as e:
                logger.error(f"Error deleting file {file_path}: {e}")
        
        if deleted_count > 0:
            logger.info(f"Cleanup complete: {deleted_count} file(s) deleted")


# Global cleanup service instance
cleanup_service: FileCleanupService = None


def get_cleanup_service(download_dir: str, retention_hours: int = 1) -> FileCleanupService:
    """Get or create the cleanup service instance"""
    global cleanup_service
    if cleanup_service is None:
        cleanup_service = FileCleanupService(download_dir, retention_hours)
    return cleanup_service
