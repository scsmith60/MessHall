\# MessHall Assets



All paths below match `app.json`.



\## App icons



\- \*\*./assets/messhall\_icon\_1024.png\*\*  

&nbsp; Square, 1024×1024, no rounded corners, no transparency (iOS uses this).



\- \*\*./assets/messhall\_adaptive\_foreground.png\*\*  

&nbsp; Transparent foreground for Android adaptive icon (layered on color #0B0F19).  

&nbsp; Recommend at least 432×432 with 72px margin all around.



\## Splash



\- \*\*./assets/messhall\_splash.png\*\*  

&nbsp; Large, transparent or solid, centered. Expo scales to device.  

&nbsp; Recommended source: 3000×3000 PNG.



\## Brand marks (optional but handy)



\- \*\*./assets/logo\_wordmark\_light.png\*\* – for light BGs  

\- \*\*./assets/logo\_wordmark\_dark.png\*\* – for dark BGs  

\- \*\*./assets/placeholder\_thumb.png\*\* – 800×600 safe placeholder



\## Tips

\- Keep text inside a safe area (~70% of width/height).

\- Don’t round corners on the master icon; platforms do this differently.

\- If the icon looks too small on Android 13+, expand artwork in the adaptive foreground file.

# MessHall 🍽️

A modern recipe sharing & cook-mode app built with Expo + React Native.  
Supports deep links, Android/iOS share intents, Supabase backend, and light/dark theming.

---

## Quick start

```sh
# 1. Clone + install
git clone https://github.com/you/messhall.git
cd messhall
npm install   # or yarn / pnpm

# 2. Set Supabase env (see below)
cp .env.example .env

# 3. Start in Expo dev client
npx expo start --clear


