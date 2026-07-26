/**
 * How Content Works — Transparency page explaining content sourcing,
 * ad blocking technology, and answers to common user questions.
 *
 * All sections are collapsible (topic-wise) with a FAQ section at the end.
 */

import React, { useState } from "react";
import { View, Text, TouchableOpacity, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BackIcon } from "../components/Icons";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

export default function HowItWorksScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View
      className="flex-1"
      style={{ backgroundColor: "#070708", paddingTop: insets.top }}
    >
      {/* Header */}
      <View className="px-5 pt-4 pb-2 flex-row items-center">
        <TouchableOpacity
          onPress={() => router.back()}
          className="w-9 h-9 rounded-full bg-zinc-800/60 items-center justify-center mr-3"
          activeOpacity={0.7}
        >
          <BackIcon width={20} height={20} color="#F4F4F5" />
        </TouchableOpacity>
        <Text
          style={{
            fontFamily: "PlayfairDisplay_700Bold",
            fontSize: 22,
            color: "#F4F4F5",
          }}
        >
          How Content Works
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        <View
          className="w-16 h-0.5 mb-5"
          style={{ backgroundColor: "#D4A237" }}
        />

        <Text className="text-sm leading-6 mb-6" style={{ color: "#A1A1AA" }}>
          Everything you need to know about how FilmSnaps sources content,
          blocks ads, and protects your privacy — explained transparently.
        </Text>

        {/* ── SECTION: Content Sources ── */}
        <CollapsibleSection title="Content Sources" icon="server">
          <Body>
            FilmSnaps does not host, store, or upload any video content. When
            you watch a movie or TV show, the app fetches an embed page from a
            third-party streaming provider whose servers are independent and
            unrelated to us.
          </Body>
          <Bullet text="Multiple sources (providers) are available for most titles" />
          <Bullet text="If one source fails, the app automatically tries the next available" />
          <Bullet text="You can set a default source in Settings → Default Source" />
          <Bullet text="Providers are community-curated and may change over time" />
        </CollapsibleSection>

        {/* ── SECTION: How Streaming Works ── */}
        <CollapsibleSection title="How Streaming Works" icon="play-circle">
          <Body>
            When you tap "Watch", the app loads the provider's embed page inside
            a sandboxed WebView — a dedicated browser view that is isolated from
            the rest of the app. The WebView:
          </Body>
          <Bullet text="Renders only the provider's video player interface" />
          <Bullet text="Has no access to your device data, cookies, or app storage" />
          <Bullet text="Is destroyed when you leave the player, leaving no traces" />
          <Bullet text="Supports fullscreen playback, subtitles, and audio track selection" />
        </CollapsibleSection>

        {/* ── SECTION: Ad Blocking Technology ── */}
        <CollapsibleSection
          title="Ad Blocking Technology"
          icon="shield-checkmark"
        >
          <Body>
            FilmSnaps blocks ads and trackers at multiple layers — similar to
            how Brave Browser blocks unwanted content before it can load. The
            system is layered so that even if one layer misses something, the
            next catches it.
          </Body>

          <SubSection title="Layer 1: Network-Level Blocking (Brave-Style)">
            <Body>
              Every network request made by the WebView passes through a native
              ad-blocking engine before it reaches the network. This engine:
            </Body>
            <Bullet text="Maintains a list of known ad, tracker, and popup domains compiled from EasyList, EasyPrivacy, and AdGuard filter lists" />
            <Bullet text="Uses an Aho-Corasick pattern matcher for fast lookups — checks every URL in O(L) time regardless of list size" />
            <Bullet text="Keeps a session-based trust list: once a host serves real video content, all its future requests bypass blocking for that session" />
            <Bullet text="Supports allow-list exceptions so that video CDNs and required player assets are never blocked" />
          </SubSection>

          <SubSection title="Layer 2: Cosmetic Filtering">
            <Body>
              Some ads are injected by the page's own JavaScript and cannot be
              blocked at the network level. For these, the app injects CSS rules
              that hide ad containers, popup overlays, and banner elements —
              they are never rendered on screen.
            </Body>
          </SubSection>

          <SubSection title="Layer 3: Runtime Guard Scripts">
            <Body>
              When the WebView loads a provider page, the app injects a
              comprehensive guard script before any page code runs. This script:
            </Body>
            <Bullet text="Seals window.open — popup attempts return null silently" />
            <Bullet text="Intercepts fetch and XMLHttpRequest calls targeting ad domains" />
            <Bullet text="Watches for new DOM elements and removes ad iframes the moment they appear" />
            <Bullet text="Blocks service worker registration used for ad injection" />
            <Bullet text="Prevents anti-adblock detection that some providers use to detect ad blockers" />
          </SubSection>

          <SubSection title="Layer 4: Anti-Anti-Adblock Scriptlets">
            <Body>
              Some providers run scripts that detect ad blockers and either
              break the player or show nag screens. The app neutralises these
              by:
            </Body>
            <Bullet text="Forcing ad-related JavaScript variables (adsEnabled, canShowAds, etc.) to always return false" />
            <Bullet text="Aborting scripts that try to read popup or ad variables" />
            <Bullet text="Preventing visibility-change and focus/blur listeners that detect popup blocking" />
            <Bullet text="Cloaking native function signatures so that providers cannot detect our monkey-patches" />
          </SubSection>

          <SubSection title="Layer 5: Provider-Specific Rules">
            <Body>
              Each streaming provider has unique ad patterns. The app maintains
              per-provider blocking rules, custom CSS selectors, and known ad
              URL patterns that are updated regularly to adapt to changes in
              provider layouts.
            </Body>
          </SubSection>
        </CollapsibleSection>

        {/* ── SECTION: How Likely Are You to See Ads? ── */}
        <CollapsibleSection
          title="How Likely Are You to See Ads?"
          icon="analytics"
        >
          <Body>
            The ad blocking system is designed to catch the vast majority of ads
            before they load. Most users will see a clean, ad-free experience
            99%+ of the time. However:
          </Body>

          <SubSection title="What Gets Blocked">
            <Bullet text="Popups and popunders — completely blocked" />
            <Bullet text="Banner ads and overlay ads — hidden via CSS or removed from DOM" />
            <Bullet text="Video pre-roll / mid-roll ads — blocked at network level when served from known ad CDNs" />
            <Bullet text="Analytics and tracking scripts — prevented from loading" />
            <Bullet text="Crypto miners — blocked at domain level" />
            <Bullet text="Redirect attempts to ad landing pages — intercepted at the native layer" />
          </SubSection>

          <SubSection title="What Might Slip Through">
            <Body>In rare circumstances, you may still encounter an ad:</Body>
            <Bullet text="Ads served from the same CDN as the video content (server-side ad insertion) cannot be distinguished from legitimate video — blocking them would block the video too" />
            <Bullet text="Newly deployed ad domains not yet in our blocklists — these are added as we identify them" />
            <Bullet text="Ads injected via first-party JavaScript that load from the provider's own domain (same-origin ads)" />
            <Bullet text="Provider layouts can change, temporarily breaking CSS hiding rules until we update them" />
          </SubSection>

          <SubSection title="What We Do When Something Slips Through">
            <Body>
              The blocklist configuration is updated regularly. The app checks
              for updated blocking rules on startup and fetches the latest
              patterns from our configuration server. We also welcome reports of
              missed ads so we can add them to the blocklist.
            </Body>
          </SubSection>
        </CollapsibleSection>

        {/* ── SECTION: Important Notes ── */}
        <CollapsibleSection title="Important Notes" icon="warning">
          <Body>
            <Bold>No content is modified or re-encoded.</Bold> The app simply
            requests the same embed page that any browser would load, and strips
            out the unwanted elements before they affect your experience.
          </Body>
          <Body extraMargin>
            <Bold>This is not a VPN or proxy.</Bold> The ad blocking happens
            entirely on your device. Your IP address is still visible to the
            streaming provider when you watch content.
          </Body>
          <Body extraMargin>
            <Bold>No user data is sent to any ad-blocking service.</Bold> The
            blocklist is fetched as a static JSON file. No information about
            your browsing or watching activity is transmitted.
          </Body>
          <Body extraMargin>
            <Bold>Providers can change at any time.</Bold> If a provider updates
            their page layout, the player may temporarily break or show ads
            until the app's rules are updated accordingly.
          </Body>
        </CollapsibleSection>

        {/* ── SECTION: Technical Summary ── */}
        <CollapsibleSection title="Technical Summary" icon="code-slash">
          <Body>FilmSnaps uses a layered defence model:</Body>
          <View
            className="mt-3 mb-1 rounded-xl overflow-hidden"
            style={{
              backgroundColor: "#0E0E11",
              borderWidth: 0.5,
              borderColor: "#1f1f1f",
            }}
          >
            <TechRow
              label="Native engine"
              value="Aho-Corasick pattern matching"
              color="#D4A237"
            />
            <TechDivider />
            <TechRow
              label="Filter lists"
              value="EasyList, EasyPrivacy, AdGuard, custom"
              color="#22c55e"
            />
            <TechDivider />
            <TechRow
              label="Cosmetic CSS"
              value="Per-provider element hiding"
              color="#5b9cf6"
            />
            <TechDivider />
            <TechRow
              label="Guard JS"
              value="15-layer runtime protection"
              color="#a855f7"
            />
            <TechDivider />
            <TechRow
              label="Session trust"
              value="Auto-allow video CDNs"
              color="#f97316"
            />
            <TechDivider />
            <TechRow
              label="Update cadence"
              value="On-startup + 6-hour TTL"
              color="#ec4899"
            />
          </View>
        </CollapsibleSection>

        {/* ── SECTION: FAQ ── */}
        <CollapsibleSection
          title="Frequently Asked Questions"
          icon="help-circle"
          defaultOpen
        >
          <Body>
            Common questions about how FilmSnaps works, your privacy, and the
            technology behind the scenes.
          </Body>

          <FaqItem
            question="Can streaming providers steal my data or hack my device?"
            answer={
              <Body>
                <Bold>Zero percent chance.</Bold> The provider's page runs
                inside a sandboxed WebView — a stripped-down browser that has no
                access to your device's storage, file system, contacts, apps, or
                any other personal data. It cannot execute code outside that
                WebView, cannot read app state, and cannot install anything on
                your device. The WebView is destroyed completely when you leave
                the player, leaving zero traces behind. All the provider sees is
                a standard HTTP request for their embed page — exactly what a
                normal browser would send. They have no way to reach into the
                app or your device.
              </Body>
            }
          />

          <FaqItem
            question="What can a provider do with my IP address?"
            answer={
              <Body>
                The provider sees your IP address — just like every website you
                visit in any browser. With just an IP address, they cannot
                identify you personally, cannot access your device, and cannot
                cause you any harm. An IP address only reveals the approximate
                region you're connecting from (usually the city level) and the
                name of your internet service provider. This is the same
                information any website gets when you visit it. FilmSnaps does
                not share your IP with anyone beyond the provider you chose to
                watch from.
              </Body>
            }
          />

          <FaqItem
            question="Does FilmSnaps collect my personal data?"
            answer={
              <Body>
                <Bold>No.</Bold> FilmSnaps does not collect, store, or transmit
                any personal data to external servers. Everything — your watch
                history, saved content, downloads, and settings — stays on your
                device. There are no analytics SDKs, no tracking pixels, and no
                telemetry. For full details, see the Privacy Policy in Settings.
              </Body>
            }
          />

          <FaqItem
            question="Can the app get malware from a provider's page?"
            answer={
              <Body>
                <Bold>No.</Bold> The WebView is sandboxed at the operating
                system level. A webpage inside a WebView cannot install
                software, modify system files, or access other apps. It is one
                of the most locked-down environments a web page can run in.
                Additionally, the guard scripts block known malicious patterns,
                popups, and redirect attempts before they can execute. Between
                the OS sandbox and the app's security layers, there is no
                realistic path for malware to reach your device through
                streaming.
              </Body>
            }
          />

          <FaqItem
            question="What happens if a provider's page has a virus or malicious script?"
            answer={
              <Body>
                Malicious scripts inside a WebView are contained by the same
                sandbox that isolates legitimate content. JavaScript in a
                WebView cannot access the file system, read app data, make
                network requests outside the browser context, or exploit the
                host app. Furthermore, the guard scripts actively block common
                exploit techniques: popups are sealed, redirects are
                intercepted, and known script injection patterns are
                neutralised. Even in the worst case (a fully compromised embed
                page), the attacker gains nothing — they are trapped inside a
                browser view with no escape route to the device.
              </Body>
            }
          />

          <FaqItem
            question="Do you sell my data or share it with advertisers?"
            answer={
              <Body>
                <Bold>Never.</Bold> FilmSnaps has no advertising, no ad
                partnerships, and no data-sharing agreements. We do not collect
                data to sell, and we do not show ads ourselves. The ad blocking
                technology exists solely to clean up the third-party provider
                pages — not to replace their ads with our own. There is no
                business incentive to collect or share your data.
              </Body>
            }
          />

          <FaqItem
            question="Why do I sometimes see a brief popup before it gets blocked?"
            answer={
              <Body>
                The ad blocking layers work at different speeds. Network-level
                blocking (Layer 1) stops requests before they leave the device —
                these ads never load at all. But some ads are injected by the
                page's own JavaScript after the page loads (same-origin). These
                require the DOM observer (Layer 3) to detect and remove them,
                which can take a few hundred milliseconds. You might see a flash
                of an ad container before it is removed. This is harmless and
                does not mean the ad was fully rendered or tracked.
              </Body>
            }
          />

          <FaqItem
            question="Can I use a VPN with FilmSnaps?"
            answer={
              <Body>
                Yes, a VPN works fine with FilmSnaps. Using a VPN will change
                the IP address visible to streaming providers, which can be
                useful if you want additional privacy or need to access
                region-specific content. The ad blocking system works
                independently of your VPN connection since it runs entirely on
                your device at the network request layer.
              </Body>
            }
          />

          <FaqItem
            question="How often are the ad blocklists updated?"
            answer={
              <Body>
                The app checks for updated blocklist configurations on startup
                and refreshes them every 6 hours while the app is running.
                Filter lists are compiled from EasyList, EasyPrivacy, and
                AdGuard — which are updated by their respective communities
                daily. The app also maintains custom provider-specific rules
                that are updated as providers change their layouts.
              </Body>
            }
          />

          <FaqItem
            question="Is this legal?"
            answer={
              <Body>
                FilmSnaps does not host, distribute, or modify copyrighted
                content. The app simply provides a user interface to access
                publicly available embed pages — the same pages you could access
                by visiting the provider directly in any browser. The ad
                blocking is a client-side privacy measure, which has been upheld
                as legal in numerous jurisdictions (similar to AdBlock Plus,
                uBlock Origin, and Brave Browser's built-in blocking). For more
                details, see the Legal &amp; DMCA page in Settings.
              </Body>
            }
          />
        </CollapsibleSection>
      </ScrollView>
    </View>
  );
}

