import { cn } from "@/lib/utils";

export function SkeletonCard() {
  return (
    <div className="skeleton">
      <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-secondary">
        <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent" />
      </div>
      <div className="mt-2.5 space-y-2 px-0.5">
        <div className="h-4 bg-secondary rounded w-3/4"></div>
        <div className="h-3 bg-secondary rounded w-1/2"></div>
      </div>
    </div>
  );
}

export function SkeletonHero() {
  return (
    <div className="relative w-full h-[90vh] min-h-[600px] overflow-hidden skeleton">
      <div className="absolute inset-0 bg-secondary"></div>
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-transparent" />
      <div className="absolute inset-0 gradient-hero-text" />

      <div className="absolute inset-0 flex items-center">
        <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-7 w-16 bg-secondary rounded-full"></div>
              <div className="h-5 w-12 bg-secondary rounded"></div>
              <div className="h-5 w-20 bg-secondary rounded"></div>
            </div>
            <div className="h-16 bg-secondary rounded w-3/4 mb-6"></div>
            <div className="space-y-3 mb-8">
              <div className="h-4 bg-secondary rounded w-full"></div>
              <div className="h-4 bg-secondary rounded w-5/6"></div>
              <div className="h-4 bg-secondary rounded w-4/6"></div>
            </div>
            <div className="flex gap-3">
              <div className="h-12 w-36 bg-secondary rounded-xl"></div>
              <div className="h-12 w-28 bg-secondary rounded-xl"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function SkeletonGrid({ count = 20 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

export function SkeletonRow() {
  return (
    <div className="relative group">
      <div className="flex items-center justify-between px-5 sm:px-6 lg:px-8 mb-4">
        <h2 className="h-8 bg-secondary rounded w-1/4 skeleton"></h2>
      </div>
      <div className="relative px-5 sm:px-6 lg:px-8">
        <div className="pb-10">
          <div className="grid grid-flow-col auto-cols-max gap-4 overflow-hidden">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="w-[200px]">
                <SkeletonCard />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function SkeletonDetail() {
  return (
    <div className="min-h-screen bg-background">
      {/* ── Phone variant (mirrors the sm:hidden detail layout) ── */}
      <div className="sm:hidden">
        <div className="w-full h-[42vh] max-h-[350px] skeleton" />
        <div className="relative z-10 -mt-[52px] px-4">
          <div className="flex items-center">
            <div className="h-[156px] w-[104px] shrink-0 rounded-xl skeleton" />
            <div className="ml-[18px] min-w-0 flex-1 self-center">
              <div className="h-5 w-3/4 rounded skeleton mb-2" />
              <div className="h-5 w-1/2 rounded skeleton mb-2" />
              <div className="flex gap-1.5">
                <div className="h-[18px] w-11 rounded-md skeleton" />
                <div className="h-[18px] w-9 rounded-md skeleton" />
                <div className="h-[18px] w-12 rounded-md skeleton" />
              </div>
            </div>
          </div>
          <div className="mt-[18px] space-y-3">
            <div className="h-12 w-full rounded-xl skeleton" />
            <div className="flex gap-2.5">
              <div className="h-10 flex-1 rounded-xl skeleton" />
              <div className="h-10 flex-1 rounded-xl skeleton" />
            </div>
          </div>
          <div className="mt-6 space-y-2.5">
            <div className="h-4 w-24 rounded skeleton" />
            <div className="h-3.5 w-full rounded skeleton" />
            <div className="h-3.5 w-11/12 rounded skeleton" />
            <div className="h-3.5 w-3/4 rounded skeleton" />
          </div>
          <div className="mt-6 flex gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="shrink-0 w-20 aspect-[2/3] rounded-lg skeleton"
              />
            ))}
          </div>
        </div>
      </div>

      {/* ── Desktop / tablet variant (mirrors the hidden sm:block layout) ── */}
      <div className="hidden sm:block">
        <div className="detail-top pt-16">
          <div className="relative">
            <div className="absolute inset-0 h-[60vh] skeleton" />
            <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
              <div className="h-9 w-36 rounded-lg skeleton mb-6" />
              <div className="grid lg:grid-cols-3 gap-8 lg:gap-12">
                <div className="lg:col-span-1">
                  <div className="aspect-[2/3] rounded-2xl skeleton" />
                </div>
                <div className="lg:col-span-2 space-y-6">
                  <div>
                    <div className="h-12 w-2/3 rounded skeleton" />
                    <div className="flex items-center gap-3 mt-4">
                      <div className="h-8 w-16 rounded-full skeleton" />
                      <div className="h-5 w-20 rounded skeleton" />
                      <div className="h-5 w-28 rounded skeleton" />
                    </div>
                    <div className="flex flex-wrap gap-2 mt-4">
                      {Array.from({ length: 4 }).map((_, i) => (
                        <div
                          key={i}
                          className="h-7 w-20 rounded-full skeleton"
                        />
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="h-[46px] w-44 rounded-full skeleton" />
                    <div className="h-[46px] w-32 rounded-full skeleton" />
                    <div className="h-[46px] w-28 rounded-full skeleton" />
                  </div>
                  <div className="space-y-2.5">
                    <div className="h-3.5 w-24 rounded skeleton" />
                    <div className="h-4 w-full max-w-prose rounded skeleton" />
                    <div className="h-4 w-full max-w-prose rounded skeleton" />
                    <div className="h-4 w-2/3 max-w-prose rounded skeleton" />
                  </div>
                  <div className="pt-4 flex gap-3">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div
                        key={i}
                        className="shrink-0 w-24 aspect-[2/3] rounded-lg skeleton"
                      />
                    ))}
                  </div>
                  <div className="pt-4">
                    <div className="aspect-video max-w-2xl rounded-2xl skeleton" />
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="px-5 sm:px-6 lg:px-8 pb-14">
            <SkeletonRow />
          </div>
        </div>
      </div>
    </div>
  );
}

export function SkeletonPlayer() {
  return (
    <div className="w-full aspect-video bg-secondary rounded-xl skeleton" />
  );
}

export function SkeletonPerson() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-6">
        {/* Back row (mirrors the Back button) */}
        <div className="h-4 w-16 rounded skeleton mb-6" />

        {/* Centered profile — avatar, name, department, dates */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-28 h-28 rounded-full skeleton mb-4" />
          <div className="h-7 w-44 rounded skeleton" />
          <div className="h-4 w-24 rounded skeleton mt-2" />
          <div className="h-3.5 w-40 rounded skeleton mt-2" />
          <div className="h-3.5 w-32 rounded skeleton mt-1.5" />
        </div>

        {/* Biography */}
        <div className="mb-8">
          <div className="h-5 w-28 rounded skeleton mb-3" />
          <div className="space-y-2.5">
            <div className="h-3.5 w-full rounded skeleton" />
            <div className="h-3.5 w-full rounded skeleton" />
            <div className="h-3.5 w-11/12 rounded skeleton" />
            <div className="h-3.5 w-2/3 rounded skeleton" />
          </div>
        </div>

        {/* Credits — Movies + TV Shows rows (mirrors the credit carousels) */}
        <SkeletonCreditRow />
        <SkeletonCreditRow />

        <div className="h-12" />
      </div>
    </div>
  );
}

function SkeletonCreditRow() {
  return (
    <div className="mb-8">
      <div className="h-5 w-24 rounded skeleton mb-4" />
      <div className="flex gap-3 overflow-hidden pb-2">
        {Array.from({ length: 9 }).map((_, i) => (
          <div key={i} className="shrink-0 w-24">
            <div className="aspect-[2/3] rounded-lg skeleton mb-1.5" />
            <div className="h-3 w-3/4 rounded skeleton" />
            <div className="h-2.5 w-1/2 rounded skeleton mt-1" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function SkeletonWatch() {
  return (
    <>
      {/* ══════════════════════════════════════════════════════════════
          <1280px — WatchClient's web layout: top bar + player zone +
          below-video hub card (MobilePlayerZone + PlayerHub parity).
          ══════════════════════════════════════════════════════════════ */}
      <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-background xl:hidden">
        {/* Top bar — back circle, title block, audio + server pills */}
        <header className="shrink-0 flex items-center justify-between gap-2.5 border-b border-white/[0.06] px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <div className="h-8 w-8 shrink-0 rounded-full skeleton" />
            <div className="hidden sm:block min-w-0 space-y-1.5">
              <div className="h-3 w-28 rounded skeleton" />
              <div className="h-2 w-16 rounded skeleton" />
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <div className="h-8 w-9 rounded-full skeleton" />
            <div className="h-8 w-20 rounded-full skeleton" />
          </div>
        </header>

        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {/* Player zone — full-bleed on phone, framed 16:9 card on sm+
              (same sizing contract as MobilePlayerZone) */}
          <div className="w-full sm:px-3">
            <div className="relative w-full h-[38vh] min-h-[245px] max-h-[46vh] sm:h-auto sm:aspect-video sm:rounded-2xl skeleton" />
          </div>

          {/* Below-video hub — tab dock, season bar, episode rows, pinned
              prev/next (mirrors PlayerHub's cohesive episode card) */}
          <section className="flex min-h-0 flex-1 flex-col overflow-hidden p-2.5">
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[20px] border border-white/[0.06] bg-elevated p-2.5">
              <div className="flex shrink-0 items-center gap-2 px-1 pt-1.5">
                <div className="h-9 w-24 rounded-full skeleton" />
                <div className="h-9 w-24 rounded-full skeleton" />
              </div>
              <div className="mt-2.5 h-px shrink-0 bg-subtle" />
              <div className="mt-2.5 flex shrink-0 items-center gap-2 px-1">
                <div className="h-9 w-36 rounded-lg skeleton" />
                <div className="h-9 w-14 rounded-lg skeleton" />
              </div>
              <div className="mt-2.5 min-h-0 flex-1 space-y-2 overflow-hidden px-1">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2.5 rounded-[14px] border border-white/[0.06] p-3"
                  >
                    <div className="h-[50px] w-[88px] shrink-0 rounded-lg skeleton" />
                    <div className="min-w-0 flex-1">
                      <div className="h-2.5 w-1/4 rounded skeleton" />
                      <div className="mt-1.5 h-3.5 w-2/3 rounded skeleton" />
                      <div className="mt-1.5 h-2.5 w-1/3 rounded skeleton" />
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex shrink-0 gap-2 px-1 pb-0.5">
                <div className="h-10 flex-1 rounded-xl skeleton" />
                <div className="h-10 flex-1 rounded-xl skeleton" />
              </div>
            </div>
          </section>
        </main>
      </div>

      {/* ══════════════════════════════════════════════════════════════
          ≥1280px — DesktopWatchLayout's two-zone layout: top controls
          (menu + server pill + title | prev/next + theater), video area
          + resize divider + episode sidebar (340px default width).
          ══════════════════════════════════════════════════════════════ */}
      <div className="hidden h-[calc(100vh-48px)] w-full flex-col overflow-hidden bg-background px-4 pt-6 pb-3 lg:px-6 xl:flex">
        {/* Top controls bar */}
        <div className="mb-2 flex shrink-0 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <div className="h-8 w-8 shrink-0 rounded-xl skeleton" />
            <div className="h-9 w-[118px] shrink-0 rounded-xl skeleton" />
            <div className="ml-1 min-w-0 space-y-1.5">
              <div className="h-5 w-44 rounded skeleton" />
              <div className="h-2.5 w-24 rounded skeleton" />
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div className="h-9 w-32 rounded-xl skeleton" />
            <div className="h-9 w-[88px] rounded-xl skeleton" />
          </div>
        </div>

        {/* Flex row: video zone + divider + episode sidebar */}
        <div className="flex min-h-0 flex-1 items-stretch">
          <div className="min-w-0 flex-1 rounded-2xl bg-black/40 skeleton" />

          <div className="flex w-3 shrink-0 items-center justify-center">
            <div className="h-12 w-1 rounded-full bg-white/10" />
          </div>

          <div className="w-[340px] shrink-0 overflow-hidden rounded-2xl border border-white/[0.08] bg-surface p-3">
            <div className="flex items-center justify-between px-1 pb-2">
              <div className="h-5 w-28 rounded skeleton" />
              <div className="h-7 w-7 rounded-lg skeleton" />
            </div>
            <div className="flex gap-2 px-1 pb-2">
              <div className="h-8 w-24 rounded-full skeleton" />
              <div className="h-8 w-24 rounded-full skeleton" />
              <div className="h-8 w-24 rounded-full skeleton" />
            </div>
            <div className="space-y-2 px-1">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2.5 rounded-xl border border-white/[0.06] p-2"
                >
                  <div className="h-[50px] w-[88px] shrink-0 rounded-lg skeleton" />
                  <div className="min-w-0 flex-1">
                    <div className="h-2.5 w-1/4 rounded skeleton" />
                    <div className="mt-1.5 h-3.5 w-2/3 rounded skeleton" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
