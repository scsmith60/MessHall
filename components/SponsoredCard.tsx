// components/SponsoredCard.tsx
// 🧒 what this does (like I'm 5):
// - This is the little ad card in your feed.
// - It looks like your normal cards so it feels nice.
// - It shows a tiny green "Sponsored" pill.
// - NEW: If you give me a sponsor logo URL, I show a tiny logo circle
//   in the top-right corner of the image. If there is no image, I put the
//   logo near the title so it's still visible.
// - You can choose "subtle" (default) or "accent" to make the border a bit
//   more green, but it's still sleek.
//
// ✅ Backwards compatible with your old props:
//    You can pass one object `m={{...}}` OR pass each field directly.
//    If fields are missing, we render nothing (no crash).

import React from "react";
import { Image, Linking, Text, TouchableOpacity, View } from "react-native";
import { COLORS, RADIUS } from "../lib/theme";
import { logAdEvent } from "../lib/ads";

export type SponsoredCardModel = {
  slotId?: string;
  creativeId?: string;
  brand?: string;
  title?: string;
  image_url?: string;
  cta?: string | null;       // button label (e.g. "Learn more")
  cta_url?: string | null;   // link (e.g. "https://example.com")
  sponsorLogoUrl?: string | null; // 🔥 NEW: small round logo in the corner
};

type Props = {
  // You can pass all fields inside "m"...
  m?: SponsoredCardModel;

  // ...or directly as props (same keys as the model).
  slotId?: string;
  creativeId?: string;
  brand?: string;
  title?: string;
  image_url?: string;
  cta?: string | null;
  cta_url?: string | null;
  sponsorLogoUrl?: string | null;

  // Small styling knobs (optional)
  showSponsoredPill?: boolean;            // default: true
  pillText?: string;                      // default: "Sponsored"
  variant?: "subtle" | "accent";          // default: "subtle"
};

// 🧠 helper: make sure the link opens even if they forgot the https://
function normalizeUrlMaybe(url?: string | null) {
  const s = (url ?? "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  return `https://${s}`;
}

// 🎨 soft accent colors that match your app's vibe
const ACCENT_SOFT_BG = "rgba(0, 200, 120, 0.15)";
const ACCENT_SOFT_BORDER = "rgba(0, 200, 120, 0.35)";

export default function SponsoredCard(props: Props) {
  // Prefer the "m" object if provided; otherwise build from direct props.
  const m: SponsoredCardModel | undefined = props.m ?? {
    slotId: props.slotId,
    creativeId: props.creativeId,
    brand: props.brand,
    title: props.title,
    image_url: props.image_url,
    cta: props.cta,
    cta_url: props.cta_url,
    sponsorLogoUrl: props.sponsorLogoUrl,
  };

  if (!m) return null;

  const showPill = props.showSponsoredPill ?? true;
  const pillText = props.pillText ?? "Sponsored";
  const variant = props.variant ?? "subtle";

  const onPress = async () => {
    try {
      await (logAdEvent?.(m.slotId ?? "", "click", { where: "home_feed", unit: "inline_card" }, m.creativeId ?? "", {
        brand: m.brand ?? null,
        title: m.title ?? null,
      }));
    } catch {}
    const url = normalizeUrlMaybe(m.cta_url ?? "");
    if (url) {
      try {
        await Linking.openURL(url);
      } catch {}
    }
  };

  const borderColor = variant === "accent" ? ACCENT_SOFT_BORDER : "rgba(255,255,255,0.08)";
  const containerBg = COLORS.card;

  // 🌟 tiny helper to draw the round sponsor logo
  const SponsorBadge = ({ topInset = 8, rightInset = 8 }: { topInset?: number; rightInset?: number }) => {
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
      {/* 🖼️ Image area (if there is an image) */}
      {!!m.image_url && (
        <View style={{ position: "relative" }}>
          <Image source={{ uri: m.image_url }} style={{ width: "100%", height: 160 }} resizeMode="cover" />

          {/* Sponsored pill on top-left */}
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
              <Text style={{ color: COLORS.accent, fontWeight: "900", fontSize: 12 }}>{pillText}</Text>
            </View>
          )}

          {/* 🔥 NEW: sponsor logo on top-right */}
          <SponsorBadge />
        </View>
      )}

      {/* 🧾 Text area */}
      <View style={{ padding: 12, position: "relative" }}>
        {/* If no image, still show the Sponsored pill and logo in the text block */}
        {!m.image_url && (
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 6 }}>
            {showPill && (
              <View
                style={{
                  backgroundColor: ACCENT_SOFT_BG,
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                  borderRadius: 999,
                  marginRight: 8,
                }}
              >
                <Text style={{ color: COLORS.accent, fontWeight: "900", fontSize: 12 }}>{pillText}</Text>
              </View>
            )}

            {/* tiny inline logo when there's no image */}
            {!!m.sponsorLogoUrl && (
              <View
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 11,
                  overflow: "hidden",
                  borderWidth: 1,
                  borderColor: "rgba(255,255,255,0.5)",
                }}
              >
                <Image source={{ uri: m.sponsorLogoUrl }} style={{ width: 22, height: 22 }} />
              </View>
            )}
          </View>
        )}

        {/* Brand (small and calm) */}
        {!!m.brand && (
          <Text style={{ color: COLORS.subtext, fontWeight: "800", marginBottom: 4 }}>{m.brand}</Text>
        )}

        {/* Title (big and strong) */}
        {!!m.title && (
          <Text style={{ color: COLORS.text, fontSize: 16, fontWeight: "900", marginBottom: 8 }}>{m.title}</Text>
        )}

        {/* CTA button-like pill */}
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
            <Text style={{ color: "#001018", fontWeight: "900" }}>{m.cta || "Learn more"}</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}
