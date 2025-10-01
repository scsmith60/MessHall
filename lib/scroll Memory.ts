// /lib/scrollMemory.ts
// 🧠 like I'm 5: a little notebook where we remember list positions per screen
// - set(name, y): write the Y scroll position
// - get(name): read it back when we return

const store = new Map<string, number>();

export function rememberScroll(screenName: string, y: number) {
  store.set(screenName, y);
}

export function recallScroll(screenName: string) {
  return store.get(screenName) ?? 0; // 0 if we never saved
}

export function clearScroll(screenName: string) {
  store.delete(screenName);
}
