# Setting Up Stripe Webhooks (Recommended)

To automatically sync Stripe Connect account status with your database, set up webhooks:

## Why Webhooks?

Stripe webhooks notify your server when:
- A Connect account completes onboarding
- Account status changes (active/suspended/restricted)
- Payouts succeed or fail
- Disputes are created

This ensures your `profiles.stripe_account_id` stays in sync automatically.

## Setup Steps:

### 1. Create Webhook Endpoint in Stripe
1. Go to Stripe Dashboard → **Developers → Webhooks**
2. Click **"Add endpoint"**
3. Enter endpoint URL: `https://your-project.supabase.co/functions/v1/stripe-webhook`
4. Select events to listen for:
   - `account.updated`
   - `account.application.deauthorized`
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`

### 2. Create Webhook Handler Function
Create `supabase/functions/stripe-webhook/index.ts`:

```typescript
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

Deno.serve(async (req) => {
  const signature = req.headers.get("stripe-signature");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");

  // Verify webhook signature (important for security)
  // ... verification code here ...

  const event = await req.json();

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  // Handle account.updated event
  if (event.type === "account.updated") {
    const account = event.data.object;
    
    // Find user by stripe_account_id
    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .eq("stripe_account_id", account.id)
      .maybeSingle();

    if (profile) {
      // Update account status if needed
      // You could add a stripe_account_status column
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
```

### 3. Add Webhook Secret to Supabase
In Supabase Dashboard → Edge Functions → stripe-webhook → Secrets:
- Add `STRIPE_WEBHOOK_SECRET` (from Stripe webhook settings)

This is optional but recommended for production.

