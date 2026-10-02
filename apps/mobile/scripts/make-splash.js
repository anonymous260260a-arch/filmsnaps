/**
 * Regenerates apps/mobile/assets/splash.png as a SQUARE brand lockup.
 *
 * Why square: the same asset is shown by two very different renderers.
 *   1. Native boot splash — Android 12+ fits it into the system icon circle
 *      (~2/3 of a 288dp box); Android <12 uses the classic window splash
 *      (app.json imageWidth). A full-screen poster is contain-fitted into
 *      that tiny box, which shrank the wordmark to ~10dp — the reported
 *      "splash sometimes too small in prod" bug. A square lockup scales
 *      down gracefully and looks intentional in every renderer.
 *   2. The JS `SplashHold` in app/_layout.tsx (until fonts/settings ready).
 *
 * Layout (canvas 1284×1284):
 *   icon 34% · gap · "FilmSnaps" Geist-700 · "your personal cinema" Geist-400
 * All content sits within the middle 72% so the Android 12+ circular mask
 * cannot clip the wordmark.
 *
 * Usage: node apps/mobile/scripts/make-splash.js
 */
const sharp = require("M:/filmsnaps-main/node_modules/sharp");
const fs = require("fs");
const path = require("path");

const W = 1284;
const H = 1284; // SQUARE — safe in the Android 12+ icon circle
const root = "M:/filmsnaps-main";
const iconPath = path.join(root, "apps/mobile/assets/icon.png");
const outPath = path.join(root, "apps/mobile/assets/splash.png");
const backupPath = path.join(root, "apps/mobile/assets/splash-original.png");

// Phase 1C FIX 5.3: real brand font (Geist) from node_modules, not Segoe UI.
const GEIST_BOLD = path.join(
  root,
  "node_modules/@expo-google-fonts/geist/700Bold/Geist_700Bold.ttf",
);
const GEIST_REG = path.join(
  root,
  "node_modules/@expo-google-fonts/geist/400Regular/Geist_400Regular.ttf",
);

if (!fs.existsSync(outPath)) {
  console.error("missing splash.png", outPath);
  process.exit(1);
}
if (!fs.existsSync(backupPath)) {
  fs.copyFileSync(outPath, backupPath);
  console.log("backed up previous splash → splash-original.png");
}
if (!fs.existsSync(GEIST_BOLD) || !fs.existsSync(GEIST_REG)) {
  console.error("Geist TTF not found — cannot render brand wordmark");
  process.exit(1);
}

const fontBoldB64 = fs.readFileSync(GEIST_BOLD).toString("base64");
const fontRegB64 = fs.readFileSync(GEIST_REG).toString("base64");

// Geometry — everything inside the middle 72% (circle-mask safe).
const iconSize = Math.round(W * 0.34); // ~436px
const titleSize = Math.round(W * 0.085); // ~109px
const taglineSize = Math.round(W * 0.032); // ~41px
const gapIconTitle = Math.round(W * 0.045);
const gapTitleTagline = Math.round(W * 0.03);

// Vertical block: icon + title + tagline centered as one group.
const titleBaseline = 0; // computed below via block height
const blockH =
  iconSize + gapIconTitle + titleSize + gapTitleTagline + taglineSize;
const blockTop = Math.round((H - blockH) / 2);
const iconTop = blockTop;
const iconLeft = Math.round((W - iconSize) / 2);
const titleY =
  blockTop + iconSize + gapIconTitle + Math.round(titleSize * 0.78);
const taglineY = titleY + gapTitleTagline + taglineSize;

const svg = Buffer.from(`
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style>
      @font-face { font-family: 'Geist'; src: url('data:font/ttf;base64,${fontRegB64}') format('truetype'); font-weight: 400; }
      @font-face { font-family: 'Geist'; src: url('data:font/ttf;base64,${fontBoldB64}') format('truetype'); font-weight: 700; }
    </style>
  </defs>
  <rect width="100%" height="100%" fill="#070708"/>
  <text x="${W / 2}" y="${titleY}" text-anchor="middle" font-family="Geist" font-weight="700" font-size="${titleSize}" fill="#f5f5f4" letter-spacing="6">FilmSnaps</text>
  <text x="${W / 2}" y="${taglineY}" text-anchor="middle" font-family="Geist" font-weight="400" font-size="${taglineSize}" fill="#a1a1aa" letter-spacing="8">your personal cinema</text>
</svg>`);

void titleBaseline;

(async () => {
  const textLayer = await sharp(svg).png().toBuffer();
  const iconBuf = await sharp(iconPath)
    .resize(iconSize, iconSize, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  await sharp(textLayer)
    .composite([{ input: iconBuf, left: iconLeft, top: iconTop }])
    .png({ compressionLevel: 9 })
    .toFile(outPath);

  const meta = await sharp(outPath).metadata();
  console.log(
    "wrote",
    outPath,
    "bytes",
    fs.statSync(outPath).size,
    "dims",
    meta.width,
    "x",
    meta.height,
    "(square lockup)",
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
