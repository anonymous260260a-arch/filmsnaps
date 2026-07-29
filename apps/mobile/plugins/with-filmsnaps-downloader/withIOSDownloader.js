const { withDangerousMod, withAppDelegate } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

function withIOSDownloader(config) {
  // ─── Step 1: Write Swift + ObjC bridge files ───
  config = withDangerousMod(config, [
    "ios",
    async (modConfig) => {
      const iosRoot = modConfig.modRequest.platformProjectRoot;
      const projectName = modConfig.modRequest.projectName || "Filmsnaps";
      const targetDir = path.join(iosRoot, projectName, "FilmsnapsDownloader");
      const filesDir = path.join(__dirname, "files");

      fs.mkdirSync(targetDir, { recursive: true });

      for (const file of [
        "FilmsnapsDownloader.swift",
        "FilmsnapsDownloader.m",
      ]) {
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

  // ─── Step 2: Patch AppDelegate to add background session handler ───
  config = withAppDelegate(config, (modConfig) => {
    let contents = modConfig.modResults.contents;
    const language = modConfig.modResults.language;

    if (language === "swift") {
      if (!contents.includes("backgroundCompletionHandler")) {
        // Add property after class declaration line
        const classPattern = /class AppDelegate.*?\{/;
        contents = contents.replace(classPattern, (match) => {
          return (
            match + "\n    var backgroundCompletionHandler: (() -> Void)?\n"
          );
        });

        // Add handleEventsForBackgroundURLSession before closing brace
        const method = `
    override func application(
        _ application: UIApplication,
        handleEventsForBackgroundURLSession identifier: String,
        completionHandler: @escaping () -> Void
    ) {
        backgroundCompletionHandler = completionHandler
    }
`;
        // Insert before last closing brace of class
        const lastBrace = contents.lastIndexOf("}");
        if (lastBrace > 0) {
          contents =
            contents.slice(0, lastBrace) +
            method +
            "\n" +
            contents.slice(lastBrace);
        }
      }
    }

    modConfig.modResults.contents = contents;
    console.log("[with-filmsnaps-downloader] AppDelegate patched ✓");
    return modConfig;
  });

  return config;
}

module.exports = { withIOSDownloader };
