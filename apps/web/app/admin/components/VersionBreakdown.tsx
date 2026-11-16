"use client";

import React from "react";
import type { Dashboard } from "./types";
import { fmtInt } from "./utils";
import { Section, Card, NoData } from "./shared";

const CLIENT_LABELS: Record<string, string> = {
  "mobile-android": "Android",
  "mobile-ios": "iOS",
  desktop: "Desktop",
  web: "Web",
  ssr: "Server (SSR)",
  unknown: "Unknown / old builds",
};

function clientLabel(client: string): string {
  return CLIENT_LABELS[client] ?? client;
}

export function VersionBreakdown({ cur }: { cur: Dashboard | null }) {
  if (!cur) return null;
  const versions = cur.versions;
  const rows = versions?.rows ?? [];

  const mobileRows = rows.filter((r) => r.client.startsWith("mobile"));
  const unknownRequests = rows
    .filter((r) => r.client === "unknown" || r.appVersion === "(none)")
    .reduce((acc, r) => acc + r.requests, 0);
  const totalRequests = rows.reduce((acc, r) => acc + r.requests, 0);

  return (
    <Section
      icon="📱"
      title="App Versions"
      question="Which app builds are hitting the API, and how many installs are on pre-telemetry builds (no version header)."
    >
      <Card
        title="API requests by client + version"
        hint={
          versions
            ? `sampled 1-in-${versions.sampleOneIn}, scaled to estimates`
            : undefined
        }
        wide
      >
        {rows.length === 0 ? (
          <NoData message="No version data yet — deploy the worker with the Analytics Engine binding first" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left text-white/[0.4] border-b border-white/[0.07]">
                  <th className="py-2 pr-4 font-semibold uppercase text-[10.5px] tracking-wider">
                    Client
                  </th>
                  <th className="py-2 pr-4 font-semibold uppercase text-[10.5px] tracking-wider">
                    Version
                  </th>
                  <th className="py-2 pr-4 font-semibold uppercase text-[10.5px] tracking-wider text-right">
                    Requests (est.)
                  </th>
                  <th className="py-2 pr-4 font-semibold uppercase text-[10.5px] tracking-wider text-right">
                    Installs (est.)
                  </th>
                  <th className="py-2 font-semibold uppercase text-[10.5px] tracking-wider text-right">
                    Share
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const isUnknown =
                    r.client === "unknown" || r.appVersion === "(none)";
                  return (
                    <tr
                      key={`${r.client}:${r.appVersion}`}
                      className="border-b border-white/[0.04] last:border-0"
                    >
                      <td className="py-2 pr-4 text-white/80">
                        {clientLabel(r.client)}
                      </td>
                      <td className="py-2 pr-4 font-mono">
                        {isUnknown ? (
                          <span className="text-amber-400 font-semibold">
                            {r.appVersion === "(none)"
                              ? "(no version)"
                              : r.appVersion}
                          </span>
                        ) : (
                          <span className="text-white/80">{r.appVersion}</span>
                        )}
                        {r.client.startsWith("mobile") &&
                          r.appVersion !== "(none)" && (
                            <span className="ml-2 text-[10px] text-emerald-400/80">
                              OTA-eligible
                            </span>
                          )}
                      </td>
                      <td className="py-2 pr-4 text-right font-mono text-white/80">
                        {fmtInt(r.requests)}
                      </td>
                      <td className="py-2 pr-4 text-right font-mono text-white/80">
                        {r.users > 0 ? fmtInt(r.users) : "—"}
                      </td>
                      <td className="py-2 text-right">
                        {totalRequests > 0 ? (
                          <span
                            className={
                              isUnknown
                                ? "text-amber-400 font-semibold"
                                : "text-white/50"
                            }
                          >
                            {((r.requests / totalRequests) * 100).toFixed(1)}%
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {totalRequests > 0 && (
              <p className="mt-3 text-[11.5px] text-white/[0.4]">
                Old-build traffic (no version header):{" "}
                <span className="text-amber-400 font-semibold">
                  {((unknownRequests / totalRequests) * 100).toFixed(1)}%
                </span>{" "}
                of API requests. Mobile installs on 2.4.0+ are OTA-eligible.
              </p>
            )}
            {mobileRows.length === 0 && rows.length > 0 && (
              <p className="mt-2 text-[11px] text-white/[0.3]">
                No version-tagged mobile traffic yet — appears after the first
                release with the new headers ships.
              </p>
            )}
          </div>
        )}
      </Card>
    </Section>
  );
}
