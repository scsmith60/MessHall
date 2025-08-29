// PURPOSE: create your public profile row if it doesn't exist yet.
// We call this before first "Save to Cloud".
import { supabase } from './supabase';

export async function ensureMyProfile() {
  const { data: u } = await supabase.auth.getUser();
  if (!u?.user) throw new Error('Not signed in');

  const id = u.user.id;
  // try to fetch
  const { data: existing } = await supabase.from('profiles').select('id').eq('id', id).maybeSingle();
  if (existing) return id;

  // make a simple default username (you can edit later in Profile screen)
  const username = 'user_' + id.slice(0, 6);

  const { error } = await supabase.from('profiles').insert({
    id, username, display_name: username
  });
  if (error) throw error;
  return id;
}
