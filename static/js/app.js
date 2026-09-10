let currentFolder = 'all';
let allDevices = [];
let useBackend = false;

const DEFAULT_TUNNEL_URL = 'https://spa-vatican-voting-utilization.trycloudflare.com';

function getServerBaseUrl() {
    const custom = localStorage.getItem('nas_server_url');
    if (custom && custom.trim()) return custom.trim().replace(/\/+$/, '');
    if (window.location.hostname.includes('github.io')) {
        return DEFAULT_TUNNEL_URL;
    }
    return '';
}

function getApiUrl(path) {
    const base = getServerBaseUrl();
    return base ? `${base}${path}` : path;
}

function getAssetUrl(url) {
    if (!url) return '';
    if (url.startsWith('data:') || url.startsWith('http://') || url.startsWith('https://')) {
        return url;
    }
    const base = getServerBaseUrl();
    return base ? `${base}${url}` : url;
}

function updateServerStatus() {
    const pill = document.getElementById('serverStatusPill');
    const dot = pill ? pill.querySelector('.status-dot') : null;
    const text = document.getElementById('serverStatusText');
    if (!pill || !dot || !text) return;

    if (useBackend) {
        dot.className = 'status-dot online';
        const base = getServerBaseUrl();
        if (base) {
            text.textContent = 'Central Cloud Sync';
        } else {
            text.textContent = 'Central Database';
        }
    } else {
        dot.className = 'status-dot offline';
        text.textContent = 'Local Browser Cache';
    }
}

function promptServerUrl() {
    const current = localStorage.getItem('nas_server_url') || (window.location.hostname.includes('github.io') ? DEFAULT_TUNNEL_URL : '');
    const entered = prompt('Enter your Central NAS Server URL:\n(Leave empty to reset to default)', current);
    if (entered !== null) {
        if (entered.trim()) {
            localStorage.setItem('nas_server_url', entered.trim());
        } else {
            localStorage.removeItem('nas_server_url');
        }
        window.location.reload();
    }
}

// Device detection helper
function detectDeviceName() {
    const ua = navigator.userAgent || '';
    
    const redmiMatch = ua.match(/(Redmi[^;\)]*|M2\d{3}[^;\)]*|2\d{3}[^;\)]*)/i);
    if (redmiMatch) {
        return redmiMatch[1].trim();
    }
    if (/iPhone/i.test(ua)) {
        return 'Apple iPhone';
    }
    if (/iPad/i.test(ua)) {
        return 'Apple iPad';
    }
    if (/Samsung|SM-[A-Z0-9]+/i.test(ua)) {
        const smMatch = ua.match(/SM-[A-Z0-9]+/i);
        return smMatch ? `Samsung ${smMatch[0]}` : 'Samsung Galaxy';
    }
    if (/Pixel/i.test(ua)) {
        const pixelMatch = ua.match(/Pixel\s*\d+[a-zA-Z]*/i);
        return pixelMatch ? pixelMatch[0] : 'Google Pixel';
    }
    if (/Xiaomi|POCO/i.test(ua)) {
        return 'Xiaomi Device';
    }
    if (/Android/i.test(ua)) {
        return 'Android Mobile';
    }
    if (/Macintosh/i.test(ua)) {
        return 'MacBook Pro';
    }
    if (/Windows/i.test(ua)) {
        return 'Windows Workstation';
    }
    if (/Linux/i.test(ua)) {
        return 'Linux PC';
    }
    return 'Redmi Note 15';
}

