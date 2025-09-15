// super simple link builder so we can change domains later in one place
const DOMAIN = "https://messhall.app"; // <-- put your real domain here
export function recipeUrl(id: string) {
  // short and clean path for recipes
  return `${DOMAIN}/r/${encodeURIComponent(id)}`;
}
