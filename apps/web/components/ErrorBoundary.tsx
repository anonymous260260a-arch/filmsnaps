"use client";

import { Component, ReactNode } from "react";
import { AlertTriangle, Minus, RefreshCw, Square, X } from "lucide-react";
import { GlassButton } from "@/components/ui/glass-button";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Error caught by boundary:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // The desktop shell is frameless — the ONLY close/minimize affordance
      // is the GlobalTopBar, which a full-screen fallback replaces. The
      // fallback must keep a minimal window-controls strip or the user is
      // trapped in the error screen with no way to quit the app.
      const isDesktop =
        typeof window !== "undefined" &&
        !!(window as unknown as { electronAPI?: { isDesktop?: boolean } })
          .electronAPI?.isDesktop;

      return (
        <div className="min-h-screen flex flex-col bg-background">
          {isDesktop && (
            <div
              className="flex h-12 shrink-0 select-none items-center justify-end border-b border-white/[0.07] bg-surface"
              style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
            >
              <div
                className="flex self-stretch items-stretch"
                style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
              >
                <button
                  onClick={() =>
                    (
                      window as unknown as {
                        electronAPI?: { minimize?: () => void };
                      }
                    ).electronAPI?.minimize?.()
                  }
                  className="flex w-12 cursor-pointer items-center justify-center text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
                  aria-label="Minimize"
                >
                  <Minus size={14} strokeWidth={1.5} />
                </button>
                <button
                  onClick={() =>
                    (
                      window as unknown as {
                        electronAPI?: { maximize?: () => void };
                      }
                    ).electronAPI?.maximize?.()
                  }
                  className="flex w-12 cursor-pointer items-center justify-center text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
                  aria-label="Maximize"
                >
                  <Square size={11} strokeWidth={1.5} />
                </button>
                <button
                  onClick={() =>
                    (
                      window as unknown as {
                        electronAPI?: { close?: () => void };
                      }
                    ).electronAPI?.close?.()
                  }
                  className="flex w-12 cursor-pointer items-center justify-center text-muted-foreground transition-colors hover:text-white hover:bg-[#e81123]"
                  aria-label="Close"
                >
                  <X size={15} strokeWidth={1.5} />
                </button>
              </div>
            </div>
          )}
          <div className="flex-1 flex items-center justify-center p-4">
            <div className="max-w-md w-full rounded-2xl border border-white/[0.06] glass-light p-10 text-center shadow-2xl">
              <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-5">
                <AlertTriangle className="h-8 w-8 text-red-400" />
              </div>
              <h1 className="text-xl font-bold text-foreground mb-2">
                Something went wrong
              </h1>
              <p className="text-sm text-muted-foreground mb-8 leading-relaxed">
                Error:{" "}
                {this.state.error?.message ||
                  "An unexpected error occurred. Please try reloading the page."}
              </p>
              <GlassButton
                onClick={() => {
                  this.setState({ hasError: false, error: undefined });
                  window.location.reload();
                }}
                className="gap-2"
              >
                <RefreshCw className="h-4 w-4" />
                Reload Page
              </GlassButton>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
