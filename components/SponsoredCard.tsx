// components/SponsoredCard.tsx
// 🧒 ELI5: this is the little ad card.
// When you tap it:
//   1) we try REALLY hard to figure out which slot it came from (slot id).
//   2) we tell the server "this was a CLICK!" (without creative_id, so DB is happy).
//   3) we open the website.
// If we can't find a slot id, the server can still guess it from your last view
// (if you applied the RPC I gave you). Either way, your Owner pills can move. ✅

import React from "react";
import { Image, Linking, Text, TouchableOpacity, View } from "react-native";

// 🎨 your theme bits (unchanged)
import { COLORS, RADIUS } from "../lib/theme";

// 📝 click/impression logger (it does RPC first, then direct insert fallback)
import { logAdEvent } from "@/lib/ads/logAdEvent";

// 🔌 used only for the last-resort direct insert path (should almost never run)
import { supabase } from "../lib/supabase";
import { logDebug } from "../lib/logger";

/* ----------------------------------------------------------------------------
 * 1) TYPES (what the card understands)
 * ---------------------------------------------------------------------------*/

export type SponsoredCardModel = {
  // 👉 modern names you already use in some places
  slotId?: string;
  creativeId?: string;

  // 👉 legacy / alternative shapes we see out in the wild
  slot_id?: string;                   // legacy
  creative_id?: string;               // legacy
  slot?: { id?: string } | null;      // nested object
  id?: string;                        // sometimes the slot *is* the model

  // ad content
  brand?: string;
  title?: string;
  image_url?: string;
  cta?: string | null;
  cta_url?: string | null;
  sponsorLogoUrl?: string | null;
};

type Props = {
  m?: SponsoredCardModel;

  // allow passing fields directly as props too
  slotId?: string;
  slot_id?: string;           // legacy
  creativeId?: string;
  creative_id?: string;       // legacy

  brand?: string;
  title?: string;
  image_url?: string;
  cta?: string | null;
  cta_url?: string | null;
  sponsorLogoUrl?: string | null;

  showSponsoredPill?: boolean;
  pillText?: string;
  variant?: "subtle" | "accent";

  // debug helper: if true, our logger will skip RPC and write directly
  // (you usually keep this false; leave here for emergencies)
  debugForceDirect?: boolean;
};

/* ----------------------------------------------------------------------------
 * 2) LITTLE HELPERS (tiny tools)
 * ---------------------------------------------------------------------------*/

// make links open even if someone forgot "https://"
function normalizeUrlMaybe(url?: string | null) {
  const s = (url ?? "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  return `https://${s}`;
}

// check if a string *looks* like a real UUID (so DB FKs don't yell)
function looksLikeUUID(v?: string | null) {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
  );
}

// cute colors for the “Sponsored” pill
const ACCENT_SOFT_BG = "rgba(0, 200, 120, 0.15)";
const ACCENT_SOFT_BORDER = "rgba(0, 200, 120, 0.35)";

/* ----------------------------------------------------------------------------
 * 3) THE CARD (the little box you tap)
 * ---------------------------------------------------------------------------*/

