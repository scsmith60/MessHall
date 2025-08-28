// PURPOSE: pretend database for now using a JSON file on device. Later -> Supabase.
import * as FS from 'expo-file-system';

const FILE = FS.documentDirectory + 'drafts.json';

export type DraftRecipe = {
  id: string;
  title: string;
  minutes?: number;
  servings?: number;
  image?: string; // local URI
  ingredients: { id: string; text: string }[];
  steps: { id: string; text: string }[];
  sourceUrl?: string;
  createdAt: number;
};

// read all drafts
export async function loadDrafts(): Promise<DraftRecipe[]> {
  try {
    const exists = await FS.getInfoAsync(FILE);
    if (!exists.exists) return [];
    const txt = await FS.readAsStringAsync(FILE);
    return JSON.parse(txt);
  } catch {
    return [];
  }
}

// save list
export async function saveDrafts(list: DraftRecipe[]) {
  await FS.writeAsStringAsync(FILE, JSON.stringify(list));
}

// add new
export async function addDraft(d: DraftRecipe) {
  const list = await loadDrafts();
  list.unshift(d);
  await saveDrafts(list);
}
