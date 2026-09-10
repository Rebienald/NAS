#!/bin/bash
pkill -f "python3 app.py" 2>/dev/null
pkill -f "cloudflared tunnel" 2>/dev/null
sleep 1

cd /home/rebienald/Desktop/NAS
nohup python3 app.py > /tmp/nas_flask.log 2>&1 &
sleep 2

nohup cloudflared tunnel --url http://127.0.0.1:5000 > /tmp/nas_tunnel.log 2>&1 &
sleep 4

TUNNEL_URL=$(grep -o 'https://[-a-zA-Z0-9]*\.trycloudflare\.com' /tmp/nas_tunnel.log | head -n 1)

echo "================================================="
echo "NAS Server is Online!"
echo "Public Website URL: $TUNNEL_URL"
echo "Local WiFi URL:     http://192.168.1.25:5000"
echo "Localhost URL:      http://127.0.0.1:5000"
echo "================================================="
