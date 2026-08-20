const {
  withDangerousMod,
  withMainApplication,
  withAndroidManifest,
  withAppBuildGradle,
} = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const MODULE_PACKAGE = "app.filmsnaps.mobile.download";
const JAVA_DIR_RELATIVE = "app/src/main/java/app/filmsnaps/mobile/download";

function withAndroidDownloader(config) {
  // ─── Step 1: Write Kotlin files into the generated android/ tree ───
  config = withDangerousMod(config, [
    "android",
    async (modConfig) => {
      const androidRoot = modConfig.modRequest.platformProjectRoot;
      assert(androidRoot, "android platformProjectRoot is undefined");
      const targetDir = path.join(androidRoot, JAVA_DIR_RELATIVE);
      const filesDir = path.join(__dirname, "files");

      fs.mkdirSync(targetDir, { recursive: true });

      // Expert: copy 3 files instead of 2 — add FilmsnapsDownloadService.kt
      const filesToCopy = [
        "FilmsnapsDownloadModule.kt",
        "FilmsnapsDownloadPackage.kt",
        "FilmsnapsDownloadService.kt", // NEW — the ForegroundService
        "OfflineFileProvider.kt", // NEW — zero-copy bridge for MediaStore playback
      ];

      for (const file of filesToCopy) {
        const src = path.join(filesDir, file);
        const dest = path.join(targetDir, file);
        if (!fs.existsSync(src)) {
          console.warn(
            `[with-filmsnaps-downloader] template not found: ${src}`,
          );
          continue;
        }
        fs.writeFileSync(dest, fs.readFileSync(src, "utf-8"));
        console.log(`[with-filmsnaps-downloader] wrote ${dest}`);
      }

      return modConfig;
    },
  ]);

  // ─── Step 2: Patch MainApplication.kt to register the package ───
  config = withMainApplication(config, (modConfig) => {
    let contents = modConfig.modResults.contents;

    // Add import if not present
    const importLine = `import ${MODULE_PACKAGE}.FilmsnapsDownloadPackage`;
    if (!contents.includes(importLine)) {
      // Find the line after expo.modules.ExpoReactHostFactory
      const marker = "import expo.modules.ExpoReactHostFactory";
      const idx = contents.indexOf(marker);
      if (idx !== -1) {
        const insertPos = contents.indexOf("\n", idx) + 1;
        contents =
          contents.slice(0, insertPos) +
          importLine +
          "\n" +
          contents.slice(insertPos);
      }
    }

    // Add package registration inside the .apply block
    const registrationLine = "add(FilmsnapsDownloadPackage())";
    if (!contents.includes(registrationLine)) {
      // Find the comment line that has "add(MyReactNativePackage())"
      const marker = "// add(MyReactNativePackage())";
      const idx = contents.indexOf(marker);
      if (idx !== -1) {
        // Replace the commented example with our live registration
        contents =
          contents.slice(0, idx) +
          registrationLine +
          contents.slice(idx + marker.length);
      }
    }

    modConfig.modResults.contents = contents;
    console.log("[with-filmsnaps-downloader] MainApplication.kt patched ✓");
    return modConfig;
  });

  // ─── Step 3: Add permissions and service to AndroidManifest.xml ───
  config = withAndroidManifest(config, (modConfig) => {
    const root = modConfig.modResults.manifest;

    // Expert: add FOREGROUND_SERVICE_DATA_SYNC to permission list
    const permissions = [
      "android.permission.INTERNET",
      "android.permission.ACCESS_NETWORK_STATE",
      "android.permission.POST_NOTIFICATIONS",
      "android.permission.FOREGROUND_SERVICE",
      "android.permission.FOREGROUND_SERVICE_DATA_SYNC", // NEW — required on API 34+ for typed FGS
      "android.permission.WAKE_LOCK",
    ];

    if (!root["uses-permission"]) {
      root["uses-permission"] = [];
    }

    const existingPerms = (root["uses-permission"] || []).map(
      (p) => p.$?.["android:name"],
    );

    for (const perm of permissions) {
      if (!existingPerms.includes(perm)) {
        root["uses-permission"].push({
          $: { "android:name": perm },
        });
      }
    }

    // Expert: register the ForegroundService in the application element
    const application = root["application"]?.[0];
    if (application) {
      if (!application.service) {
        application.service = [];
      }
      const existingServices = (application.service || []).map(
        (s) => s.$?.["android:name"],
      );
      const serviceName = ".download.FilmsnapsDownloadService";
      if (!existingServices.includes(serviceName)) {
        application.service.push({
          $: {
            "android:name": serviceName,
            "android:exported": "false",
            "android:foregroundServiceType": "dataSync",
          },
        });
        console.log(
          "[with-filmsnaps-downloader] ForegroundService registered in manifest ✓",
        );
      }

      // Expert: register the OfflineFileProvider (zero-copy MediaStore playback bridge)
      if (!application.provider) {
        application.provider = [];
      }
      const existingProviders = (application.provider || []).map(
        (p) => p.$?.["android:name"],
      );
      const providerName = ".download.OfflineFileProvider";
      if (!existingProviders.includes(providerName)) {
        application.provider.push({
          $: {
            "android:name": providerName,
            "android:authorities": "com.filmsnaps.offline",
            "android:exported": "false",
            "android:grantUriPermissions": "true",
          },
        });
        console.log(
          "[with-filmsnaps-downloader] OfflineFileProvider registered in manifest ✓",
        );
      }
    }

    return modConfig;
  });

  // ─── Step 4: Add OkHttp + kotlinx-coroutines dependencies (expert) ───
  config = withAppBuildGradle(config, (modConfig) => {
    const contents = modConfig.modResults.contents;

    // Guard against double-insert
    if (contents.includes("okhttp:4.12.0")) return modConfig;

    // Insert before the last closing block in dependencies
    const depsBlock = "dependencies {";
    const depsIdx = contents.lastIndexOf(depsBlock);
    if (depsIdx === -1) return modConfig;

    const insertPos = contents.indexOf("\n", depsIdx) + 1;
    const newDeps =
      `    implementation "com.squareup.okhttp3:okhttp:4.12.0"\n` +
      `    implementation "org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1"\n`;

    modConfig.modResults.contents =
      contents.slice(0, insertPos) + newDeps + contents.slice(insertPos);

    console.log("[with-filmsnaps-downloader] OkHttp + coroutines deps added ✓");
    return modConfig;
  });

  return config;
}

module.exports = { withAndroidDownloader };
