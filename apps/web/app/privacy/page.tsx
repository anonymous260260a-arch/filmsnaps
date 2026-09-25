import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import { LegalPageShell } from "@/components/legal/LegalPageShell";
import {
  Section,
  Body,
  Bold,
  Bullet,
} from "@/components/legal/LegalPrimitives";

const GITHUB = "https://github.com/anonymous260260a-arch/filmsnaps";

export const metadata = {
  title: "Privacy Policy",
  description:
    "FilmSnaps privacy policy — what data we collect, what stays on your device, and our commitment to user privacy.",
  alternates: {
    canonical: "https://filmsnap-pro.netlify.app/privacy",
  },
};

export default function PrivacyPage() {
  return (
    <LegalPageShell
      title="Privacy Policy"
      subtitle="How we handle your data — the short version: we don't collect it."
      icon={
        <ShieldCheck className="h-10 w-10 text-primary" strokeWidth={1.5} />
      }
    >
      <p className="mb-2 text-sm font-medium text-faint">
        Last updated: September 2026
      </p>

      <Section title="The Short Version">
        <Bullet text="FilmSnaps has no accounts — we don't know who you are." />
        <Bullet text="Your watch history, bookmarks, progress, and settings never leave your device." />
        <Bullet text="The Android app can send anonymous usage statistics and crash reports — on by default, off anytime in Settings." />
        <Bullet text="We never collect anything that can identify you: no identifiers, no IP addresses, no search text, no titles by name." />
      </Section>

      <Section title="What Stays on Your Device">
        <Body>
          Watch history and progress, bookmarks, your download list, all
          settings, and downloaded files are stored only on your device and are
          never transmitted to us. Downloads are saved to your device&apos;s
          shared Downloads folder — like any file there, they remain after you
          uninstall FilmSnaps.
        </Body>
      </Section>

      <Section title="Anonymous Usage Statistics (Optional)">
        <Body>
          To know which streaming sources actually work and what to fix, the
          app sends small anonymous events — for example, whether a source
          succeeded or failed, roughly how long it took (rounded), whether
          playback stalled, which features get used, plus app version and
          connection type (Wi-Fi or cellular). To measure source coverage we
          count the content ID (a TMDB number) of titles you open, in aggregate
          only. No title names, no search text, no URLs, and no free text are
          ever sent.
        </Body>
        <Body extraMargin>
          <Bold>
            The website sends no statistics and no crash reports. Everything
            below about statistics applies to the Android app.
          </Bold>
        </Body>
        <Body extraMargin>
          Statistics start after you accept the terms and stay on until you
          turn them off. Turning them off (Settings → Anonymous usage
          statistics) stops all sending immediately and clears anything queued.
        </Body>
      </Section>

      <Section title="Crash Reports (Optional — Same Toggle)">
        <Body>
          When the app crashes, a report — the error type and stack trace, with
          web addresses removed — is sent to Sentry, a third-party
          crash-reporting service hosted in the United States, so we can fix
          crashes. The same toggle controls this.
        </Body>
      </Section>

      <Section title="What We Never Collect">
        <Body>
          No names, emails, or accounts (there are none) · no user, device,
          advertising, or session identifiers · no IP addresses (we never read
          or store them) · no search queries · no titles by name · no location ·
          no advertising or tracking SDKs.
        </Body>
      </Section>

      <Section title="Who FilmSnaps Connects To">
        <Bullet text="Our servers (Cloudflare): movie/TV metadata lookups (this keeps the TMDB API key off your device), app configuration (source list, announcements, player settings), ad-block filter updates, app update checks, and — if enabled — the anonymous statistics above." />
        <Bullet text="Cloudflare's public speed-test endpoint: only when the app needs to measure your connection (about 4 MB; results cached for a day)." />
        <Bullet text="The streaming source you choose: when you play or download, that provider sees your IP address — exactly as if you opened their site in a browser. We don't control this; a VPN hides it." />
        <Bullet text="Anime metadata (AniList, Kitsu, Shikimori) and subtitle services, when you use those features." />
      </Section>

      <Section title="How Long We Keep It">
        <Body>
          Anonymous statistics are kept for up to 12 months, then deleted
          automatically. Crash reports follow Sentry&apos;s standard retention.
          Nothing on our side is linked to you, so there is no profile of you to
          expire.
        </Body>
      </Section>

      <Section title="Your Control">
        <Body>
          Everything personal to you is already in your hands — history,
          bookmarks, and settings live on your device, and clearing app data
          removes them. Because nothing we collect is linked to you, there is
          nothing of yours on our servers to access, correct, or delete — and
          turning statistics off stops all future collection instantly.
        </Body>
      </Section>

      <Section title="Your Rights (GDPR / CCPA)">
        <Body>
          These laws protect personal data. Our statistics and crash reports
          contain no identifiers and no IP addresses, so they aren&apos;t
          personal data — but if you ever want anything stopped, the Settings
          toggle works immediately, and you can reach us at{" "}
          <Bold>privacy@filmsnaps.app</Bold>.
        </Body>
      </Section>

      <Section title="Children's Privacy">
        <Body>
          FilmSnaps is not directed at children under 13. We do not knowingly
          collect any information from anyone, let alone children. If you
          believe a child has interacted with our services, please contact us.
        </Body>
      </Section>

      <Section title="Security Research">
        <Body>
          We welcome responsible disclosure of security vulnerabilities. If you
          discover a weakness in FilmSnaps, please open a security issue or pull
          request at our{" "}
          <Link
            href={GITHUB}
            className="text-primary underline-offset-2 hover:underline"
          >
            GitHub repository
          </Link>
          . We aim to acknowledge reports within 72 hours and work with you to
          resolve verified issues. Please do not publicly disclose a
          vulnerability until a fix is available.
        </Body>
      </Section>

      <Section title="Changes to This Policy">
        <Body>
          We may update this policy from time to time. When we do, we will
          update the &quot;Last updated&quot; date above and note the change in
          our public changelog. Because FilmSnaps is open source, you can also
          review the commit history to see exactly what changed in the code that
          handles your data. Continued use of the app after a change constitutes
          acceptance of the updated policy.
        </Body>
      </Section>

      <Section title="Contact">
        <Body>
          If you have questions about this privacy policy, please reach out via
          email at <Bold>privacy@filmsnaps.app</Bold>. For security
          vulnerabilities, please use{" "}
          <Link
            href={GITHUB}
            className="text-primary underline-offset-2 hover:underline"
          >
            GitHub security issues
          </Link>{" "}
          instead. See the{" "}
          <Link
            href="/legal"
            className="text-primary underline-offset-2 hover:underline"
          >
            Legal &amp; DMCA
          </Link>{" "}
          page for our open-source license and terms.
        </Body>
      </Section>
    </LegalPageShell>
  );
}
