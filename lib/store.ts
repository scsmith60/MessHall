// PURPOSE: a tiny "recipe registry" so the detail screen can find data by id.
// LATER: we will replace these with Supabase calls, but keep the same function names.
export type RecipeCore = {
  id: string;
  title: string;
  image: string;
  creator: string;
  knives: number;
  cooks: number;
  createdAt: number;
};

class RecipeStore {
  private map = new Map<string, RecipeCore>();
  private saved = new Set<string>();
  private liked = new Set<string>();

  // add/refresh items (called by Home after fetch)
  upsertMany(items: RecipeCore[]) {
    for (const it of items) this.map.set(it.id, it);
  }

  get(id: string) { return this.map.get(id); }

  isSaved(id: string) { return this.saved.has(id); }
  toggleSaved(id: string) {
    if (this.saved.has(id)) this.saved.delete(id); else this.saved.add(id);
    return this.isSaved(id);
  }

  isLiked(id: string) { return this.liked.has(id); }
  toggleLiked(id: string) {
    if (this.liked.has(id)) this.liked.delete(id); else this.liked.add(id);
    return this.isLiked(id);
  }
}

export const recipeStore = new RecipeStore();
