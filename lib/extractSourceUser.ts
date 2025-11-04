/**
 * Extract username/source identifier from social media URLs
 * Supports Instagram, TikTok, and other platforms
 * 
 * Examples:
 * - https://www.instagram.com/p/ABC123/ → extracts from URL path or meta
 * - https://www.instagram.com/reel/ABC123/ → extracts from URL path or meta
 * - https://www.tiktok.com/@username/video/123456 → @username
 * - https://www.tiktok.com/@cookingcreator/video/123456 → @cookingcreator
 */

export function extractSourceUserFromUrl(url: string): string | null {
  if (!url || typeof url !== 'string') return null;

  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();

    // TikTok: https://www.tiktok.com/@username/video/123456
    if (hostname.includes('tiktok.com')) {
      const match = urlObj.pathname.match(/\/@([^/]+)/);
      if (match && match[1]) {
        return `@${match[1]}`;
      }
    }

    // Instagram: https://www.instagram.com/p/ABC123/ or /reel/ABC123/
    // Username is usually in the URL path or we need to extract from meta
    // For now, we'll try to extract from path if available
    if (hostname.includes('instagram.com')) {
      // Instagram URLs sometimes have username in path: /username/p/ABC123/
      const pathMatch = urlObj.pathname.match(/^\/([^/]+)\/(?:p|reel|tv)\//);
      if (pathMatch && pathMatch[1] && !pathMatch[1].match(/^\d+$/)) {
        // Don't match if it's just numbers (likely a post ID)
        return `@${pathMatch[1]}`;
      }
    }

    // YouTube: https://www.youtube.com/@channelname or /channel/CHANNEL_ID
    if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) {
      const match = urlObj.pathname.match(/\/@([^/]+)/);
      if (match && match[1]) {
        return `@${match[1]}`;
      }
    }

    // Pinterest: https://www.pinterest.com/username/board/
    if (hostname.includes('pinterest.com')) {
      const match = urlObj.pathname.match(/^\/([^/]+)/);
      if (match && match[1] && match[1] !== 'pin') {
        return `@${match[1]}`;
      }
    }

    // Generic: if URL contains @username pattern, extract it
    const genericMatch = url.match(/@([a-zA-Z0-9._-]+)/);
    if (genericMatch && genericMatch[1]) {
      return `@${genericMatch[1]}`;
    }

    return null;
  } catch (e) {
    // If URL parsing fails, try regex fallback
    const fallbackMatch = url.match(/@([a-zA-Z0-9._-]+)/);
    if (fallbackMatch && fallbackMatch[1]) {
      return `@${fallbackMatch[1]}`;
    }
    return null;
  }
}

/**
 * Extract source user from HTML meta tags (for cases where URL doesn't contain username)
 * This is useful for Instagram posts where the URL might just be /p/ABC123/
 */
export function extractSourceUserFromMeta(html: string, url: string): string | null {
  if (!html || typeof html !== 'string') return null;

  try {
    // Instagram: look for author or og:site_name with @username
    const authorMatch = html.match(/<meta[^>]+property=["']article:author["'][^>]+content=["']([^"']+)["']/i);
    if (authorMatch && authorMatch[1]) {
      const username = authorMatch[1].match(/@?([a-zA-Z0-9._-]+)/);
      if (username && username[1]) {
        return `@${username[1]}`;
      }
    }

    // TikTok: look for author meta
    const tiktokAuthorMatch = html.match(/<meta[^>]+name=["']author["'][^>]+content=["']([^"']+)["']/i);
    if (tiktokAuthorMatch && tiktokAuthorMatch[1]) {
      const username = tiktokAuthorMatch[1].match(/@?([a-zA-Z0-9._-]+)/);
      if (username && username[1]) {
        return `@${username[1]}`;
      }
    }

    // Look for @username in JSON-LD structured data
    const jsonLdMatch = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
    if (jsonLdMatch && jsonLdMatch[1]) {
      try {
        const json = JSON.parse(jsonLdMatch[1]);
        const author = json?.author?.name || json?.author?.alternateName || json?.['@graph']?.[0]?.author?.name;
        if (author) {
          const username = String(author).match(/@?([a-zA-Z0-9._-]+)/);
          if (username && username[1]) {
            return `@${username[1]}`;
          }
        }
      } catch (e) {
        // JSON parse failed, continue
      }
    }

    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Main function to extract source user from URL and optionally HTML
 * Tries URL first, then falls back to HTML meta extraction
 */
export async function extractSourceUser(url: string, html?: string): Promise<string | null> {
  // First try extracting from URL
  const fromUrl = extractSourceUserFromUrl(url);
  if (fromUrl) return fromUrl;

  // If URL extraction failed and HTML is provided, try meta extraction
  if (html) {
    const fromMeta = extractSourceUserFromMeta(html, url);
    if (fromMeta) return fromMeta;
  }

  return null;
}

