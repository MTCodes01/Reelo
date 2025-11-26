// ==================== Configuration ====================
const API_BASE_URL = '/api';
const POLL_INTERVAL = 1000; // Poll every 1 second

// ==================== State Management ====================
let currentJobId = null;
let pollInterval = null;
let selectedFormat = 'mp3-128'; // Default
let currentMode = 'audio';

// ==================== DOM Elements ====================
const elements = {
    urlInput: document.getElementById('youtube-url'),
    pasteBtn: document.getElementById('paste-btn'),
    convertBtn: document.getElementById('convert-btn'),
    
    // Type & Formats
    audioFormats: document.getElementById('audio-formats'),
    videoFormats: document.getElementById('video-formats'),
    
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
function isValidUrl(url) {
    const patterns = [
        /^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)[\w-]+/,
        /^(https?:\/\/)?(www\.)?youtube\.com\/watch\?.*v=[\w-]+/,
        /^(https?:\/\/)?(www\.)?instagram\.com\/(p|reel|tv)\/[\w-]+\/?/
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
        elements.videoPreview.classList.remove('hidden');
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

// ==================== UI Logic ====================
function handleTypeSelect(e) {
    const btn = e.currentTarget;
    const type = btn.dataset.format; // 'audio' or 'video'
    
    if (type === currentMode) return;
    
    // Update Type Buttons
    document.querySelectorAll('[data-format="audio"], [data-format="video"]').forEach(b => {
        b.classList.remove('active');
    });
    btn.classList.add('active');
    
    currentMode = type;
    
    // Toggle Format Containers
    if (type === 'audio') {
        elements.videoFormats.classList.add('hidden');
        elements.audioFormats.classList.remove('hidden');
        // Set default audio format
        selectFormat('mp3-128');
    } else {
        elements.audioFormats.classList.add('hidden');
        elements.videoFormats.classList.remove('hidden');
        // Set default video format
        selectFormat('mp4-1080');
    }
}

function selectFormat(formatId) {
    selectedFormat = formatId;
    
    // Update active state in the visible container
    const container = currentMode === 'audio' ? elements.audioFormats : elements.videoFormats;
    const btns = container.querySelectorAll('.format-btn');
    
    btns.forEach(btn => {
        if (btn.dataset.format === formatId) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}

function handleFormatSelect(e) {
    const btn = e.currentTarget;
    selectFormat(btn.dataset.format);
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

async function handleConvert() {
    const url = elements.urlInput.value.trim();
    
    // Validate URL
    if (!url) {
        showError('Please enter a YouTube URL');
        return;
    }
    
    if (!isValidUrl(url)) {
        showError('Invalid URL. Please enter a valid YouTube or Instagram URL.');
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
elements.convertBtn.addEventListener('click', handleConvert);
elements.downloadBtn.addEventListener('click', handleDownload);
elements.convertAnotherBtn.addEventListener('click', handleConvertAnother);
elements.tryAgainBtn.addEventListener('click', handleTryAgain);

// Type Selection
document.querySelectorAll('[data-format="audio"], [data-format="video"]').forEach(btn => {
    // Only attach to the type selector buttons, not format buttons
    if (btn.parentElement.parentElement.querySelector('.format-label').textContent.trim() === 'Type:') {
        btn.addEventListener('click', handleTypeSelect);
    }
});

// Format Selection
document.querySelectorAll('.format-btn').forEach(btn => {
    // Exclude type selector buttons
    const label = btn.parentElement.parentElement.querySelector('.format-label').textContent.trim();
    if (label !== 'Type:') {
        btn.addEventListener('click', handleFormatSelect);
    }
});

// Allow Enter key to trigger conversion
elements.urlInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        handleConvert();
    }
});

// ==================== Initialization ====================
// ==================== Initialization ====================
console.log('YT Converter initialized');
// Initialize UI state
if (currentMode === 'audio') {
    elements.videoFormats.classList.add('hidden');
    elements.audioFormats.classList.remove('hidden');
    // Ensure correct type button is active
    document.querySelector('[data-format="video"]').classList.remove('active');
    document.querySelector('[data-format="audio"]').classList.add('active');
} else {
    elements.audioFormats.classList.add('hidden');
    elements.videoFormats.classList.remove('hidden');
    // Ensure correct type button is active
    document.querySelector('[data-format="audio"]').classList.remove('active');
    document.querySelector('[data-format="video"]').classList.add('active');
}
// Set initial active format button
selectFormat(selectedFormat);
