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

/**
 * Extract a clean domain name from URL for display
 * Examples:
 * - www.allrecipes.com -> allrecipes.com
 * - www.foodnetwork.com -> foodnetwork.com
 * - m.tiktok.com -> tiktok.com
 */
function extractDomainFromUrl(url: string): string | null {
  if (!url || typeof url !== 'string') return null;
  
  try {
    const urlObj = new URL(url);
    let hostname = urlObj.hostname.toLowerCase();
    
    // Remove www. prefix
    if (hostname.startsWith('www.')) {
      hostname = hostname.substring(4);
    }
    
    // Remove mobile prefixes (m., mobile.)
    hostname = hostname.replace(/^(m|mobile)\./, '');
    
    return hostname || null;
  } catch (e) {
    return null;
  }
}

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

    // Instagram: https://www.instagram.com/p/ABC123/ or /reel/ABC123/ or /username/p/ABC123/
    // Instagram URLs can have username in path: /username/p/ABC123/
    // Or they might be just /p/ABC123/ (username not in URL, would need DOM extraction)
    if (hostname.includes('instagram.com')) {
      // Try to extract from path: /username/p/ABC123/ or /username/reel/ABC123/
      const pathMatch = urlObj.pathname.match(/^\/([^/]+)\/(?:p|reel|tv)\//);
      if (pathMatch && pathMatch[1] && !pathMatch[1].match(/^\d+$/)) {
        // Don't match if it's just numbers (likely a post ID)
        return `@${pathMatch[1]}`;
      }
      // Also check if the path starts with what looks like a username (not p, reel, tv)
      const firstPathSegment = urlObj.pathname.split('/').filter(Boolean)[0];
      if (firstPathSegment && 
          !['p', 'reel', 'tv', 'stories', 'explore', 'accounts'].includes(firstPathSegment.toLowerCase()) &&
          !firstPathSegment.match(/^\d+$/) &&
          firstPathSegment.length >= 1 && firstPathSegment.length <= 30) {
        return `@${firstPathSegment}`;
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

    // Fallback: return domain name as source (for recipe sites, blogs, etc.)
    // This ensures we always have some attribution
    const domain = extractDomainFromUrl(url);
    if (domain) {
      return domain;
    }

    return null;
  } catch (e) {
    // If URL parsing fails, try regex fallback for @username
    const fallbackMatch = url.match(/@([a-zA-Z0-9._-]+)/);
    if (fallbackMatch && fallbackMatch[1]) {
      return `@${fallbackMatch[1]}`;
    }
    // Last resort: try to extract domain from URL string
    const domainMatch = url.match(/https?:\/\/(?:www\.)?([^\/]+)/i);
    if (domainMatch && domainMatch[1]) {
      return domainMatch[1].toLowerCase().replace(/^www\./, '');
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

    // Look for author in JSON-LD structured data (for recipe sites and blogs)
    const jsonLdMatches = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
    for (const match of jsonLdMatches) {
      try {
        const json = JSON.parse(match[1]);
        // Handle both single objects and arrays/graphs
        const items = Array.isArray(json) ? json : (json['@graph'] ? json['@graph'] : [json]);
        
        for (const item of items) {
          // Try to extract author from Recipe schema
          if (item['@type'] && /Recipe/i.test(String(item['@type']))) {
            const author = item?.author;
            if (author) {
              // Handle author as object or string
              const authorName = typeof author === 'string' 
                ? author 
                : author?.name || author?.alternateName || author?.givenName || author?.familyName;
              if (authorName) {
                const nameStr = String(authorName).trim();
                // If it looks like a username (@username), return as-is
                if (nameStr.match(/^@[a-zA-Z0-9._-]+$/)) {
                  return nameStr;
                }
                // Otherwise, format as name (for recipe sites, we use the full name)
                // But only if it's not too long (likely a real name, not a username)
                if (nameStr.length > 0 && nameStr.length <= 50 && !nameStr.includes('@')) {
                  return nameStr; // Return full name for recipe sites
                }
              }
            }
          }
          
          // Also check generic author field (for articles, blog posts, etc.)
          const author = item?.author?.name || item?.author?.alternateName || item?.author;
          if (author) {
            const authorName = typeof author === 'string' ? author : author?.name;
            if (authorName) {
              const nameStr = String(authorName).trim();
              // Check for @username pattern
              const username = nameStr.match(/@?([a-zA-Z0-9._-]+)/);
              if (username && username[1]) {
                return `@${username[1]}`;
              }
              // If it's a reasonable name (not too long), return it
              if (nameStr.length > 0 && nameStr.length <= 50 && !nameStr.includes('@')) {
                return nameStr;
              }
            }
          }
        }
      } catch (e) {
        // JSON parse failed, continue to next match
      }
    }
    
    // Also check for author meta tags (for recipe sites)
    const authorMetaMatch = html.match(/<meta[^>]+name=["']author["'][^>]+content=["']([^"']+)["']/i);
    if (authorMetaMatch && authorMetaMatch[1]) {
      const authorName = authorMetaMatch[1].trim();
      // If it looks like a username, format it
      const username = authorName.match(/@?([a-zA-Z0-9._-]+)/);
      if (username && username[1]) {
        return authorName.startsWith('@') ? authorName : `@${username[1]}`;
      }
      // Otherwise return the full name (if reasonable length)
      if (authorName.length > 0 && authorName.length <= 50) {
        return authorName;
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
 * Always returns something - falls back to domain name if no username/author found
 */
export async function extractSourceUser(url: string, html?: string): Promise<string | null> {
  // First try extracting from URL (includes domain fallback)
  const fromUrl = extractSourceUserFromUrl(url);
  if (fromUrl) return fromUrl;

  // If URL extraction didn't find username/author and HTML is provided, try meta extraction
  if (html) {
    const fromMeta = extractSourceUserFromMeta(html, url);
    if (fromMeta) return fromMeta;
  }

  // Final fallback: extract domain from URL as source
  const domain = extractDomainFromUrl(url);
  return domain;
}