export default function SponsoredCard(props: Props) {
  // 🧩 build one model from either props.m or the direct props
  const m: SponsoredCardModel | undefined = props.m ?? {
    slotId: props.slotId ?? props.slot_id,
    creativeId: props.creativeId ?? props.creative_id,
    brand: props.brand,
    title: props.title,
    image_url: props.image_url,
    cta: props.cta,
    cta_url: props.cta_url,
    sponsorLogoUrl: props.sponsorLogoUrl,
  };
  if (!m) return null;

  // 🧭 find the slot id in LOTS of places (so clicks get attributed)
  const resolvedSlotId: string | null =
    m.slotId ??
    m.slot_id ??
    (m.slot && (m.slot as any).id) ??
    m.id ??
    props.slot_id ??
    null;

  // (we intentionally do NOT resolve creative ids to avoid FK errors)

  const showPill = props.showSponsoredPill ?? true;
  const pillText = props.pillText ?? "Sponsored";
  const variant = props.variant ?? "subtle";

  /* ------------------------------------------------------------------------
   * 3a) WHEN YOU TAP (save click first, then open link)
   * ---------------------------------------------------------------------*/
  const onPress = async () => {
    let wrote = false;

    try {
      // 📨 tell the logger: "this was a CLICK!"
      // - we send slot_id if it looks like a real UUID
      // - we DO NOT send creative_id (so FK doesn't fail)
      const ok = await logAdEvent({
        event_type: "click",
        placement: "feed", // change to "rail" in rail contexts
        slot_id: looksLikeUUID(resolvedSlotId) ? resolvedSlotId : null,
        // creative_id is ignored inside logger on purpose
        meta: {
          screen: "home_feed",
          brand: m.brand ?? null,
          title: m.title ?? null,
          cta_url: m.cta_url ?? null,
        },
        forceDirect: props.debugForceDirect === true,
      });

      wrote = !!ok;
      logDebug("[SponsoredCard] click wrote?", wrote, "slot:", resolvedSlotId);
    } catch (e) {
      // if something weird happens, we'll try one more time directly below
      logDebug("[SponsoredCard] helper threw; will try direct", (e as any)?.message || e);
      wrote = false;
    }

    // 🛟 last-resort: direct insert (should rarely run, but keeps you safe)
    if (!wrote) {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const user_id = auth.user?.id ?? null;

        const direct: any = {
          user_id,
          placement: "feed",
          event_type: "click",
          meta: {
            screen: "home_feed",
            brand: m.brand ?? null,
            title: m.title ?? null,
            cta_url: m.cta_url ?? null,
          },
          occurred_at: new Date().toISOString(),
          created_at: new Date().toISOString(), // so metrics see it right away
        };

        if (looksLikeUUID(resolvedSlotId)) direct.slot_id = resolvedSlotId!;

        // NOTE: we DO NOT set creative_id here (avoids FK failures)
        const { error } = await supabase.from("ad_events").insert(direct);
        if (!error) {
          wrote = true;
          logDebug("[SponsoredCard] direct insert OK (slot:", resolvedSlotId, ")");
        } else {
          logDebug("[SponsoredCard] direct insert error:", error.message);
        }
      } catch (e: any) {
        logDebug("[SponsoredCard] direct insert threw:", e?.message || e);
      }
    }

    // ⏳ tiny pause so the network send finishes before we leave the app
    try {
      await new Promise((r) => setTimeout(r, 120));
    } catch {}

    // 🌐 now open the link
    const url = normalizeUrlMaybe(m.cta_url ?? "");
    if (url) {
      try {
        await Linking.openURL(url);
      } catch {}
    }
  };

  /* ------------------------------------------------------------------------
   * 3b) THE PRETTY PICTURE (UI is unchanged)
   * ---------------------------------------------------------------------*/

  const borderColor =
    variant === "accent" ? ACCENT_SOFT_BORDER : "rgba(255,255,255,0.08)";
  const containerBg = COLORS.card;

  // tiny sponsor logo bubble (optional)
  const SponsorBadge = ({
    topInset = 8,
    rightInset = 8,
  }: {
    topInset?: number;
    rightInset?: number;
  }) => {
    if (!m.sponsorLogoUrl) return null;
    return (
      <View
        style={{
          position: "absolute",
          top: topInset,
          right: rightInset,
          width: 28,
          height: 28,
          borderRadius: 14,
          backgroundColor: "rgba(0,0,0,0.45)",
          alignItems: "center",
          justifyContent: "center",
          padding: 2,
        }}
      >
        <Image
          source={{ uri: m.sponsorLogoUrl }}
          style={{
            width: 24,
            height: 24,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.6)",
          }}
          resizeMode="cover"
        />
      </View>
    );
  };

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.9}
      style={{
        backgroundColor: containerBg,
        borderRadius: RADIUS.xl,
        overflow: "hidden",
        marginBottom: 12,
        borderWidth: 1,
        borderColor,
      }}
    >
      {/* 📷 big image on top (if there is one) */}
      {!!m.image_url && (
        <View style={{ position: "relative" }}>
          <Image
            source={{ uri: m.image_url }}
            style={{ width: "100%", height: 160 }}
            resizeMode="cover"
          />

          {/* "Sponsored" pill in the corner */}
          {showPill && (
            <View
              style={{
                position: "absolute",
                top: 8,
                left: 8,
                backgroundColor: ACCENT_SOFT_BG,
                paddingHorizontal: 10,
                paddingVertical: 4,
                borderRadius: 999,
              }}
            >
              <Text style={{ color: COLORS.accent, fontWeight: "900", fontSize: 12 }}>
                {pillText}
              </Text>
            </View>
          )}

          <SponsorBadge />
        </View>
      )}

      {/* 📝 words & button */}
      <View style={{ padding: 12, position: "relative" }}>
        {!!m.brand && (
          <Text style={{ color: COLORS.subtext, fontWeight: "800", marginBottom: 4 }}>
            {m.brand}
          </Text>
        )}

        {!!m.title && (
          <Text style={{ color: COLORS.text, fontSize: 16, fontWeight: "900", marginBottom: 8 }}>
            {m.title}
          </Text>
        )}

        {(m.cta || m.cta_url) && (
          <View
            style={{
              alignSelf: "flex-start",
              backgroundColor: COLORS.accent,
              paddingVertical: 8,
              paddingHorizontal: 12,
              borderRadius: 999,
            }}
          >
            <Text style={{ color: "#001018", fontWeight: "900" }}>
              {m.cta || "Learn more"}
            </Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}
