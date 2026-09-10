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

// Client-side persistent IndexedDB storage engine for standalone web deployment
const DB_NAME = 'NAS_STORAGE_DB';
const DB_VERSION = 1;

let dbInstance = null;

function openNASDatabase() {
    return new Promise((resolve, reject) => {
        if (dbInstance) return resolve(dbInstance);

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('photos')) {
                const photoStore = db.createObjectStore('photos', { keyPath: 'id', autoIncrement: true });
                photoStore.createIndex('folder_name', 'folder_name', { unique: false });
                photoStore.createIndex('uploaded_at', 'uploaded_at', { unique: false });
            }
            if (!db.objectStoreNames.contains('devices')) {
                const deviceStore = db.createObjectStore('devices', { keyPath: 'folder_name' });
                deviceStore.createIndex('display_name', 'display_name', { unique: false });
            }
        };

        request.onsuccess = (e) => {
            dbInstance = e.target.result;
            resolve(dbInstance);
        };

        request.onerror = (e) => reject(e.target.error);
    });
}

const ClientStorage = {
    async isBackendAvailable() {
        const testUrl = getApiUrl('/api/stats');
        return new Promise((resolve) => {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', testUrl, true);
            xhr.timeout = 3000;
            xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
            xhr.onerror = () => resolve(false);
            xhr.ontimeout = () => resolve(false);
            try {
                xhr.send();
            } catch (e) {
                resolve(false);
            }
        });
    },

    async getStats() {
        const db = await openNASDatabase();
        return new Promise((resolve) => {
            const tx = db.transaction(['photos', 'devices'], 'readonly');
            const pReq = tx.objectStore('photos').getAll();
            const dReq = tx.objectStore('devices').getAll();

            tx.oncomplete = () => {
                const photos = pReq.result || [];
                const devices = dReq.result || [];
                const totalBytes = photos.reduce((acc, p) => acc + (p.file_size || 0), 0);
                resolve({
                    photo_count: photos.length,
                    device_count: devices.length,
                    total_size_bytes: totalBytes
                });
            };
        });
    },

    async getDevices() {
        const db = await openNASDatabase();
        return new Promise((resolve) => {
            const tx = db.transaction(['photos', 'devices'], 'readonly');
            const pReq = tx.objectStore('photos').getAll();
            const dReq = tx.objectStore('devices').getAll();

            tx.oncomplete = () => {
                const photos = pReq.result || [];
                const devices = dReq.result || [];

                const devMap = {};
                devices.forEach(d => {
                    devMap[d.folder_name] = {
                        id: d.folder_name,
                        folder_name: d.folder_name,
                        display_name: d.display_name,
                        device_type: 'Mobile',
                        photo_count: 0,
                        total_size: 0,
                        latest_upload: d.created_at,
                        cover_photo: null
                    };
                });

                photos.forEach(p => {
                    if (!devMap[p.folder_name]) {
                        devMap[p.folder_name] = {
                            id: p.folder_name,
                            folder_name: p.folder_name,
                            display_name: p.device_name,
                            device_type: 'Mobile',
                            photo_count: 0,
                            total_size: 0,
                            latest_upload: p.uploaded_at,
                            cover_photo: null
                        };
                    }
                    devMap[p.folder_name].photo_count++;
                    devMap[p.folder_name].total_size += p.file_size;
                    devMap[p.folder_name].cover_photo = p.url;
                });

                resolve(Object.values(devMap));
            };
        });
    },

    async getPhotos(folder) {
        const db = await openNASDatabase();
        return new Promise((resolve) => {
            const tx = db.transaction('photos', 'readonly');
            const pReq = tx.objectStore('photos').getAll();

            tx.oncomplete = () => {
                let photos = pReq.result || [];
                if (folder && folder !== 'all') {
                    photos = photos.filter(p => p.folder_name === folder);
                }
                // Sort by ID desc
                photos.sort((a, b) => b.id - a.id);
                resolve(photos);
            };
        });
    },

    async savePhoto(file, deviceName) {
        const db = await openNASDatabase();
        const base64Data = await this.fileToDataUrl(file);
        const folderName = deviceName.trim().replace(/[^\w\s\-\.]/g, '').replace(/[\s]+/g, '-');

        return new Promise((resolve, reject) => {
            const tx = db.transaction(['photos', 'devices'], 'readwrite');
            const devStore = tx.objectStore('devices');
            const photoStore = tx.objectStore('photos');

            devStore.put({
                folder_name: folderName,
                display_name: deviceName.trim(),
                created_at: new Date().toISOString()
            });

            const photoRecord = {
                folder_name: folderName,
                device_name: deviceName.trim(),
                original_name: file.name,
                url: base64Data,
                file_size: file.size,
                uploaded_at: new Date().toISOString()
            };

            photoStore.add(photoRecord);

            tx.oncomplete = () => resolve(photoRecord);
            tx.onerror = (e) => reject(e.target.error);
        });
    },

    async deletePhoto(photoId) {
        const db = await openNASDatabase();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('photos', 'readwrite');
            tx.objectStore('photos').delete(photoId);
            tx.oncomplete = () => resolve(true);
            tx.onerror = (e) => reject(e.target.error);
        });
    },

    fileToDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }
};

