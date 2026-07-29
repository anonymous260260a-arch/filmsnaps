// apps/mobile/lib/download/networkPolicy.ts

import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";
import type { NetworkPolicy } from "./types";
import { logger } from "./logger";

type NetworkChangeCallback = (canDownload: boolean, isWifi: boolean) => void;

export class NetworkAwarePolicy {
  private policy: NetworkPolicy;
  private currentState: NetInfoState | null = null;
  private unsubscribeNetInfo: (() => void) | null = null;
  private listeners = new Set<NetworkChangeCallback>();

  constructor(policy: NetworkPolicy = "any") {
    this.policy = policy;

    // Eagerly fetch initial state so canDownload() works immediately
    NetInfo.fetch()
      .then((state) => {
        logger.debug(
          "NetworkPolicy: Initial state",
          state.type,
          "connected:",
          state.isConnected,
        );
        this.currentState = state;
        const canDownload = this.canDownload();
        for (const cb of this.listeners) {
          cb(canDownload, state.type === "wifi");
        }
      })
      .catch((err) => {
        logger.warn("NetworkPolicy: Initial fetch failed:", err);
      });

    // Subscribe to ongoing changes
    this.unsubscribeNetInfo = NetInfo.addEventListener((state) => {
      const isWifi = state.type === "wifi";
      const isConnected = state.isConnected ?? false;
      this.currentState = state;

      logger.debug(
        "NetworkPolicy: Change → type:",
        state.type,
        "connected:",
        isConnected,
        "policy:",
        this.policy,
      );

      // Notify listeners of network change
      const canDownload = this.canDownload();
      for (const cb of this.listeners) {
        cb(canDownload, isWifi);
      }
    });
  }

  /** Can we start/continue downloads right now? */
  canDownload(): boolean {
    if (!this.currentState?.isConnected) return false;
    if (this.policy === "any") return true;
    if (this.policy === "wifi-only") return this.currentState.type === "wifi";
    return true; // "ask" is handled at UI level before enqueue
  }

  isWifi(): boolean {
    return this.currentState?.type === "wifi";
  }

  isConnected(): boolean {
    return this.currentState?.isConnected ?? false;
  }

  setPolicy(policy: NetworkPolicy): void {
    this.policy = policy;
  }

  getPolicy(): NetworkPolicy {
    return this.policy;
  }

  /** Subscribe to network changes. Returns unsubscribe function. */
  onChange(callback: NetworkChangeCallback): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  destroy(): void {
    this.unsubscribeNetInfo?.();
    this.listeners.clear();
  }
}
