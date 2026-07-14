import { requireNativeViewManager } from 'expo-modules-core';
import React from 'react';
import { StyleProp, ViewStyle } from 'react-native';

export interface PlayerWebViewMessage {
  type: string;
  [key: string]: any;
}

export interface PlayerWebViewProps {
  source: { uri: string; headers?: Record<string, string> };
  userAgent?: string;
  injectedJavaScriptBeforeContentLoaded?: string;
  /** Re-injected on every onPageFinished (ad-blocking scripts that must re-apply). */
  injectedJavaScriptAfterLoad?: string;
  allowsFullscreenVideo?: boolean;
  style?: StyleProp<ViewStyle>;
  onLoadingStart?: (event: { nativeEvent: { url: string } }) => void;
  onLoadingFinish?: (event: { nativeEvent: { url: string } }) => void;
  onHttpError?: (event: { nativeEvent: { statusCode: number; description: string } }) => void;
  onMessage?: (event: { nativeEvent: { data: string } }) => void;
  onRenderProcessGone?: (event: { nativeEvent: { didCrash: boolean } }) => void;
  setSupportMultipleWindows?: boolean;
  referrer?: string;
  javaScriptCanOpenWindowsAutomatically?: boolean;
  /** Phase 3: Domain Discovery / Audit Mode. When enabled, all network
   *  request hosts are tracked and dispatched via onAuditData. */
  auditMode?: boolean;
  onAuditData?: (event: { nativeEvent: { hosts: string; count: number; hostsDetailed: string } }) => void;
}

export interface PlayerWebViewRef {
  forceLoad: (url: string) => void;
  reload: () => void;
  stopLoading: () => void;
  injectJavaScript: (script: string) => void;
}

const NativeView = requireNativeViewManager('PlayerWebview');

const PlayerWebView = React.forwardRef<PlayerWebViewRef, PlayerWebViewProps>(
  (props, ref) => {
    const nativeRef = React.useRef<any>(null);

    const [forceLoadUrl, setForceLoadUrl] = React.useState('');
    const [forceReload, setForceReload] = React.useState(0);
    const [forceStop, setForceStop] = React.useState(0);
    const [injectedJS, setInjectedJS] = React.useState('');

    React.useImperativeHandle(ref, () => ({
      forceLoad: (url: string) => setForceLoadUrl(url),
      reload: () => setForceReload(Date.now()),
      stopLoading: () => setForceStop(Date.now()),
      injectJavaScript: (script: string) => {
        // Append a unique comment to bust the native deduplication cache
        // so identical seek scripts evaluate properly on multiple calls.
        setInjectedJS(`${script}\n//${Date.now()}`);
      },
    }));

    return (
      <NativeView
        {...props}
        ref={nativeRef}
        forceLoadUrl={forceLoadUrl}
        forceReload={forceReload}
        forceStop={forceStop}
        injectedJavaScript_={injectedJS}
      />
    );
  }
);

PlayerWebView.displayName = 'PlayerWebView';

export default PlayerWebView;
