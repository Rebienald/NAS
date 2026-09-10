import os
import re
import uuid
import mimetypes
from datetime import datetime
from flask import Flask, request, jsonify, render_template, send_from_directory
from werkzeug.utils import secure_filename
from PIL import Image, ExifTags

from database import init_db, get_db

app = Flask(__name__)
init_db()

@app.after_request
def add_cors_headers(response):
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, DELETE, OPTIONS'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
    return response

@app.route('/api/<path:path>', methods=['OPTIONS'])
def options_handler(path):
    return ('', 204)

# Base upload directory
UPLOAD_ROOT = os.path.join(os.path.dirname(__file__), 'static', 'uploads')
os.makedirs(UPLOAD_ROOT, exist_ok=True)

# Allowed image extensions
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'bmp', 'svg'}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def clean_folder_name(name):
    """Sanitize folder name safely while keeping it readable and human-friendly."""
    if not name or not name.strip():
        name = "Unknown-Device"
    name = name.strip()
    # Replace invalid filesystem characters with dashes or underscores
    cleaned = re.sub(r'[^\w\s\-\.]', '', name)
    cleaned = re.sub(r'[\s]+', '-', cleaned).strip('-_')
    return cleaned if cleaned else "Unknown-Device"

def extract_exif_info(image_path):
    """Attempt to extract camera make and model from photo EXIF data."""
    camera_make = None
    camera_model = None
    width, height = 0, 0
    try:
        with Image.open(image_path) as img:
            width, height = img.size
            exif = img.getexif()
            if exif:
                make_id = None
                model_id = None
                for tag_id in ExifTags.TAGS:
                    if ExifTags.TAGS[tag_id] == 'Make':
                        make_id = tag_id
                    elif ExifTags.TAGS[tag_id] == 'Model':
                        model_id = tag_id
                if make_id and make_id in exif:
                    camera_make = str(exif[make_id]).strip()
                if model_id and model_id in exif:
                    camera_model = str(exif[model_id]).strip()
    except Exception:
        pass
    return width, height, camera_make, camera_model

def get_or_create_device(cursor, display_name):
    folder_name = clean_folder_name(display_name)
    cursor.execute('SELECT id, folder_name, display_name FROM devices WHERE folder_name = ?', (folder_name,))
    device = cursor.fetchone()
    if device:
        return device['id'], device['folder_name'], device['display_name']

    cursor.execute('''
        INSERT INTO devices (folder_name, display_name, device_type)
        VALUES (?, ?, ?)
    ''', (folder_name, display_name.strip(), 'Mobile' if any(w in display_name.lower() for w in ['phone', 'redmi', 'iphone', 'galaxy', 'pixel', 'note', 'xiaomi', 'android']) else 'Device'))
    device_id = cursor.lastrowid
    
    # Ensure physical folder exists on disk
    device_dir = os.path.join(UPLOAD_ROOT, folder_name)
    os.makedirs(device_dir, exist_ok=True)
    return device_id, folder_name, display_name.strip()

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/stats', methods=['GET'])
def get_stats():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT COUNT(*) as count FROM devices')
    device_count = cursor.fetchone()['count']
    
    cursor.execute('SELECT COUNT(*) as count, COALESCE(SUM(file_size), 0) as total_size FROM photos')
    photo_row = cursor.fetchone()
    photo_count = photo_row['count']
    total_bytes = photo_row['total_size']
    conn.close()

    return jsonify({
        'device_count': device_count,
        'photo_count': photo_count,
        'total_size_bytes': total_bytes
    })

