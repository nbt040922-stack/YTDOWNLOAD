// XSS Protection
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// Window Controls
document.getElementById('winMinimize')?.addEventListener('click', () => window.electronAPI.minimizeWindow());
document.getElementById('winMaximize')?.addEventListener('click', () => window.electronAPI.maximizeWindow());
document.getElementById('winClose')?.addEventListener('click', () => window.electronAPI.closeWindow());
document.getElementById('btnLogin')?.addEventListener('click', async () => {
    try {
        await window.electronAPI.loginYouTube();
        alert('Login check completed! Cookies have been updated.');
    } catch (e) {
        alert('Login Error: ' + e.message);
    }
});

// UI Selectors
const downloadBtn = document.getElementById('downloadBtn');
const urlInput = document.getElementById('urlInput');
const currentPathText = document.getElementById('currentPath');
const downloadList = document.getElementById('downloadList');
const welcomeArea = document.getElementById('welcomeArea');
const engineLabel = document.getElementById('engineLabel');
const storagePicker = document.getElementById('storagePicker');

let currentSavePath = '';
let activeDownloads = 0;
let completedDownloads = 0;
const downloadQueue = [];
const MAX_CONCURRENT = 5;

// Initialize Storage & UI
async function initApp() {
    // Get path from Main Process (persisted in settings.json or default downloads)
    currentSavePath = await window.electronAPI.getDefaultPath();
    
    // Update UI
    if (currentPathText) currentPathText.innerText = currentSavePath;
    updateFooterStatus();
}

storagePicker?.addEventListener('click', async () => {
    const newPath = await window.electronAPI.selectFolder();
    if (newPath) {
        currentSavePath = newPath;
        if (currentPathText) currentPathText.innerText = newPath;
    }
});

function updateFooterStatus() {
    if (engineLabel) engineLabel.innerText = `Queue: ${downloadQueue.length} | Downloading: ${activeDownloads} | Completed: ${completedDownloads}`;
}

// Dropdown Menu Logic
const menuItems = document.querySelectorAll('.menu-item');
menuItems.forEach(item => {
    item.addEventListener('click', (e) => {
        if (e.target.closest('.dropdown-menu')) return;
        const isOpen = item.classList.contains('open');
        menuItems.forEach(i => i.classList.remove('open'));
        if (!isOpen) item.classList.add('open');
        e.stopPropagation();
    });
});

window.addEventListener('click', () => {
    menuItems.forEach(i => i.classList.remove('open'));
});

// Menu Action Handlers
document.getElementById('btnMinimizeTray')?.addEventListener('click', () => window.electronAPI.minimizeToTray());
document.getElementById('btnQuit')?.addEventListener('click', () => window.electronAPI.quitApp());

document.getElementById('btnCancelAll')?.addEventListener('click', () => {
    window.electronAPI.cancelAllDownloads();
    downloadQueue.length = 0; // Clear the queue
    document.querySelectorAll('.download-card').forEach(card => {
        if (!card.classList.contains('completed')) card.remove();
    });
    activeDownloads = 0;
    updateFooterStatus();
    checkEmpty();
});

document.getElementById('btnClearCompleted')?.addEventListener('click', () => {
    document.querySelectorAll('.download-card.completed').forEach(card => card.remove());
    checkEmpty();
});

document.getElementById('btnClearFailed')?.addEventListener('click', () => {
    document.querySelectorAll('.download-card.error').forEach(card => card.remove());
    checkEmpty();
});

document.getElementById('btnOpenHome')?.addEventListener('click', () => window.electronAPI.openHomeDir());
document.getElementById('btnUpdateEngine')?.addEventListener('click', async () => {
    const btn = document.getElementById('btnUpdateEngine');
    const originalContent = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Updating...';
    try {
        const result = await window.electronAPI.updateEngine();
        alert(result.code === 0 ? 'Update successful!' : 'Update failed: ' + result.output);
    } catch (e) {
        alert('Update error: ' + e.message);
    } finally {
        btn.innerHTML = originalContent;
    }
});
document.getElementById('btnFfmpegWeb')?.addEventListener('click', () => window.electronAPI.openExternal('https://ffmpeg.org/download.html'));
document.getElementById('btnChangelog')?.addEventListener('click', (e) => {
    e.preventDefault();
    window.electronAPI.openExternal('https://github.com/yt-dlp/yt-dlp/releases');
});

