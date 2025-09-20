// File: components/TutorialOverlay.tsx
// Purpose: A one-time, first-launch tutorial overlay with hand animations (Lottie)
// Tech: React Native + Expo (or bare RN), AsyncStorage for the "seen" flag, Lottie for gestures
// How it works (like you're 5):
// 1) We check a tiny note we saved called "mh_tutorial_seen_v1".
// 2) If it's not there, we show the big help screen with hand videos.
// 3) When you tap "Got it", we save the note so we don't show it again.
// 4) If you want to see it later, there's a helper you can call from Settings to reset the note.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Modal, View, Text, Pressable, StyleSheet, Dimensions, SafeAreaView } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import LottieView from 'lottie-react-native'

// 🔑 Storage key — bump the version if you ship a new tutorial flow
const STORAGE_KEY = 'mh_tutorial_seen_v1'

// ✋ Types for the slides we show
export type TutorialSlide = {
  id: string
  title: string
  subtitle: string
  // Path to your local Lottie JSON asset (put in /assets/lottie/*)
  lottie: any
}

// ⛳ Default slides (edit text to match your app)
// 🧩 Use the exact files you saved in /assets/lottie
const DEFAULT_SLIDES: TutorialSlide[] = [
  {
    id: 'swipe-left',
    title: 'Swipe the Feed (Left)',
    subtitle: 'Move left to peek what’s next.',
    lottie: require('../assets/lottie/swipe-left.json'),
  },
  {
    id: 'swipe-right',
    title: 'Swipe the Feed (Right)',
    subtitle: 'Go back by swiping right.',
    lottie: require('../assets/lottie/swipe-right.json'),
  },
  {
    id: 'tap',
    title: 'Tap a Recipe',
    subtitle: 'Open it to see steps and photos.',
    lottie: require('../assets/lottie/tap.json'),
  },
  {
    id: 'long-press',
    title: 'Long-Press for Actions',
    subtitle: 'Hold to save, share, or add to cart.',
    lottie: require('../assets/lottie/long-press.json'), // or '../assets/lottie/touch.json'
  },
]


// 🧠 Hook: checks + sets the one-time flag
export function useTutorialSeen() {
  const [hasSeen, setHasSeen] = useState<boolean | null>(null)

  useEffect(() => {
    (async () => {
      try {
        const val = await AsyncStorage.getItem(STORAGE_KEY)
        setHasSeen(val === 'true')
      } catch (e) {
        // If storage fails, act as if they have not seen it
        setHasSeen(false)
      }
    })()
  }, [])

  const markSeen = useCallback(async () => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, 'true')
      setHasSeen(true)
    } catch (e) {
      // ignore
    }
  }, [])

  const resetSeen = useCallback(async () => {
    try {
      await AsyncStorage.removeItem(STORAGE_KEY)
      setHasSeen(false)
    } catch (e) {
      // ignore
    }
  }, [])

  return { hasSeen, markSeen, resetSeen }
}