@app.route('/api/devices', methods=['GET'])
def list_devices():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT d.id, d.folder_name, d.display_name, d.device_type, d.created_at,
               COUNT(p.id) as photo_count,
               COALESCE(SUM(p.file_size), 0) as total_size,
               MAX(p.uploaded_at) as latest_upload,
               (SELECT filename FROM photos WHERE device_id = d.id ORDER BY id DESC LIMIT 1) as cover_photo
        FROM devices d
        LEFT JOIN photos p ON d.id = p.device_id
        GROUP BY d.id
        ORDER BY latest_upload DESC, d.created_at DESC
    ''')
    rows = cursor.fetchall()
    devices = []
    for r in rows:
        cover_url = None
        if r['cover_photo']:
            cover_url = f"/static/uploads/{r['folder_name']}/{r['cover_photo']}"
        devices.append({
            'id': r['id'],
            'folder_name': r['folder_name'],
            'display_name': r['display_name'],
            'device_type': r['device_type'],
            'photo_count': r['photo_count'],
            'total_size': r['total_size'],
            'latest_upload': r['latest_upload'],
            'cover_photo': cover_url
        })
    conn.close()
    return jsonify(devices)

@app.route('/api/photos', methods=['GET'])
def list_photos():
    folder = request.args.get('folder')
    conn = get_db()
    cursor = conn.cursor()
    if folder and folder != 'all':
        cursor.execute('''
            SELECT p.*, d.display_name as device_display_name
            FROM photos p
            JOIN devices d ON p.device_id = d.id
            WHERE p.folder_name = ?
            ORDER BY p.id DESC
        ''', (folder,))
    else:
        cursor.execute('''
            SELECT p.*, d.display_name as device_display_name
            FROM photos p
            JOIN devices d ON p.device_id = d.id
            ORDER BY p.id DESC
        ''')
    rows = cursor.fetchall()
    photos = []
    for r in rows:
        photos.append({
            'id': r['id'],
            'device_id': r['device_id'],
            'device_name': r['device_display_name'],
            'folder_name': r['folder_name'],
            'filename': r['filename'],
            'original_name': r['original_name'],
            'url': f"/static/uploads/{r['folder_name']}/{r['filename']}",
            'file_size': r['file_size'],
            'width': r['width'],
            'height': r['height'],
            'camera_make': r['camera_make'],
            'camera_model': r['camera_model'],
            'uploaded_at': r['uploaded_at']
        })
    conn.close()
    return jsonify(photos)

@app.route('/api/upload', methods=['POST'])
def upload_photos():
    if 'photos' not in request.files:
        return jsonify({'error': 'No file part in request'}), 400

    files = request.files.getlist('photos')
    if not files or len(files) == 0:
        return jsonify({'error': 'No files selected'}), 400

    # Device name provided by client (auto-detected or manually edited)
    client_device = request.form.get('device_name', '').strip()
    user_agent = request.headers.get('User-Agent', '')

    conn = get_db()
    cursor = conn.cursor()

    uploaded_results = []

    for file in files:
        if file.filename == '':
            continue
        if not allowed_file(file.filename):
            continue

        orig_filename = secure_filename(file.filename) or 'photo.jpg'
        ext = orig_filename.rsplit('.', 1)[1].lower() if '.' in orig_filename else 'jpg'
        unique_name = f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}.{ext}"

        # Temporary save to inspect EXIF if client didn't supply device name
        temp_dir = os.path.join(UPLOAD_ROOT, '_temp')
        os.makedirs(temp_dir, exist_ok=True)
        temp_path = os.path.join(temp_dir, unique_name)
        file.save(temp_path)

        width, height, exif_make, exif_model = extract_exif_info(temp_path)
        file_size = os.path.getsize(temp_path)

        # Determine target device display name
        target_name = client_device
        if not target_name:
            if exif_make or exif_model:
                parts = [p for p in [exif_make, exif_model] if p]
                target_name = " ".join(parts)
            elif 'Redmi' in user_agent:
                target_name = 'Redmi Note'
            elif 'iPhone' in user_agent:
                target_name = 'Apple iPhone'
            elif 'Android' in user_agent:
                target_name = 'Android Device'
            else:
                target_name = 'Web Client'

        device_id, folder_name, final_display_name = get_or_create_device(cursor, target_name)
        target_dir = os.path.join(UPLOAD_ROOT, folder_name)
        os.makedirs(target_dir, exist_ok=True)
        final_path = os.path.join(target_dir, unique_name)

        # Move from temp to device folder
        os.rename(temp_path, final_path)

        mime_type = mimetypes.guess_type(final_path)[0] or f"image/{ext}"

        cursor.execute('''
            INSERT INTO photos (device_id, folder_name, filename, original_name, file_path, file_size, width, height, mime_type, camera_make, camera_model)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (device_id, folder_name, unique_name, orig_filename, final_path, file_size, width, height, mime_type, exif_make, exif_model))

        uploaded_results.append({
            'filename': unique_name,
            'folder_name': folder_name,
            'device_name': final_display_name,
            'url': f"/static/uploads/{folder_name}/{unique_name}",
            'size': file_size
        })

    conn.commit()
    conn.close()

    # Clean up empty temp folder if present
    try:
        if os.path.exists(temp_dir) and not os.listdir(temp_dir):
            os.rmdir(temp_dir)
    except Exception:
        pass

    return jsonify({
        'success': True,
        'uploaded_count': len(uploaded_results),
        'photos': uploaded_results
    })

@app.route('/api/photos/<int:photo_id>', methods=['DELETE'])
def delete_photo(photo_id):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM photos WHERE id = ?', (photo_id,))
    photo = cursor.fetchone()
    if not photo:
        conn.close()
        return jsonify({'error': 'Photo not found'}), 404

    # Remove file from disk
    if os.path.exists(photo['file_path']):
        try:
            os.remove(photo['file_path'])
        except Exception:
            pass

    cursor.execute('DELETE FROM photos WHERE id = ?', (photo_id,))
    conn.commit()

    # Check if folder has any remaining photos; if 0, optionally delete device folder or keep it
    cursor.execute('SELECT COUNT(*) as count FROM photos WHERE device_id = ?', (photo['device_id'],))
    remaining = cursor.fetchone()['count']
    if remaining == 0:
        cursor.execute('DELETE FROM devices WHERE id = ?', (photo['device_id'],))
        conn.commit()
        folder_path = os.path.join(UPLOAD_ROOT, photo['folder_name'])
        try:
            if os.path.exists(folder_path) and not os.listdir(folder_path):
                os.rmdir(folder_path)
        except Exception:
            pass

    conn.close()
    return jsonify({'success': True})

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=True)
