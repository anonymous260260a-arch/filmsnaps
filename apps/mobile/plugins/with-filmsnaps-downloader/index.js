/**
 * Expo config plugin that injects the Filmsnaps native download module.
 * Runs during `expo prebuild` and EAS Build — files survive regeneration.
 */
const { withAndroidDownloader } = require("./withAndroidDownloader");
const { withIOSDownloader } = require("./withIOSDownloader");

function withFilmsnapsDownloader(config) {
  config = withAndroidDownloader(config);
  config = withIOSDownloader(config);
  return config;
}

module.exports = withFilmsnapsDownloader;
