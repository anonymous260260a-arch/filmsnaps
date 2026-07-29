import { Bug, Lightbulb, Route, History, HelpCircle } from "lucide-react";
import { HomeCard } from "@/components/HomeCard";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function HomePage() {
  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">FilmSnaps Feedback</h1>
            <p className="text-xs text-muted-foreground hidden sm:block">
              Help us make FilmSnaps better
            </p>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        {/* Hero */}
        <section className="text-center mb-10">
          <h2 className="text-2xl md:text-3xl font-bold mb-3">
            How can we help?
          </h2>
          <p className="text-muted-foreground max-w-lg mx-auto">
            Found a bug? Have an idea? Want to see what is coming next? You are
            in the right place.
          </p>
        </section>

        {/* Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <HomeCard
            title="Report a Bug"
            description="Something not working right? Let us know."
            icon={Bug}
            href="/report-bug"
            accentColor="#ef4444"
          />
          <HomeCard
            title="Request a Feature"
            description="Have an idea? Share it with the community."
            icon={Lightbulb}
            href="/feature-request"
            accentColor="#3b82f6"
          />
          <HomeCard
            title="Roadmap"
            description="See what we are working on and what is planned."
            icon={Route}
            href="/roadmap"
            accentColor="#8b5cf6"
          />
          <HomeCard
            title="Changelog"
            description="Track updates, fixes, and new features."
            icon={History}
            href="/changelog"
          />
          <HomeCard
            title="FAQ"
            description="Common questions and answers about FilmSnaps."
            icon={HelpCircle}
            href="/faq"
          />
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t mt-12">
        <div className="max-w-5xl mx-auto px-4 py-6 text-center text-xs text-muted-foreground">
          <p>FilmSnaps Feedback Portal — Your voice helps shape the app.</p>
        </div>
      </footer>
    </div>
  );
}
