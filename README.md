# Local Personal NAS Photo Hub

A minimalist, high-speed personal Network Attached Storage (NAS) web service for backing up photos directly from your smartphone, tablet, or PC to a local centralized server.

## Features

- **Automatic Device-Specific Folders**: Uploading from a phone (e.g. `Redmi Note 15` or `Apple iPhone`) automatically detects the device and stores the photos in that device's dedicated folder.
- **Dynamic Device Filtering**: Switch between device tabs or view all photos centrally across all connected phones and computers.
- **Minimalist White & Gray UI**: Crisp, clean, distraction-free aesthetic with high-contrast typography and subtle borders.
- **Direct Preview & Lightbox**: Inspect original full-resolution photos, view upload metadata, and download files with one click.
- **Database Indexing**: SQLite database tracks files, sizes, dimensions, upload timestamps, and camera metadata.
- **Responsive Layout**: Designed for seamless mobile touch interactions and desktop drag-and-drop.

## Quick Start

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Run server (accessible to any device on your local WiFi network)
python3 app.py
```

Open your browser at `http://localhost:5000` (or `http://<your-local-ip>:5000` from your phone).