// 🎬 The overlay itself
export function TutorialOverlay({
  visible,
  onDone,
  slides = DEFAULT_SLIDES,
  brandColor = '#15B77E', // MessHall green-ish (adjust to your exact token)
}: {
  visible: boolean
  onDone: () => void
  slides?: TutorialSlide[]
  brandColor?: string
}) {
  const [index, setIndex] = useState(0)
  const lottieRef = useRef<LottieView>(null)

  const { width } = Dimensions.get('window')

  // Restart animation when the slide changes
  useEffect(() => {
    try {
      lottieRef.current?.reset?.()
      // small timeout helps certain Android devices replay reliably
      const t = setTimeout(() => lottieRef.current?.play?.(), 150)
      return () => clearTimeout(t)
    } catch {}
  }, [index])

  const isLast = index === slides.length - 1

  const next = useCallback(() => {
    setIndex((i) => Math.min(i + 1, slides.length - 1))
  }, [slides.length])

  const prev = useCallback(() => {
    setIndex((i) => Math.max(i - 1, 0))
  }, [])

  const current = slides[index]

  return (
    <Modal visible={visible} animationType="fade" transparent>
      {/* Dim the world behind */}
      <View style={styles.backdrop}>
        <SafeAreaView style={styles.card}>
          {/* Header: lil pill that says "Quick Tour" */}
          <View style={[styles.pill, { borderColor: brandColor }]}> 
            <Text style={[styles.pillText, { color: brandColor }]}>Quick Tour</Text>
          </View>

          {/* Title & Subtitle */}
          <Text style={styles.title}>{current.title}</Text>
          <Text style={styles.subtitle}>{current.subtitle}</Text>

          {/* The hand animation */}
          <View style={{ width: width * 0.8, height: width * 0.8, alignSelf: 'center' }}>
            <LottieView
              ref={lottieRef}
              source={current.lottie}
              autoPlay
              loop
              style={{ width: '100%', height: '100%' }}
            />
          </View>

          {/* Pager dots like candy */}
          <View style={styles.dotsRow}>
            {slides.map((s, i) => (
              <View
                key={s.id}
                style={[styles.dot, i === index && { backgroundColor: brandColor, width: 18 }]}
              />
            ))}
          </View>

          {/* Buttons row */}
          <View style={styles.buttonsRow}>
            <Pressable onPress={prev} disabled={index === 0} style={[styles.btn, styles.btnGhost]}> 
              <Text style={[styles.btnGhostText, index === 0 && { opacity: 0.4 }]}>Back</Text>
            </Pressable>
            {isLast ? (
              <Pressable onPress={onDone} style={[styles.btn, { backgroundColor: brandColor }]}>
                <Text style={styles.btnText}>Got it</Text>
              </Pressable>
            ) : (
              <Pressable onPress={next} style={[styles.btn, { backgroundColor: brandColor }]}>
                <Text style={styles.btnText}>Next</Text>
              </Pressable>
            )}
          </View>

          {/* Skip link for grumpy grown-ups */}
          {!isLast && (
            <Pressable onPress={onDone} style={{ marginTop: 8 }}>
              <Text style={[styles.skipText, { color: brandColor }]}>Skip</Text>
            </Pressable>
          )}
        </SafeAreaView>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)', // see-through dark
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  card: {
    width: '100%',
    borderRadius: 20,
    padding: 20,
    backgroundColor: '#0D1117', // HUD dark
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
  },
  pill: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    alignSelf: 'center',
    marginBottom: 12,
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  pillText: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  title: {
    color: 'white',
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 15,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 12,
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 8,
    marginBottom: 12,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.4)',
  },
  buttonsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  btn: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    minWidth: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '700',
  },
  btnGhost: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  btnGhostText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  skipText: {
    fontSize: 14,
    fontWeight: '600',
  },
})

// 🧩 Drop-in wrapper: shows overlay once, saves flag
// Use this in your root layout (e.g., _layout.tsx with Expo Router) or App.tsx
export function TutorialOverlayGate({ children }: { children: React.ReactNode }) {
  const { hasSeen, markSeen } = useTutorialSeen()
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (hasSeen === false) setShow(true)
  }, [hasSeen])

  const handleDone = useCallback(() => {
    setShow(false)
    markSeen()
  }, [markSeen])

  // If we don't yet know, just render app to avoid blocking (fast)
  return (
    <View style={{ flex: 1 }}>
      {children}
      <TutorialOverlay visible={show} onDone={handleDone} />
    </View>
  )
}

// 🛠️ Helper for Settings screen to let users see the tutorial again
export async function resetTutorialOverlay() {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY)
  } catch {}
}

// -------- Usage Example (put this in your root) --------
// File: app/_layout.tsx (Expo Router) or App.tsx
// import { TutorialOverlayGate } from '../components/TutorialOverlay'
//
// export default function RootLayout() {
//   return (
//     <TutorialOverlayGate>
//       {/* your navigators / tabs / screens go here */}
//       <RootNavigator />
//     </TutorialOverlayGate>
//   )
// }
//
// -------- Settings Button Example to Reset --------
// import { resetTutorialOverlay } from '../components/TutorialOverlay'
// <Pressable onPress={() => resetTutorialOverlay()}> 
//   <Text>Replay Tutorial</Text>
// </Pressable>
//
// -------- Installing deps --------
// expo install lottie-react-native
// npm i @react-native-async-storage/async-storage
//
// -------- Adding Lottie files --------
// 1) Make a folder: /assets/lottie
// 2) Download 3 JSON animations (free from lottiefiles.com):
//    - hand-swipe.json
//    - hand-tap.json
//    - hand-longpress.json
// 3) Put them into /assets/lottie and keep the names as-is.
