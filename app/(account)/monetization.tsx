// app/(account)/monetization.tsx
//
// LIKE I'M 5 (what changed):
// • When you're APPROVED, the "Earn on your recipes" switch now saves to the database:
//    - ON  -> profiles.monetize_enabled_at = now()
//    - OFF -> profiles.monetize_enabled_at = null
//   We also read that value on load so the switch remembers your choice.
// • We only show/compute the Eligibility checklist BEFORE you apply (appStatus === "none").
//   That removes the scary "We couldn’t load your checklist" once you're pending/approved.
//
// Everything else stays the same.

import React, { useEffect, useState, useMemo, useCallback } from "react";
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  ScrollView,
  Switch,
  Modal,
  Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { COLORS as THEME } from "@/lib/theme";

const COLORS = {
  bg: THEME.bg,
  card: THEME.card,
  card2: THEME.surface,
  border: THEME.border,
  text: THEME.text,
  sub: THEME.subtext,
  subtext: THEME.subtext,
  good: THEME.accent,
  bad: '#EF4444',
  accent: THEME.accent,
  glass: 'rgba(255,255,255,0.06)',
};

// 🧁 tiny dark popup we control (no more white OS Alert)
function ThemedToast({
  visible,
  onClose,
  title,
  message,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  message: string;
}) {
  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.55)",
          alignItems: "center",
          justifyContent: "center",
          padding: 20,
        }}
      >
        <View
          style={{
            width: "100%",
            maxWidth: 420,
            backgroundColor: COLORS.card,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: COLORS.border,
            padding: 16,
          }}
        >
          <Text style={{ color: COLORS.text, fontWeight: "900", fontSize: 16 }}>
            {title}
          </Text>
          <Text style={{ color: COLORS.subtext, marginTop: 8 }}>{message}</Text>
          <Pressable
            onPress={onClose}
            style={{
              alignSelf: "flex-end",
              marginTop: 14,
              paddingVertical: 8,
              paddingHorizontal: 14,
              borderRadius: 999,
              backgroundColor: COLORS.accent,
            }}
          >
            <Text style={{ color: "#041016", fontWeight: "900" }}>OK</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

type ChecklistItem = { label: string; help?: string; passed: boolean; ctaRoute?: string };
type AppStatus = "none" | "pending" | "approved" | "rejected" | "withdrawn";

