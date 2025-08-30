// lib/og.ts
import { supabase } from '@/lib/supabase';

type OgResult = { image: string | null; title?: string | null; description?: string | null };

export async function fetchOgForUrl(url: string): Promise<OgResult> {
  const { data, error } = await supabase.functions.invoke('og-scrape', {
    body: { url },
  });
  if (error) throw error;
  return data as OgResult;
}