// Login Link
document.getElementById('btnLoginURL')?.addEventListener('click', () => document.getElementById('btnLogin').click());

// Download Card Management
function createDownloadCard(id, title, thumbnail = '', url = '') {
    const card = document.createElement('div');
    card.className = 'download-card';
    card.id = `card-${id}`;
    card.setAttribute('data-url', url);
    card.innerHTML = `
        <div class="card-thumbnail">
            <img src="${escapeHtml(thumbnail) || 'resources/mascot.png'}">
            <div class="card-status-overlay">
                <i class="fas fa-spinner fa-spin-slow"></i>
            </div>
        </div>
        <div class="card-content">
            <div class="card-title">${escapeHtml(title)}</div>
            <div class="card-info">
                <span id="speed-${escapeHtml(id)}">Waiting...</span>
                <span id="percent-${escapeHtml(id)}">0%</span>
            </div>
            <div class="progress-container"><div id="fill-${escapeHtml(id)}" class="progress-fill"></div></div>
        </div>
        <div class="card-actions" id="actions-${escapeHtml(id)}">
            <div class="action-btn" onclick="deleteCard('${escapeHtml(id)}')">
                <i class="fas fa-times"></i>
            </div>
        </div>
    `;
    downloadList.appendChild(card);
    downloadList.classList.remove('hidden');
    welcomeArea.classList.add('hidden');
    // Note: activeDownloads is managed by the queue
}

function deleteCard(id) {
    const card = document.getElementById(`card-${id}`);
    if (card) {
        card.remove();
    }
    checkEmpty();
    updateFooterStatus();
}

function retryDownload(id) {
    const card = document.getElementById(`card-${id}`);
    if (!card) return;
    const url = card.getAttribute('data-url');
    if (!url) return;

    card.classList.remove('error');
    const speed = document.getElementById(`speed-${id}`);
    if (speed) {
        speed.innerText = 'Queued...';
        speed.style.color = '';
    }
    const actions = document.getElementById(`actions-${id}`);
    if (actions) {
        actions.innerHTML = `<div class="action-btn" onclick="deleteCard('${id}')"><i class="fas fa-times"></i></div>`;
    }
    
    downloadQueue.unshift(url);
    processQueue();
}

function checkEmpty() {
    if (downloadList.children.length === 0) {
        downloadList.classList.add('hidden');
        welcomeArea.classList.remove('hidden');
    }
}

// IPC Listeners
window.electronAPI.onDownloadProgress(({ id, value }) => {
    const fill = document.getElementById(`fill-${id}`);
    const percent = document.getElementById(`percent-${id}`);
    const speed = document.getElementById(`speed-${id}`);
    if (fill) fill.style.width = `${value}%`;
    if (percent) percent.innerText = `${Math.floor(value)}%`;
    if (speed && speed.innerText === 'Analyzing...') speed.innerText = 'Downloading...';
    
    // Detect Merging (usually at 100% or near end)
    if (value >= 100 && speed) speed.innerText = 'Merging...';
});

window.electronAPI.onDownloadSpeed(({ id, value }) => {
    const speed = document.getElementById(`speed-${id}`);
    if (speed) speed.innerText = value;
});

