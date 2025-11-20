// supabase/functions/cart-add/index.ts

// LIKE I'M 5: This server function generates affiliate links and tracks clicks.

// - For Amazon/Walmart/Kroger: Creates affiliate URLs that redirect users

// - For Instacart: Uses their API to programmatically add items to cart

// - For DoorDash: Uses search-based redirects (API integration available if configured)

// - Tracks all clicks in affiliate_clicks table for monetization

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

// 🆕 Helper: Check which stores are enabled (have affiliate config)
async function getEnabledStores() {
  const enabled = [];
  
  // Check each provider's required config
  if (Deno.env.get("AMAZON_ASSOCIATE_TAG")) enabled.push("amazon");
  if (Deno.env.get("WALMART_AFFILIATE_ID")) enabled.push("walmart");
  if (Deno.env.get("KROGER_CJ_PID")) enabled.push("kroger");
  if (Deno.env.get("ALBERTSONS_CJ_PID")) enabled.push("albertsons");
  if (Deno.env.get("INSTACART_API_KEY")) enabled.push("instacart");
  if (Deno.env.get("DOORDASH_API_KEY") || Deno.env.get("DOORDASH_PARTNER_ID")) enabled.push("doordash");
  
  // H-E-B: Always enabled (search redirect only, no affiliate program available)
  // This means users can use it but we can't monetize it
  enabled.push("heb");
  
  return enabled;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }

  // 🆕 Handle GET request for enabled stores (simple check)
  if (req.method === "GET") {
    try {
      const enabled = await getEnabledStores();
      return new Response(JSON.stringify({
        enabled
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    } catch (error) {
      console.error("Error getting enabled stores:", error);
      // Return at least H-E-B as fallback
      return new Response(JSON.stringify({
        enabled: ["heb"]
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
  }

  try {
    // 🆕 Check if this is a request to get enabled stores (POST with checkEnabled flag)
    let requestBody;
    try {
      requestBody = await req.json();
    } catch {
      // If no JSON body, treat as enabled check request
      try {
        const enabled = await getEnabledStores();
        return new Response(JSON.stringify({
          enabled
        }), {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      } catch (error) {
        console.error("Error getting enabled stores:", error);
        // Return at least H-E-B as fallback
        return new Response(JSON.stringify({
          enabled: ["heb"]
        }), {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
    }

    // If request has checkEnabled flag, return enabled stores
    if (requestBody?.checkEnabled === true) {
      try {
        const enabled = await getEnabledStores();
        return new Response(JSON.stringify({
          enabled
        }), {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      } catch (error) {
        console.error("Error getting enabled stores:", error);
        // Return at least H-E-B as fallback
        return new Response(JSON.stringify({
          enabled: ["heb"]
        }), {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
    }

    const { provider, selections, userId, recipeId, shoppingListId } = requestBody;

    if (!provider || !selections || selections.length === 0) {
      return new Response(JSON.stringify({
        ok: false,
        error: "Missing provider or selections"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Track the click (for monetization tracking)
    if (userId) {
      await supabase.from("affiliate_clicks").insert({
        user_id: userId,
        provider,
        items_count: selections.length,
        recipe_id: recipeId || null,
        shopping_list_id: shoppingListId || null,
        created_at: new Date().toISOString()
      }).catch(() => {}); // Don't fail if tracking fails
    }

    // Generate affiliate link based on provider
    let redirectUrl;

    switch (provider) {
      case "amazon": {
        // Amazon: Build affiliate link with ASINs
        const associateTag = Deno.env.get("AMAZON_ASSOCIATE_TAG") ?? "";
        const asins = selections.map((s) => s.storeProductId).filter(Boolean);

        if (asins.length === 1) {
          // Single item: direct product link
          redirectUrl = `https://www.amazon.com/dp/${asins[0]}${associateTag ? `?tag=${associateTag}` : ""}`;
        } else if (asins.length > 1) {
          // Multiple items: Amazon cart with multiple ASINs
          const asinParams = asins.map((asin, i) => `${i === 0 ? "ASIN" : `ASIN.${i + 1}`}=${asin}`).join("&");
          redirectUrl = `https://www.amazon.com/gp/cart/add.html?${asinParams}${associateTag ? `&tag=${associateTag}` : ""}`;
        } else {
          // Fallback: search page
          const searchQuery = encodeURIComponent(selections[0]?.title ?? "");
          redirectUrl = `https://www.amazon.com/s?k=${searchQuery}${associateTag ? `&tag=${associateTag}` : ""}`;
        }
        break;
      }

      case "walmart": {
        // Walmart: Build affiliate link with SKUs/UPCs
        const affiliateId = Deno.env.get("WALMART_AFFILIATE_ID") ?? "";
        const items = selections.map((s) => s.storeProductId).filter(Boolean);

        if (items.length === 1) {
          redirectUrl = `https://www.walmart.com/ip/${items[0]}${affiliateId ? `?affiliateId=${affiliateId}` : ""}`;
        } else {
          // Walmart cart builder (may need to adjust based on their actual API)
          const searchQuery = encodeURIComponent(selections[0]?.title ?? "");
          redirectUrl = `https://www.walmart.com/search?q=${searchQuery}${affiliateId ? `&affiliateId=${affiliateId}` : ""}`;
        }
        break;
      }

      case "kroger": {
        // Kroger: CJ Affiliate link (if configured) or search
        // Note: Kroger delivery is now via DoorDash, but pickup still available
        const cjPid = Deno.env.get("KROGER_CJ_PID") ?? "";
        const firstItem = selections[0];

        // Build search query - use just name for better search results
        let searchQuery = firstItem?.title ?? "";
        redirectUrl = `https://www.kroger.com/search?query=${encodeURIComponent(searchQuery)}`;

        if (cjPid) {
          // Wrap with CJ Affiliate tracking
          const encodedUrl = encodeURIComponent(redirectUrl);
          redirectUrl = `https://www.anrdoezrs.net/links/${cjPid}/type/dlg/sid/cart-add/url/${encodedUrl}`;
        }
        break;
      }

      case "heb": {
        // H-E-B: Search-based (no public API)
        // H-E-B can only search one item at a time, so we use the first item
        // If multiple items, we combine them into one search query (user can search for all)
        if (selections.length === 1) {
          const searchQuery = selections[0]?.title ?? "";
          redirectUrl = `https://www.heb.com/search/?q=${encodeURIComponent(searchQuery)}`;
        } else {
          // Multiple items: combine into single search query (H-E-B will show all results)
          // Format: "item1 item2 item3"
          const allItems = selections.map((s) => s.title).filter(Boolean).join(" ");
          redirectUrl = `https://www.heb.com/search/?q=${encodeURIComponent(allItems)}`;
        }
        break;
      }

      case "albertsons": {
        // Albertsons: CJ Affiliate link (if configured) or search
        const cjPid = Deno.env.get("ALBERTSONS_CJ_PID") ?? "";
        const searchQuery = selections[0]?.title ?? "";
        const searchUrl = `https://www.albertsons.com/shop/search-results.html?q=${encodeURIComponent(searchQuery)}`;

        if (cjPid) {
          // Wrap with CJ Affiliate tracking
          const encodedUrl = encodeURIComponent(searchUrl);
          redirectUrl = `https://www.anrdoezrs.net/links/${cjPid}/type/dlg/sid/cart-add/url/${encodedUrl}`;
        } else {
          redirectUrl = searchUrl;
        }
        break;
      }

      case "instacart": {
        // Instacart: Use their API for programmatic cart addition
        const instacartApiKey = Deno.env.get("INSTACART_API_KEY") ?? "";
        const instacartApiUrl = Deno.env.get("INSTACART_API_URL") ?? "https://api.instacart.com";

        if (!instacartApiKey) {
          // Fallback to search if no API key
          const searchQuery = encodeURIComponent(selections[0]?.title ?? "");
          redirectUrl = `https://www.instacart.com/store/search?q=${searchQuery}`;
        } else {
          try {
            // Build recipe page payload for Instacart
            const recipeItems = selections.map((sel) => ({
              product_name: sel.title,
              quantity: sel.quantity ?? "1"
            }));

            // Call Instacart API to create recipe page
            // See: https://docs.instacart.com/developer_platform_api/api/products/create_recipe_page
            const recipeResponse = await fetch(`${instacartApiUrl}/v1/recipes`, {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${instacartApiKey}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                title: "Recipe Ingredients",
                items: recipeItems
              })
            });

            if (recipeResponse.ok) {
              const recipeData = await recipeResponse.json();
              redirectUrl = recipeData.recipe_url || recipeData.checkout_url;
            } else {
              // Fallback
              const searchQuery = encodeURIComponent(selections[0]?.title ?? "");
              redirectUrl = `https://www.instacart.com/store/search?q=${searchQuery}`;
            }
          } catch (error) {
            console.error("Instacart API error:", error);
            // Fallback
            const searchQuery = encodeURIComponent(selections[0]?.title ?? "");
            redirectUrl = `https://www.instacart.com/store/search?q=${searchQuery}`;
          }
        }
        break;
      }

      case "doordash": {
        // DoorDash: Grocery delivery and pickup
        // DoorDash has grocery stores available through their platform
        // API integration may be available through DoorDash Drive or third-party aggregators
        const doordashApiKey = Deno.env.get("DOORDASH_API_KEY") ?? "";
        const doordashPartnerId = Deno.env.get("DOORDASH_PARTNER_ID") ?? "";
        const doordashApiUrl = Deno.env.get("DOORDASH_API_URL") ?? "https://api.doordash.com";

        // For now, use search-based redirect since DoorDash grocery API details are limited
        // If API keys are configured, we can enhance this later
        if (doordashApiKey || doordashPartnerId) {
          try {
            // TODO: Implement DoorDash API integration when API documentation is available
            // This could use DoorDash Drive API or third-party aggregators like KitchenHub
            // For now, fall through to search-based redirect
            console.log("DoorDash API keys detected, but API integration not yet implemented");
          } catch (error) {
            console.error("DoorDash API error:", error);
          }
        }

        // Search-based redirect to DoorDash grocery section
        // DoorDash grocery is available at: https://www.doordash.com/groceries
        // We'll redirect to their grocery search
        if (selections.length === 1) {
          const searchQuery = encodeURIComponent(selections[0]?.title ?? "");
          // DoorDash grocery search URL
          redirectUrl = `https://www.doordash.com/groceries/search?query=${searchQuery}`;
        } else {
          // Multiple items: use first item for search, or combine
          const allItems = selections.map((s) => s.title).filter(Boolean).join(" ");
          redirectUrl = `https://www.doordash.com/groceries/search?query=${encodeURIComponent(allItems)}`;
        }
        break;
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      redirectUrl: redirectUrl || undefined,
      provider,
      itemsCount: selections.length
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("cart-add error:", error);
    return new Response(JSON.stringify({
      ok: false,
      error: error?.message ?? "Internal server error"
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});

