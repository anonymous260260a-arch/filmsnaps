/**
 * Cloudflare Turnstile widget integration.
 * Invisible CAPTCHA-free bot detection.
 */

let turnstileLoaded = false;

function ensureTurnstileScript(): Promise<void> {
  if (turnstileLoaded) return Promise.resolve();
  return new Promise<void>((resolve) => {
    if (typeof window === "undefined") return resolve();
    if ((window as any).turnstile) {
      turnstileLoaded = true;
      return resolve();
    }
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    script.async = true;
    script.defer = true;
    script.onload = () => {
      turnstileLoaded = true;
      resolve();
    };
    document.head.appendChild(script);
  });
}

/**
 * Get a Turnstile token by rendering an invisible widget.
 * Returns null if offline or Turnstile unavailable.
 */
export async function getTurnstileToken(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  if (!navigator.onLine) return null;

  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  if (!siteKey || siteKey === "your-turnstile-site-key") {
    // Dev mode — no Turnstile configured
    console.warn("[Turnstile] No site key configured — skipping");
    return "dev-skip-token";
  }

  try {
    await ensureTurnstileScript();

    // Wait for turnstile to be ready
    await new Promise<void>((resolve) => {
      const check = () => {
        if ((window as any).turnstile) resolve();
        else setTimeout(check, 100);
      };
      check();
    });

    return new Promise<string | null>((resolve) => {
      // Create a temporary container for the widget
      const container = document.createElement("div");
      container.style.display = "none";
      document.body.appendChild(container);

      (window as any).turnstile.render(container, {
        sitekey: siteKey,
        callback: (token: string) => {
          document.body.removeChild(container);
          resolve(token);
        },
        "expired-callback": () => {
          document.body.removeChild(container);
          resolve(null);
        },
        "error-callback": () => {
          document.body.removeChild(container);
          resolve(null);
        },
        theme: "dark",
      });

      // Timeout after 10s
      setTimeout(() => {
        if (document.body.contains(container)) {
          document.body.removeChild(container);
          resolve(null);
        }
      }, 10000);
    });
  } catch (err) {
    console.warn("[Turnstile] Error getting token:", err);
    return null;
  }
}