export default function MonetizationScreen() {
  const { session } = useAuth();
  const router = useRouter();
  const userId = session?.user?.id;

  // 🧺 little buckets
  const [loading, setLoading] = useState(true);
  const [eligible, setEligible] = useState<boolean | null>(null);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [applying, setApplying] = useState(false);
  const [appStatus, setAppStatus] = useState<AppStatus>("none");
  const [rejectionNotes, setRejectionNotes] = useState<string | null>(null);

  // switch state now persists to DB via profiles.monetize_enabled_at
  const [monetizeOn, setMonetizeOn] = useState(false);
  const [stripeAccountId, setStripeAccountId] = useState<string | null>(null);
  const [stripeSetupComplete, setStripeSetupComplete] = useState(false);
  const monetizationToggleEnabled = useMemo(
    () => appStatus === "approved",
    [appStatus]
  );

  // 🌈 our dark popup state
  const [toastOpen, setToastOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState("");

  // 🕵️ load newest application (+ eligibility only if needed) and current switch state
  const load = useCallback(async () => {
    console.log("=== LOAD FUNCTION CALLED ===", { userId, hasUserId: !!userId });
    if (!userId) {
      console.log("No userId, returning early");
      return;
    }
    console.log("Setting loading to true");
    setLoading(true);

    // 1) newest application row (might not exist)
    console.log("Querying creator_applications...");
    let apps: any[] | null = null;
    let appErr: any = null;
    
    try {
      // Query with better error handling - use maybeSingle for efficiency
      const { data, error } = await supabase
        .from("creator_applications")
        .select("status, submitted_at, notes")
        .eq("user_id", userId)
        .order("submitted_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (error) {
        console.error("Error querying creator_applications:", error);
        appErr = error;
        apps = null;
      } else {
        apps = data ? [data] : [];
        appErr = null;
      }
      console.log("creator_applications query result - apps:", apps, "error:", appErr);
    } catch (queryError: any) {
      console.error("Exception querying creator_applications:", queryError);
      appErr = queryError;
      apps = null;
      // Continue with status "none" if query fails
    }

    let status: AppStatus = "none";
    let notes: string | null = null;
    if (!appErr && apps && Array.isArray(apps) && apps.length > 0) {
      status = (apps[0].status as AppStatus) || "none";
      notes = apps[0].notes || null;
    } else if (appErr) {
      // If query failed, default to "none" status and continue
      console.warn("Using default status 'none' due to query error");
      status = "none";
      notes = null;
    }
    console.log("Setting appStatus to:", status, "notes:", notes);
    setAppStatus(status);
    setRejectionNotes(notes);

    // 2) If APPROVED, read current on/off from profiles.monetize_enabled_at and Stripe status
    if (status === "approved") {
      console.log("Status is approved, loading profile data...");
      const { data: prof } = await supabase
        .from("profiles")
        .select("monetize_enabled_at, stripe_account_id")
        .eq("id", userId)
        .maybeSingle();
      console.log("Profile data loaded:", prof);
      setMonetizeOn(!!prof?.monetize_enabled_at);
      setStripeAccountId(prof?.stripe_account_id || null);
      setStripeSetupComplete(!!prof?.stripe_account_id);
      // We skip the eligibility checklist once you've applied/been approved.
      setEligible(null);
      setChecklist([]);
      setLoading(false);
      console.log("Returning early (approved)");
      return;
    }

    // 3) If PENDING, skip the checklist (but allow withdrawn to see checklist)
    if (status === "pending") {
      console.log("Status is pending, skipping checklist");
      setEligible(null);
      setChecklist([]);
      setLoading(false);
      console.log("Returning early (pending)");
      return;
    }
    
    // 3a) If WITHDRAWN, treat like "none" - show checklist so they can reapply
    if (status === "withdrawn") {
      console.log("Status is withdrawn, loading checklist for reapplication");
      // Continue to load checklist below (don't return early)
    }

    // 3b) If REJECTED, load the checklist so they can see what to fix
    if (status === "rejected") {
      try {
        const { data, error } = await supabase.functions.invoke("eligibility-check", {
          body: {},
        });
        console.log("Eligibility check response (rejected) - data:", JSON.stringify(data), "error:", error);
        
        if (error) {
          console.error("Eligibility check function error (rejected):", error);
          setEligible(null);
          setChecklist([]);
          setLoading(false);
          return;
        }
        // Check if response has an error field
        if (data?.error) {
          console.error("Eligibility check returned error (rejected):", data.error);
          setEligible(null);
          setChecklist([]);
        } else if (data) {
          console.log("Setting eligibility (rejected) - eligible:", data.eligible, "checklist type:", typeof data.checklist, "checklist:", data.checklist);
          setEligible(!!data?.eligible);
          const checklistArray = Array.isArray(data?.checklist) ? data.checklist : [];
          console.log("Checklist array length (rejected):", checklistArray.length);
          setChecklist(checklistArray);
        } else {
          console.error("No data returned from eligibility check (rejected)");
          setEligible(null);
          setChecklist([]);
        }
      } catch (e: any) {
        console.error("Failed to load eligibility checklist (rejected):", e);
        setEligible(null);
        setChecklist([]);
      } finally {
        setLoading(false);
      }
      return;
    }

    // 4) Load checklist when status is "none" OR "withdrawn" (so they can reapply)
    console.log("About to call eligibility-check function, status is:", status);
    try {
      console.log("Calling supabase.functions.invoke('eligibility-check')...");
      
      // Add timeout to prevent hanging
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error("Eligibility check timeout after 10 seconds")), 10000)
      );
      
      const functionPromise = supabase.functions.invoke("eligibility-check", {
        body: {},
      });
      
      const { data, error } = await Promise.race([functionPromise, timeoutPromise]) as any;
      
      console.log("Eligibility check response received - data:", JSON.stringify(data), "error:", error);
      console.log("Data type:", typeof data, "Is array:", Array.isArray(data));
      
      if (error) {
        console.error("Eligibility check function error:", error);
        setEligible(false);
        setChecklist([]);
        setLoading(false);
        return;
      }
      
      // Check if response has an error field
      if (data?.error) {
        console.error("Eligibility check returned error:", data.error);
        setEligible(false);
        setChecklist([]);
      } else if (data) {
        console.log("Setting eligibility - eligible:", data.eligible, "checklist type:", typeof data.checklist, "checklist:", data.checklist);
        setEligible(!!data?.eligible);
        const checklistArray = Array.isArray(data?.checklist) ? data.checklist : [];
        console.log("Checklist array length:", checklistArray.length);
        setChecklist(checklistArray);
      } else {
        console.error("No data returned from eligibility check");
        setEligible(false);
        setChecklist([]);
      }
    } catch (e: any) {
      console.error("Failed to load eligibility checklist:", e);
      console.error("Error details:", JSON.stringify(e, null, 2));
      setEligible(false);
      setChecklist([]);
    } finally {
      console.log("Setting loading to false");
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    console.log("useEffect triggered, userId:", userId);
    if (userId) {
      load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]); // Only depend on userId, not load (load is stable due to useCallback)

  // 🚀 user taps Apply — unchanged except we already use invoke()
  const applyNow = async () => {
    try {
      setApplying(true);

      const { data, error } = await supabase.functions.invoke("creator-apply", {
        body: {},
      });

      if (error || !data?.ok) {
        setToastMsg(error?.message || data?.error || "Couldn’t submit application. Please try again.");
        setToastOpen(true);
        return;
      }

      // ✅ immediately reflect "pending" in UI
      setAppStatus("pending");
      setToastMsg("Application submitted! We'll email you when approved.");
      setToastOpen(true);
    } catch (e: any) {
      setToastMsg(e?.message || "Something went wrong.");
      setToastOpen(true);
    } finally {
      setApplying(false);
    }
  };

  // 🧲 toggle saver: writes to profiles.monetize_enabled_at
  const setMonetize = async (next: boolean) => {
    if (!userId || !monetizationToggleEnabled) return;
    setMonetizeOn(next); // optimistic
    try {
      const updates =
        next
          ? { monetize_enabled_at: new Date().toISOString() }
          : { monetize_enabled_at: null };

      const { error } = await supabase
        .from("profiles")
        .update(updates)
        .eq("id", userId);

      if (error) {
        // revert if save failed
        setMonetizeOn(!next);
        setToastMsg(error.message || "Couldn’t save your setting. Please try again.");
        setToastOpen(true);
      } else {
        setToastMsg(next ? "Monetization turned ON." : "Monetization turned OFF.");
        setToastOpen(true);
      }
    } catch (e: any) {
      setMonetizeOn(!next);
      setToastMsg(e?.message || "Couldn’t save your setting.");
      setToastOpen(true);
    }
  };

  // 🎨 helpers (unchanged)
  const chip = (text: string, color: string) => (
    <View
      style={{
        alignSelf: "flex-start",
        paddingHorizontal: 10,
        paddingVertical: 6,
        backgroundColor: color,
        borderRadius: 999,
      }}
    >
      <Text style={{ color: "#041016", fontWeight: "900" }}>{text}</Text>
    </View>
  );

  const Row = ({ 
    ok, 
    label, 
    help, 
    ctaRoute 
  }: { 
    ok: boolean; 
    label: string; 
    help?: string; 
    ctaRoute?: string;
  }) => {
    const handlePress = async () => {
      if (!ok && ctaRoute) {
        // Special handling for Stripe setup
        if (label.includes('Stripe')) {
          // Get/create Stripe onboarding link
          try {
            setToastMsg("Getting your Stripe onboarding link...");
            setToastOpen(true);
            
            // Don't send user_id - let the function use the current authenticated user
            // This ensures the permission check passes (user requesting their own link)
            const { data, error } = await supabase.functions.invoke(
              "admin-resend-stripe-onboarding",
              { body: {} } // Empty body - function will use current user
            );
            
            if (error) {
              console.error("Stripe onboarding error:", error);
              setToastMsg(error.message || "Couldn't get Stripe link. The function may not be deployed or Stripe is not configured.");
              setToastOpen(true);
              return;
            }
            
            if (!data?.url) {
              const errorMsg = data?.error || "No Stripe link was returned. Contact support.";
              console.error("Stripe onboarding response:", data);
              setToastMsg(errorMsg);
              setToastOpen(true);
              return;
            }
            
            // Open the Stripe onboarding link
            const canOpen = await Linking.canOpenURL(data.url);
            if (canOpen) {
              await Linking.openURL(data.url);
              setToastMsg("Opening Stripe setup page...");
            } else {
              setToastMsg(`Please visit: ${data.url}`);
            }
            setToastOpen(true);
          } catch (e: any) {
            setToastMsg(e?.message || "Failed to get Stripe link");
            setToastOpen(true);
          }
        } else {
          // Regular navigation for other checklist items
          router.push(ctaRoute as any);
        }
      }
    };

    const isPressable = !ok && !!ctaRoute;

    return (
      <Pressable
        onPress={handlePress}
        disabled={!isPressable}
        style={{
          backgroundColor: COLORS.card,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: COLORS.border,
          padding: 12,
          opacity: isPressable ? 1 : 1,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: ok ? COLORS.text : COLORS.subtext, fontWeight: "800" }}>
              {ok ? "✅" : "⭕"} {label}
            </Text>
            {help ? <Text style={{ color: COLORS.subtext, marginTop: 4 }}>{help}</Text> : null}
          </View>
          {isPressable && (
            <Ionicons 
              name="chevron-forward" 
              size={20} 
              color={COLORS.subtext} 
              style={{ marginLeft: 8 }}
            />
          )}
        </View>
      </Pressable>
    );
  };

  // 🧠 decide button text + disabled state
  let buttonText = "Apply for Monetization";
  let buttonDisabled = false;

  if (appStatus === "pending") {
    buttonText = "Application pending";
    buttonDisabled = true;
  } else if (appStatus === "approved") {
    buttonText = "Approved";
    buttonDisabled = true;
  } else if (appStatus === "rejected" || appStatus === "withdrawn") {
    buttonText = "Reapply for Monetization";
    // Allow resubmission, but still check if they've fixed the issues
    if (eligible === false) {
      buttonText = "Fix the issues above to reapply";
      buttonDisabled = true;
    } else if (eligible === null && checklist.length === 0) {
      // Still loading checklist
      buttonText = "Loading checklist...";
      buttonDisabled = true;
    } else {
      buttonDisabled = false;
    }
  } else {
    // no application yet → use eligibility gates
    if (loading) {
      // Still loading
      buttonText = "Loading checklist...";
      buttonDisabled = true;
    } else if (eligible === null && checklist.length === 0) {
      // Loading completed but no data - show error state
      buttonText = "Unable to load checklist";
      buttonDisabled = true;
    } else if (eligible === false) {
      buttonText = "Complete the steps above to apply";
      buttonDisabled = true;
    } else if (eligible === true) {
      buttonText = "Apply for Monetization";
      buttonDisabled = false;
    } else {
      // Unknown state, disable to be safe
      buttonText = "Complete the steps above to apply";
      buttonDisabled = true;
    }
  }

  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <Text style={{ color: COLORS.text, fontSize: 22, fontWeight: "900" }}>
          Monetization
        </Text>

        {/* Status pill */}
        {appStatus === "pending" && chip("Pending review", COLORS.accent)}
        {appStatus === "approved" && chip("Approved", COLORS.good)}
        {appStatus === "rejected" && chip("Rejected", COLORS.bad)}

        {/* Loading spinner */}
        {loading && (
          <View style={{ padding: 12, alignItems: "center", justifyContent: "center" }}>
            <ActivityIndicator />
            <Text style={{ color: COLORS.subtext, marginTop: 6 }}>Loading your eligibility status…</Text>
          </View>
        )}

        {/* Rejection notes */}
        {!loading && appStatus === "rejected" && rejectionNotes && (
          <View
            style={{
              backgroundColor: COLORS.card,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: COLORS.bad,
              padding: 12,
              marginTop: 4,
            }}
          >
            <Text style={{ color: COLORS.bad, fontWeight: "800", marginBottom: 6 }}>
              Why your application was rejected:
            </Text>
            <Text style={{ color: COLORS.text, lineHeight: 20 }}>{rejectionNotes}</Text>
          </View>
        )}

        {/* Checklist — Show when rejected, withdrawn, OR before applying */}
        {!loading && (appStatus === "none" || appStatus === "rejected" || appStatus === "withdrawn") && (
          <View style={{ gap: 10, marginTop: 8 }}>
            <Text style={{ color: COLORS.text, fontWeight: "800", fontSize: 16 }}>
              {appStatus === "rejected" || appStatus === "withdrawn" 
                ? "Fix these issues to reapply:" 
                : "Eligibility Checklist"}
            </Text>
            {checklist.length === 0 ? (
              <View
                style={{
                  backgroundColor: COLORS.card,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: COLORS.border,
                  padding: 12,
                }}
              >
                <Text style={{ color: COLORS.subtext }}>
                  We couldn't load your checklist right now. Please try refreshing.
                </Text>
              </View>
            ) : (
              <>
                {checklist.map((c, i) => (
                  <Row 
                    key={i} 
                    ok={!!c.passed} 
                    label={c.label} 
                    help={c.help}
                    ctaRoute={c.ctaRoute}
                  />
                ))}
                {eligible === true && (
                  <View
                    style={{
                      backgroundColor: COLORS.card,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: COLORS.good,
                      padding: 12,
                      marginTop: 4,
                    }}
                  >
                    <Text style={{ color: COLORS.good, fontWeight: "800" }}>
                      ✅ All requirements met! You can apply now.
                    </Text>
                  </View>
                )}
              </>
            )}
          </View>
        )}


        {/* Apply button */}
        <Pressable
          disabled={buttonDisabled || applying}
          onPress={applyNow}
          style={{
            marginTop: 8,
            alignItems: "center",
            justifyContent: "center",
            paddingVertical: 14,
            borderRadius: 999,
            backgroundColor:
              buttonDisabled || applying ? COLORS.border : COLORS.good,
            opacity: applying ? 0.8 : 1,
          }}
        >
          <Text
            style={{
              color: buttonDisabled || applying ? "#a7b0bf" : "#041016",
              fontWeight: "900",
            }}
          >
            {applying ? "Submitting…" : buttonText}
          </Text>
        </Pressable>

        {/* Monetization switch: enabled only when APPROVED; saves to DB */}
        <View
          style={{
            marginTop: 8,
            backgroundColor: COLORS.card2,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: COLORS.border,
            padding: 12,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={{ color: COLORS.text, fontWeight: "800" }}>
              Enable Monetization
            </Text>
            <Text style={{ color: COLORS.subtext, marginTop: 4, fontSize: 12 }}>
              Turn this on to enable both Enlisted Club tips and future recipe profit sharing.
            </Text>
          </View>
          <Switch
            value={monetizeOn}
            onValueChange={(v) => setMonetize(v)}
            disabled={!monetizationToggleEnabled}
            trackColor={{ false: COLORS.border, true: COLORS.good }}
            thumbColor={monetizationToggleEnabled ? "#041016" : "#2a3446"}
          />
        </View>

        <Text style={{ color: COLORS.subtext, fontSize: 12 }}>
          Tip: Once approved, we'll email you and unlock the switch. This enables all monetization features.
        </Text>

        {/* Two Monetization Paths Section */}
        {appStatus === "approved" && (
          <View style={{ marginTop: 20, gap: 12 }}>
            <Text style={{ color: COLORS.text, fontSize: 18, fontWeight: "900", marginBottom: 4 }}>
              Monetization Options
            </Text>
            
            {/* Path 1: Enlisted Club Tips */}
            <View
              style={{
                backgroundColor: COLORS.card2,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: stripeSetupComplete ? COLORS.good : COLORS.border,
                padding: 14,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}>
                <Text style={{ color: COLORS.text, fontWeight: "800", fontSize: 15 }}>
                  💰 Enlisted Club Tips
                </Text>
                <View
                  style={{
                    marginLeft: 8,
                    paddingHorizontal: 8,
                    paddingVertical: 4,
                    backgroundColor: COLORS.good,
                    borderRadius: 999,
                  }}
                >
                  <Text style={{ color: "#041016", fontWeight: "800", fontSize: 10 }}>Available Now</Text>
                </View>
              </View>
              
              <Text style={{ color: COLORS.subtext, fontSize: 12, lineHeight: 18, marginBottom: 8 }}>
                Receive direct tips from participants during live cooking sessions. You get 90% of each tip, with 10% going to the platform.
              </Text>

              {stripeSetupComplete ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={{ color: COLORS.good, fontSize: 12, fontWeight: "700" }}>✓ Ready to receive tips</Text>
                  <Text style={{ color: COLORS.subtext, fontSize: 11 }}>
                    • $0.50 - $500.00 per tip
                  </Text>
                </View>
              ) : (
                <>
                  <Text style={{ color: COLORS.subtext, fontSize: 12, lineHeight: 18, marginBottom: 8 }}>
                    To receive tips, you need to complete Stripe Connect onboarding.
                  </Text>
                  <Pressable
                    onPress={() => {
                      setToastMsg(
                        "Contact support or check your email for the Stripe onboarding link. Once completed, you can start receiving tips during live sessions."
                      );
                      setToastOpen(true);
                    }}
                    style={{
                      marginTop: 4,
                      paddingVertical: 8,
                      paddingHorizontal: 12,
                      backgroundColor: COLORS.accent,
                      borderRadius: 8,
                      alignSelf: "flex-start",
                    }}
                  >
                    <Text style={{ color: "#041016", fontWeight: "800", fontSize: 12 }}>
                      Get Stripe Onboarding Link
                    </Text>
                  </Pressable>
                </>
              )}
            </View>

            {/* Path 2: Recipe Profit Sharing */}
            <View
              style={{
                backgroundColor: COLORS.card2,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: COLORS.border,
                padding: 14,
                opacity: 0.8,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}>
                <Text style={{ color: COLORS.text, fontWeight: "800", fontSize: 15 }}>
                  📊 Recipe Profit Sharing
                </Text>
                <View
                  style={{
                    marginLeft: 8,
                    paddingHorizontal: 8,
                    paddingVertical: 4,
                    backgroundColor: COLORS.accent,
                    borderRadius: 999,
                  }}
                >
                  <Text style={{ color: "#041016", fontWeight: "800", fontSize: 10 }}>Coming Later</Text>
                </View>
              </View>
              
              <Text style={{ color: COLORS.subtext, fontSize: 12, lineHeight: 18, marginBottom: 8 }}>
                Split revenue from recipe monetization (affiliate sales, subscriptions, etc.) with contributors. This requires the platform to have established revenue streams first.
              </Text>

              <View style={{ 
                backgroundColor: COLORS.card, 
                padding: 10, 
                borderRadius: 8, 
                marginTop: 8,
                borderLeftWidth: 3,
                borderLeftColor: COLORS.accent,
              }}>
                <Text style={{ color: COLORS.text, fontSize: 11, fontWeight: "700", marginBottom: 4 }}>
                  Why it's not available yet:
                </Text>
                <Text style={{ color: COLORS.subtext, fontSize: 11, lineHeight: 16 }}>
                  • Platform needs revenue streams (affiliates, subscriptions, etc.){"\n"}
                  • Revenue tracking system needs to be built{"\n"}
                  • Contributor attribution system required{"\n"}
                  • Profit calculation engine needed
                </Text>
              </View>

              <View style={{ marginTop: 10, flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Ionicons name="information-circle" size={14} color={COLORS.subtext} />
                <Text style={{ color: COLORS.subtext, fontSize: 11, fontStyle: "italic" }}>
                  Focus on Enlisted Club tips for now. Profit sharing will be added as the platform grows.
                </Text>
              </View>
            </View>

            {/* How They Work Together */}
            <View
              style={{
                backgroundColor: COLORS.card,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: COLORS.border,
                padding: 12,
                marginTop: 4,
              }}
            >
              <Text style={{ color: COLORS.text, fontWeight: "800", fontSize: 13, marginBottom: 6 }}>
                💡 How They Work Together
              </Text>
              <Text style={{ color: COLORS.subtext, fontSize: 11, lineHeight: 16 }}>
                • <Text style={{ fontWeight: "700" }}>Enlisted Club Tips:</Text> Immediate earnings from live sessions (available now){"\n"}
                • <Text style={{ fontWeight: "700" }}>Profit Sharing:</Text> Future earnings from recipe monetization (coming when platform has revenue)
              </Text>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Dark popup for messages */}
      <ThemedToast
        visible={toastOpen}
        onClose={() => setToastOpen(false)}
        title="All set"
        message={toastMsg}
      />
    </SafeAreaView>
  );
}
