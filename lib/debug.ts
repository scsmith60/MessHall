// lib/debug.ts
// 🧸 Like I'm 5: This file is our "little notebook".
// We write tiny notes (logs) every time important auth stuff happens.
// The notes are saved on the device so we can read them even after a restart.

import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "__MH_DEBUG_LOG__";
const MAX = 300; // keep last 300 notes

type Entry = {
  ts: number;           // when it happened
  tag: string;          // category like [auth], [login], [tabs]
  msg: string;          // human text
  data?: any;           // extra details (safe stuff only)
};

let listeners = new Set<(e: Entry) => void>();

async function readAll(): Promise<Entry[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Entry[]) : [];
  } catch {
    return [];
  }
}

async function writeAll(list: Entry[]) {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // ignore
  }
}

export const d = {
  // ✏️ write a note
  log: async (tag: string, msg: string, data?: any) => {
    const entry: Entry = { ts: Date.now(), tag, msg, data };
    console.log(`${new Date(entry.ts).toISOString()} ${tag} ${msg}`, data ?? "");
    const list = await readAll();
    list.push(entry);
    // keep it from getting tooooo big
    while (list.length > MAX) list.shift();
    await writeAll(list);
    // tell any screens watching that a new note came in
    listeners.forEach((fn) => fn(entry));
  },

  // 📖 get all notes (newest last)
  getAll: readAll,

  // 🧼 erase the notebook
  clear: async () => {
    await AsyncStorage.removeItem(KEY);
  },

  // 👂 let a screen listen for new notes
  subscribe: (fn: (e: Entry) => void) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

// Small helper for quick redacted session snapshot (so we don't log secrets)
export function summarizeSession(session: any) {
  if (!session) return null;
  return {
    userId: session.user?.id ?? null,
    email: session.user?.email ?? null,
    provider: session.user?.app_metadata?.provider ?? null,
    expiresAt: session.expires_at ?? null,
  };
}
