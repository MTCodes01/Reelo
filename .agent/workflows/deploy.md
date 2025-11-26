---
description: How to deploy the YT Downloader application using Docker
---

# Deployment Steps

1.  **Prerequisites**: Ensure Docker and Docker Compose are installed on your server.

2.  **Clone/Update Repository**:
    ```bash
    git pull origin main
    ```

3.  **Environment Configuration**:
    Ensure your `.env` file is configured correctly in `backend/.env`.
    ```bash
    # Example .env content
    PORT=7654
    ALLOWED_ORIGINS=http://localhost:3294,https://reelo.domain.com
    ```

4.  **Build and Run**:
    Run the following command to build the image and start the container in detached mode.
    ```bash
    docker-compose up --build -d
    ```

5.  **Verify Deployment**:
    Check if the container is running:
    ```bash
    docker ps
    ```
    You should see a container named `reelo` (or similar) running on port `0.0.0.0:3294->7654/tcp`.

6.  **Access Application**:
    Open your browser and navigate to `http://<your-server-ip>:3294` or `https://reelo.domain.com` if configured with a reverse proxy.

7.  **Logs**:
    To view application logs:
    ```bash
    docker-compose logs -f
    ```

8.  **Stop Application**:
    To stop the application:
    ```bash
    docker-compose down
    ```