// ── Collapsible Section ──

function CollapsibleSection({
  title,
  icon,
  children,
  defaultOpen,
}: {
  title: string;
  icon?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <View className="mb-4">
      <TouchableOpacity
        onPress={() => setOpen(!open)}
        activeOpacity={0.7}
        className="flex-row items-center py-3"
      >
        {icon && (
          <Ionicons
            name={icon as any}
            size={16}
            color="#D4A237"
            style={{ marginRight: 10 }}
          />
        )}
        <Text
          className="flex-1 text-sm font-semibold"
          style={{ color: "#F4F4F5", fontFamily: "Inter_600SemiBold" }}
        >
          {title}
        </Text>
        <Ionicons
          name={open ? "chevron-up" : "chevron-down"}
          size={16}
          color="#52525b"
        />
      </TouchableOpacity>
      {open && (
        <View
          className="ml-1 pl-3 border-l-2"
          style={{ borderColor: "#1f1f1f" }}
        >
          {children}
        </View>
      )}
    </View>
  );
}

// ── FAQ Item ──

function FaqItem({
  question,
  answer,
}: {
  question: string;
  answer: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View
      className="mb-3 mt-2 rounded-xl overflow-hidden"
      style={{
        backgroundColor: "#0A0A0D",
        borderWidth: 0.5,
        borderColor: "#1a1a1e",
      }}
    >
      <TouchableOpacity
        onPress={() => setOpen(!open)}
        activeOpacity={0.7}
        className="flex-row items-center px-4 py-3"
      >
        <Text
          className="flex-1 text-sm leading-5 pr-2"
          style={{ color: "#F4F4F5", fontFamily: "Inter_500Medium" }}
        >
          {question}
        </Text>
        <Ionicons
          name={open ? "remove-circle-outline" : "add-circle-outline"}
          size={18}
          color="#D4A237"
        />
      </TouchableOpacity>
      {open && (
        <View className="px-4 pb-3 pt-1">
          <View
            className="w-full h-[1px] mb-3"
            style={{ backgroundColor: "#1a1a1e" }}
          />
          {answer}
        </View>
      )}
    </View>
  );
}

