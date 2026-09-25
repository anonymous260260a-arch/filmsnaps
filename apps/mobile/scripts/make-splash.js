/**
 * Regenerates apps/mobile/assets/splash.png:
 *   bg #070708 · icon mark · "FilmSnaps" (Geist 700) · "your personal cinema"
 *
 * Usage: node apps/mobile/scripts/make-splash.js
 */
const sharp = require("M:/filmsnaps-main/node_modules/sharp");
const fs = require("fs");
const path = require("path");

const W = 1284;
const H = 2778;
const root = "M:/filmsnaps-main";
const iconPath = path.join(root, "apps/mobile/assets/icon.png");
const outPath = path.join(root, "apps/mobile/assets/splash.png");
const backupPath = path.join(
  root,
  "apps/mobile/assets/splash-original.png",
);

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
  console.log("backed up original splash");
}
if (!fs.existsSync(GEIST_BOLD) || !fs.existsSync(GEIST_REG)) {
  console.error("Geist TTF not found — cannot render brand wordmark");
  process.exit(1);
}

const fontBoldB64 = fs.readFileSync(GEIST_BOLD).toString("base64");
const fontRegB64 = fs.readFileSync(GEIST_REG).toString("base64");

const titleY = 1680;
const iconSize = 360;
const iconTop = titleY - 96 - 60 - iconSize;
const iconLeft = Math.round((W - iconSize) / 2);

const svg = Buffer.from(`
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style>
      @font-face { font-family: 'Geist'; src: url('data:font/ttf;base64,${fontRegB64}') format('truetype'); font-weight: 400; }
      @font-face { font-family: 'Geist'; src: url('data:font/ttf;base64,${fontBoldB64}') format('truetype'); font-weight: 700; }
    </style>
  </defs>
  <rect width="100%" height="100%" fill="#070708"/>
  <text x="${W / 2}" y="${titleY}" text-anchor="middle" font-family="Geist" font-weight="700" font-size="96" fill="#f5f5f4" letter-spacing="6">FilmSnaps</text>
  <text x="${W / 2}" y="${titleY + 72}" text-anchor="middle" font-family="Geist" font-weight="400" font-size="36" fill="#a1a1aa" letter-spacing="8">your personal cinema</text>
</svg>`);

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
    meta.height,
    "font=Geist",
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
