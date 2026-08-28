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
        Last updated: August 2026
      </p>

      <Section title="Our Privacy Philosophy">
        <Body>
          We believe privacy is a fundamental right, not a premium feature.
          FilmSnaps is engineered with a strict{" "}
          <Bold>zero-knowledge architecture</Bold>. The app does not collect,
          store, or transmit any personal data, telemetry, or usage statistics
          to external servers. Everything you do stays on your device.
        </Body>
      </Section>

      <Section title="Data We Collect">
        <Body>
          In short: <Bold>no personal data.</Bold> FilmSnaps does not operate
          servers that receive, process, or store any information that
          identifies you. The only requests our server handles are anonymous
          movie and TV metadata lookups (a TMDB proxy we run to keep the API key
          off your device) — these carry no user identifiers, watch history, or
          browsing data. There are no cookies, no tracking pixels, no analytics
          SDKs, no crash reporters, and no third-party monitoring tools embedded
          in our code. We do not create a device fingerprint and do not track
          your behavior across the app or across the web.
        </Body>
      </Section>

      <Section title="Data Stored Locally on Your Device">
        <Body>
          The following data is stored exclusively in your device&apos;s local
          storage or file system. It never leaves your device and is not
          transmitted to FilmSnaps:
        </Body>
        <Bullet text="Watch history and progress (to enable the 'Continue Watching' feature)" />
        <Bullet text="Your personal watchlist and bookmarked titles" />
        <Bullet text="App settings (preferred providers, subtitle defaults, UI preferences)" />
        <Bullet text="Offline downloads (saved to your device's shared media folders)" />
        <Body extraMargin>
          You can delete any of this at any time through the app&apos;s settings
          or by uninstalling FilmSnaps. Deleting the app removes locally stored
          data.
        </Body>
      </Section>

      <Section title="Third-Party Connections">
        <Body>
          When you stream content, your device connects directly to third-party
          content servers. These independent providers may log your IP address
          and request details as part of their standard web server operations.
          FilmSnaps has no control over, and assumes no responsibility for, the
          data practices or privacy policies of these third-party hosts. We
          strongly recommend using a reputable VPN if you wish to mask your IP
          address from streaming providers.
        </Body>
        <Body extraMargin>
          FilmSnaps also queries public metadata services (such as TMDB) for
          movie and TV information. Those requests are governed by the metadata
          provider&apos;s own privacy policy, not ours. For details on the
          security architecture protecting you from third-party threats, see the{" "}
          <Link
            href="/transparency"
            className="text-primary underline-offset-2 hover:underline"
          >
            Transparency &amp; Security
          </Link>{" "}
          page.
        </Body>
      </Section>

      <Section title="Blocklist Updates">
        <Body>
          To keep the ad-blocking engine effective, the app periodically fetches
          updated filter rules from a static, public repository. This request
          contains no user identifiers, device IDs, or browsing history. It is a
          simple, anonymous file download. The filter lists are
          cryptographically signed, so they cannot be tampered with in transit.
        </Body>
      </Section>

      <Section title="Your Rights">
        <Body>
          Because FilmSnaps collects no personal data about you, there is
          nothing for us to access, correct, or delete on a server. All of your
          data is local to your device and is entirely under your control — you
          can review, clear, or remove it at any time through the app&apos;s
          settings or by uninstalling the app.
        </Body>
        <Body extraMargin>
          If you are located in a region covered by privacy laws such as the EU
          General Data Protection Regulation (GDPR) or the California Consumer
          Privacy Act (CCPA), those laws generally apply to organizations that
          collect and process personal information. Since we collect none, we
          incur no data-handling obligations under them. Your practical rights
          reduce to the local-data control described above.
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
