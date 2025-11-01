# Jitsi SDK Peer Dependencies - Complete List

This document lists all peer dependencies required by `@jitsi/react-native-sdk@11.6.3`.

## Already Installed ✅

All required peer dependencies have been installed:

1. `@amplitude/analytics-react-native@1.4.13` ✅
2. `@giphy/react-native-sdk@4.1.0` ✅
3. `@react-native-async-storage/async-storage@1.23.1` ✅
4. `@react-native-clipboard/clipboard@1.14.3` ✅
5. `@react-native-community/netinfo@11.1.0` ✅ (installed as ^11.1.0)
6. `@react-native-community/slider@4.5.6` ✅ (installed as ^4.5.6)
7. `@react-native-google-signin/google-signin@10.1.0` ✅
8. `@sayem314/react-native-keep-awake@1.3.1` ✅
9. `react-native-background-timer` (Jitsi fork) ✅
10. `react-native-calendar-events` (Jitsi fork) ✅
11. `react-native-default-preference` (Jitsi fork) ✅
12. `react-native-device-info@12.1.0` ✅
13. `react-native-get-random-values@1.11.0` ✅
14. `react-native-gesture-handler@2.24.0` ✅ (installed as ~2.28.0 - compatible)
15. `react-native-pager-view@6.8.1` ✅
16. `react-native-performance@5.1.2` ✅
17. `react-native-orientation-locker` (Jitsi fork) ✅
18. `react-native-safe-area-context@5.5.2` ✅ (installed as ~5.6.0 - compatible)
19. `react-native-screens@4.11.1` ✅ (installed as ~4.16.0 - compatible)
20. `react-native-sound` (Jitsi fork) ✅
21. `react-native-splash-view@0.0.18` ✅
22. `react-native-svg@15.11.2` ✅ (installed as 15.12.1 - compatible)
23. `react-native-video@6.13.0` ✅
24. `react-native-watch-connectivity@1.1.0` ✅
25. `react-native-webrtc@124.0.7` ✅
26. `react-native-webview@13.13.5` ✅ (installed as ^13.15.0 - compatible)
27. `react-native-worklets-core` (Jitsi fork) ✅

## Additional Dependencies Installed

- `@amplitude/analytics-core` - Required by Amplitude analytics
- `react-native-default-preference` - Was initially installed from npm, now using Jitsi fork

## Note

Some packages are installed with slightly newer versions (using `^` or `~`), but they are compatible with the SDK's requirements. The SDK uses optional imports, so some dependencies may only be loaded if specific features are used.

## Installation Command (for reference)

If you ever need to reinstall all peer dependencies:

```bash
npm install \
  @amplitude/analytics-react-native@1.4.13 \
  @giphy/react-native-sdk@4.1.0 \
  @react-native-async-storage/async-storage@1.23.1 \
  @react-native-clipboard/clipboard@1.14.3 \
  @react-native-community/netinfo@11.1.0 \
  @react-native-community/slider@4.5.6 \
  @react-native-google-signin/google-signin@10.1.0 \
  @sayem314/react-native-keep-awake@1.3.1 \
  react-native-background-timer@github:jitsi/react-native-background-timer#d180dfaa4486ae3ee17d01242db92cb3195f4718 \
  react-native-calendar-events@github:jitsi/react-native-calendar-events#47f068dedfed7c0f72042e093f688eb11624eb7b \
  react-native-default-preference@github:jitsi/react-native-default-preference#c9bf63bdc058e3fa2aa0b87b1ee1af240f44ed02 \
  react-native-device-info@12.1.0 \
  react-native-get-random-values@1.11.0 \
  react-native-gesture-handler@2.24.0 \
  react-native-pager-view@6.8.1 \
  react-native-performance@5.1.2 \
  react-native-orientation-locker@github:jitsi/react-native-orientation-locker#fe095651d819cf134624f786b61fc8667862178a \
  react-native-safe-area-context@5.5.2 \
  react-native-screens@4.11.1 \
  react-native-sound@github:jitsi/react-native-sound#ea13c97b5c2a4ff5e0d9bacbd9ff5e4457fe2c3c \
  react-native-splash-view@0.0.18 \
  react-native-svg@15.11.2 \
  react-native-video@6.13.0 \
  react-native-watch-connectivity@1.1.0 \
  react-native-webrtc@124.0.7 \
  react-native-webview@13.13.5 \
  react-native-worklets-core@github:jitsi/react-native-worklets-core#8c5dfab2a5907305da8971696a781b60f0f9cb18 \
  --legacy-peer-deps
```