// ── Sub-components ──

function SubSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View className="mb-4 mt-3">
      <Text
        className="text-xs font-semibold mb-2"
        style={{ color: "#D4A237", fontFamily: "Inter_600SemiBold" }}
      >
        {title}
      </Text>
      {children}
    </View>
  );
}

function Body({
  children,
  extraMargin,
}: {
  children: React.ReactNode;
  extraMargin?: boolean;
}) {
  return (
    <Text
      className={`text-sm leading-6 ${extraMargin ? "mt-3" : ""}`}
      style={{ color: "#D4D4D8" }}
    >
      {children}
    </Text>
  );
}

function Bold({ children }: { children: React.ReactNode }) {
  return (
    <Text style={{ fontFamily: "Inter_600SemiBold", color: "#F4F4F5" }}>
      {children}
    </Text>
  );
}

function Bullet({ text }: { text: string }) {
  return (
    <View className="flex-row items-start mt-2">
      <Text className="text-[10px] mt-1.5 mr-2.5" style={{ color: "#D4A237" }}>
        ■
      </Text>
      <Text className="text-sm leading-5 flex-1" style={{ color: "#D4D4D8" }}>
        {text}
      </Text>
    </View>
  );
}

function TechRow({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <View className="flex-row items-center px-4 py-2.5">
      <View
        className="w-2 h-2 rounded-full mr-2.5"
        style={{ backgroundColor: color }}
      />
      <Text
        className="text-xs flex-1"
        style={{ color: "#A1A1AA", fontFamily: "Inter_500Medium" }}
      >
        {label}
      </Text>
      <Text
        className="text-xs text-right"
        style={{ color: "#F4F4F5", fontFamily: "Inter_400Regular" }}
      >
        {value}
      </Text>
    </View>
  );
}

function TechDivider() {
  return (
    <View className="h-[1px] mx-4" style={{ backgroundColor: "#1a1a1e" }} />
  );
}
