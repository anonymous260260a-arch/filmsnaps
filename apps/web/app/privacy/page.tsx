import { ShieldCheck } from "lucide-react";
import { LegalPageShell } from "@/components/legal/LegalPageShell";

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
      <div className="space-y-8">
        <p className="text-sm font-medium text-faint">
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

        <Section title="The Bridge Architecture">
          <Body>
            FilmSnaps operates strictly as a client-side bridge. To display
            movie titles, posters, and summaries, the app queries public
            metadata databases (such as TMDB). When you choose to watch a title,
            the app passes the public metadata ID to independent, third-party
            embed providers.
          </Body>
          <Body>
            Because we act only as a conduit, your streaming requests are sent
            directly from your device to the third-party provider. FilmSnaps
            servers never see, route, or log the content you request.
          </Body>
        </Section>

        <Section title="What Stays Locally on Your Device">
          <Body>
            The following data is stored exclusively in your device's local
            storage or file system:
          </Body>
          <Bullet text="Watch history and progress (to enable the 'Continue Watching' feature)" />
          <Bullet text="Your personal watchlist and bookmarked titles" />
          <Bullet text="App settings (preferred providers, subtitle defaults, UI preferences)" />
          <Bullet text="Offline downloads (saved to your device's shared media folders)" />
        </Section>

        <Section title="Third-Party Providers & IP Addresses">
          <Body>
            When you stream content, your device connects directly to
            third-party content servers. These independent providers may log
            your IP address and request details as part of their standard web
            server operations. FilmSnaps has no control over, and assumes no
            responsibility for, the data practices or privacy policies of these
            third-party hosts. We strongly recommend using a reputable VPN if
            you wish to mask your IP address from streaming providers.
          </Body>
        </Section>

        <Section title="Zero Telemetry & No Analytics">
          <Body>
            FilmSnaps does not include any analytics SDKs, tracking pixels,
            crash reporters, or third-party monitoring tools. We do not know
            what you watch, when you watch it, or how long you use the app.
            There are no advertisements, and therefore no ad-tracking networks
            embedded in our codebase.
          </Body>
        </Section>

        <Section title="Blocklist Updates">
          <Body>
            To keep the ad-blocking engine effective, the app periodically
            fetches updated filter rules from a static, public repository. This
            request contains no user identifiers, device IDs, or browsing
            history. It is a simple, anonymous file download.
          </Body>
        </Section>

        <Section title="Children's Privacy">
          <Body>
            FilmSnaps is not directed at children under 13. We do not knowingly
            collect any information from anyone, let alone children. If you
            believe a child has interacted with our services, please contact us.
          </Body>
        </Section>

        <Section title="Contact">
          <Body>
            If you have questions about this privacy policy or our security
            architecture, please reach out via email at{" "}
            <Bold>privacy@filmsnaps.app</Bold>.
          </Body>
        </Section>
      </div>
    </LegalPageShell>
  );
}

// ── Sub-components ──

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-lg font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

function Body({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-base leading-7 text-muted-foreground mb-4">{children}</p>
  );
}

function Bold({ children }: { children: React.ReactNode }) {
  return <span className="font-semibold text-foreground">{children}</span>;
}

function Bullet({ text }: { text: string }) {
  return (
    <p className="mt-2 flex items-start gap-3 text-base leading-7 text-muted-foreground">
      <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
      <span>{text}</span>
    </p>
  );
}