function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDate(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// Fetch stats and update header
async function loadStats() {
    try {
        let data;
        if (useBackend) {
            const res = await fetch(getApiUrl('/api/stats'));
            data = await res.json();
        } else {
            data = await ClientStorage.getStats();
        }
        document.getElementById('statTotalPhotos').textContent = data.photo_count || 0;
        document.getElementById('statTotalDevices').textContent = data.device_count || 0;
        document.getElementById('statTotalStorage').textContent = formatBytes(data.total_size_bytes || 0);
    } catch (e) {
        console.error('Failed to load stats', e);
    }
}

// Fetch devices and render folder overview and tabs
async function loadDevices() {
    try {
        if (useBackend) {
            const res = await fetch(getApiUrl('/api/devices'));
            allDevices = await res.json();
        } else {
            allDevices = await ClientStorage.getDevices();
        }

        renderFolderTabs();
        renderFolderOverview();
    } catch (e) {
        console.error('Failed to load devices', e);
    }
}

function renderFolderTabs() {
    const tabsContainer = document.getElementById('folderTabs');
    tabsContainer.innerHTML = `
        <button class="tab-btn ${currentFolder === 'all' ? 'active' : ''}" onclick="selectFolder('all')">
            <i class="fas fa-layer-group"></i> All Photos
        </button>
    `;

    allDevices.forEach(dev => {
        const btn = document.createElement('button');
        btn.className = `tab-btn ${currentFolder === dev.folder_name ? 'active' : ''}`;
        btn.onclick = () => selectFolder(dev.folder_name);
        btn.innerHTML = `
            <i class="fas fa-mobile-screen-button"></i> ${escapeHtml(dev.display_name)}
            <span class="tab-badge">${dev.photo_count}</span>
        `;
        tabsContainer.appendChild(btn);
    });
}

function renderFolderOverview() {
    const overviewContainer = document.getElementById('foldersOverview');
    if (!allDevices || allDevices.length === 0) {
        overviewContainer.style.display = 'none';
        return;
    }

    overviewContainer.style.display = 'grid';
    overviewContainer.innerHTML = '';

    allDevices.forEach(dev => {
        const card = document.createElement('div');
        card.className = `folder-card ${currentFolder === dev.folder_name ? 'active-folder' : ''}`;
        card.onclick = () => selectFolder(dev.folder_name);

        card.innerHTML = `
            <div>
                <div class="folder-card-top">
                    <div class="folder-icon">
                        <i class="fas fa-folder"></i>
                    </div>
                    <div class="folder-details">
                        <h3>${escapeHtml(dev.display_name)}</h3>
                        <span>Folder: /${escapeHtml(dev.folder_name)}</span>
                    </div>
                </div>
            </div>
            <div class="folder-meta">
                <span><i class="fas fa-image"></i> ${dev.photo_count} photo${dev.photo_count === 1 ? '' : 's'}</span>
                <span>${formatBytes(dev.total_size)}</span>
            </div>
        `;
        overviewContainer.appendChild(card);
    });
}

// Fetch photos for selected folder
async function loadPhotos() {
    const grid = document.getElementById('photoGrid');
    grid.innerHTML = '<div class="empty-state"><p>Loading photos...</p></div>';

    try {
        let photos = [];
        if (useBackend) {
            const url = getApiUrl(`/api/photos?folder=${encodeURIComponent(currentFolder)}`);
            const res = await fetch(url);
            photos = await res.json();
        } else {
            photos = await ClientStorage.getPhotos(currentFolder);
        }

        if (photos.length === 0) {
            grid.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon"><i class="fas fa-cloud-arrow-up"></i></div>
                    <h3>No photos here yet</h3>
                    <p>Select or drop photos above to upload into this device folder.</p>
                </div>
            `;
            return;
        }

        grid.innerHTML = '';
        photos.forEach(photo => {
            const card = document.createElement('div');
            card.className = 'photo-card';
            const assetUrl = getAssetUrl(photo.url);
            card.innerHTML = `
                <div class="photo-img-wrap" onclick="openLightbox('${assetUrl}', '${escapeHtml(photo.original_name)}', '${escapeHtml(photo.device_name)}', '${formatBytes(photo.file_size)}')">
                    <img src="${assetUrl}" alt="${escapeHtml(photo.original_name)}" class="photo-img" loading="lazy">
                    <div class="photo-folder-tag">
                        <i class="fas fa-folder-closed"></i> ${escapeHtml(photo.device_name)}
                    </div>
                </div>
                <div class="photo-info">
                    <div class="photo-text">
                        <div class="photo-name" title="${escapeHtml(photo.original_name)}">${escapeHtml(photo.original_name)}</div>
                        <div class="photo-date">${formatDate(photo.uploaded_at)} · ${formatBytes(photo.file_size)}</div>
                    </div>
                    <div class="photo-actions">
                        <a href="${assetUrl}" download="${escapeHtml(photo.original_name)}" class="btn-icon" title="Download">
                            <i class="fas fa-download"></i>
                        </a>
                        <button class="btn-icon danger" onclick="deletePhoto(${photo.id})" title="Delete">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            `;
            grid.appendChild(card);
        });
    } catch (e) {
        grid.innerHTML = '<div class="empty-state"><p>Error loading photos.</p></div>';
        console.error('Failed to load photos', e);
    }
}

function selectFolder(folder) {
    currentFolder = folder;
    renderFolderTabs();
    renderFolderOverview();
    loadPhotos();
}

// Lightbox Modal
function openLightbox(url, name, device, size) {
    const modal = document.getElementById('lightboxModal');
    const modalImg = document.getElementById('modalImg');
    const modalTitle = document.getElementById('modalTitle');
    const modalMeta = document.getElementById('modalMeta');
    const modalDownload = document.getElementById('modalDownload');

    modalImg.src = url;
    modalTitle.textContent = name;
    modalMeta.textContent = `Device: ${device} · Size: ${size}`;
    modalDownload.href = url;
    modalDownload.download = name;

    modal.classList.add('open');
}

function closeLightbox() {
    document.getElementById('lightboxModal').classList.remove('open');
}

// Delete Photo
async function deletePhoto(photoId) {
    if (!confirm('Are you sure you want to delete this photo from your NAS storage?')) {
        return;
    }
    try {
        if (useBackend) {
            const res = await fetch(getApiUrl(`/api/photos/${photoId}`), { method: 'DELETE' });
            const data = await res.json();
            if (!data.success) throw new Error('Delete failed');
        } else {
            await ClientStorage.deletePhoto(photoId);
        }
        loadStats();
        loadDevices();
        loadPhotos();
    } catch (e) {
        alert('Failed to delete photo.');
    }
}

// Upload Handling
function setupUpload() {
    const dropzone = document.getElementById('dropzone');
    const fileInput = document.getElementById('fileInput');
    const deviceInput = document.getElementById('deviceNameInput');
    const queue = document.getElementById('uploadQueue');
    const progressFill = document.getElementById('uploadProgressFill');
    const progressText = document.getElementById('uploadProgressText');

    if (!deviceInput.value) {
        deviceInput.value = detectDeviceName();
    }

    dropzone.addEventListener('click', (e) => {
        if (e.target !== fileInput) {
            fileInput.click();
        }
    });

    dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
    });

    dropzone.addEventListener('dragleave', () => {
        dropzone.classList.remove('dragover');
    });

    dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            uploadFiles(e.dataTransfer.files);
        }
    });

    fileInput.addEventListener('change', () => {
        if (fileInput.files && fileInput.files.length > 0) {
            uploadFiles(fileInput.files);
        }
    });

    async function uploadFiles(files) {
        const deviceName = deviceInput.value.trim() || 'Unknown Device';

        queue.style.display = 'block';
        progressFill.style.width = '30%';
        progressText.textContent = `Saving ${files.length} photo(s) into folder "${deviceName}"...`;

        try {
            if (useBackend) {
                const formData = new FormData();
                formData.append('device_name', deviceName);
                for (let i = 0; i < files.length; i++) {
                    formData.append('photos', files[i]);
                }
                const xhr = new XMLHttpRequest();
                xhr.open('POST', getApiUrl('/api/upload'), true);
                xhr.upload.onprogress = (e) => {
                    if (e.lengthComputable) {
                        const percent = Math.round((e.loaded / e.total) * 100);
                        progressFill.style.width = `${percent}%`;
                    }
                };
                xhr.onload = () => {
                    progressFill.style.width = '100%';
                    progressText.textContent = 'Upload complete!';
                    finishUpload();
                };
                xhr.onerror = () => {
                    progressText.textContent = 'Upload failed.';
                };
                xhr.send(formData);
            } else {
                // Client-side instant saving
                for (let i = 0; i < files.length; i++) {
                    await ClientStorage.savePhoto(files[i], deviceName);
                    const percent = Math.round(((i + 1) / files.length) * 100);
                    progressFill.style.width = `${percent}%`;
                }
                progressText.textContent = 'Saved to device folder successfully!';
                finishUpload();
            }
        } catch (e) {
            console.error('Upload error', e);
            progressText.textContent = 'Error saving photo.';
        }
    }

    function finishUpload() {
        setTimeout(() => {
            queue.style.display = 'none';
            progressFill.style.width = '0%';
            fileInput.value = '';
        }, 1200);

        loadStats();
        loadDevices();
        loadPhotos();
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

document.addEventListener('DOMContentLoaded', async () => {
    useBackend = await ClientStorage.isBackendAvailable();
    updateServerStatus();
    setupUpload();
    await loadStats();
    await loadDevices();
    await loadPhotos();

    document.getElementById('lightboxModal').addEventListener('click', (e) => {
        if (e.target.id === 'lightboxModal') closeLightbox();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeLightbox();
    });
});
