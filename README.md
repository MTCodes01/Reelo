# YT Converter - YouTube to MP3/MP4 Converter

A modern, fast, and free YouTube to MP3/MP4 converter with a beautiful UI and powerful backend.

![YT Converter](https://img.shields.io/badge/version-1.0.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## ✨ Features

- 🎵 **Multiple Formats**: Download as MP3 or MP4 (360p/720p/1080p)
- ⚡ **Lightning Fast**: Optimized conversion using yt-dlp and ffmpeg
- 🎨 **Modern UI**: Beautiful, responsive design with smooth animations
- 📊 **Progress Tracking**: Real-time conversion status updates
- 🔒 **Secure**: Automatic file cleanup, rate limiting, and CORS protection
- 📱 **Mobile Friendly**: Fully responsive design for all devices
- 🎬 **Video Preview**: See thumbnail, title, and duration before converting

## 📁 Project Structure

```
YT-Downloader/
├── frontend/
│   ├── index.html              # Main landing page
│   └── static/
│       ├── css/
│       │   └── style.css       # Styles with glassmorphism
│       └── js/
│           └── app.js          # Frontend logic
├── backend/
│   ├── main.py                 # FastAPI application
│   ├── requirements.txt        # Python dependencies
│   ├── .env.example            # Environment variables template
│   └── app/
│       ├── __init__.py
│       ├── models.py           # Pydantic models
│       ├── routes.py           # API endpoints
│       ├── converter.py        # yt-dlp integration
│       └── cleanup.py          # File cleanup service
├── deployment/
│   ├── ytconverter.service     # systemd service
│   └── nginx.conf              # Nginx configuration
└── README.md
```

## 🚀 Quick Start

### Prerequisites

- Python 3.9+
- ffmpeg
- yt-dlp

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd YT-Downloader
   ```

2. **Install system dependencies**
   
   **Ubuntu/Debian:**
   ```bash
   sudo apt update
   sudo apt install python3-pip python3-venv ffmpeg
   pip3 install yt-dlp
   ```
   
   **Windows:**
   - Install Python from [python.org](https://python.org)
   - Install ffmpeg from [ffmpeg.org](https://ffmpeg.org/download.html)
   - Install yt-dlp: `pip install yt-dlp`

3. **Set up Python virtual environment**
   ```bash
   cd backend
   python -m venv venv
   
   # Windows
   venv\Scripts\activate
   
   # Linux/Mac
   source venv/bin/activate
   ```

4. **Install Python dependencies**
   ```bash
   pip install -r requirements.txt
   ```

5. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env with your settings
   ```

6. **Run the development server**
   ```bash
   python main.py
   ```

7. **Open in browser**
   - Navigate to `http://localhost:8000`
   - The frontend will be served automatically

## 🔧 Configuration

Edit `.env` file to customize settings:

```env
# CORS Settings
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:8000

# Rate Limiting
RATE_LIMIT=10/minute

# File Management
DOWNLOAD_DIR=./downloads
FILE_RETENTION_HOURS=1
CLEANUP_INTERVAL_MINUTES=30

# Server Settings
HOST=0.0.0.0
PORT=8000
```

## 🌐 Production Deployment

### 1. Set up the server

```bash
# Create application directory
sudo mkdir -p /var/www/yt-converter
sudo chown -R $USER:$USER /var/www/yt-converter

# Copy files
cp -r frontend /var/www/yt-converter/
cp -r backend /var/www/yt-converter/

# Set up virtual environment
cd /var/www/yt-converter/backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 2. Configure systemd service

```bash
# Copy service file
sudo cp deployment/ytconverter.service /etc/systemd/system/

# Edit the service file to match your paths
sudo nano /etc/systemd/system/ytconverter.service

# Enable and start service
sudo systemctl daemon-reload
sudo systemctl enable ytconverter
sudo systemctl start ytconverter

# Check status
sudo systemctl status ytconverter
```

### 3. Configure Nginx

```bash
# Install Nginx
sudo apt install nginx

# Copy configuration
sudo cp deployment/nginx.conf /etc/nginx/sites-available/ytconverter

# Update domain name in the config
sudo nano /etc/nginx/sites-available/ytconverter

# Enable site
sudo ln -s /etc/nginx/sites-available/ytconverter /etc/nginx/sites-enabled/

# Test configuration
sudo nginx -t

# Reload Nginx
sudo systemctl reload nginx
```

### 4. Set up SSL with Let's Encrypt

```bash
# Install Certbot
sudo apt install certbot python3-certbot-nginx

# Obtain certificate
sudo certbot --nginx -d your-domain.com -d www.your-domain.com

# Auto-renewal is set up automatically
```

## 🔒 Security Hardening

1. **Firewall Configuration**
   ```bash
   sudo ufw allow 80/tcp
   sudo ufw allow 443/tcp
   sudo ufw enable
   ```

2. **Rate Limiting**
   - Application-level: 10 requests/minute (configurable in `.env`)
   - Nginx-level: Additional rate limiting in `nginx.conf`

3. **CORS Protection**
   - Configure `ALLOWED_ORIGINS` in `.env`
   - Only allow trusted domains

4. **File Cleanup**
   - Automatic deletion after 1 hour (configurable)
   - Runs every 30 minutes

5. **User Permissions**
   - Run service as `www-data` user
   - Restrict file permissions

## 📊 API Documentation

Once running, visit `http://localhost:8000/docs` for interactive API documentation.

### Endpoints

- `GET /api/info?url={youtube_url}` - Get video metadata
- `POST /api/convert` - Start conversion
- `GET /api/status/{job_id}` - Check conversion status
- `GET /api/download/{job_id}` - Download converted file
- `GET /health` - Health check

## 🛠️ Development

### Running in development mode

```bash
cd backend
python main.py
```

The server will run with auto-reload enabled.

### Logs

```bash
# View application logs
sudo journalctl -u ytconverter -f

# View Nginx logs
sudo tail -f /var/log/nginx/ytconverter_access.log
sudo tail -f /var/log/nginx/ytconverter_error.log
```

## 🐛 Troubleshooting

### "yt-dlp not found"
```bash
pip install --upgrade yt-dlp
```

### "ffmpeg not found"
```bash
# Ubuntu/Debian
sudo apt install ffmpeg

# Windows
# Download from https://ffmpeg.org/download.html
```

### "Permission denied" errors
```bash
sudo chown -R www-data:www-data /var/www/yt-converter
sudo chmod -R 755 /var/www/yt-converter
```

### Backend not starting
```bash
# Check logs
sudo journalctl -u ytconverter -n 50

# Verify Python dependencies
cd /var/www/yt-converter/backend
source venv/bin/activate
pip install -r requirements.txt
```

## 📝 License

This project is for educational purposes only. Respect YouTube's Terms of Service and only download videos you have permission to download.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## ⚠️ Disclaimer

This tool is for personal use only. Users are responsible for complying with YouTube's Terms of Service and copyright laws. The developers assume no liability for misuse of this software.

## 📧 Support

For issues and questions, please open an issue on GitHub.

---

Made with ❤️ for the community
