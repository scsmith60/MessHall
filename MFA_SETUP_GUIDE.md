# 2FA Setup Guide for MessHall

This guide explains how to enable Two-Factor Authentication (2FA) for users in your MessHall app.

## Overview

We've already created:
- ✅ Security settings screen (`app/(account)/settings/security.tsx`)
- ✅ MFA enabled in local config (`supabase/config.toml`)
- ✅ Eligibility check that verifies 2FA status
- ✅ UI for users to enroll in 2FA

## Steps to Enable 2FA

### 1. **Supabase Plan Requirement**
MFA is only available on **Supabase Pro plan or higher**. If you're on the free tier, you'll need to upgrade.

### 2. **Enable MFA in Supabase Dashboard (Production)**

For your **production/hosted Supabase project**:

1. Go to your Supabase project dashboard: https://app.supabase.com
2. Navigate to **Authentication** → **Settings** (or **Settings** → **Auth**)
3. Scroll down to **Multi-Factor Authentication (MFA)** section
4. Enable **MFA** (toggle it on)
5. Enable **TOTP (Time-based One-Time Password)** specifically
6. Save the settings

**Note:** The config.toml file only affects local development. For production, you must enable it in the dashboard.

### 3. **Local Development Setup**

If you're running Supabase locally:

1. The `supabase/config.toml` file already has MFA enabled:
   ```toml
   [auth.mfa.totp]
   enroll_enabled = true
   verify_enabled = true
   ```

2. **Restart your local Supabase instance** to apply changes:
   ```bash
   npx supabase stop
   npx supabase start
   ```

### 4. **Verify It's Working**

1. Open your app and navigate to the monetization screen
2. Tap on "2FA is turned on" in the checklist (or go to Settings → Security)
3. You should see the security settings screen
4. Tap "Enable 2FA"
5. You should see a QR code and secret key (if MFA is properly enabled)
6. If you see an error about MFA not being enabled, check steps 2 or 3 above

## How It Works

### User Flow:
1. User taps "2FA is turned on" in monetization checklist
2. Navigates to Security Settings screen
3. Taps "Enable 2FA"
4. Sees QR code and secret key
5. Scans QR code with authenticator app (Google Authenticator, Authy, etc.)
6. Enters 6-digit code to verify
7. 2FA is now enabled ✅

### Technical Flow:
1. `supabase.auth.mfa.enroll()` - Starts enrollment, returns QR code and secret
2. User scans QR code with authenticator app
3. `supabase.auth.mfa.verify()` - Verifies the code from authenticator app
4. Factor is marked as "verified" in `auth.mfa_factors` table
5. Eligibility check queries `auth.mfa_factors` to verify 2FA status

## Troubleshooting

### Error: "MFA not enabled"
- **Local:** Make sure you restarted Supabase after changing config.toml
- **Production:** Enable MFA in Supabase dashboard (see step 2)

### Error: "MFA is only available on Pro plan"
- Upgrade your Supabase project to Pro plan or higher
- MFA is not available on the free tier

### QR Code Not Showing
- Check browser console for errors
- Verify MFA is enabled in dashboard/config
- Make sure you're using a recent version of @supabase/supabase-js

### Can't Verify Code
- Make sure your device time is synchronized (TOTP is time-based)
- Try entering the code manually using the secret key
- Wait a few seconds and try a new code (codes refresh every 30 seconds)

## Database Access

The eligibility check function queries `auth.mfa_factors` table. This table is in the `auth` schema and is automatically managed by Supabase. No additional RLS policies are needed - Supabase handles access control for MFA factors.

## Testing

To test 2FA enrollment:
1. Use a test account
2. Enable 2FA
3. Use Google Authenticator or Authy to scan the QR code
4. Verify with a code
5. Check that the monetization checklist now shows 2FA as passed

## Additional Resources

- [Supabase MFA Documentation](https://supabase.com/docs/guides/auth/mfa)
- [TOTP RFC 6238](https://tools.ietf.org/html/rfc6238)

