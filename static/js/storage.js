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
        if (window.location.protocol === 'file:' || window.location.hostname.includes('github.io')) {
            return false;
        }
        return new Promise((resolve) => {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', '/api/stats', true);
            xhr.timeout = 2000;
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
