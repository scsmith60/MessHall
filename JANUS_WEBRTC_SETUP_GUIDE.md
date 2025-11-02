# Janus WebRTC Server - Complete Setup Guide

## 🎯 What is Janus?

**Janus** is a lightweight, open-source WebRTC server that you can self-host. It's completely free and gives you:
- ✅ **$0 per minute** streaming costs
- ✅ **Fixed monthly cost** (~$40-150/month for server)
- ✅ **Full control** over your streaming infrastructure
- ✅ **Same low latency** as Daily.co (1-2 seconds)
- ✅ **Unlimited usage** (no per-minute charges)

## 📊 Cost Comparison

| Solution | Setup Cost | Monthly Cost (low) | Monthly Cost (high) |
|----------|-----------|-------------------|-------------------|
| **Daily.co** | $0 | $175 (100K min) | $1,950 (1M min) |
| **Cloudflare Stream** | $0 | $0 (100K min) | $900 (1M min) |
| **Janus (Self-hosted)** | 4-8 hours | **$40/month** | **$150/month** |

**Break-even point:** Janus becomes cheaper after ~18K minutes/month (assuming $40 server).

## 🏗️ Architecture

```
┌─────────────┐
│ React Native│
│    App      │
└──────┬──────┘
       │ WebRTC
       ▼
┌─────────────┐      ┌──────────┐
│ Janus Server│◄────►│ TURN     │
│ (SFU)       │      │ Server   │
└─────────────┘      └──────────┘
       │
       ▼
┌─────────────┐
│  Viewers    │
└─────────────┘
```

**SFU (Selective Forwarding Unit):** Janus acts as a media relay - it receives streams from hosts and forwards them to viewers without re-encoding. This is very efficient.

## 📋 Prerequisites

### 1. Server Requirements
- **OS:** Ubuntu 20.04/22.04 or Debian 11/12
- **CPU:** 2+ cores (4+ recommended)
- **RAM:** 4GB minimum (8GB recommended)
- **Storage:** 20GB+ SSD
- **Bandwidth:** 1TB+ monthly transfer included
- **VPS Provider:** DigitalOcean, Linode, Hetzner, AWS EC2

### 2. Technical Knowledge
- Basic Linux command line
- Understanding of ports/firewalls
- Domain name (optional but recommended)

### 3. Cost Estimate
- **DigitalOcean Droplet:** $24-48/month (4-8GB RAM)
- **Linode:** $24-48/month (similar)
- **Hetzner:** $20-40/month (cheapest)
- **AWS EC2:** $30-60/month (t3.medium)

## 🚀 Step 1: Set Up VPS

### Option A: DigitalOcean (Easiest)

1. **Create Account:** https://www.digitalocean.com
2. **Create Droplet:**
   - Choose: Ubuntu 22.04
   - Plan: **Basic** → **Regular Intel** → **$24/month** (4GB RAM, 2 vCPU)
   - Datacenter: Choose closest to your users
   - Authentication: SSH keys (recommended) or password
3. **Note IP Address:** You'll need this later

### Option B: Hetzner (Cheapest)

1. **Create Account:** https://www.hetzner.com
2. **Create Server:**
   - Location: Choose closest to users
   - Image: Ubuntu 22.04
   - Type: CPX21 (4 vCPU, 8GB RAM) - **~€20/month**
3. **Note IP Address**

### Option C: AWS EC2 (Enterprise)

1. **Launch EC2 Instance:**
   - AMI: Ubuntu Server 22.04
   - Instance: t3.medium (2 vCPU, 4GB RAM)
   - Security Group: Allow HTTP (80), HTTPS (443), Custom TCP (8088, 8188, 8089)
2. **Note IP Address**

---

## 🔧 Step 2: Install Dependencies

SSH into your server:

```bash
ssh root@YOUR_SERVER_IP
```

### Update System
```bash
apt update && apt upgrade -y
```

### Install Required Packages
```bash
apt install -y \
  build-essential \
  git \
  libssl-dev \
  libglib2.0-dev \
  libopus-dev \
  libogg-dev \
  libcurl4-openssl-dev \
  libglib2.0-dev \
  libconfig-dev \
  libtool \
  libsrtp2-dev \
  libwebsockets-dev \
  libnanomsg-dev \
  librabbitmq-dev \
  pkg-config \
  gengetopt \
  libavformat-dev \
  libavcodec-dev \
  libavutil-dev \
  libavfilter-dev \
  libavdevice-dev \
  libavresample-dev \
  libavcodec-dev \
  libavformat-dev \
  libswscale-dev \
  libswresample-dev \
  libavfilter-dev \
  libavdevice-dev \
  libavutil-dev \
  libpostproc-dev
```

### Install libnice (for NAT traversal)
```bash
cd /tmp
wget https://github.com/libnice/libnice/releases/download/0.1.21/libnice-0.1.21.tar.gz
tar -xzf libnice-0.1.21.tar.gz
cd libnice-0.1.21
./configure --prefix=/usr
make && make install
```

### Install libsrtp2
```bash
cd /tmp
git clone https://github.com/cisco/libsrtp.git
cd libsrtp
./configure --prefix=/usr --enable-openssl
make shared_library && make install
```

