// /lib/theme.ts
// simple theme so all screens look the same
// Centralized color tokens for a unified dark theme.
// These tokens aim to create clear separation between background, surfaces and cards
// while preserving the green accent. Use these everywhere instead of hard-coded hexes.
export const COLORS = {
  // base layers
  bg: '#071F1C', // very dark green-gray / near-black (root background)
  surface: '#0A2A26', // main panels / screen containers (input fields)
  card: '#153A32', // card surfaces that sit above surface
  elevated: '#153A32', // stronger elevated panels

  // overlays & scrims
  overlay: 'rgba(7,31,28,0.6)',

  // accent
  accent: '#1DB954', // primary green accent
  accentActive: '#17A84A',
  onAccent: '#FFFFFF',

  // status
  danger: '#EF4444',
  success: '#1DB954',

  // typography
  text: '#E6F7F6', // primary text
  subtext: '#A9C7C6', // secondary text / captions
  muted: '#5E8583',

  // borders / dividers / shadows
  border: 'rgba(255,255,255,0.06)',
  shadow: 'rgba(0,0,0,0.6)',
};

export const RADIUS = { xl: 20, lg: 16, md: 12, sm: 8 };
export const SPACING = { xl: 24, lg: 16, md: 12, sm: 8 };
