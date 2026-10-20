// ==================== Configuration ====================
const API_BASE_URL = '/api';
const POLL_INITIAL_MS = 1000;   // first poll after 1 s
const POLL_MAX_MS    = 10000;  // back off up to 10 s
const POLL_TIMEOUT_MS = 10 * 60 * 1000; // hard stop after 10 min

// ==================== State Management ====================
let currentJobId = null;
let pollTimer = null;        // setTimeout handle
let pollTimeoutTimer = null; // hard-stop handle
let selectedFormat = 'mp3-128'; // Default
let currentMode = 'audio';

let trimState = {
    isOpen: false,
    isEnabled: true,
    startTime: 0,
    endTime: 0,
    duration: 0,
    sourceUrl: '',
    cachedVideoInfo: null,
    isDragging: null // 'start' | 'end' | null
};

// ==================== DOM Elements ====================
const elements = {
    urlInput: document.getElementById('youtube-url'),
    pasteBtn: document.getElementById('paste-btn'),
    convertBtn: document.getElementById('convert-btn'),
    
    // Type & Formats
    audioFormats: document.getElementById('audio-formats'),
    videoFormats: document.getElementById('video-formats'),
    imageFormats: document.getElementById('image-formats'),

    // Trim Controls
    trimToggleAudio: document.getElementById('trim-toggle-audio'),
    trimToggleVideo: document.getElementById('trim-toggle-video'),
    trimIndicatorDots: document.querySelectorAll('.trim-indicator-dot'),
    trimBadges: document.querySelectorAll('.trim-badge'),
    
    trimSection: document.getElementById('trim-section'),
    trimDurationBadge: document.getElementById('trim-duration-badge'),
    trimEnableToggle: document.getElementById('trim-enable-toggle'),
    trimResetBtn: document.getElementById('trim-reset-btn'),
    
    trimTimeline: document.getElementById('trim-timeline'),
    trimTrackHighlight: document.getElementById('trim-track-highlight'),
    trimHandleStart: document.getElementById('trim-handle-start'),
    trimHandleEnd: document.getElementById('trim-handle-end'),
    trimTooltipStart: document.getElementById('trim-tooltip-start'),
    trimTooltipEnd: document.getElementById('trim-tooltip-end'),
    
    trimTimelineStartLabel: document.getElementById('trim-timeline-start-label'),
    trimTimelineEndLabel: document.getElementById('trim-timeline-end-label'),
    trimTimelineStatus: document.getElementById('trim-timeline-status'),
    
    trimStartInput: document.getElementById('trim-start-input'),
    trimEndInput: document.getElementById('trim-end-input'),
    trimValidationMsg: document.getElementById('trim-validation-msg'),
    
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
function normalizeYouTubeUrl(url) {
    // Convert YouTube Shorts URLs to standard watch URLs
    // Example: youtube.com/shorts/Ir02lSLUmSQ -> youtube.com/watch?v=Ir02lSLUmSQ
    const shortsPattern = /(?:youtube\.com\/shorts\/)([^&\s?]+)/;
    const shortsMatch = url.match(shortsPattern);
    
    if (shortsMatch) {
        const videoId = shortsMatch[1];
        // Preserve https:// if present, otherwise add it
        const hasProtocol = url.startsWith('http://') || url.startsWith('https://');
        const protocol = hasProtocol ? '' : 'https://';
        return `${protocol}www.youtube.com/watch?v=${videoId}`;
    }

    // Convert YouTube Live URLs to standard watch URLs
    // Example: youtube.com/live/Epd-dLqNpbw -> youtube.com/watch?v=Epd-dLqNpbw
    const livePattern = /(?:youtube\.com\/live\/)([^&\s?]+)/;
    const liveMatch = url.match(livePattern);

    if (liveMatch) {
        const videoId = liveMatch[1];
        const hasProtocol = url.startsWith('http://') || url.startsWith('https://');
        const protocol = hasProtocol ? '' : 'https://';
        return `${protocol}www.youtube.com/watch?v=${videoId}`;
    }

    // Convert YouTube Music URLs to standard watch URLs
    // Example: music.youtube.com/watch?v=... -> www.youtube.com/watch?v=...
    if (url.includes('music.youtube.com')) {
        return url.replace('music.youtube.com', 'www.youtube.com');
    }
    
    return url;
}

function isValidUrl(url) {
    const patterns = [
        /^(https?:\/\/)?(www\.|music\.)?(youtube\.com\/watch\?v=|youtu\.be\/)[\w-]+/,
        /^(https?:\/\/)?(www\.|music\.)?youtube\.com\/watch\?.*v=[\w-]+/,
        /^(https?:\/\/)?(www\.)?youtube\.com\/shorts\/[\w-]+/,
        /^(https?:\/\/)?(www\.)?youtube\.com\/live\/[\w-]+/,
        /^(https?:\/\/)?(www\.)?instagram\.com\/(p|reel|tv)\/[\w-]+\/?/,
        /^(https?:\/\/)?([a-z0-9-]+\.)?pinterest\.[a-z.]+\/pin\/[\w-]+\/?/,
        /^(https?:\/\/)?pin\.it\/[\w-]+\/?/,
        /^(https?:\/\/)?([a-z0-9-]+\.)?pinimg\.com\/.+/
    ];
    return patterns.some(pattern => pattern.test(url));
}

function extractVideoId(url) {
    const patterns = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/,
        /youtube\.com\/watch\?.*v=([^&\s]+)/,
        /youtube\.com\/shorts\/([^&\s?]+)/,
        /youtube\.com\/live\/([^&\s?]+)/
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

function formatTimestamp(seconds) {
    seconds = Math.max(0, Math.round(seconds || 0));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function parseTimestamp(str) {
    if (typeof str !== 'string') return null;
    str = str.trim();
    if (!str) return null;
    
    // Check if simple integer or float seconds (e.g. "45" or "45.5")
    if (/^\d+(\.\d+)?$/.test(str)) {
        return Math.floor(parseFloat(str));
    }
    
    // Check MM:SS or HH:MM:SS
    const parts = str.split(':').map(Number);
    if (parts.some(isNaN)) return null;
    
    if (parts.length === 2) {
        const [m, s] = parts;
        if (s < 0 || s >= 60 || m < 0) return null;
        return m * 60 + s;
    } else if (parts.length === 3) {
        const [h, m, s] = parts;
        if (s < 0 || s >= 60 || m < 0 || m >= 60 || h < 0) return null;
        return h * 3600 + m * 60 + s;
    }
    return null;
}

function showTrimError(msg) {
    if (elements.trimValidationMsg) {
        elements.trimValidationMsg.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> ${msg}`;
        elements.trimValidationMsg.classList.remove('hidden');
    }
}

function clearTrimError() {
    if (elements.trimValidationMsg) {
        elements.trimValidationMsg.textContent = '';
        elements.trimValidationMsg.classList.add('hidden');
    }
    if (elements.trimStartInput) elements.trimStartInput.classList.remove('error');
    if (elements.trimEndInput) elements.trimEndInput.classList.remove('error');
}

function updateTrimUI() {
    const duration = trimState.duration;
    
    if (duration > 0) {
        // Clamp bounds
        trimState.startTime = Math.max(0, Math.min(trimState.startTime, duration - 1));
        trimState.endTime = Math.max(trimState.startTime + 1, Math.min(trimState.endTime, duration));
        
        const startPct = (trimState.startTime / duration) * 100;
        const endPct = (trimState.endTime / duration) * 100;
        
        if (elements.trimHandleStart) elements.trimHandleStart.style.left = `${startPct}%`;
        if (elements.trimHandleEnd) elements.trimHandleEnd.style.left = `${endPct}%`;
        if (elements.trimTrackHighlight) {
            elements.trimTrackHighlight.style.left = `${startPct}%`;
            elements.trimTrackHighlight.style.width = `${Math.max(0, endPct - startPct)}%`;
        }
        
        if (elements.trimTooltipStart) elements.trimTooltipStart.textContent = formatTimestamp(trimState.startTime);
        if (elements.trimTooltipEnd) elements.trimTooltipEnd.textContent = formatTimestamp(trimState.endTime);
        
        if (elements.trimTimelineStartLabel) elements.trimTimelineStartLabel.textContent = formatTimestamp(0);
        if (elements.trimTimelineEndLabel) elements.trimTimelineEndLabel.textContent = formatTimestamp(duration);
        
        // Update input boxes if not currently focused
        if (elements.trimStartInput && document.activeElement !== elements.trimStartInput) {
            elements.trimStartInput.value = formatTimestamp(trimState.startTime);
        }
        if (elements.trimEndInput && document.activeElement !== elements.trimEndInput) {
            elements.trimEndInput.value = formatTimestamp(trimState.endTime);
        }
        
        // ARIA attributes
        if (elements.trimHandleStart) {
            elements.trimHandleStart.setAttribute('aria-valuenow', trimState.startTime);
            elements.trimHandleStart.setAttribute('aria-valuemax', trimState.endTime - 1);
        }
        if (elements.trimHandleEnd) {
            elements.trimHandleEnd.setAttribute('aria-valuenow', trimState.endTime);
            elements.trimHandleEnd.setAttribute('aria-valuemin', trimState.startTime + 1);
            elements.trimHandleEnd.setAttribute('aria-valuemax', duration);
        }
        
        const clipLen = trimState.endTime - trimState.startTime;
        const isTrimActive = trimState.isEnabled && (trimState.startTime > 0 || trimState.endTime < duration);
        
        if (isTrimActive) {
            if (elements.trimDurationBadge) elements.trimDurationBadge.textContent = `Clip: ${formatTimestamp(clipLen)}`;
            if (elements.trimTimelineStatus) elements.trimTimelineStatus.textContent = `Clip Length: ${formatTimestamp(clipLen)} (${clipLen}s)`;
            
            elements.trimIndicatorDots.forEach(dot => dot.classList.remove('hidden'));
            elements.trimBadges.forEach(badge => {
                badge.textContent = formatTimestamp(clipLen);
                badge.classList.remove('hidden');
            });
            if (elements.trimToggleAudio) elements.trimToggleAudio.classList.add('active-trim');
            if (elements.trimToggleVideo) elements.trimToggleVideo.classList.add('active-trim');
        } else {
            if (elements.trimDurationBadge) elements.trimDurationBadge.textContent = `Full: ${formatTimestamp(duration)}`;
            if (elements.trimTimelineStatus) elements.trimTimelineStatus.textContent = 'Full Video';
            
            elements.trimIndicatorDots.forEach(dot => dot.classList.add('hidden'));
            elements.trimBadges.forEach(badge => badge.classList.add('hidden'));
            if (elements.trimToggleAudio) elements.trimToggleAudio.classList.remove('active-trim');
            if (elements.trimToggleVideo) elements.trimToggleVideo.classList.remove('active-trim');
        }
    } else {
        // No metadata yet
        if (elements.trimHandleStart) elements.trimHandleStart.style.left = '0%';
        if (elements.trimHandleEnd) elements.trimHandleEnd.style.left = '100%';
        if (elements.trimTrackHighlight) {
            elements.trimTrackHighlight.style.left = '0%';
            elements.trimTrackHighlight.style.width = '100%';
        }
        
        if (elements.trimTooltipStart) elements.trimTooltipStart.textContent = '00:00';
        if (elements.trimTooltipEnd) elements.trimTooltipEnd.textContent = '--:--';
        if (elements.trimTimelineStartLabel) elements.trimTimelineStartLabel.textContent = '00:00';
        if (elements.trimTimelineEndLabel) elements.trimTimelineEndLabel.textContent = '--:--';
        if (elements.trimTimelineStatus) elements.trimTimelineStatus.textContent = 'Paste video URL to load length';
        if (elements.trimDurationBadge) elements.trimDurationBadge.textContent = 'Full Video';
        
        elements.trimIndicatorDots.forEach(dot => dot.classList.add('hidden'));
        elements.trimBadges.forEach(badge => badge.classList.add('hidden'));
        if (elements.trimToggleAudio) elements.trimToggleAudio.classList.remove('active-trim');
        if (elements.trimToggleVideo) elements.trimToggleVideo.classList.remove('active-trim');
    }
    
    // Sync open state styling
    if (elements.trimToggleAudio) {
        if (trimState.isOpen) elements.trimToggleAudio.classList.add('open');
        else elements.trimToggleAudio.classList.remove('open');
    }
    if (elements.trimToggleVideo) {
        if (trimState.isOpen) elements.trimToggleVideo.classList.add('open');
        else elements.trimToggleVideo.classList.remove('open');
    }
}

function toggleTrimSection() {
    trimState.isOpen = !trimState.isOpen;
    if (trimState.isOpen) {
        elements.trimSection.classList.remove('hidden');
        const url = elements.urlInput.value.trim();
        if (url && isValidUrl(url) && trimState.duration === 0) {
            loadVideoMetadata(url);
        }
    } else {
        elements.trimSection.classList.add('hidden');
    }
    updateTrimUI();
}

async function loadVideoMetadata(url, force = false) {
    url = normalizeYouTubeUrl(url.trim());
    if (!isValidUrl(url)) return;
    if (!force && trimState.sourceUrl === url && trimState.duration > 0) return;
    
    try {
        const isNewUrl = trimState.sourceUrl !== url;
        trimState.sourceUrl = url;
        
        const videoInfo = await fetchVideoInfo(url);
        trimState.cachedVideoInfo = videoInfo;
        displayVideoPreview(videoInfo);
        
        const videoDuration = Math.max(1, Math.round(videoInfo.duration || 0));
        trimState.duration = videoDuration;
        
        // If this is a new video or range uninitialized, default to full range
        if (isNewUrl || (trimState.startTime === 0 && trimState.endTime === 0)) {
            trimState.startTime = 0;
            trimState.endTime = videoDuration;
        } else if (trimState.endTime > videoDuration) {
            trimState.endTime = videoDuration;
        }
        
        clearTrimError();
        updateTrimUI();
    } catch (err) {
        console.warn('Metadata fetch note:', err.message);
    }
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
    const type = btn.dataset.format; // 'audio', 'video', or 'image'
    
    if (type === currentMode) return;
    
    // Update Type Buttons
    document.querySelectorAll('[data-format="audio"], [data-format="video"], [data-format="image"]').forEach(b => {
        b.classList.remove('active');
    });
    btn.classList.add('active');
    
    currentMode = type;
    
    // Toggle Format Containers
    if (type === 'audio') {
        elements.videoFormats.classList.add('hidden');
        elements.imageFormats.classList.add('hidden');
        elements.audioFormats.classList.remove('hidden');
        // Restore trimming controls if open
        if (trimState.isOpen) {
            elements.trimSection.classList.remove('hidden');
        }
        updateTrimUI();
        // Set default audio format
        selectFormat('mp3-128');
    } else if (type === 'video') {
        elements.audioFormats.classList.add('hidden');
        elements.imageFormats.classList.add('hidden');
        elements.videoFormats.classList.remove('hidden');
        // Restore trimming controls if open
        if (trimState.isOpen) {
            elements.trimSection.classList.remove('hidden');
        }
        updateTrimUI();
        // Set default video format
        selectFormat('mp4-1080');
    } else {
        // Image format: hide trimming controls completely
        elements.audioFormats.classList.add('hidden');
        elements.videoFormats.classList.add('hidden');
        elements.imageFormats.classList.remove('hidden');
        elements.trimSection.classList.add('hidden');
        selectFormat('image-png');
    }
}

function selectFormat(formatId) {
    selectedFormat = formatId;
    
    // Update active state in the visible container
    let container = elements.audioFormats;
    if (currentMode === 'video') container = elements.videoFormats;
    if (currentMode === 'image') container = elements.imageFormats;
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
        const response = await axios.get(`${API_BASE_URL}/info?url=${encodeURIComponent(url)}`);
        return response.data;
    } catch (error) {
        const detail = error.response?.data?.detail || error.message || 'Network error. Please check your connection.';
        throw new Error(detail);
    }
}

async function startConversion(url, format, startTime = null, endTime = null) {
    try {
        const payload = { url, format };
        if (startTime !== null && endTime !== null) {
            payload.start_time = startTime;
            payload.end_time = endTime;
        }
        const response = await axios.post(`${API_BASE_URL}/convert`, payload);
        return response.data;
    } catch (error) {
        const detail = error.response?.data?.detail || error.message || 'Network error. Please check your connection.';
        throw new Error(detail);
    }
}

async function checkJobStatus(jobId) {
    try {
        const response = await axios.get(`${API_BASE_URL}/status/${jobId}`);
        return response.data;
    } catch (error) {
        const detail = error.response?.data?.detail || error.message || 'Network error. Please check your connection.';
        throw new Error(detail);
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

function clearPolling() {
    if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
    }
    if (pollTimeoutTimer) {
        clearTimeout(pollTimeoutTimer);
        pollTimeoutTimer = null;
    }
}

function startProgressPolling(jobId) {
    clearPolling();

    let delay = POLL_INITIAL_MS;

    // Hard timeout — stop polling after POLL_TIMEOUT_MS no matter what
    pollTimeoutTimer = setTimeout(() => {
        clearPolling();
        showError('Conversion timed out. Please try again.');
    }, POLL_TIMEOUT_MS);

    async function poll() {
        // Pause while the tab is hidden to save resources
        if (document.hidden) {
            pollTimer = setTimeout(poll, POLL_MAX_MS);
            return;
        }

        try {
            const status = await checkJobStatus(jobId);

            if (status.status === 'completed') {
                clearPolling();
                updateProgress('Complete!', 100);
                showSection(elements.downloadSection);
                setLoading(false);
            } else if (status.status === 'failed') {
                clearPolling();
                showError(status.error || 'Conversion failed. Please try again.');
            } else {
                updateProgress(status.message || 'Processing...', status.progress || 0);
                // Use a gentle 2-second poll interval during active processing
                // so the UI stays responsive without hammering the server.
                delay = 2000;
                pollTimer = setTimeout(poll, delay);
            }
        } catch (error) {
            clearPolling();
            showError(error.message);
        }
    }

    // Kick off the first poll after the initial delay
    pollTimer = setTimeout(poll, delay);
}

// ==================== Timeline Drag & Interactions ====================
function initTimelineDrag() {
    function getEventClientX(e) {
        if (e.touches && e.touches.length > 0) {
            return e.touches[0].clientX;
        }
        return e.clientX;
    }

    function onPointerDown(handleType, e) {
        if (trimState.duration <= 0) return;
        e.preventDefault();
        trimState.isDragging = handleType;
        if (handleType === 'start') {
            elements.trimHandleStart.classList.add('dragging');
        } else {
            elements.trimHandleEnd.classList.add('dragging');
        }
        clearTrimError();
    }

    if (elements.trimHandleStart) {
        elements.trimHandleStart.addEventListener('mousedown', (e) => onPointerDown('start', e));
        elements.trimHandleStart.addEventListener('touchstart', (e) => onPointerDown('start', e), { passive: false });
    }
    
    if (elements.trimHandleEnd) {
        elements.trimHandleEnd.addEventListener('mousedown', (e) => onPointerDown('end', e));
        elements.trimHandleEnd.addEventListener('touchstart', (e) => onPointerDown('end', e), { passive: false });
    }

    function onPointerMove(e) {
        if (!trimState.isDragging || trimState.duration <= 0) return;
        
        const clientX = getEventClientX(e);
        const rect = elements.trimTimeline.getBoundingClientRect();
        const offsetX = Math.max(0, Math.min(rect.width, clientX - rect.left));
        const ratio = offsetX / rect.width;
        let time = Math.round(ratio * trimState.duration);
        
        if (trimState.isDragging === 'start') {
            time = Math.max(0, Math.min(trimState.endTime - 1, time));
            trimState.startTime = time;
        } else if (trimState.isDragging === 'end') {
            time = Math.max(trimState.startTime + 1, Math.min(trimState.duration, time));
            trimState.endTime = time;
        }
        
        updateTrimUI();
    }

    function onPointerUp() {
        if (trimState.isDragging) {
            trimState.isDragging = null;
            if (elements.trimHandleStart) elements.trimHandleStart.classList.remove('dragging');
            if (elements.trimHandleEnd) elements.trimHandleEnd.classList.remove('dragging');
            updateTrimUI();
        }
    }

    document.addEventListener('mousemove', onPointerMove);
    document.addEventListener('touchmove', onPointerMove, { passive: false });
    document.addEventListener('mouseup', onPointerUp);
    document.addEventListener('touchend', onPointerUp);

    // Track click to snap the closest handle
    if (elements.trimTimeline) {
        elements.trimTimeline.addEventListener('click', (e) => {
            if (trimState.duration <= 0) return;
            if (e.target.closest('.trim-handle')) return;
            
            const rect = elements.trimTimeline.getBoundingClientRect();
            const offsetX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
            const ratio = offsetX / rect.width;
            const clickTime = Math.round(ratio * trimState.duration);
            
            const distToStart = Math.abs(clickTime - trimState.startTime);
            const distToEnd = Math.abs(clickTime - trimState.endTime);
            
            if (distToStart <= distToEnd) {
                trimState.startTime = Math.max(0, Math.min(trimState.endTime - 1, clickTime));
            } else {
                trimState.endTime = Math.max(trimState.startTime + 1, Math.min(trimState.duration, clickTime));
            }
            clearTrimError();
            updateTrimUI();
        });
    }

    // Keyboard navigation on handles
    if (elements.trimHandleStart) {
        elements.trimHandleStart.addEventListener('keydown', (e) => {
            if (trimState.duration <= 0) return;
            const step = e.shiftKey ? 5 : 1;
            if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
                e.preventDefault();
                trimState.startTime = Math.max(0, trimState.startTime - step);
                updateTrimUI();
            } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
                e.preventDefault();
                trimState.startTime = Math.min(trimState.endTime - 1, trimState.startTime + step);
                updateTrimUI();
            }
        });
    }

    if (elements.trimHandleEnd) {
        elements.trimHandleEnd.addEventListener('keydown', (e) => {
            if (trimState.duration <= 0) return;
            const step = e.shiftKey ? 5 : 1;
            if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
                e.preventDefault();
                trimState.endTime = Math.max(trimState.startTime + 1, trimState.endTime - step);
                updateTrimUI();
            } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
                e.preventDefault();
                trimState.endTime = Math.min(trimState.duration, trimState.endTime + step);
                updateTrimUI();
            }
        });
    }
}

// ==================== Timestamp Inputs & Controls ====================
function initTimestampInputs() {
    function handleStartCommit() {
        const parsed = parseTimestamp(elements.trimStartInput.value);
        if (parsed === null || parsed < 0) {
            showTrimError('Invalid start time (use MM:SS or seconds).');
            elements.trimStartInput.classList.add('error');
            return;
        }
        if (parsed >= trimState.endTime) {
            showTrimError('Start time must be less than end time.');
            elements.trimStartInput.classList.add('error');
            return;
        }
        if (trimState.duration > 0 && parsed >= trimState.duration) {
            showTrimError('Start time cannot exceed video duration.');
            elements.trimStartInput.classList.add('error');
            return;
        }
        clearTrimError();
        trimState.startTime = parsed;
        updateTrimUI();
    }

    function handleEndCommit() {
        const parsed = parseTimestamp(elements.trimEndInput.value);
        if (parsed === null) {
            showTrimError('Invalid end time (use MM:SS or seconds).');
            elements.trimEndInput.classList.add('error');
            return;
        }
        if (parsed <= trimState.startTime) {
            showTrimError('End time must be greater than start time.');
            elements.trimEndInput.classList.add('error');
            return;
        }
        if (trimState.duration > 0 && parsed > trimState.duration) {
            showTrimError(`End time cannot exceed video duration (${formatTimestamp(trimState.duration)}).`);
            elements.trimEndInput.classList.add('error');
            return;
        }
        clearTrimError();
        trimState.endTime = parsed;
        updateTrimUI();
    }

    if (elements.trimStartInput) {
        elements.trimStartInput.addEventListener('blur', handleStartCommit);
        elements.trimStartInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') elements.trimStartInput.blur();
        });
    }

    if (elements.trimEndInput) {
        elements.trimEndInput.addEventListener('blur', handleEndCommit);
        elements.trimEndInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') elements.trimEndInput.blur();
        });
    }

    if (elements.trimResetBtn) {
        elements.trimResetBtn.addEventListener('click', () => {
            trimState.startTime = 0;
            trimState.endTime = trimState.duration > 0 ? trimState.duration : 0;
            clearTrimError();
            updateTrimUI();
        });
    }

    if (elements.trimEnableToggle) {
        elements.trimEnableToggle.addEventListener('change', (e) => {
            trimState.isEnabled = e.target.checked;
            const textEl = elements.trimEnableToggle.parentElement.querySelector('.trim-switch-text');
            if (textEl) {
                textEl.textContent = trimState.isEnabled ? 'Enabled' : 'Disabled';
            }
            clearTrimError();
            updateTrimUI();
        });
    }
}

// ==================== Event Handlers ====================
async function handlePasteClick() {
    try {
        const text = await navigator.clipboard.readText();
        elements.urlInput.value = text;
        elements.urlInput.focus();
        if (isValidUrl(text.trim())) {
            loadVideoMetadata(text.trim());
        }
    } catch (error) {
        console.error('Failed to read clipboard:', error);
    }
}

async function handleConvert() {
    let url = elements.urlInput.value.trim();
    
    // Validate URL
    if (!url) {
        showError('Please enter a Proper URL');
        return;
    }
    
    if (!isValidUrl(url)) {
        showError('1D-10T Error. Please enter a valid YouTube, Instagram, or Pinterest URL.');
        return;
    }
    
    // Normalize YouTube Shorts URLs to standard watch URLs
    url = normalizeYouTubeUrl(url);

    // Determine trimming parameters
    let startTime = null;
    let endTime = null;

    if (currentMode !== 'image' && trimState.isEnabled) {
        const isCustomRange = trimState.startTime > 0 || (trimState.duration > 0 && trimState.endTime < trimState.duration);
        if (isCustomRange) {
            if (trimState.startTime < 0) {
                showError('Trim start time cannot be negative.');
                return;
            }
            if (trimState.endTime <= trimState.startTime) {
                showError('Please enter a valid trim range: End time must be greater than start time.');
                return;
            }
            if (trimState.duration > 0 && trimState.endTime > trimState.duration) {
                showError(`Trim end time cannot exceed video duration (${formatTimestamp(trimState.duration)}).`);
                return;
            }
            startTime = trimState.startTime;
            endTime = trimState.endTime;
        }
    }
    
    setLoading(true);
    
    try {
        // Fetch or re-use video info
        let videoInfo = trimState.cachedVideoInfo;
        if (!videoInfo || trimState.sourceUrl !== url) {
            videoInfo = await fetchVideoInfo(url);
            trimState.cachedVideoInfo = videoInfo;
            trimState.sourceUrl = url;
            trimState.duration = Math.max(1, Math.round(videoInfo.duration || 0));
            if (trimState.endTime === 0 || trimState.endTime > trimState.duration) {
                trimState.endTime = trimState.duration;
            }
        }
        displayVideoPreview(videoInfo);
        
        // Start conversion
        const conversionResponse = await startConversion(url, selectedFormat, startTime, endTime);
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
    clearPolling();
    
    // Hide all sections
    showSection(null);
    
    // Reset progress
    updateProgress('Processing...', 0);

    // Reset trim state
    trimState.sourceUrl = '';
    trimState.cachedVideoInfo = null;
    trimState.duration = 0;
    trimState.startTime = 0;
    trimState.endTime = 0;
    clearTrimError();
    updateTrimUI();
    
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

// Trim toggles beside Quality label
if (elements.trimToggleAudio) {
    elements.trimToggleAudio.addEventListener('click', toggleTrimSection);
}
if (elements.trimToggleVideo) {
    elements.trimToggleVideo.addEventListener('click', toggleTrimSection);
}

// URL input change / paste / blur detection for metadata prefetching
let urlDebounceTimer = null;
elements.urlInput.addEventListener('input', () => {
    clearTimeout(urlDebounceTimer);
    urlDebounceTimer = setTimeout(() => {
        const val = elements.urlInput.value.trim();
        if (isValidUrl(val)) {
            loadVideoMetadata(val);
        }
    }, 600);
});

elements.urlInput.addEventListener('blur', () => {
    const val = elements.urlInput.value.trim();
    if (isValidUrl(val)) {
        loadVideoMetadata(val);
    }
});

elements.urlInput.addEventListener('paste', () => {
    setTimeout(() => {
        const val = elements.urlInput.value.trim();
        if (isValidUrl(val)) {
            loadVideoMetadata(val);
        }
    }, 100);
});

// Type Selection
document.querySelectorAll('[data-format="audio"], [data-format="video"], [data-format="image"]').forEach(btn => {
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
console.log('Reelo initialized');

// Initialize timeline drag & inputs
initTimelineDrag();
initTimestampInputs();

// Initialize UI state
if (currentMode === 'audio') {
    elements.videoFormats.classList.add('hidden');
    elements.imageFormats.classList.add('hidden');
    elements.audioFormats.classList.remove('hidden');
    document.querySelector('[data-format="video"]').classList.remove('active');
    document.querySelector('[data-format="image"]').classList.remove('active');
    document.querySelector('[data-format="audio"]').classList.add('active');
} else if (currentMode === 'video') {
    elements.audioFormats.classList.add('hidden');
    elements.imageFormats.classList.add('hidden');
    elements.videoFormats.classList.remove('hidden');
    document.querySelector('[data-format="audio"]').classList.remove('active');
    document.querySelector('[data-format="image"]').classList.remove('active');
    document.querySelector('[data-format="video"]').classList.add('active');
} else {
    elements.audioFormats.classList.add('hidden');
    elements.videoFormats.classList.add('hidden');
    elements.imageFormats.classList.remove('hidden');
    document.querySelector('[data-format="audio"]').classList.remove('active');
    document.querySelector('[data-format="video"]').classList.remove('active');
    document.querySelector('[data-format="image"]').classList.add('active');
}

// Set initial active format button and trim UI
selectFormat(selectedFormat);
updateTrimUI();
