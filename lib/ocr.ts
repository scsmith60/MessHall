// lib/ocr.ts
// 👶 ELI5: This file is our "text reader" helper.
// We give it a picture (URI), and it gives us words it sees in the picture.

import { recognizeText as recognizeTextJS } from "expo-text-extractor";

// Try to load native ML Kit OCR if available (managed apps may not have it)
let mlkit: any = null;
try {
  // Use eval to avoid Metro static resolution when the module isn't installed
  const req = (eval as any)("require");
  mlkit = req("expo-mlkit-ocr");
} catch (_) {
  mlkit = null;
}

// ⭐ Main function you will call everywhere
export async function recognizeImageText(imageUri: string) {
  // Safety: if no picture, return empty text
  if (!imageUri) {
    return { text: "", lines: [], blocks: [] as Array<{ text: string }> };
  }

  // Ask the library to read the picture (prefer ML Kit if present)
  const result = mlkit
    ? await mlkit.recognizeText(imageUri)
    : await recognizeTextJS(imageUri);

  // Different libs sometimes shape their answers a bit differently,
  // so we normalize to one simple format for the rest of the app.
  const text = (result as any)?.text ?? "";
  const blocks =
    (result as any)?.blocks ??
    (Array.isArray((result as any)) ? (result as any) : []);

  // Lines: split the big text by newlines as a friendly format
  const lines = text
    .split(/\r?\n/)
    .map((s: string) => s.trim())
    .filter(Boolean);

  return {
    text,     // the whole blob of text
    lines,    // each line as a list
    blocks,   // raw blocks from the library (for advanced uses)
  };
}
