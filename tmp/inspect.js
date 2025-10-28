const fs = require('fs');
const html = fs.readFileSync('tmp/gordon.html', 'utf8');
const matches = [...html.matchAll(/<script[^>]+type=[\"']application\/ld\+json[\"'][^>]*>([\s\S]*?)<\/script>/gi)];
console.log('scripts', matches.length);
for (const m of matches) {
  try {
    const json = JSON.parse(m[1]);
    const items = Array.isArray(json) ? json : (json['@graph'] ? json['@graph'] : [json]);
    for (const item of items) {
      const type = item['@type'];
      const typeArr = Array.isArray(type) ? type : [type];
      if (typeArr && typeArr.some(t => String(t).toLowerCase().includes('recipe'))) {
        console.log('tag', typeArr);
        console.log('recipeIngredient length', item.recipeIngredient && item.recipeIngredient.length);
        console.log('recipeInstructions typeof', typeof item.recipeInstructions);
        console.log('recipeInstructions sample', JSON.stringify(item.recipeInstructions && item.recipeInstructions[0]));
      }
    }
  } catch (err) {
    console.log('parse error', err.message);
  }
}