### Install usrsctp (optional, for data channels)
```bash
cd /tmp
git clone https://github.com/sctplab/usrsctp.git
cd usrsctp
./bootstrap
./configure --prefix=/usr
make && make install
```

---

## 🏗️ Step 3: Install Janus

### Clone and Build Janus
```bash
cd /opt
git clone https://github.com/meetecho/janus-gateway.git
cd janus-gateway
git checkout v1.3.1  # Use stable version

# Install dependencies
sh autogen.sh
./configure --prefix=/opt/janus \
  --enable-post-processing \
  --enable-plugin-videoroom \
  --enable-plugin-textroom \
  --enable-plugin-streaming \
  --enable-plugin-voicemail \
  --enable-plugin-recordplay \
  --enable-plugin-audiobridge \
  --enable-plugin-sip \
  --enable-http \
  --enable-websockets \
  --enable-data-channels \
  --enable-rabbitmq \
  --enable-mqtt \
  --enable-unix-sockets \
  --enable-dtls-settimeout \
  --enable-plugin-echotest

make
make install
make configs
```

This will take 10-20 minutes to compile.

### Create Systemd Service
```bash
cat > /etc/systemd/system/janus.service << 'EOF'
[Unit]
Description=Janus WebRTC Server
After=network.target

[Service]
Type=simple
User=root
ExecStart=/opt/janus/bin/janus --configs-folder=/opt/janus/etc/janus
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable janus
```

---

## ⚙️ Step 4: Configure Janus

### Main Configuration
```bash
nano /opt/janus/etc/janus/janus.jcfg
```

Key settings:
```json
{
  "general": {
    "configs_folder": "/opt/janus/etc/janus",
    "plugins_folder": "/opt/janus/lib/janus/plugins",
    "transports_folder": "/opt/janus/lib/janus/transports",
    "events_folder": "/opt/janus/lib/janus/events",
    "loggers_folder": "/opt/janus/lib/janus/loggers",
    "debug_level": 4,
    "debug_timestamps": true,
    "interface": "0.0.0.0",
    "port": 8088,
    "https": false,
    "secure_port": 8089,
    "secure_interface": "0.0.0.0"
  },
  "plugins": {
    "disable": "libjanus_voicemail.so,libjanus_recordplay.so"
  }
}
```

### VideoRoom Plugin (for your sessions)
```bash
nano /opt/janus/etc/janus/janus.plugin.videoroom.jcfg
```

```json
{
  "general": {
    "string_ids": true,
    "room_pin": "mypassword",
    "session_timeout": 60,
    "destroy_session_timeout": 30
  },
  "rooms": {
    "default": {
      "description": "Default video room",
      "secret": "adminpwd",
      "pin": "",
      "post": "",
      "publishers": 10,
      "bitrate": 128000,
      "bitrate_cap": true,
      "fir_freq": 10,
      "require_pvtid": false,
      "notify_joining": false,
      "audio_level_average": 50,
      "audio_active_packets": 100,
      "audio_level_average_interval": 20,
      "video_senders": 10,
      "video_codec": "vp8",
      "opus_fec": false,
      "video_svc": false,
      "h264_profile": "42e01f",
      "record": false
    }
  }
}
```

### WebSocket Transport (for React Native)
```bash
nano /opt/janus/etc/janus/janus.transport.websockets.jcfg
```

```json
{
  "general": {
    "enabled": true,
    "ws_logging": "all",
    "interface": "0.0.0.0",
    "port": 8188,
    "secure": false,
    "secure_port": 8989
  }
}
```

---

## 🌐 Step 5: Set Up TURN Server

TURN servers are needed for NAT traversal (allowing connections through firewalls).

### Option A: Use Coturn (Self-hosted, Free)

```bash
apt install -y coturn
```

Edit config:
```bash
nano /etc/turnserver.conf
```

```ini
listening-port=3478
tls-listening-port=5349
listening-ip=YOUR_SERVER_IP
external-ip=YOUR_SERVER_IP
realm=yourdomain.com
server-name=yourdomain.com
user=janus:your-secure-password
# Use your domain or IP
```

Start Coturn:
```bash
systemctl enable coturn
systemctl start coturn
```

### Option B: Use Public TURN (Free, but less reliable)

You can use free public TURN servers like:
- `stun:stun.l.google.com:19302`
- Or Twilio's free TURN (limited)

---

## 🔒 Step 6: Firewall Configuration

```bash
# Allow HTTP/HTTPS
ufw allow 80/tcp
ufw allow 443/tcp

# Allow Janus
ufw allow 8088/tcp  # HTTP Janus
ufw allow 8089/tcp  # HTTPS Janus
ufw allow 8188/tcp  # WebSocket
ufw allow 8989/tcp  # Secure WebSocket

# Allow TURN
ufw allow 3478/tcp
ufw allow 3478/udp
ufw allow 5349/tcp
ufw allow 5349/udp
ufw allow 49152:65535/udp  # TURN relay ports

ufw enable
```

---

## 🚀 Step 7: Start Janus

