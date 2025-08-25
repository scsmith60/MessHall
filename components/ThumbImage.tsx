// components/ThumbImage.tsx
import React, { useEffect, useState } from 'react';
import { Image, ImageProps, ActivityIndicator, View } from 'react-native';
import { resolveThumbUrl } from '../lib/thumb';

type Props = Omit<ImageProps, 'source'> & {
  path?: string | null; // recipes.thumb_path
  debugKey?: string;    // optional: to distinguish logs
};

export default function ThumbImage({ path, debugKey, style, ...rest }: Props) {
  const [uri, setUri] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(!!path);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const u = await resolveThumbUrl(path || '');
        if (alive) setUri(u);
      } catch (e) {
        // DEBUG: leave for now; safe to remove later
        console.log('DBG: ThumbImage resolve error', debugKey, (e as any)?.message || e);
        if (alive) setUri('');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [path, debugKey]);

  if (!uri) {
    return (
      <View style={[{ alignItems: 'center', justifyContent: 'center' }, style as any]}>
        {loading ? <ActivityIndicator /> : null}
      </View>
    );
  }

  return <Image source={{ uri }} style={style} {...rest} />;
}
