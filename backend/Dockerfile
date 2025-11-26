# Use an official Python runtime as a parent image
FROM python:3.11-slim

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Install system dependencies (ffmpeg is required for yt-dlp)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Set the working directory in the container
WORKDIR /app

# Copy the requirements file into the container
COPY backend/requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy the backend code
COPY backend /app/backend

# Copy the frontend code (served by FastAPI)
COPY frontend /app/frontend

# Create downloads directory
RUN mkdir -p /app/downloads

# Expose the port the app runs on
EXPOSE 7654

# Command to run the application
# We run from /app so that imports like 'from app.routes' work if pythonpath is set or if we run as module
# Adjusting command to run from /app/backend context or setting PYTHONPATH
WORKDIR /app/backend
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7654"]
