# PRISM DASH

A neon, low-poly **endless runner** built for the browser and phones. Pilot a glowing
crystal down an infinite canyon — switch lanes, jump hurdles, collect energy shards, and
charge your **DASH** as the speed keeps climbing. Cool lighting via real-time bloom,
emissive materials, fog, and shifting colour "biomes".

**▶ Play:** https://esalavat.github.io/prism-dash/

Built with [Three.js](https://threejs.org/) (vendored locally — no runtime CDN, works
offline and passes App Store review). Wraps to native iOS/Android with
[Capacitor](https://capacitorjs.com/).

## Controls

| Action        | Touch                        | Keyboard            |
|---------------|------------------------------|---------------------|
| Switch lane   | Swipe left / right           | ← → or A D          |
| Jump          | Tap, or swipe up             | ↑ / W / Space       |
| Dash (when charged) | Tap right side of screen | Shift               |
| Pause         | ❚❚ button                    | Esc                 |

## Run locally

No build step — it's a static site. Serve the folder with any static server:

```bash
npm start            # -> http://localhost:5173  (uses `npx serve`)
# or:  python3 -m http.server 5173
```

Open the URL on your phone (same Wi-Fi) to test touch controls.

## Deploy (web) — GitHub Pages

This repo is served from the `main` branch root. Any push updates the live site at the
URL above. `.nojekyll` is present so Pages serves the files as-is.

## Ship as an iOS / Android app (Capacitor)

The web game is the app. Capacitor wraps it in a native shell you submit to the stores.

```bash
npm install @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android
npx cap init            # already scaffolded in capacitor.config.json
npm run cap:add:ios     # creates /ios   (needs macOS + Xcode)
npm run cap:add:android # creates /android (needs Android Studio)
npm run cap:sync
npm run cap:open:ios    # build & submit in Xcode
npm run cap:open:android
```

Generate all native icons/splash from the source art:

```bash
npm install -D @capacitor/assets
npm run assets          # uses assets/icon-1024.png
```

- **App IDs / signing:** set your Apple Team + bundle id in Xcode, and the Android
  signing key in Android Studio. Bundle id is `com.esalavat.prismdash` (edit in
  `capacitor.config.json`).
- **Orientation / fullscreen:** configured for portrait fullscreen.

## Monetization

Everything is wired through `Store` in `src/game.js`. On the **web** it runs a clearly
labelled *demo unlock*; inside the native app it calls real store billing.

Revenue surfaces already built into the UI:

- **Cosmetic crystal skins** — 2 free, 4 premium ($0.99–$2.99). *(Consumable-free,
  non-consumable IAPs.)*
- **Remove Ads** — $2.99 non-consumable.
- **Revive / Continue** — "watch ad to continue" once per run (rewarded ad slot).
- **Shard economy** — soft currency accumulates across runs (ready for a
  "buy shards" consumable IAP if you want it).

### Wiring real purchases

Recommended: [**RevenueCat**](https://www.revenuecat.com/) — one SDK for StoreKit
(iOS) + Play Billing (Android), plus the [Capacitor plugin](https://www.revenuecat.com/docs/getting-started/installation/capacitor).

```bash
npm install @revenuecat/purchases-capacitor
```

Then implement the two touch-points in `src/game.js`:

1. `Store.buy(productId, price)` → call `Purchases.purchaseProduct({ productIdentifier })`
   and return success. Product ids used: `skin_volt`, `skin_ember`, `skin_void`,
   `skin_aurum`, `remove_ads`.
2. On launch, restore entitlements and set `save.owned` / `save.removeAds` from the
   customer info so purchases persist across devices.

For ads (banner / rewarded-revive), use
[AdMob](https://github.com/capacitor-community/admob). Gate them on `save.removeAds`.

> Configure matching products in **App Store Connect** and **Google Play Console** with
> the same ids before testing on device.

## Project layout

```
index.html              # shell, import map, UI overlays
styles.css              # neon UI
src/game.js             # entire game (engine, state, input, store)
vendor/three/           # vendored Three.js + bloom passes (no CDN at runtime)
assets/                 # app icons (svg + png)
manifest.webmanifest    # PWA install metadata
capacitor.config.json   # native wrapper config
```

## Tuning

Gameplay constants live at the top of `src/game.js` (`BASE_SPEED`, `MAX_SPEED`,
`JUMP_V`, `BIOMES`, spawn weights in `spawnRow`). Bloom strength is set in
`buildComposer()`.

---
© Eric Salavat. All rights reserved.
