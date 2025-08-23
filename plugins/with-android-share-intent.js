// plugins/with-android-share-intent.js
const { withAndroidManifest, AndroidConfig, createRunOncePlugin } = require('@expo/config-plugins');

const pkg = 'with-android-share-intent';

function ensureArray(x) {
  return Array.isArray(x) ? x : x ? [x] : [];
}

function makeIntentFilterSend(mimeType) {
  return {
    $: { 'android:autoVerify': 'false' },
    'action': [{ $: { 'android:name': 'android.intent.action.SEND' } }],
    'category': [
      { $: { 'android:name': 'android.intent.category.DEFAULT' } },
      { $: { 'android:name': 'android.intent.category.BROWSABLE' } },
    ],
    'data': [{ $: { 'android:mimeType': mimeType } }],
  };
}

function makeIntentFilterSendMultiple(mimeType) {
  return {
    $: { 'android:autoVerify': 'false' },
    'action': [{ $: { 'android:name': 'android.intent.action.SEND_MULTIPLE' } }],
    'category': [
      { $: { 'android:name': 'android.intent.category.DEFAULT' } },
      { $: { 'android:name': 'android.intent.category.BROWSABLE' } },
    ],
    'data': [{ $: { 'android:mimeType': mimeType } }],
  };
}

function hasFilter(existing, targetAction, mime) {
  return existing?.some((f) => {
    const action = f.action?.[0]?.$?.['android:name'];
    const mimeType = f.data?.[0]?.$?.['android:mimeType'];
    return action === targetAction && mimeType === mime;
  });
}

const withAndroidShareIntent = (config) =>
  withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;
    const app = AndroidConfig.Manifest.getMainApplication(manifest);
    const activity = AndroidConfig.Manifest.getMainActivity(manifest);
    if (!app || !activity) return cfg;

    activity['intent-filter'] = ensureArray(activity['intent-filter']);

    const mimeTypes = ['text/plain', 'image/*', 'text/uri-list'];
    const pairs = [
      ...mimeTypes.map((m) => ['android.intent.action.SEND', m]),
      ...mimeTypes.map((m) => ['android.intent.action.SEND_MULTIPLE', m]),
    ];

    for (const [action, mime] of pairs) {
      if (action === 'android.intent.action.SEND') {
        if (!hasFilter(activity['intent-filter'], action, mime)) {
          activity['intent-filter'].push(makeIntentFilterSend(mime));
        }
      } else {
        if (!hasFilter(activity['intent-filter'], action, mime)) {
          activity['intent-filter'].push(makeIntentFilterSendMultiple(mime));
        }
      }
    }

    return cfg;
  });

module.exports = createRunOncePlugin(withAndroidShareIntent, pkg, '1.0.0');
