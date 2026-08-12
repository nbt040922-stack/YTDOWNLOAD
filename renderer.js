function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

const downloadBtn = document.getElementById('downloadBtn');
const urlInput = document.getElementById('urlInput');
const downloadList = document.getElementById('downloadList');
const welcomeArea = document.getElementById('welcomeArea');
const engineLabel = document.getElementById('engineLabel');
const activeStates = new Set(['METADATA', 'DOWNLOADING', 'MERGING', 'VERIFYING']);
let currentSavePath = '';
let downloadJobs = [];

document.getElementById('winMinimize')?.addEventListener('click', () => window.electronAPI.minimizeWindow());
document.getElementById('winMaximize')?.addEventListener('click', () => window.electronAPI.maximizeWindow());
document.getElementById('winClose')?.addEventListener('click', () => window.electronAPI.closeWindow());

async function loginYouTube() {
    try {
        const state = await window.electronAPI.loginYouTube();
        updateAuthStateView(state);
        alert(state === 'SIGNED_IN' ? 'YouTube sign-in saved.' : 'YouTube sign-in was not detected.');
    } catch (error) {
        alert('Login Error: ' + error.message);
    }
}

document.getElementById('btnLogin')?.addEventListener('click', loginYouTube);
document.getElementById('btnLoginYouTube')?.addEventListener('click', loginYouTube);
document.getElementById('btnLogoutYouTube')?.addEventListener('click', async () => {
    try {
        updateAuthStateView(await window.electronAPI.logoutYouTube());
    } catch (error) {
        alert('Logout Error: ' + error.message);
    }
});

function updateEngineStatusView(status) {
    if (!status) return;
    const ytDlpVersion = document.getElementById('ytDlpVersion');
    const denoVersion = document.getElementById('denoVersion');
    if (ytDlpVersion) ytDlpVersion.innerText = `yt-dlp: ${status.yt_dlp_version || status.ytdlp_status}`;
    if (denoVersion) denoVersion.innerText = `Deno: ${status.deno_version?.split(/\s+/)[1] || status.deno_status}`;
}

function updateAuthStateView(state) {
    const label = document.getElementById('youtubeAuthState');
    const text = state === 'SIGNED_IN' ? 'Signed in' : state === 'SIGNED_OUT' ? 'Not signed in' : 'Unknown';
    if (label) label.innerText = `YouTube: ${text}`;
    const loginIcon = document.getElementById('btnLogin');
    if (loginIcon) loginIcon.title = `YouTube: ${text}`;
}

function updateFooterStatus() {
    const queued = downloadJobs.filter(job => job.state === 'QUEUED').length;
    const active = downloadJobs.filter(job => activeStates.has(job.state)).length;
    const done = downloadJobs.filter(job => job.state === 'DONE').length;
    if (engineLabel) engineLabel.innerText = `Queue: ${queued} | Downloading: ${active} | Completed: ${done}`;
}

