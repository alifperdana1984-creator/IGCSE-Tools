# Firebase API Key Restriction

The `firebase-applet-config.json` contains a browser API key that should be restricted
to prevent unauthorized use from other domains.

## Steps

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Select project: **igcse-tools**
3. Navigate to: APIs & Services → Credentials
4. Find the **Browser key** (or API key named for this project)
5. Click Edit → Application restrictions → HTTP referrers
6. Add these allowed referrers:
   - `igcse-tools.firebaseapp.com/*`
   - `igcse-tools.web.app/*`
   - `localhost/*`
   - `127.0.0.1/*`
7. Save

## Note

Firebase API keys for web apps are inherently public — Firestore security rules
are the actual security layer. Restricting the key adds an extra layer by preventing
use from unexpected origins.
