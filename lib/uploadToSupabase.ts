// lib/uploadToSupabase.ts
import * as FileSystem from 'expo-file-system';
import { supabase } from './supabaseClient';


/**
* Upload a local file (file://...) as a Blob to Supabase Storage.
* Returns the storage key. Use createSignedUrl later to display.
*/
export async function uploadFileToBucket(
bucket: string,
key: string,
fileUri: string,
contentType = 'image/jpeg',
upsert = true
) {
// Expo/React Native supports fetch on file:// URIs → Blob
const resp = await fetch(fileUri);
const blob = await resp.blob();
const { error } = await supabase.storage.from(bucket).upload(key, blob, { contentType, upsert });
if (error) throw error;
return key;
}


export async function signedUrl(bucket: string, key: string, seconds = 60 * 60 * 24 * 7) {
const { data, error } = await supabase.storage.from(bucket).createSignedUrl(key, seconds);
if (error) throw error;
return data.signedUrl;
}