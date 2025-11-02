# Janus WebRTC Setup Instructions

## 🎯 What You Need to Do

This guide walks you through setting up your Janus WebRTC server and configuring the app to use it.

---

## Step 1: Set Up VPS Server (Choose One)

### Option A: DigitalOcean (Recommended for Beginners)

1. **Sign up:** https://www.digitalocean.com
2. **Create Droplet:**
   - Choose: **Ubuntu 22.04**
   - Plan: **Basic** → **Regular Intel** → **$24/month** (4GB RAM, 2 vCPU)
   - Datacenter: Choose closest to your users
   - Authentication: SSH keys (recommended) or password
3. **Note your server IP address**

### Option B: Hetzner (Cheapest)

1. **Sign up:** https://www.hetzner.com
2. **Create Server:**
   - Location: Choose closest to users
   - Image: **Ubuntu 22.04**
   - Type: **CPX21** (4 vCPU, 8GB RAM) - **~€20/month**
3. **Note your server IP address**

---

## Step 2: Install Janus (4-8 hours)

**Follow the complete guide:** `JANUS_WEBRTC_SETUP_GUIDE.md`

**Quick summary:**
1. SSH into your server: `ssh root@YOUR_SERVER_IP`
2. Install dependencies (see guide)
3. Compile and install Janus
4. Configure Janus (edit config files)
5. Start Janus service: `systemctl start janus`
6. Test: `curl http://YOUR_SERVER_IP:8088/janus/info`

**Key configuration:**
- WebSocket port: `8188` (non-secure) or `8989` (secure)
- HTTP API port: `8088` (non-secure) or `8089` (secure)

---

## Step 3: Configure Environment Variables

### In Your React Native App

Add to your `.env` file or `app.config.ts`:

```bash
EXPO_PUBLIC_JANUS_SERVER_URL=wss://your-server-ip:8989/janus
EXPO_PUBLIC_JANUS_HTTP_URL=https://your-server-ip:8089/janus
```

**For development (local network testing):**
```bash
EXPO_PUBLIC_JANUS_SERVER_URL=ws://YOUR_SERVER_IP:8188/janus
EXPO_PUBLIC_JANUS_HTTP_URL=http://YOUR_SERVER_IP:8088/janus
```

**For production (with SSL):**
```bash
EXPO_PUBLIC_JANUS_SERVER_URL=wss://janus.yourdomain.com:8989/janus
EXPO_PUBLIC_JANUS_HTTP_URL=https://janus.yourdomain.com:8089/janus
```

### In Supabase (Edge Functions)

Go to **Supabase Dashboard → Edge Functions → Secrets**

Add these secrets:
- **`JANUS_ADMIN_URL`**: `http://YOUR_SERVER_IP:8088/janus` (optional, for room creation via API)
- **`JANUS_ADMIN_SECRET`**: Your admin secret if configured (optional)

**Note:** Edge functions will work without these - Janus creates rooms automatically on first join.

---

## Step 4: Set Up SSL/HTTPS (Production)

For production, you need SSL certificates:

### Option A: Let's Encrypt (Free)

```bash
# On your server
apt install certbot
certbot certonly --standalone -d janus.yourdomain.com

# Update Janus config to use SSL certificates
# Edit /opt/janus/etc/janus/janus.jcfg
```

### Option B: Cloudflare Tunnel (Easiest)

1. Install Cloudflare Tunnel
2. Point subdomain to your Janus server
3. Cloudflare handles SSL automatically

---

## Step 5: Configure Firewall

```bash
# Allow Janus ports
ufw allow 8088/tcp   # HTTP Janus
ufw allow 8089/tcp # HTTPS Janus
ufw allow 8188/tcp  # WebSocket
ufw allow 8989/tcp  # Secure WebSocket
ufw allow 3478/tcp  # TURN
ufw allow 3478/udp  # TURN
ufw allow 49152:65535/udp  # TURN relay ports
```

---

## Step 6: Test the Integration

1. **Update your app code:**
   - Already done! The code has been updated to use Janus
   - Just need to set environment variables

2. **Deploy edge functions:**
   ```bash
   supabase functions deploy janus-create-room
   supabase functions deploy janus-get-token
   ```

3. **Test in app:**
   - Create a session
   - Start video (host)
   - Join video (participant)
   - Verify video works

---

## Step 7: Remove Old Code (Optional Cleanup)

Once Janus is working, you can remove:
- `supabase/functions/daily-create-room/` (keep for reference if needed)
- `supabase/functions/daily-get-token/` (keep for reference if needed)
- `supabase/functions/cloudflare-create-stream/` (keep for reference if needed)
- `components/VideoStream.tsx` (keep for reference)
- `components/VideoStreamCloudflare.tsx` (keep for reference)

---

## 🔧 Troubleshooting

### "Failed to connect to Janus"
- Check firewall rules
- Verify Janus is running: `systemctl status janus`
- Check Janus logs: `tail -f /opt/janus/var/log/janus.log`
- Verify WebSocket URL is correct

### "WebRTC connection failed"
- Check TURN server is configured
- Verify ICE servers in component
- Check network connectivity

### "Room not found"
- Janus creates rooms automatically on first join
- Check room ID format (should be numeric)

---

## 📝 Configuration Checklist

- [ ] VPS server created and running
- [ ] Janus installed and running
- [ ] Firewall configured
- [ ] Environment variables set in app
- [ ] Edge function secrets set in Supabase
- [ ] SSL configured (production)
- [ ] Edge functions deployed
- [ ] Tested video streaming

---

## 🚀 Next Steps

Once Janus is working:

1. **Remove session duration limits** (optional - since costs are fixed)
2. **Remove participant count limits** (optional - for technical limits only)
3. **Remove monthly usage caps** (not needed with fixed costs)
4. **Monitor server performance** and scale as needed

---

## 📚 Additional Resources

- **Full Setup Guide:** `JANUS_WEBRTC_SETUP_GUIDE.md`
- **Janus Documentation:** https://janus.conf.meetecho.com/docs/
- **Business Case:** `JANUS_RECOMMENDATION.md`

---

**Estimated Setup Time:** 4-8 hours (mostly waiting for compilation)

**Once setup is complete, your app will use Janus instead of Daily.co/Cloudflare!** 🎉

