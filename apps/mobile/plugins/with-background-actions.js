/**
 * Config plugin for react-native-background-actions.
 *
 * This package (v4.x) does not ship its own Expo config plugin, so we inject
 * the required service declaration and permissions into AndroidManifest.xml
 * during prebuild.
 */

const { withAndroidManifest, withPlugins } = require("@expo/config-plugins");

/**
 * Add foreground service permissions and the RNBackgroundActionsTask service
 * to the Android manifest.
 */
function addBackgroundServiceToManifest(androidManifest) {
  const mainApplication = androidManifest.manifest.application?.[0];
  if (!mainApplication) return androidManifest;

  // Add permissions if missing
  const existingPermissions = androidManifest.manifest["uses-permission"] || [];
  const requiredPermissions = [
    "android.permission.FOREGROUND_SERVICE",
    "android.permission.FOREGROUND_SERVICE_DATA_SYNC",
  ];

  for (const perm of requiredPermissions) {
    if (!existingPermissions.some((p) => p.$["android:name"] === perm)) {
      existingPermissions.push({
        $: { "android:name": perm },
      });
    }
  }
  androidManifest.manifest["uses-permission"] = existingPermissions;

  // Add service if missing
  const existingServices = mainApplication["service"] || [];
  const serviceName = "com.asterinet.react.bgactions.RNBackgroundActionsTask";

  if (!existingServices.some((s) => s.$["android:name"] === serviceName)) {
    existingServices.push({
      $: {
        "android:name": serviceName,
        "android:foregroundServiceType": "dataSync",
        "android:exported": "false",
      },
    });
  }
  mainApplication["service"] = existingServices;

  return androidManifest;
}

module.exports = (config) => {
  return withAndroidManifest(config, (conf) => {
    conf.modResults = addBackgroundServiceToManifest(conf.modResults);
    return conf;
  });
};
