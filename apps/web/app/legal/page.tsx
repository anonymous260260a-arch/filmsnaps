import { Scale } from "lucide-react";
import { LegalPageShell } from "@/components/legal/LegalPageShell";

export const metadata = {
  title: "Legal & DMCA",
  description:
    "FilmSnaps Legal & Disclaimer — content notice, no-affiliation statement, user responsibility, and warranty disclaimer.",
  alternates: {
    canonical: "https://filmsnap-pro.netlify.app/legal",
  },
};

export default function LegalPage() {
  return (
    <LegalPageShell
      title="Legal & DMCA"
      subtitle="Terms of use, copyright notices, and liability disclaimers."
      icon={<Scale className="h-10 w-10 text-primary" strokeWidth={1.5} />}
    >
      <div className="space-y-8">
        <p className="text-sm font-medium text-faint">
          Last updated: August 2026
        </p>

        <Section title="The Architecture of FilmSnaps">
          <Body>
            FilmSnaps operates strictly as a{" "}
            <Bold>client-side privacy interface</Bold>. The application queries
            public metadata databases (such as TMDB) to display titles,
            summaries, and posters. When you choose to watch a title, the app
            passes the public metadata ID to independent, third-party embed
            providers.
          </Body>
          <Body>
            FilmSnaps acts solely as a bridge connecting your device to these
            external sources while stripping away their malicious advertising.
            We do not scrape, index, route, or store any media files.
          </Body>
        </Section>

        <Section title="No Hosting or Distribution">
          <Body>
            FilmSnaps does <Bold>not</Bold> host, upload, store, or distribute
            any video content, files, or media. All content accessed through
            this application is hosted and streamed by third-party services that
            are completely independent of, and unaffiliated with, FilmSnaps. We
            have no control over the content these third parties choose to make
            available on their servers.
          </Body>
        </Section>

        <Section title="DMCA & Copyright Infringement">
          <Body>
            FilmSnaps respects the intellectual property rights of others and
            expects users to do the same. Because FilmSnaps does not host or
            distribute any content,{" "}
            <Bold>we cannot remove or disable access to media files</Bold>.
          </Body>
          <Body>
            If you are a copyright owner and believe your content is being
            hosted or distributed without authorization, you must direct your
            DMCA takedown notices to the actual hosting providers or the search
            engines that index them. FilmSnaps is not a hosting provider and is
            not the appropriate recipient for DMCA notices regarding third-party
            media.
          </Body>
        </Section>

        <Section title="User Responsibility & Local Laws">
          <Body>
            By using FilmSnaps, you acknowledge and agree that you are solely
            responsible for your use of the application. You agree to:
          </Body>
          <Bullet text="Ensure your use of the app complies with all local, national, and international copyright laws." />
          <Bullet text="Only access and stream content that is in the public domain, or content for which you have explicit legal permission or a valid license." />
          <Bullet text="Assume full liability for any copyright infringement resulting from your use of third-party streaming providers." />
        </Section>

        <Section title="Disclaimer of Warranties">
          <Body>
            This software is provided on an{" "}
            <Bold>&quot;as is&quot; and &quot;as available&quot;</Bold> basis
            without warranty of any kind, either express or implied, including
            but not limited to the implied warranties of merchantability,
            fitness for a particular purpose, or non-infringement. The
            developers and contributors are not responsible for any damages,
            data loss, or legal issues that may arise from the use of this
            application or the third-party services it connects to.
          </Body>
        </Section>

        <Section title="Abuse Reports">
          <Body>
            While we cannot remove content from third-party servers, if you
            discover that a specific third-party provider integrated into our
            app is exclusively dedicated to hosting malicious software or
            illegal content, you may report the provider integration to{" "}
            <Bold>abuse@filmsnaps.app</Bold>. We reserve the right to remove
            access to specific third-party APIs at our sole discretion.
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
