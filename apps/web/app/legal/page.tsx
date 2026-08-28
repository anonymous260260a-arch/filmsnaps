import { Scale } from "lucide-react";
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
      <p className="mb-2 text-sm font-medium text-faint">
        Last updated: August 2026
      </p>

      <Section title="Nature of the Software">
        <Body>
          FilmSnaps is a <Bold>client-side privacy interface</Bold> provided for
          educational and personal-use purposes. The application queries public
          metadata databases (such as TMDB) to display titles, summaries, and
          posters. When you choose to watch a title, the app passes the public
          metadata ID to independent, third-party embed providers — the same
          pages you could open in any web browser yourself.
        </Body>
        <Body extraMargin>
          FilmSnaps is <Bold>open source</Bold>. The full source code is
          publicly available at{" "}
          <Link
            href={GITHUB}
            className="text-primary underline-offset-2 hover:underline"
          >
            {GITHUB}
          </Link>
          , so anyone can inspect exactly how it works. We do not scrape, index,
          route, or store any media files. We act solely as a bridge between
          your device and external sources while stripping away their malicious
          advertising.
        </Body>
      </Section>

      <Section title="No Content Hosting">
        <Body>
          FilmSnaps does <Bold>not</Bold> host, upload, store, or distribute any
          video content, files, or media. All content accessed through this
          application is hosted and streamed by third-party services that are
          completely independent of, and unaffiliated with, FilmSnaps. We have
          no control over the content these third parties choose to make
          available on their servers, and we do not curate, review, or endorse
          it.
        </Body>
      </Section>

      <Section title="DMCA & Copyright">
        <Body>
          FilmSnaps respects the intellectual property rights of others and
          expects users to do the same. Because FilmSnaps does not host or
          distribute any content,{" "}
          <Bold>we cannot remove or disable access to media files</Bold>. We are
          not a search engine, host, or distributor — we are a client-side
          interface.
        </Body>
        <Body extraMargin>
          If you are a copyright owner and believe your content is being hosted
          or distributed without authorization, please follow these steps:
        </Body>
        <Bullet text="Identify the actual hosting provider from the embed URL the content is served from." />
        <Bullet text="Send your DMCA takedown notice directly to that hosting provider, following their published process." />
        <Bullet text="If the content remains indexed by a search engine, submit a removal request to that search engine." />
        <Body extraMargin>
          FilmSnaps is not the appropriate recipient for DMCA notices regarding
          third-party media. Direct all such notices to the parties above.
        </Body>
      </Section>

      <Section title="User Responsibility">
        <Body>
          By using FilmSnaps, you acknowledge and agree that you are solely
          responsible for your use of the application. You agree to:
        </Body>
        <Bullet text="Ensure your use of the app complies with all local, national, and international copyright laws." />
        <Bullet text="Only access and stream content that is in the public domain, or content for which you have explicit legal permission or a valid license." />
        <Bullet text="Assume full liability for any copyright infringement resulting from your use of third-party streaming providers." />
        <Body extraMargin>
          You agree to <Bold>indemnify and hold harmless</Bold> the developers,
          contributors, and distributors of FilmSnaps from any claims, damages,
          losses, liabilities, costs, or legal expenses (including reasonable
          attorneys&apos; fees) arising out of or related to your use of the
          application or your access to third-party content.
        </Body>
      </Section>

      <Section title="Disclaimer of Warranties">
        <Body>
          This software is provided on an{" "}
          <Bold>&quot;as is&quot; and &quot;as available&quot;</Bold> basis
          without warranty of any kind, either express or implied, including but
          not limited to the implied warranties of merchantability, fitness for
          a particular purpose, or non-infringement. The developers and
          contributors are not responsible for any damages, data loss, or legal
          issues that may arise from the use of this application or the
          third-party services it connects to.
        </Body>
      </Section>

      <Section title="Limitation of Liability">
        <Body>
          To the maximum extent permitted by applicable law, in no event shall
          the developers or contributors of FilmSnaps be liable for any
          indirect, incidental, special, consequential, or punitive damages —
          including, without limitation, loss of profits, loss of data, loss of
          goodwill, or business interruption — arising out of or in connection
          with your use of, or inability to use, the application, even if
          advised of the possibility of such damages.
        </Body>
      </Section>

      <Section title="Open Source License">
        <Body>
          FilmSnaps is released under the{" "}
          <Bold>GNU General Public License v3.0 (GPL-3.0)</Bold> — a free,
          copyleft license. You are free to use, study, modify, and redistribute
          the software, provided that any distribution of the software or a
          derivative work is also made available under the GPL-3.0 and that the
          complete corresponding source code is provided. The full license text
          is available in the repository at{" "}
          <Link
            href={GITHUB}
            className="text-primary underline-offset-2 hover:underline"
          >
            {GITHUB}
          </Link>
          . For details on the security architecture this license protects, see
          the{" "}
          <Link
            href="/transparency"
            className="text-primary underline-offset-2 hover:underline"
          >
            Transparency &amp; Security
          </Link>{" "}
          page.
        </Body>
      </Section>

      <Section title="Abuse Reports">
        <Body>
          While we cannot remove content from third-party servers, if you
          discover that a specific third-party provider integrated into our app
          is exclusively dedicated to hosting malicious software or illegal
          content, you may report the provider integration to{" "}
          <Bold>abuse@filmsnaps.app</Bold>. We reserve the right to remove
          access to specific third-party APIs at our sole discretion.
        </Body>
        <Body extraMargin>
          Please note that we do not review or act on copyright complaints —
          those must be directed to the actual hosting providers as described in
          the DMCA section above.
        </Body>
      </Section>

      <Section title="Governing Law">
        <Body>
          FilmSnaps makes no representation that the application is appropriate
          or lawful in every country or territory.{" "}
          <Bold>
            You are responsible for complying with the laws of your own country
            or jurisdiction
          </Bold>
          . If any provision of these terms is held to be unenforceable, the
          remaining provisions shall remain in full force and effect.
        </Body>
      </Section>

      <Section title="Changes to These Terms">
        <Body>
          We may update these terms from time to time. When we do, we will
          update the &quot;Last updated&quot; date above and note the change in
          our public changelog. Your continued use of FilmSnaps after any
          changes constitutes acceptance of the updated terms.
        </Body>
      </Section>
    </LegalPageShell>
  );
}
