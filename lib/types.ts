// lib/types.ts
// LIKE I'M 5: this tells TypeScript what a Recipe looks like,
// including the source_url we care about.

export type Recipe = {
  id: string;
  owner_id: string | null;            // your table has owner_id (use user_id if that's your column)
  is_private: boolean;                // if true, monetization should be OFF
  monetization_eligible: boolean;     // the toggle we show in the app
  source_url: string | null;          // if this has a link, recipe is IMPORTED
  title?: string | null;              // optional fields (only if you have them)
  likes_count?: number | null;
  cooks_count?: number | null;
  created_at: string;
  updated_at: string;
  // add any other fields you store... totally fine
};