function formatBytes(value) {
    if (!Number.isFinite(value) || value <= 0) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
    return `${(value / (1024 ** index)).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function statusText(job) {
    if (job.state === 'DOWNLOADING') {
        const speed = job.speed ? `${formatBytes(job.speed)}/s` : '';
        const eta = Number.isFinite(job.eta) ? `ETA ${job.eta}s` : '';
        return ['Downloading', speed, eta].filter(Boolean).join(' • ');
    }
    const labels = {
        QUEUED: 'Queued', METADATA: 'Analyzing...', MERGING: 'Merging...', VERIFYING: 'Verifying...',
        DONE: 'Completed', FAILED: job.last_error_message || 'Failed', CANCELLED: 'Cancelled'
    };
    return labels[job.state] || job.state;
}

function createCard(job) {
    const card = document.createElement('div');
    card.className = 'download-card';
    card.dataset.jobId = job.id;
    card.innerHTML = `
        <div class="card-thumbnail">
            <img>
            <div class="card-status-overlay"><i class="fas fa-spinner fa-spin-slow"></i></div>
        </div>
        <div class="card-content">
            <div class="card-title"></div>
            <div class="card-info"><span class="job-status"></span><span class="job-percent"></span></div>
            <div class="progress-container"><div class="progress-fill"></div></div>
        </div>
        <div class="card-actions"></div>`;
    downloadList.appendChild(card);
    return card;
}

function renderJob(job) {
    let card = Array.from(downloadList.children).find(item => item.dataset.jobId === job.id);
    if (!card) card = createCard(job);
    card.classList.toggle('completed', job.state === 'DONE');
    card.classList.toggle('error', job.state === 'FAILED');
    card.classList.toggle('cancelled', job.state === 'CANCELLED');
    card.title = job.exact_output_path || job.last_error_message || '';
    card.querySelector('.card-title').textContent = job.title || 'Analyzing URL...';
    card.querySelector('.card-thumbnail img').src = job.thumbnail || 'resources/mascot.png';
    const progress = Math.max(0, Math.min(100, Number(job.progress_percent) || 0));
    card.querySelector('.job-status').textContent = statusText(job);
    card.querySelector('.job-percent').textContent = `${Math.floor(progress)}%`;
    card.querySelector('.progress-fill').style.width = `${progress}%`;

    const actions = card.querySelector('.card-actions');
    actions.replaceChildren();
    if (job.state === 'QUEUED' || activeStates.has(job.state)) {
        const cancel = document.createElement('div');
        cancel.className = 'action-btn delete';
        cancel.title = 'Cancel';
        cancel.innerHTML = '<i class="fas fa-times"></i>';
        cancel.addEventListener('click', () => window.electronAPI.cancelDownloadJob(job.id));
        actions.appendChild(cancel);
    } else if (job.state === 'FAILED') {
        const retry = document.createElement('div');
        retry.className = 'action-btn retry';
        retry.title = 'Retry';
        retry.innerHTML = '<i class="fas fa-sync-alt"></i>';
        retry.addEventListener('click', () => window.electronAPI.retryDownloadJob(job.id));
        actions.appendChild(retry);
    } else if (job.state === 'DONE') {
        actions.innerHTML = '<div class="action-btn" style="color:#4caf50"><i class="fas fa-check-circle"></i></div>';
    }
}

function renderAllJobs(jobs) {
    downloadJobs = Array.isArray(jobs) ? jobs : [];
    const ids = new Set(downloadJobs.map(job => job.id));
    Array.from(downloadList.children).forEach(card => {
        if (!ids.has(card.dataset.jobId)) card.remove();
    });
    downloadJobs.forEach(renderJob);
    const empty = downloadJobs.length === 0;
    downloadList.classList.toggle('hidden', empty);
    welcomeArea.classList.toggle('hidden', !empty);
    updateFooterStatus();
}

window.electronAPI.onDownloadJobsUpdated(renderAllJobs);
window.electronAPI.onEngineStatusUpdated(updateEngineStatusView);
window.electronAPI.onAuthStateUpdated(updateAuthStateView);

async function initApp() {
    currentSavePath = await window.electronAPI.getDefaultPath();
    updateEngineStatusView(await window.electronAPI.getEngineStatus());
    updateAuthStateView(await window.electronAPI.getAuthState());
    renderAllJobs(await window.electronAPI.getDownloadJobs());
}

document.getElementById('btnSelectFolder')?.addEventListener('click', async () => {
    const newPath = await window.electronAPI.selectFolder();
    if (newPath) currentSavePath = newPath;
});

document.getElementById('btnOpenDownloadFolder')?.addEventListener('click', async () => {
    const result = await window.electronAPI.openDownloadFolder();
    if (!result.ok) alert('Cannot open download folder: ' + result.error);
});

const menuItems = document.querySelectorAll('.menu-item');
menuItems.forEach(item => item.addEventListener('click', event => {
    if (event.target.closest('.dropdown-menu')) return;
    const isOpen = item.classList.contains('open');
    menuItems.forEach(menu => menu.classList.remove('open'));
    if (!isOpen) item.classList.add('open');
    event.stopPropagation();
}));
window.addEventListener('click', () => menuItems.forEach(item => item.classList.remove('open')));

document.getElementById('btnMinimizeTray')?.addEventListener('click', () => window.electronAPI.minimizeToTray());
document.getElementById('btnQuit')?.addEventListener('click', () => window.electronAPI.quitApp());
document.getElementById('btnCancelAll')?.addEventListener('click', () => window.electronAPI.cancelAllDownloads());
document.getElementById('btnClearCompleted')?.addEventListener('click', () => window.electronAPI.clearDownloadJobs(['DONE']));
document.getElementById('btnClearFailed')?.addEventListener('click', () => window.electronAPI.clearDownloadJobs(['FAILED', 'CANCELLED']));
document.getElementById('btnOpenHome')?.addEventListener('click', () => window.electronAPI.openHomeDir());

document.getElementById('btnUpdateEngine')?.addEventListener('click', async () => {
    const btn = document.getElementById('btnUpdateEngine');
    const originalContent = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Updating...';
    try {
        const result = await window.electronAPI.updateEngine();
        const versions = `${result.old_version || 'unknown'} → ${result.new_version || 'unknown'}`;
        alert(result.code === 0 ? `yt-dlp ${result.update_status}: ${versions}` : `yt-dlp update ${result.update_status}: ${result.output}`);
    } catch (error) {
        alert('Update error: ' + error.message);
    } finally {
        btn.innerHTML = originalContent;
    }
});

document.getElementById('btnRepairEngine')?.addEventListener('click', async () => {
    const btn = document.getElementById('btnRepairEngine');
    const originalContent = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Repairing...';
    try {
        const result = await window.electronAPI.repairEngine();
        alert(result.code === 0 ? 'Downloader repair completed.' : 'Repair failed: ' + result.output);
    } catch (error) {
        alert('Repair error: ' + error.message);
    } finally {
        btn.innerHTML = originalContent;
    }
});

document.getElementById('btnFfmpegWeb')?.addEventListener('click', () => window.electronAPI.openExternal('https://ffmpeg.org/download.html'));
document.getElementById('btnChangelog')?.addEventListener('click', event => {
    event.preventDefault();
    window.electronAPI.openExternal('https://github.com/yt-dlp/yt-dlp/releases');
});
downloadBtn?.addEventListener('click', async () => {
    const urls = urlInput.value.split('\n').map(url => url.trim()).filter(Boolean);
    if (!urls.length) return;
    const youtubePattern = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be|music\.youtube\.com)\/.+/;
    const validUrls = urls.filter(url => youtubePattern.test(url));
    if (!validUrls.length) {
        alert('Vui lòng nhập URL YouTube hợp lệ');
        return;
    }
    const firstUrl = validUrls[0];
    const isChannelFeed = firstUrl.includes('/@') && ['/videos', '/shorts', '/playlists', '/streams'].some(part => firstUrl.includes(part));
    const isPlaylist = isChannelFeed || /[?&]list=/.test(firstUrl) || firstUrl.includes('/playlist');
    urlInput.value = '';
    if (isPlaylist && validUrls.length === 1) return showPlaylistScanner(firstUrl);
    await window.electronAPI.enqueueDownloadJobs(validUrls.map(url => ({ url, output_directory: currentSavePath })));
});

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
        scannedVideos = await window.electronAPI.getPlaylistData(url);
        playlistItems.innerHTML = scannedVideos.map((video, index) => `
            <div class="playlist-item">
                <label class="checkbox-container"><input type="checkbox" class="video-checkbox" data-index="${index}" checked><span class="checkmark"></span></label>
                <img src="${escapeHtml(video.thumbnail) || 'resources/mascot.png'}" class="playlist-item-thumb">
                <div class="playlist-item-info"><div class="playlist-item-title">${escapeHtml(video.title)}</div><div class="playlist-item-meta">${escapeHtml(video.uploader)} • ${formatDuration(video.duration)}</div></div>
            </div>`).join('');
        selectAll.checked = true;
        playlistModal.classList.remove('hidden');
    } catch (error) {
        alert('Failed to scan playlist/channel: ' + error.message);
    } finally {
        downloadBtn.innerHTML = originalContent;
        downloadBtn.style.pointerEvents = '';
    }
}

function formatDuration(seconds) {
    if (!seconds) return 'Unknown';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return hours ? `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}` : `${minutes}:${secs.toString().padStart(2, '0')}`;
}

closeModal?.addEventListener('click', () => playlistModal.classList.add('hidden'));
selectAll?.addEventListener('change', event => document.querySelectorAll('.video-checkbox').forEach(box => { box.checked = event.target.checked; }));
btnStartBatch?.addEventListener('click', async () => {
    const selected = Array.from(document.querySelectorAll('.video-checkbox:checked')).map(box => scannedVideos[Number(box.dataset.index)]);
    if (!selected.length) return alert('Please select at least one video to download.');
    const subdirectory = selected[0].uploader || 'Batch_Download';
    await window.electronAPI.enqueueDownloadJobs(selected.map(video => ({
        url: video.url,
        title: video.title,
        thumbnail: video.thumbnail,
        output_directory: currentSavePath,
        subdirectory
    })));
    playlistModal.classList.add('hidden');
});

urlInput.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        downloadBtn.click();
    }
});

initApp();
