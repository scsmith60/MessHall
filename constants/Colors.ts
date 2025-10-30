// Centralized color system for light/dark. Keep legacy keys to avoid breaking Themed.tsx
const tintColorLight = '#1DB954';
const tintColorDark = '#1DB954';

const palette = {
  // dark theme tokens
  dark: {
    text: '#E6F7F6',
    subtext: '#A9C7C6',
    muted: '#5E8583',
    background: '#071F20', // root background
    surface: '#0A2A2B',
    card: '#0F3A3B',
    elevated: '#123C3D',
    border: 'rgba(255,255,255,0.06)',
    overlay: 'rgba(7,31,32,0.6)',
    tint: tintColorDark,
    accent: '#1DB954',
    accentActive: '#17A84A',
    onAccent: '#FFFFFF',
    success: '#27AE60',
    warning: '#F2C94C',
    danger: '#EB5757',
    tabIconDefault: '#9BB4B1',
    tabIconSelected: tintColorDark,
  },

  // light theme tokens (kept minimal since app is primarily dark)
  light: {
    text: '#0F172A',
    subtext: '#475569',
    muted: '#64748B',
    background: '#F8FAFA',
    surface: '#FFFFFF',
    card: '#FFFFFF',
    elevated: '#F1F5F9',
    border: '#E5E7EB',
    overlay: 'rgba(0,0,0,0.5)',
    tint: tintColorLight,
    accent: '#1DB954',
    accentActive: '#17A84A',
    onAccent: '#FFFFFF',
    success: '#16A34A',
    warning: '#F59E0B',
    danger: '#EF4444',
    tabIconDefault: '#94A3B8',
    tabIconSelected: tintColorLight,
  },
};

export default palette;
