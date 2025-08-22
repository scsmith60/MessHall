// lib/ogScan.ts
export type OgScanResult = { title?: string; ogImage?: string; error?: string };


export async function ogScan(url: string): Promise<OgScanResult> {
const base = process.env.EXPO_PUBLIC_SUPABASE_URL;
if (!base) return { error: 'Missing EXPO_PUBLIC_SUPABASE_URL' };
const res = await fetch(`${base}/functions/v1/og-scan`, {
method: 'POST',
headers: { 'content-type': 'application/json' },
body: JSON.stringify({ url })
});
const data = (await res.json()) as OgScanResult;
return data;
}