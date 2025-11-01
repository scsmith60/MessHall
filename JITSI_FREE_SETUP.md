# Jitsi Meet Integration (100% FREE, Unlimited)

## Why Jitsi?
- ✅ **Completely Free**: No limits, no API keys, no accounts
- ✅ **Open Source**: Self-hosted or use public servers
- ✅ **No Costs**: Unlimited usage forever
- ✅ **Privacy**: Your data stays on your server (if self-hosted)

## Setup Options

### Option 1: Use Public Jitsi Servers (Easiest - 5 minutes)
No setup needed! Just use room URLs like: `https://meet.jit.si/enlisted-session-123`

**Pros**: 
- Zero setup
- Free forever
- Works immediately

**Cons**:
- Using public infrastructure (privacy concern for some)
- Less control

### Option 2: Self-Host Jitsi (More Control)
Host your own Jitsi server for complete control.

**Pros**:
- Complete privacy
- Full customization
- No external dependencies

**Cons**:
- Need server (~$10-20/month VPS)
- Setup and maintenance required

## Implementation for Option 1 (Public Jitsi - Recommended)

Since Jitsi doesn't require API keys or tokens, we can simplify the Edge Functions to just generate room names. Would you like me to:

1. **Replace Daily.co with Jitsi Meet** (completely free, no API keys needed)
2. **Keep Daily.co** but use the free 10,000 minutes/month tier
3. **Add Jitsi as a fallback** option

For most use cases, **Daily.co's free 10,000 minutes/month is plenty** and requires less setup. But if you want truly unlimited free streaming, Jitsi is the way to go.