const SUPABASE_CONFIG = {
    url: 'https://ngjckggjadtoevbnhjhi.supabase.co',
    key: 'sb_publishable_zFd8VxxbMxpu7wFblnC36w_8Np8JVVf'
};

const SupabaseStorage = {
    isConfigured() {
        return Boolean(SUPABASE_CONFIG.url && SUPABASE_CONFIG.key);
    },

    getHeaders() {
        return {
            'apikey': SUPABASE_CONFIG.key,
            'Authorization': `Bearer ${SUPABASE_CONFIG.key}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
        };
    },

    async testConnection() {
        try {
            const res = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/nas_photos?select=id&limit=1`, {
                headers: this.getHeaders()
            });
            if (res.ok) return { ok: true };
            const err = await res.json().catch(() => ({}));
            return { ok: false, error: err.message || 'Table not ready', code: err.code };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    },

    async getStats() {
        const photos = await this.getPhotos('all');
        const devMap = new Set(photos.map(p => p.folder_name));
        const totalBytes = photos.reduce((acc, p) => acc + (p.file_size || 0), 0);
        return {
            photo_count: photos.length,
            device_count: devMap.size,
            total_size_bytes: totalBytes
        };
    },

    async getDevices() {
        const photos = await this.getPhotos('all');
        const devMap = {};
        photos.forEach(p => {
            const f = p.folder_name || 'Unknown-Device';
            if (!devMap[f]) {
                devMap[f] = {
                    id: f,
                    folder_name: f,
                    display_name: p.device_name || f,
                    device_type: 'Mobile',
                    photo_count: 0,
                    total_size: 0,
                    latest_upload: p.uploaded_at,
                    cover_photo: p.url
                };
            }
            devMap[f].photo_count++;
            devMap[f].total_size += (p.file_size || 0);
        });
        return Object.values(devMap);
    },

    async getPhotos(folder) {
        let endpoint = `${SUPABASE_CONFIG.url}/rest/v1/nas_photos?select=*&order=id.desc`;
        if (folder && folder !== 'all') {
            endpoint = `${SUPABASE_CONFIG.url}/rest/v1/nas_photos?folder_name=eq.${encodeURIComponent(folder)}&select=*&order=id.desc`;
        }
        const res = await fetch(endpoint, { headers: this.getHeaders() });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.message || 'Failed to fetch photos');
        }
        const data = await res.json();
        return data.map(p => ({
            id: p.id,
            device_name: p.device_name,
            folder_name: p.folder_name,
            original_name: p.original_name,
            url: p.url,
            file_size: p.file_size,
            uploaded_at: p.uploaded_at || p.created_at
        }));
    },

    async savePhoto(file, deviceName) {
        const base64Data = await this.compressAndEncode(file);
        const folderName = deviceName.trim().replace(/[^\w\s\-\.]/g, '').replace(/[\s]+/g, '-');

        const payload = {
            device_name: deviceName.trim(),
            folder_name: folderName,
            original_name: file.name,
            url: base64Data,
            file_size: file.size,
            uploaded_at: new Date().toISOString()
        };

        const res = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/nas_photos`, {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.message || 'Failed to save photo to Supabase');
        }
        const created = await res.json();
        return created[0] || payload;
    },

    async deletePhoto(photoId) {
        const res = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/nas_photos?id=eq.${photoId}`, {
            method: 'DELETE',
            headers: this.getHeaders()
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.message || 'Failed to delete photo from Supabase');
        }
        return true;
    },

    compressAndEncode(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = (event) => {
                const img = new Image();
                img.src = event.target.result;
                img.onload = () => {
                    const maxDim = 1600;
                    let width = img.width;
                    let height = img.height;

                    if (width > maxDim || height > maxDim) {
                        if (width > height) {
                            height = Math.round((height * maxDim) / width);
                            width = maxDim;
                        } else {
                            width = Math.round((width * maxDim) / height);
                            height = maxDim;
                        }
                    }

                    const canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);
                    resolve(canvas.toDataURL('image/jpeg', 0.85));
                };
                img.onerror = () => resolve(event.target.result);
            };
            reader.onerror = reject;
        });
    }
};
