// /lib/haptics.ts
// one place to control all buzz patterns
import * as Haptics from 'expo-haptics';

/** tiny tick for normal taps */
export const tap = async () => Haptics.selectionAsync();

/** stronger buzz for success (like recipe saved) */
export const success = async () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

/** gentle warning (like missing field) */
export const warn = async () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
