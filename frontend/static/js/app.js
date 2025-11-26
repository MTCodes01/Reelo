// ==================== Configuration ====================
const API_BASE_URL = 'http://localhost:8000/api';
const POLL_INTERVAL = 1000; // Poll every 1 second

// ==================== State Management ====================
let currentJobId = null;
let pollInterval = null;
let selectedFormat = 'mp4-720'; // Default
let currentMode = 'video';

// Format Options
const FORMATS = {
    video: [
        { id: 'mp4-360', label: '360p', sub: 'MP4' },
        { id: 'mp4-720', label: '720p', sub: 'HD' },
        { id: 'mp4-1080', label: '1080p', sub: 'FHD' },
        { id: 'mp4-1440', label: '2k', sub: 'QHD' },
        { id: 'mp4-2160', label: '4k', sub: 'UHD' }
    ],
    audio: [
        { id: 'mp3-48', label: '48k', sub: 'Low' },
        { id: 'mp3-128', label: '128k', sub: 'Std' },
        { id: 'mp3-240', label: '240k', sub: 'High' },
        { id: 'mp3-320', label: '320k', sub: 'Max' }
    ]
};

// ==================== DOM Elements ====================
const elements = {
    urlInput: document.getElementById('youtube-url'),
    pasteBtn: document.getElementById('paste-btn'),
    convertBtn: document.getElementById('convert-btn'),
    
    // Toggle & Formats
    formatContainer: document.getElementById('format-buttons-container'),
    
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

// ==================== Dynamic UI Functions ====================
function renderFormatButtons(mode) {
    const formats = FORMATS[mode];
    elements.formatContainer.innerHTML = '';
    
    formats.forEach(fmt => {
        const btn = document.createElement('button');
        btn.className = 'format-btn';
        btn.dataset.format = fmt.id;
        
        // Set active if matches selectedFormat, or default to first if mismatch
        if (selectedFormat === fmt.id) {
            btn.classList.add('active');
        }
        
        btn.innerHTML = `
            ${fmt.label}
            <span style="font-size: 0.7em; font-weight: 400; opacity: 0.7">${fmt.sub}</span>
        `;
        
        btn.addEventListener('click', handleFormatSelect);
        elements.formatContainer.appendChild(btn);
    });
    
    // If no button is active (e.g. switched mode), select the default for that mode
    if (!elements.formatContainer.querySelector('.active')) {
        const defaultFormat = mode === 'video' ? 'mp4-720' : 'mp3-128';
        selectFormat(defaultFormat);
    }
}

function selectFormat(formatId) {
    selectedFormat = formatId;
    const btns = elements.formatContainer.querySelectorAll('.format-btn');
    btns.forEach(btn => {
        if (btn.dataset.format === formatId) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}

function handleModeChange(e) {
    currentMode = e.target.value;
    renderFormatButtons(currentMode);
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

// Mode Toggle Listeners
document.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        // Remove active class from all toggle buttons
        document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
        
        // Add active class to clicked button
        const clickedBtn = e.currentTarget;
        clickedBtn.classList.add('active');
        
        // Update mode
        const newMode = clickedBtn.dataset.mode;
        if (newMode !== currentMode) {
            currentMode = newMode;
            renderFormatButtons(currentMode);
        }
    });
});

// Allow Enter key to trigger conversion
elements.urlInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        handleConvert();
    }
});

// ==================== Initialization ====================
console.log('YT Converter initialized');
// Initialize format buttons
renderFormatButtons(currentMode);
