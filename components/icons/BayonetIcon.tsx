// components/icons/BayonetIcon.tsx
// LIKE I'M 5: we draw a bayonet picture ourselves.
// We make 2 styles:
// - "mini"  (12–18px): very simple, straight, chunky → easy to read
// - "detail" (≥18px): adds groove line for fancy look
//
// IMPORTANT: Boomerang problem fixed by:
// - Keeping blade STRAIGHT (horizontal), not diagonal
// - Using a LONG pointy triangle for the tip
// - Drawing a CHUNKY guard + handle so your brain says "knife"
// - Adding a DARK stroke (outline) so shape pops on dark backgrounds

import React from "react";
import Svg, { Path, Rect, Line } from "react-native-svg";

type Props = {
  size?: number;                  // how big the icon is
  color?: string;                 // main fill color (blade/handle)
  stroke?: string;                // outline color (dark helps at tiny sizes)
  strokeWidth?: number;           // outline thickness
  variant?: "mini" | "detail";    // mini for tiny sizes, detail for bigger
};

export default function BayonetIcon({
  size = 16,
  color = "#E5E7EB",            // light metal
  stroke = "#0B1220",           // deep slate outline for contrast
  strokeWidth = 1,
  variant,
}: Props) {
  const v: "mini" | "detail" =
    variant ?? (size < 18 ? "mini" : "detail");

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* HANDLE (thick pill so it's readable) */}
      <Rect
        x="2"
        y="10.5"
        width="5.2"
        height="3.8"
        rx="0.9"
        fill={color}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
      {/* Pommel (end cap) */}
      <Rect
        x="1"
        y="11"
        width="1.6"
        height="2.8"
        rx="0.7"
        fill={color}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />

      {/* GUARD (big cross bar → screams "bayonet") */}
      <Rect
        x="7"
        y="9.5"
        width="2.2"
        height="5.0"
        rx="0.7"
        fill={color}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />

      {/* LUG NUB (hint of rifle mounting) */}
      <Rect
        x="9.3"
        y="11.2"
        width="1.2"
        height="1.6"
        rx="0.4"
        fill={color}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />

      {/* BLADE SPINE (straight + long = not a boomerang) */}
      <Path
        d="M10.5 11.2 L20.8 11.2 L22.5 12.0 L20.8 12.8 L10.5 12.8 Z"
        fill={color}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
      {/* BLADE TIP (pointy triangle) */}
      <Path
        d="M20.8 11.2 L22.5 12.0 L20.8 12.8 Z"
        fill={color}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />

      {/* Optional fuller (groove) only on 'detail' to avoid fuzz at tiny sizes */}
      {v === "detail" && (
        <Line
          x1="11.4"
          y1="12"
          x2="19.6"
          y2="12"
          stroke="#6B7280"
          strokeWidth={0.85}
          strokeLinecap="round"
        />
      )}
    </Svg>
  );
}
