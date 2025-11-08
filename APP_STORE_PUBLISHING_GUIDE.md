# App Store Publishing Guide for MessHall

This guide walks you through publishing MessHall to the Apple App Store and Google Play Store using Expo Application Services (EAS).

## Prerequisites

1. **Expo Account**: You already have an account (`scsmith60`) and EAS project ID configured
2. **Apple Developer Account**: $99/year subscription required for iOS
3. **Google Play Developer Account**: $25 one-time fee required for Android
4. **EAS CLI**: Install if not already installed
   ```bash
   npm install -g eas-cli
   ```

## Step 1: Install and Configure EAS CLI

```bash
# Install EAS CLI globally
npm install -g eas-cli

# Login to your Expo account
eas login

# Verify your project is linked
eas whoami
```

## Step 2: Prepare Your App Configuration

Your `app.config.ts` is already well-configured. Before building, ensure:

- ✅ Version numbers are correct (`version: '1.0.1'` in app.config.ts)
- ✅ Android version code increments with each release (`versionCode: 2`)
- ✅ App icons and splash screens are in place
- ✅ All environment variables are set

### Update EAS Build Configuration

Your `eas.json` needs production build profiles. Update it:

```json
{
  "cli": {
    "version": ">= 6.0.0"
  },
  "build": {
    "production": {
      "android": {
        "buildType": "app-bundle"
      },
      "ios": {
        "simulator": false
      }
    },
    "preview": {
      "android": {
        "buildType": "apk"
      },
      "ios": {
        "simulator": false
      }
    },
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    }
  },
  "submit": {
    "production": {
      "android": {
        "serviceAccountKeyPath": "./path/to/service-account-key.json"
      },
      "ios": {}
    }
  }
}
```

## Step 3: iOS - Apple App Store

### 3.1 Apple Developer Account Setup

1. **Enroll in Apple Developer Program**
   - Go to https://developer.apple.com/programs/
   - Pay $99/year subscription
   - Complete enrollment (can take 24-48 hours)

2. **Create App Identifier**
   - Go to https://developer.apple.com/account/resources/identifiers/list
   - Create new App ID with bundle identifier: `app.messhall`
   - Enable required capabilities (Push Notifications, Associated Domains, etc.)

3. **Create Distribution Certificate & Provisioning Profile**
   - EAS can handle this automatically, but you can also do it manually
   - For automatic: EAS will create these during the first build

### 3.2 Build iOS App

```bash
# Build for production (App Store)
eas build --platform ios --profile production

# Or build for TestFlight first
eas build --platform ios --profile ios-testflight
```

**First time setup:**
- EAS will prompt you to create credentials
- Choose "Set up credentials automatically" (recommended)
- EAS will create certificates and provisioning profiles

### 3.3 Submit to App Store

**Option A: Automatic Submission (Recommended)**
```bash
# Submit directly to App Store Connect
eas submit --platform ios --profile production
```

**Option B: Manual Submission**
1. Download the `.ipa` file from EAS build page
2. Use Transporter app or Xcode to upload to App Store Connect
3. Complete submission in App Store Connect

### 3.4 App Store Connect Setup

1. **Create App Listing**
   - Go to https://appstoreconnect.apple.com
   - Click "My Apps" → "+" → "New App"
   - Fill in:
     - Platform: iOS
     - Name: MessHall
     - Primary Language: English
     - Bundle ID: `app.messhall`
     - SKU: `messhall-ios` (unique identifier)

2. **App Information**
   - Category: Food & Drink
   - Privacy Policy URL (required): Your privacy policy URL
   - Support URL: Your support website

3. **Pricing and Availability**
   - Set price (Free or Paid)
   - Select countries/regions