```bash
systemctl start janus
systemctl status janus
```

Check logs:
```bash
tail -f /opt/janus/var/log/janus.log
```

Test if Janus is running:
```bash
curl http://YOUR_SERVER_IP:8088/janus/info
```

You should get a JSON response.

---

## 📱 Step 8: Integrate with React Native

### Install Dependencies

```bash
npm install janus-gateway-rtc
# or use WebRTC polyfills
```

### Create Janus Connection Component

```typescript
// components/VideoStreamJanus.tsx
import React, { useEffect, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';

const JANUS_SERVER = 'ws://YOUR_SERVER_IP:8188'; // Use your Janus server

export default function VideoStreamJanus({ 
  roomId, 
  isHost = false,
  onError 
}: {
  roomId: string;
  isHost?: boolean;
  onError?: (error: string) => void;
}) {
  const webViewRef = useRef<WebView>(null);

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="https://unpkg.com/janus-gateway/dist/janus.js"></script>
  <style>
    body { margin: 0; padding: 0; background: #000; }
    #video-container { width: 100vw; height: 100vh; }
    video { width: 100%; height: 100%; object-fit: cover; }
  </style>
</head>
<body>
  <div id="video-container"></div>
  <script>
    let janus = null;
    let videoroom = null;

    // Initialize Janus
    Janus.init({
      debug: "all",
      callback: function() {
        janus = new Janus({
          server: "${JANUS_SERVER}",
          success: function() {
            attachToVideoRoom();
          },
          error: function(error) {
            console.error("Janus error:", error);
            if (window.ReactNativeWebView) {
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'error',
                message: error
              }));
            }
          }
        });
      }
    });

    function attachToVideoRoom() {
      janus.attach({
        plugin: "janus.plugin.videoroom",
        success: function(pluginHandle) {
          videoroom = pluginHandle;
          ${isHost ? 'publishStream()' : 'subscribeToRoom()'};
        },
        error: function(error) {
          console.error("Attach error:", error);
        }
      });
    }

    function publishStream() {
      // Host publishes video
      videoroom.createOffer({
        tracks: [{ kind: 'video', capture: true }, { kind: 'audio', capture: true }],
        success: function(jsep) {
          videoroom.send({
            message: {
              request: "joinandconfigure",
              room: ${parseInt(roomId)},
              ptype: "publisher",
              display: "Host"
            },
            jsep: jsep
          });
        }
      });
    }

    function subscribeToRoom() {
      // Viewer subscribes to room
      videoroom.send({
        message: {
          request: "join",
          room: ${parseInt(roomId)},
          ptype: "subscriber",
          feed: 0 // Subscribe to first publisher (host)
        }
      });
    }
  </script>
</body>
</html>
  `;

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        source={{ html: htmlContent }}
        style={styles.webview}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        onMessage={(event) => {
          const data = JSON.parse(event.nativeEvent.data);
          if (data.type === 'error') {
            onError?.(data.message);
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  webview: {
    flex: 1,
  },
});
```

---

## 🔍 Step 9: Testing

1. **Test Janus is Running:**
   ```bash
   curl http://YOUR_SERVER_IP:8088/janus/info
   ```

2. **Test WebSocket:**
   - Open browser console
   - Connect to `ws://YOUR_SERVER_IP:8188`

3. **Test Video Room:**
   - Create two browser tabs
   - Join same room ID
   - One publishes, one subscribes

---

## 💰 Cost Breakdown

**Monthly Costs:**
- VPS Server: $24-48/month
- Domain (optional): $12/year = $1/month
- Bandwidth: Usually included (1-10TB)
- **Total: ~$25-50/month** (fixed, unlimited usage)

**vs Daily.co at 500K minutes/month: $955/month**

**Savings: $905-930/month** 🎉

---

## 🛠️ Maintenance

### Update Janus
```bash
cd /opt/janus-gateway
git pull
git checkout v1.3.1  # or latest stable
make clean
make
make install
systemctl restart janus
```

### Monitor Janus
```bash
# View logs
tail -f /opt/janus/var/log/janus.log

# Check status
systemctl status janus

# Restart if needed
systemctl restart janus
```

### Backup Configuration
```bash
tar -czf janus-config-backup.tar.gz /opt/janus/etc/janus
```

---

## 🔐 Security Considerations

1. **Use HTTPS/WSS** in production
2. **Set strong passwords** for rooms and admin
3. **Use firewall** (ufw) to restrict access
4. **Regular updates** of Janus and system
5. **Monitor logs** for suspicious activity
6. **Use VPN** for admin access (optional)

---

## 📚 Resources

- **Janus Docs:** https://janus.conf.meetecho.com/docs/
- **GitHub:** https://github.com/meetecho/janus-gateway
- **Discord:** Janus community
- **Examples:** https://janus.conf.meetecho.com/docs/examples.html

---

## 🎯 Next Steps

1. Set up Janus server (2-4 hours)
2. Test with browser (30 min)
3. Integrate with React Native (2-4 hours)
4. Migrate from Daily.co gradually
5. Monitor and optimize

**Want me to help you set up the React Native integration code?**

