// ==================== Configuration ====================
const API_BASE_URL = 'http://localhost:8000/api';
const POLL_INTERVAL = 1000; // Poll every 1 second

// ==================== State Management ====================
let currentJobId = null;
let pollInterval = null;
let selectedFormat = 'mp3';

// ==================== DOM Elements ====================
const elements = {
    urlInput: document.getElementById('youtube-url'),
    pasteBtn: document.getElementById('paste-btn'),
    convertBtn: document.getElementById('convert-btn'),
    formatBtns: document.querySelectorAll('.format-btn'),
    
    videoPreview: document.getElementById('video-preview'),
    previewThumb: document.getElementById('preview-thumb'),
    previewTitle: document.getElementById('preview-title'),
    previewChannel: document.getElementById('preview-channel'),
    previewDuration: document.getElementById('preview-duration'),
    
    progressSection: document.getElementById('progress-section'),
    progressStatus: document.getElementById('progress-status'),
    progressPercent: document.getElementById('progress-percent'),
    progressFill: document.getElementById('progress-fill'),
    
    downloadSection: document.getElementById('download-section'),
    downloadBtn: document.getElementById('download-btn'),
    convertAnotherBtn: document.getElementById('convert-another'),
    
    errorSection: document.getElementById('error-section'),
    errorMessage: document.getElementById('error-message'),
    tryAgainBtn: document.getElementById('try-again-btn')
};

// ==================== Utility Functions ====================
function isValidYouTubeUrl(url) {
    const patterns = [
        /^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)[\w-]+/,
        /^(https?:\/\/)?(www\.)?youtube\.com\/watch\?.*v=[\w-]+/
    ];
    return patterns.some(pattern => pattern.test(url));
}

function extractVideoId(url) {
    const patterns = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/,
        /youtube\.com\/watch\?.*v=([^&\s]+)/
    ];
    
    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) return match[1];
    }
    return null;
}

function formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

function showSection(section) {
    // Hide all sections
    elements.videoPreview.classList.add('hidden');
    elements.progressSection.classList.add('hidden');
    elements.downloadSection.classList.add('hidden');
    elements.errorSection.classList.add('hidden');
    
    // Show requested section
    if (section) {
        section.classList.remove('hidden');
    }
}

function setLoading(isLoading) {
    if (isLoading) {
        elements.convertBtn.classList.add('loading');
        elements.convertBtn.disabled = true;
    } else {
        elements.convertBtn.classList.remove('loading');
        elements.convertBtn.disabled = false;
    }
}

function showError(message) {
    elements.errorMessage.textContent = message;
    showSection(elements.errorSection);
    setLoading(false);
}

// ==================== API Functions ====================
async function fetchVideoInfo(url) {
    try {
        const response = await fetch(`${API_BASE_URL}/info?url=${encodeURIComponent(url)}`);
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to fetch video info');
        }
        
        return await response.json();
    } catch (error) {
        throw new Error(error.message || 'Network error. Please check your connection.');
    }
}

async function startConversion(url, format) {
    try {
        const response = await fetch(`${API_BASE_URL}/convert`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ url, format })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to start conversion');
        }
        
        return await response.json();
    } catch (error) {
        throw new Error(error.message || 'Network error. Please check your connection.');
    }
}

async function checkJobStatus(jobId) {
    try {
        const response = await fetch(`${API_BASE_URL}/status/${jobId}`);
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to check status');
        }
        
        return await response.json();
    } catch (error) {
        throw new Error(error.message || 'Network error. Please check your connection.');
    }
}

function downloadFile(jobId) {
    const downloadUrl = `${API_BASE_URL}/download/${jobId}`;
    window.location.href = downloadUrl;
}

// ==================== UI Update Functions ====================
function displayVideoPreview(videoInfo) {
    elements.previewThumb.src = videoInfo.thumbnail;
    elements.previewTitle.textContent = videoInfo.title;
    elements.previewChannel.textContent = videoInfo.channel;
    elements.previewDuration.textContent = formatDuration(videoInfo.duration);
    
    showSection(elements.videoPreview);
}

