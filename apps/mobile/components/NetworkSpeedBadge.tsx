/**
 * NetworkSpeedBadge — small indicator showing cached network speed.
 *
 * Shows measured Mbps with color coding:
 * - Green: >5 Mbps (1080p capable)
 * - Orange: 2-5 Mbps (720p)
 * - Red: <2 Mbps (480p)
 *
 * Refreshes from cache every 5 minutes.
 * Hidden if no speed data available.
 */

import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { getCachedSpeed } from "../lib/networkSpeedTest";

export function NetworkSpeedBadge() {
  const [speed, setSpeed] = useState<number | null>(null);

  useEffect(() => {
    async function loadSpeed() {
      const cached = await getCachedSpeed();
      if (cached) setSpeed(cached.speedMbps);
    }
    loadSpeed();

    // Refresh every 5 minutes
    const interval = setInterval(loadSpeed, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  if (!speed) return null;

  const color = speed < 2 ? "#ef4444" : speed < 5 ? "#f59e0b" : "#22c55e";

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 12,
        backgroundColor: "rgba(0,0,0,0.4)",
      }}
    >
      <View
        style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }}
      />
      <Text style={{ fontSize: 12, color: "white", fontWeight: "600" }}>
        {speed.toFixed(1)} Mbps
      </Text>
    </View>
  );
}