window.electronAPI.onDownloadComplete(({ id }) => {
    activeDownloads--;
    completedDownloads++;
    updateFooterStatus();
    const card = document.getElementById(`card-${id}`);
    if (card) {
        card.classList.add('completed');
        const fill = document.getElementById(`fill-${id}`);
        if (fill) fill.style.backgroundColor = '#4caf50';
        const speed = document.getElementById(`speed-${id}`);
        if (speed) speed.innerText = 'Completed';
        const actions = document.getElementById(`actions-${id}`);
        if (actions) actions.innerHTML = `<div class="action-btn" style="color: #4caf50"><i class="fas fa-check-circle"></i></div>`;
    }
    processQueue();
});

window.electronAPI.onDownloadError(({ id, message }) => {
    activeDownloads--;
    updateFooterStatus();
    const card = document.getElementById(`card-${id}`);
    if (card) {
        card.classList.add('error');
        const speed = document.getElementById(`speed-${id}`);
        if (speed) {
            speed.innerText = message === 'Missing output file (FFmpeg Error?)' ? 'Failed: ' + message : 'Error';
            speed.style.color = '#f44336';
        }
        const actions = document.getElementById(`actions-${id}`);
        if (actions) {
            actions.innerHTML = `
                <div class="action-btn retry" onclick="retryDownload('${id}')" title="Retry"><i class="fas fa-sync-alt"></i></div>
                <div class="action-btn delete" onclick="deleteCard('${id}')" title="Delete"><i class="fas fa-trash"></i></div>
            `;
        }
    }
    processQueue();
});

// Queue Processor
async function processQueue() {
    while (activeDownloads < MAX_CONCURRENT && downloadQueue.length > 0) {
        const item = downloadQueue.shift();
        // Item can be a string (URL) or an object { url, subDir }
        const url = typeof item === 'string' ? item : item.url;
        const subDir = typeof item === 'object' ? item.subDir : null;
        
        const tempId = 'task-' + Date.now() + Math.random().toString(36).substring(2, 7);
        activeDownloads++;
        createDownloadCard(tempId, 'Analyzing URL...', 'resources/mascot.png', url);
        handleQueueItem(url, tempId, subDir);
    }
    updateFooterStatus();
}

async function handleQueueItem(url, tempId, subDir) {
    try {
        const speedElem = document.getElementById(`speed-${tempId}`);
        if (speedElem) speedElem.innerText = 'Analyzing...';
        
        const metadata = await window.electronAPI.getMetadata(url);
        const realId = metadata.id || Date.now().toString();
        
        // Update Card UI
        const card = document.getElementById(`card-${tempId}`);
        if (card) {
            card.id = `card-${realId}`;
            card.querySelector('.card-title').innerText = metadata.title;
            card.querySelector('.card-thumbnail img').src = metadata.thumbnail;
            card.querySelector('.progress-fill').id = `fill-${realId}`;
            card.querySelector('.card-info span:last-child').id = `percent-${realId}`;
            card.querySelector('.card-info span:first-child').id = `speed-${realId}`;
            card.querySelector('.card-actions').id = `actions-${realId}`;
            const speed = document.getElementById(`speed-${realId}`);
            if (speed) speed.innerText = 'Downloading...';
        }
        
        window.electronAPI.downloadVideo({ 
            id: realId, 
            url, 
            savePath: currentSavePath, 
            title: metadata.title,
            subDir: subDir 
        });
    } catch (err) {
        console.error('Queue Task Error:', err);
        const card = document.getElementById(`card-${tempId}`);
        if (card) {
            card.classList.add('error');
            const speed = document.getElementById(`speed-${tempId}`);
            if (speed) {
                speed.innerText = 'Failed to fetch info';
                speed.style.color = '#f44336';
            }
            const actions = document.getElementById(`actions-${tempId}`);
            if (actions) {
                actions.innerHTML = `
                    <div class="action-btn retry" onclick="retryDownload('${tempId}')" title="Retry"><i class="fas fa-sync-alt"></i></div>
                    <div class="action-btn delete" onclick="deleteCard('${tempId}')" title="Delete"><i class="fas fa-trash"></i></div>
                `;
            }
        }
        activeDownloads--;
        updateFooterStatus();
        processQueue();
    }
}