function updateProgress(status, percent) {
    elements.progressStatus.textContent = status;
    elements.progressPercent.textContent = `${percent}%`;
    elements.progressFill.style.width = `${percent}%`;
}

function startProgressPolling(jobId) {
    // Clear any existing interval
    if (pollInterval) {
        clearInterval(pollInterval);
    }
    
    pollInterval = setInterval(async () => {
        try {
            const status = await checkJobStatus(jobId);
            
            if (status.status === 'completed') {
                clearInterval(pollInterval);
                pollInterval = null;
                showSection(elements.downloadSection);
                setLoading(false);
            } else if (status.status === 'failed') {
                clearInterval(pollInterval);
                pollInterval = null;
                showError(status.error || 'Conversion failed. Please try again.');
            } else {
                // Update progress
                updateProgress(status.message || 'Processing...', status.progress || 0);
            }
        } catch (error) {
            clearInterval(pollInterval);
            pollInterval = null;
            showError(error.message);
        }
    }, POLL_INTERVAL);
}

// ==================== Event Handlers ====================
async function handlePasteClick() {
    try {
        const text = await navigator.clipboard.readText();
        elements.urlInput.value = text;
        elements.urlInput.focus();
    } catch (error) {
        console.error('Failed to read clipboard:', error);
    }
}

function handleFormatSelect(e) {
    // Remove active class from all buttons
    elements.formatBtns.forEach(btn => btn.classList.remove('active'));
    
    // Add active class to clicked button
    e.currentTarget.classList.add('active');
    
    // Update selected format
    selectedFormat = e.currentTarget.dataset.format;
}

async function handleConvert() {
    const url = elements.urlInput.value.trim();
    
    // Validate URL
    if (!url) {
        showError('Please enter a YouTube URL');
        return;
    }
    
    if (!isValidYouTubeUrl(url)) {
        showError('Invalid YouTube URL. Please enter a valid URL.');
        return;
    }
    
    setLoading(true);
    
    try {
        // Fetch video info
        const videoInfo = await fetchVideoInfo(url);
        displayVideoPreview(videoInfo);
        
        // Start conversion
        const conversionResponse = await startConversion(url, selectedFormat);
        currentJobId = conversionResponse.job_id;
        
        // Show progress section
        showSection(elements.progressSection);
        updateProgress('Starting conversion...', 0);
        
        // Start polling for progress
        startProgressPolling(currentJobId);
        
    } catch (error) {
        showError(error.message);
    }
}

function handleDownload() {
    if (currentJobId) {
        downloadFile(currentJobId);
    }
}

function handleConvertAnother() {
    // Reset state
    currentJobId = null;
    elements.urlInput.value = '';
    
    // Clear any polling
    if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
    }
    
    // Hide all sections
    showSection(null);
    
    // Reset progress
    updateProgress('Processing...', 0);
    
    // Focus input
    elements.urlInput.focus();
}

function handleTryAgain() {
    handleConvertAnother();
}

// ==================== Event Listeners ====================
elements.pasteBtn.addEventListener('click', handlePasteClick);
elements.formatBtns.forEach(btn => {
    btn.addEventListener('click', handleFormatSelect);
});
elements.convertBtn.addEventListener('click', handleConvert);
elements.downloadBtn.addEventListener('click', handleDownload);
elements.convertAnotherBtn.addEventListener('click', handleConvertAnother);
elements.tryAgainBtn.addEventListener('click', handleTryAgain);

// Allow Enter key to trigger conversion
elements.urlInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        handleConvert();
    }
});

// ==================== Initialization ====================
console.log('YT Converter initialized');
console.log('API Base URL:', API_BASE_URL);
console.log('Make sure the backend server is running on port 8000');