4. **App Store Listing**
   - Screenshots (required):
     - iPhone 6.7" (1290 x 2796 px) - 3 required
     - iPhone 6.5" (1284 x 2778 px) - 3 required
     - iPad Pro 12.9" (2048 x 2732 px) - 3 required
   - App Preview videos (optional but recommended)
   - Description (up to 4000 characters)
   - Keywords (up to 100 characters)
   - Promotional text (up to 170 characters)
   - Support URL
   - Marketing URL (optional)

5. **Version Information**
   - What's New in This Version
   - Build: Select the build you uploaded

6. **App Review Information**
   - Contact information
   - Demo account (if app requires login)
   - Notes for reviewer

7. **Submit for Review**
   - Answer export compliance questions
   - Submit for review
   - Review typically takes 24-48 hours

## Step 4: Android - Google Play Store

### 4.1 Google Play Developer Account Setup

1. **Create Google Play Developer Account**
   - Go to https://play.google.com/console/signup
   - Pay $25 one-time registration fee
   - Complete account setup

2. **Create App**
   - Go to Google Play Console
   - Click "Create app"
   - Fill in:
     - App name: MessHall
     - Default language: English
     - App or game: App
     - Free or paid: Choose your model

### 4.2 Set Up App Signing

**Option A: Google Play App Signing (Recommended)**
- Google manages your signing key
- EAS can upload the app signing key automatically
- More secure and easier to manage

**Option B: Manual Signing**
- You manage your own keystore
- More control but more responsibility

For first-time setup, let EAS handle it automatically.

### 4.3 Build Android App

```bash
# Build for production (Play Store)
eas build --platform android --profile production
```

**First time setup:**
- EAS will prompt you to create credentials
- Choose "Set up credentials automatically"
- EAS will create a keystore for you
- **IMPORTANT**: Save the credentials password securely!

### 4.4 Create Service Account for Automatic Submission

1. **Create Service Account**
   - Go to Google Play Console → Setup → API access
   - Click "Create new service account"
   - Follow link to Google Cloud Console
   - Create service account with name like "eas-submit"
   - Grant "Service Account User" role

2. **Link Service Account**
   - Go back to Google Play Console → API access
   - Click "Grant access" for your service account
   - Grant permissions:
     - View app information
     - Manage production releases
     - Manage testing track releases

3. **Create and Download Key**
   - In Google Cloud Console, create JSON key for service account
   - Download the JSON file
   - Save it securely (e.g., `google-service-account.json`)
   - Add to `.gitignore` (never commit this file!)

4. **Update eas.json**
   ```json
   "submit": {
     "production": {
       "android": {
         "serviceAccountKeyPath": "./google-service-account.json"
       }
     }
   }
   ```

### 4.5 Submit to Google Play Store

**Option A: Automatic Submission (Recommended)**
```bash
# Submit directly to Play Store
eas submit --platform android --profile production
```

**Option B: Manual Submission**
1. Download the `.aab` file from EAS build page
2. Go to Google Play Console → Your App → Production
3. Click "Create new release"
4. Upload the `.aab` file
5. Add release notes
6. Review and roll out

### 4.6 Google Play Store Listing

1. **Store Listing**
   - App name: MessHall
   - Short description (80 characters)
   - Full description (4000 characters)
   - App icon (512 x 512 px)
   - Feature graphic (1024 x 500 px)
   - Screenshots:
     - Phone: At least 2, up to 8 (16:9 or 9:16)
     - Tablet: At least 2, up to 8 (optional)
   - Promotional video (optional)

2. **Content Rating**
   - Complete questionnaire
   - Get rating certificate

3. **Privacy Policy**
   - Required URL to your privacy policy

4. **Target Audience**
   - Age groups
   - Content guidelines

5. **Data Safety**
   - Declare data collection practices
   - Required for all apps

6. **Pricing & Distribution**
   - Set price (Free or Paid)
   - Select countries/regions

7. **Release to Production**
   - Complete all required sections
   - Submit for review
   - Review typically takes a few hours to a few days

## Step 5: Environment Variables

Ensure all required environment variables are set in EAS:

```bash
# Set environment variables for builds
eas secret:create --scope project --name EXPO_PUBLIC_SUPABASE_URL --value "your-value"
eas secret:create --scope project --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "your-value"
eas secret:create --scope project --name EXPO_PUBLIC_AGORA_APP_ID --value "your-value"
```

Or use `.env` files (not recommended for production secrets).

## Step 6: Testing Before Release

### Internal Testing

1. **Build preview versions**
   ```bash
   eas build --platform ios --profile preview
   eas build --platform android --profile preview
   ```

2. **TestFlight (iOS)**
   - Upload build to TestFlight
   - Add internal testers
   - Test thoroughly before production release

3. **Internal Testing Track (Android)**
   - Upload to internal testing track
   - Add testers via email
   - Test thoroughly

### Checklist Before Submission

- [ ] App works on multiple devices
- [ ] All features tested
- [ ] No crashes or critical bugs
- [ ] Privacy policy URL is accessible
- [ ] App icons and screenshots are high quality
- [ ] App description is clear and accurate
- [ ] Permissions are justified in descriptions
- [ ] Terms of service (if applicable)
- [ ] Support contact information is valid

## Step 7: Version Management

### iOS Versioning
- Update `version` in `app.config.ts` (e.g., "1.0.1")
- iOS uses semantic versioning (major.minor.patch)

### Android Versioning
- Update `version` in `app.config.ts` (e.g., "1.0.1")
- Update `versionCode` in `app.config.ts` (must increment: 2, 3, 4, etc.)
- Android uses version code (integer) for updates

### Release Process

1. **Update version numbers**
   ```typescript
   // app.config.ts
   version: '1.0.2',  // Increment for new release
   android: {
     versionCode: 3,  // Increment for each Android release
   }
   ```

2. **Build new version**
   ```bash
   eas build --platform all --profile production
   ```

3. **Submit update**
   ```bash
   eas submit --platform all --profile production
   ```

## Step 8: Post-Launch

### Monitor Reviews and Ratings
- Respond to user reviews
- Monitor crash reports
- Track analytics

### Update Regularly
- Fix bugs promptly
- Add new features
- Keep dependencies updated

### App Store Optimization (ASO)
- Optimize keywords
- Update screenshots based on performance
- A/B test descriptions
- Encourage positive reviews

## Common Issues and Solutions

### iOS Issues

**"No valid 'aps-environment' entitlement"**
- Enable Push Notifications capability in Apple Developer Portal

**"Missing compliance"**
- Answer export compliance questions in App Store Connect

**"Invalid bundle identifier"**
- Ensure bundle ID matches exactly: `app.messhall`

### Android Issues

**"Version code already used"**
- Increment `versionCode` in `app.config.ts`

**"Upload failed: Invalid keystore"**
- Let EAS manage credentials automatically
- Or ensure keystore is correctly configured

**"Missing privacy policy"**
- Add privacy policy URL in Play Console

## Resources

- [EAS Build Documentation](https://docs.expo.dev/build/introduction/)
- [EAS Submit Documentation](https://docs.expo.dev/submit/introduction/)
- [Apple App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Google Play Policy Center](https://play.google.com/about/developer-content-policy/)

## Quick Reference Commands

```bash
# Build for production
eas build --platform all --profile production

# Build for preview/testing
eas build --platform all --profile preview

# Submit to stores
eas submit --platform all --profile production

# View build status
eas build:list

# View credentials
eas credentials

# Update environment variables
eas secret:create --scope project --name KEY --value "value"
```

## Estimated Timeline

- **Apple Developer Account**: 24-48 hours for approval
- **First iOS Build**: 20-40 minutes
- **App Store Review**: 24-48 hours
- **Google Play Account**: Immediate (after payment)
- **First Android Build**: 15-30 minutes
- **Play Store Review**: 1-7 days (usually 1-2 days)

**Total time to first release**: ~1 week (mostly waiting for reviews)

---

Good luck with your app launch! 🚀