// Primary Download Trigger
downloadBtn?.addEventListener('click', async () => {
    const rawVal = urlInput.value.trim();
    if (!rawVal) return;
    
    const urls = rawVal.split('\n').map(u => u.trim()).filter(u => u.length > 0);
    if (urls.length === 0) return;

    // Validate YouTube URLs
    const youtubePattern = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be|music\.youtube\.com)\/.+/;
    const validUrls = urls.filter(u => youtubePattern.test(u));
    if (validUrls.length === 0) {
        alert('Vui lòng nhập URL YouTube hợp lệ');
        return;
    }

    const firstUrl = validUrls[0];
    // Check if it's a channel playlist link
    const isPlaylist = firstUrl.includes('/@') && (firstUrl.includes('/videos') || firstUrl.includes('/shorts') || firstUrl.includes('/playlists') || firstUrl.includes('/streams'));
    
    if (isPlaylist && validUrls.length === 1) {
        showPlaylistScanner(firstUrl);
        urlInput.value = '';
        return;
    }

    downloadQueue.push(...validUrls);
    urlInput.value = '';
    processQueue();
});

// Playlist Batch Logic
const playlistModal = document.getElementById('playlistModal');
const playlistItems = document.getElementById('playlistItems');
const closeModal = document.getElementById('closeModal');
const selectAll = document.getElementById('selectAll');
const btnStartBatch = document.getElementById('btnStartBatch');

let scannedVideos = [];

async function showPlaylistScanner(url) {
    const originalContent = downloadBtn.innerHTML;
    downloadBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    downloadBtn.style.pointerEvents = 'none';

    try {
        const results = await window.electronAPI.getPlaylistData(url);
        scannedVideos = results;
        renderPlaylistItems(results);
        playlistModal.classList.remove('hidden');
    } catch (e) {
        alert('Failed to scan playlist/channel: ' + e.message);
    } finally {
        downloadBtn.innerHTML = originalContent;
        downloadBtn.style.pointerEvents = '';
    }
}

function renderPlaylistItems(videos) {
    playlistItems.innerHTML = videos.map((v, index) => `
        <div class="playlist-item">
            <label class="checkbox-container">
                <input type="checkbox" class="video-checkbox" data-index="${index}" checked>
                <span class="checkmark"></span>
            </label>
            <img src="${escapeHtml(v.thumbnail) || 'resources/mascot.png'}" class="playlist-item-thumb">
            <div class="playlist-item-info">
                <div class="playlist-item-title">${escapeHtml(v.title)}</div>
                <div class="playlist-item-meta">${escapeHtml(v.uploader)} • ${formatDuration(v.duration)}</div>
            </div>
        </div>
    `).join('');
    
    // Update Select All state
    selectAll.checked = true;
}

function formatDuration(seconds) {
    if (!seconds) return 'Unknown';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return h > 0 ? 
        `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}` : 
        `${m}:${s.toString().padStart(2, '0')}`;
}

closeModal?.addEventListener('click', () => {
    playlistModal.classList.add('hidden');
});

selectAll?.addEventListener('change', (e) => {
    const checkboxes = document.querySelectorAll('.video-checkbox');
    checkboxes.forEach(cb => cb.checked = e.target.checked);
});

btnStartBatch?.addEventListener('click', () => {
    const checkboxes = document.querySelectorAll('.video-checkbox:checked');
    if (checkboxes.length === 0) {
        alert('Please select at least one video to download.');
        return;
    }

    const selected = Array.from(checkboxes).map(cb => scannedVideos[parseInt(cb.dataset.index)]);
    
    // Determine subdirectory (using uploader name from first selected item)
    const subDir = selected[0]?.uploader || 'Batch_Download';

    selected.forEach(v => {
        downloadQueue.push({ url: v.url, subDir: subDir });
    });

    playlistModal.classList.add('hidden');
    processQueue();
});

urlInput.addEventListener('keydown', (e) => { 
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        downloadBtn.click(); 
    }
});

initApp();
