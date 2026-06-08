from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from contextlib import asynccontextmanager
import logging
import os
from pathlib import Path
from dotenv import load_dotenv

from app.routes import router
from app.cleanup import get_cleanup_service

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Rate limiter
limiter = Limiter(key_func=get_remote_address)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events"""
    # Startup
    logger.info("Starting Reelo API...")
    
    # Create downloads directory
    download_dir = os.getenv("DOWNLOAD_DIR", "./downloads")
    Path(download_dir).mkdir(exist_ok=True)
    
    # Start cleanup service
    cleanup_service = get_cleanup_service(
        download_dir=download_dir,
        retention_hours=int(os.getenv("FILE_RETENTION_HOURS", "1"))
    )
    
    import asyncio
    cleanup_task = asyncio.create_task(
        cleanup_service.start(
            interval_minutes=int(os.getenv("CLEANUP_INTERVAL_MINUTES", "30"))
        )
    )
    
    logger.info("Reelo API started successfully")
    
    yield
    
    # Shutdown
    logger.info("Shutting down Reelo API...")
    cleanup_service.stop()
    cleanup_task.cancel()
    try:
        await cleanup_task
    except asyncio.CancelledError:
        pass
    logger.info("Reelo API stopped")


# Create FastAPI app
app = FastAPI(
    title="Reelo",
    description="Reelo is a fast, secure, and private YouTube downloader that allows you to download YouTube shorts, videos & Instagram Reels and convert them to MP3 or MP4. With a clean and simple interface, Reelo makes it easy to save your favorite videos for offline viewing.",
    version="1.0.0",
    lifespan=lifespan
)

# Add rate limiting
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS middleware
allowed_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routes
app.include_router(router)

# Serve frontend static files (for development)
frontend_path = Path(__file__).parent.parent / "frontend"
if frontend_path.exists():
    app.mount("/", StaticFiles(directory=str(frontend_path), html=True), name="frontend")


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "service": "yt-converter"}


if __name__ == "__main__":
    import uvicorn
    
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8000"))
    
    uvicorn.run(
        "main:app",
        host=host,
        port=port,
        reload=True,
        log_level=os.getenv("LOG_LEVEL", "info").lower()
    )
