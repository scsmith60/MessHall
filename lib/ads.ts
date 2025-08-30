// /lib/ads.ts
import { supabase } from './supabase';

export type AdEventType = 'impression' | 'click';

/** ELI5: Save "I saw/clicked ad X creative Y". */
export async function logAdEvent(
  slotId: string,
  type: AdEventType,
  meta?: Record<string, any>,
  creativeId?: string
) {
  try {
    if (!slotId || (type !== 'impression' && type !== 'click')) return;
    const { data: u } = await supabase.auth.getUser();
    const payload = {
      slot_id: slotId,
      creative_id: creativeId ?? null,
      event_type: type,
      user_id: u?.user?.id ?? null,
      meta: meta ?? null
    };
    const { error } = await supabase.from('ad_events').insert(payload);
    if (error) console.log('ad_events insert error', error.message);
  } catch (e) {
    console.log('ad_events insert failed', e);
  }
}
