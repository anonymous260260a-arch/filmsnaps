import Link from "next/link";
import { Film, Clapperboard } from "lucide-react";
import { LegalFooter } from "@/components/legal/LegalFooter";

export const metadata = {
  title: "Page Not Found",
  robots: {
    index: false,
    follow: false,
  },
};

export default function NotFound() {
  return (
    <div className="min-h-screen bg-[#070708] flex flex-col">
      <div className="flex-1 flex items-center justify-center px-6 py-16">
        <div className="max-w-md w-full text-center">
          <div className="relative mx-auto mb-8 w-24 h-24">
            <div className="absolute inset-0 rounded-2xl bg-[#D4A237]/10 ring-1 ring-[#D4A237]/20 flex items-center justify-center">
              <Film className="w-10 h-10 text-[#D4A237]" />
            </div>
            <div className="absolute -top-2 -right-3 bg-[#070708] rounded-full p-1 ring-1 ring-[#D4A237]/30">
              <Clapperboard className="w-5 h-5 text-[#D4A237]" />
            </div>
          </div>

          <h1
            className="text-4xl font-bold text-[#F4F4F5] mb-3"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Page Not Found
          </h1>
          <p className="text-[#A1A1AA] text-sm leading-relaxed mb-8">
            The page you&apos;re looking for doesn&apos;t exist or was moved.
            Let&apos;s get you back to the good stuff — trending movies and TV
            shows.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/movie"
              className="w-full sm:w-auto bg-[#D4A237] hover:brightness-105 active:scale-[0.98] transition-all rounded-xl py-3 px-6 text-[#070708] font-bold text-sm"
            >
              Browse Movies
            </Link>
            <Link
              href="/"
              className="w-full sm:w-auto bg-[#16161A] hover:bg-[#1E1E24] active:scale-[0.98] transition-all rounded-xl py-3 px-6 text-[#F4F4F5] font-bold text-sm ring-1 ring-white/10"
            >
              Go Home
            </Link>
          </div>
        </div>
      </div>
      <LegalFooter />
    </div>
  );
}
