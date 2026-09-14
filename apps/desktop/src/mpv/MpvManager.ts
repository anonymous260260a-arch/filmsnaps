/**
 * MpvManager — Manages an mpv child process and its JSON IPC over named pipe.
 *
 * mpv runs as a separate process (crash isolation) with `--input-ipc-server`
 * for bidirectional JSON-line communication. Events (playback-restart, pause,
 * seek, etc.) are pushed in real-time — no polling needed.
 *
 * Architecture mirrors VLCManager but replaces HTTP polling with event-driven
 * named pipe IPC, giving sub-frame-latency progress updates.
 */

import { spawn, type ChildProcess, execFileSync } from "child_process";
import { EventEmitter } from "events";
import * as net from "net";
import * as http from "http";
import { join, basename, dirname } from "path";
import { existsSync, readFileSync } from "fs";
import { platform, tmpdir } from "os";
import { net as electronNet } from "electron";
import { media as logMpv } from "../lib/log";

/**
 * mpv's own debug log. Must NOT live inside the app tree: in dev, the web dev
 * server watches the workspace, so every log line mpv wrote triggered a Fast
 * Refresh rebuild — which tore down and respawned mpv mid-playback (a log
 * storm → rebuild → destroy → respawn death spiral). The temp dir is also
 * reliably writable in packaged builds where resources/ may be read-only.
 */
function mpvDebugLogPath(): string {
  return join(tmpdir(), "filmsnaps-mpv-debug.log");
}

// ── Types ─────────────────────────────────────────────────────────

export interface MpvState {
  paused: boolean;
  position: number;
  duration: number;
  volume: number;
  muted: boolean;
  speed: number;
  aid: number;
  sid: number;
  trackList: MpvTrack[];
}

export interface MpvTrack {
  id: number;
  type: "audio" | "video" | "sub";
  /** Language code (e.g. "eng", "jpn") */
  lang?: string;
  /** Human-readable title */
  title?: string;
  /** Codec string (e.g. "aac", "h264") */
  codec?: string;
}

// ── Constants ─────────────────────────────────────────────────────

const IS_WIN = platform() === "win32";
const RECONNECT_DELAY_MS = 100;
const MAX_CONNECT_RETRIES = 50;
const KILL_TIMEOUT_MS = 3000;

// ── Local HTTP proxy ──────────────────────────────────────────────
// Uses Electron's Chromium network stack (electronNet.fetch) so requests match
// Chrome's exact TLS fingerprinting, bypassing Cloudflare bot security / 403 blocks.

const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

function startProxy(): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      let targetUrl = req.url || "";
      if (targetUrl.startsWith("/")) targetUrl = targetUrl.slice(1);
      if (!targetUrl) {
        res.writeHead(400);
        res.end("Missing URL");
        return;
      }

      try {
        if (
          targetUrl.startsWith("http%3A") ||
          targetUrl.startsWith("https%3A")
        ) {
          targetUrl = decodeURIComponent(targetUrl);
        }
      } catch {}

      logMpv.log(`[proxy] ${req.method} ${targetUrl.slice(0, 120)}`);

      // mpv aborts range requests constantly while seeking (read → seek →
      // abort). Each abort MUST cancel the upstream fetch — without this the
      // abandoned Chromium streams leak and exhaust the per-host socket pool
      // (6 for HTTP/1.1), after which every further range request hangs
      // forever and playback stalls with no error anywhere.
      const controller = new AbortController();
      res.on("close", () => {
        if (!res.writableEnded) controller.abort();
      });

      try {
        const fetchHeaders: Record<string, string> = {
          "User-Agent": DESKTOP_UA,
          Accept: "*/*",
          // Never let the network stack negotiate compression — the proxy
          // pipes raw body bytes straight through to mpv.
          "Accept-Encoding": "identity",
        };
        if (req.headers.range) {
          fetchHeaders["Range"] = req.headers.range as string;
        }
        if (req.headers.referer) {
          fetchHeaders["Referer"] = req.headers.referer as string;
        }

        const fetchFn = electronNet?.fetch
          ? electronNet.fetch.bind(electronNet)
          : globalThis.fetch;
        const response = await fetchFn(targetUrl, {
          method: req.method || "GET",
          headers: fetchHeaders,
          redirect: "follow",
          signal: controller.signal,
        });

        const resHeaders: Record<string, string> = {};
        response.headers.forEach((val, key) => {
          const lKey = key.toLowerCase();
          if (lKey !== "content-encoding" && lKey !== "transfer-encoding") {
            resHeaders[key] = val;
          }
        });

        res.writeHead(response.status, resHeaders);

        if (response.body) {
          // Use Readable.fromWeb for efficient pipe-based streaming.
          // This avoids micro-chunked reader.read() which causes TCP packet
          // fragmentation and severe buffering (1s play, 5s stall).
          const { Readable } = await import("stream");
          const readable = Readable.fromWeb(response.body as any);
          readable.pipe(res);
          readable.on("error", (err) => {
            logMpv.error(`[proxy] Stream error: ${err.message}`);
            if (!res.writableEnded) res.end();
          });
        } else {
          res.end();
        }
      } catch (err: any) {
        if (controller.signal.aborted) {
          // Client went away mid-request — normal for range-seeking players
          // (read → seek → abort), not an error.
          return;
        }
        logMpv.error(`[proxy] Fetch error: ${err.message}`);
        try {
          if (!res.headersSent) {
            res.writeHead(502);
            res.end(`Proxy error: ${err.message}`);
          } else if (!res.writableEnded) {
            res.end();
          }
        } catch {}
      }
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      logMpv.log(`[proxy] Listening on 127.0.0.1:${port}`);
      resolve({
        port,
        close: () => {
          try {
            server.close();
          } catch {}
        },
      });
    });

    server.on("error", reject);
  });
}

// ── mpv binary resolution ─────────────────────────────────────────

/**
 * Resolve the mpv binary path. Search order:
 *   1. Production: resources/mpv/ (bundled via extraResources)
 *   2. Dev: apps/desktop/vendor/mpv/ (download-mpv.mjs)
 *   3. System PATH (winget/scoop/choco install)
 *   4. Common Windows install locations
 */
function resolveMpvBinary(): string {
  const isDev = !basename(process.argv[0] || "").startsWith("FilmSnaps");

  // Production: resources/mpv/ (bundled via extraResources)
  if (!isDev) {
    const resPath = join(process.resourcesPath, "mpv");
    const prodBin = IS_WIN ? join(resPath, "mpv.exe") : join(resPath, "mpv");
    if (existsSync(prodBin)) return prodBin;
  }

  // Dev: apps/desktop/vendor/mpv/ — __dirname is dist/mpv/ so go up two levels
  const devPath = join(__dirname, "..", "..", "vendor", "mpv");
  const devBin = IS_WIN ? join(devPath, "mpv.exe") : join(devPath, "mpv");
  if (existsSync(devBin)) return devBin;

  // Fallback: system PATH
  try {
    const cmd = IS_WIN ? "where" : "which";
    const result = execFileSync(cmd, [IS_WIN ? "mpv.exe" : "mpv"], {
      encoding: "utf8",
      timeout: 3000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    const pathBin = result.split("\n")[0].trim();
    if (pathBin && existsSync(pathBin)) {
      logMpv.log(`[MpvManager] Found mpv on PATH: ${pathBin}`);
      return pathBin;
    }
  } catch {
    // Not on PATH
  }

  // Common Windows install locations
  if (IS_WIN) {
    const winCandidates = [
      join("C:\\Program Files\\MPV Player", "mpv.exe"),
      join("C:\\Program Files\\mpv", "mpv.exe"),
      join(process.env.LOCALAPPDATA || "", "Programs", "mpv", "mpv.exe"),
    ];
    for (const candidate of winCandidates) {
      if (existsSync(candidate)) {
        logMpv.log(`[MpvManager] Found mpv at: ${candidate}`);
        return candidate;
      }
    }
  }

  // Return the dev path as default (will fail with "not found" error)
  return devBin;
}

// ── MpvManager ────────────────────────────────────────────────────

export class MpvManager extends EventEmitter {
  private process: ChildProcess | null = null;
  private socket: net.Socket | null = null;
  private ipcPath = "";
  private requestId = 0;
  private pendingRequests = new Map<
    number,
    {
      resolve: (v: any) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
      /** First token of the command — used to attribute failures in the log. */
      cmdName: string;
    }
  >();
  private lineBuffer = "";
  private proxy: { port: number; close: () => void } | null = null;
  private observed = false;
  private starting = false;
  private lastHwnd: Buffer | undefined = undefined;
  /** Set to true once mpv successfully plays a file. Before this, exit
   *  failures are app-level bugs (bad config/GPU), not link problems —
   *  firing next-link fallback would just fail identically N times. */
  private hasPlayed = false;

  /** Cached state — updated from events, read synchronously by adapter RAF loop. */
  private _state: MpvState = {
    paused: true,
    position: 0,
    duration: 0,
    volume: 100,
    muted: false,
    speed: 1,
    aid: 0,
    sid: 0,
    trackList: [],
  };

  get state(): Readonly<MpvState> {
    return this._state;
  }

  get pid(): number | undefined {
    return this.process?.pid;
  }

  get running(): boolean {
    return !!this.process && !this.process.killed;
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  /**
   * Build the mpv command line. Every option here must exist in the bundled
   * mpv build — an unknown option is a FATAL error (exit code 1, no IPC pipe).
   * If mpv ever rejects one, start() self-heals by stripping the offending
   * option reported in mpv's log and respawning once.
   */
  private buildArgs(
    ipcPath: string,
    mpvBinary: string,
    videoHwnd?: Buffer,
  ): string[] {
    const args: string[] = [
      `--input-ipc-server=${ipcPath}`,
      "--no-terminal",
      "--idle=yes",
      // --force-window REMOVED: with --wid, mpv renders into the provided HWND.
      // force-window creates a separate standalone window which is not wanted.
      "--title=FilmSnapsPlayer",
      "--no-border",
      "--hwdec=auto-safe",
      // Expert: gpu-next has rougher edges with --wid embedding on Windows.
      // Classic gpu (d3d11 context) is the battle-tested embed path.
      "--vo=gpu",
      "--gpu-context=d3d11",
      `--user-agent=${DESKTOP_UA}`,
      "--hr-seek=yes",
      "--video-sync=display-resample",
      "--input-default-bindings=yes",
      "--cursor-autohide=1000",
      // HTML ControlBar (in the app window) owns all controls — mpv's built-in
      // OSC would fight it and is unreachable under the input model anyway.
      "--osc=no",
      "--osd-bar=yes",
      "--keep-open=yes",
      "--ytdl=no",
      // Fast startup + aggressive caching for network streams
      "--demuxer-lavf-o=probesize=65536,analyzeduration=0",
      "--cache=yes",
      "--cache-pause=no",
      "--demuxer-max-bytes=200M",
      "--demuxer-readahead-secs=30",
      "--cache-pause-wait=2",
      "--cache-secs=30",
      // Debug logging — all=debug writes per-frame vo/gpu/demuxer lines, a
      // measurable CPU+disk cost during playback. Default to warn; enable
      // full debug with FILMSNAPS_MPV_DEBUG=1.
      `--log-file=${mpvDebugLogPath()}`,
      process.env.FILMSNAPS_MPV_DEBUG
        ? "--msg-level=all=debug"
        : "--msg-level=all=warn",
    ];

    if (videoHwnd) {
      const hwndStr =
        videoHwnd.length === 8
          ? videoHwnd.readBigUInt64LE(0).toString()
          : videoHwnd.readUInt32LE(0).toString();
      args.push(`--wid=${hwndStr}`);
      logMpv.log(
        `[MpvManager] Embedding into HWND: ${hwndStr} (buffer size=${videoHwnd.length})`,
      );
    }

    return args;
  }

  /**
   * Spawn the mpv process and connect IPC.
   * @param videoHwnd Optional Windows HWND (Buffer) to render video into.
   */
  async start(videoHwnd?: Buffer): Promise<void> {
    if (this.running || this.starting) return;
    this.starting = true;
    this.lastHwnd = videoHwnd;

    const mpvBinary = resolveMpvBinary();
    logMpv.log(
      `[MpvManager] Binary: ${mpvBinary} (exists=${existsSync(mpvBinary)})`,
    );
    if (!existsSync(mpvBinary)) {
      throw new Error(`mpv binary not found at ${mpvBinary}`);
    }

    // Generate unique IPC path — Date.now() prevents pipe name reuse if the
    // old mpv hasn't fully exited when a new one spawns (same process pid).
    const id = `${process.pid}-${Date.now()}`;
    this.ipcPath = IS_WIN
      ? `\\\\.\\pipe\\filmsnaps-mpv-${id}`
      : `/tmp/filmsnaps-mpv-${id}.sock`;
    logMpv.log(`[MpvManager] IPC path: ${this.ipcPath}`);

    const args = this.buildArgs(this.ipcPath, mpvBinary, videoHwnd);

    // Start local proxy for Cloudflare/CDN URLs
    if (!this.proxy) {
      try {
        this.proxy = await startProxy();
      } catch (err: any) {
        logMpv.warn(
          `[MpvManager] Proxy start failed: ${err.message} — mpv will fetch directly`,
        );
      }
    }

    try {
      await this.spawnAndConnect(mpvBinary, args);
    } catch (err: any) {
      // Self-heal: mpv exits fatally (code 1) on any unknown CLI option and
      // names it in its log. Strip that option and retry once so a single
      // bad flag can never permanently brick playback.
      const badOptions = this.findBadOptions(mpvDebugLogPath());
      if (badOptions.length === 0 || this.running) throw err;

      logMpv.error(
        `[MpvManager] mpv rejected options [${badOptions.join(", ")}] — retrying without them`,
      );
      const filtered = args.filter(
        (a) =>
          !badOptions.some(
            (opt) =>
              a === `--${opt}` ||
              a === `--${opt}=yes` ||
              a.startsWith(`--${opt}=`),
          ),
      );
      if (filtered.length === args.length) throw err;
      // cleanup() (triggered by the exit event) killed the proxy — restore it
      // so the retry still routes URLs through the Chrome-TLS proxy.
      if (!this.proxy) {
        try {
          this.proxy = await startProxy();
        } catch {}
      }
      await this.spawnAndConnect(mpvBinary, filtered);
    }

    this.starting = false;
    console.log(
      `[MpvManager] Started (pid=${this.process?.pid}, ipc=${this.ipcPath})`,
    );
  }

  /** Read mpv's log for fatal "Error parsing option X" entries. */
  private findBadOptions(logPath: string): string[] {
    try {
      if (!existsSync(logPath)) return [];
      const content = readFileSync(logPath, "utf8");
      const bad = new Set<string>();
      const re = /Error parsing option ([\w-]+)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) bad.add(m[1]);
      return Array.from(bad);
    } catch {
      return [];
    }
  }

  private async spawnAndConnect(
    mpvBinary: string,
    args: string[],
  ): Promise<void> {
    logMpv.log(`[MpvManager] Spawning: ${mpvBinary} ${args.join(" ")}`);

    // Spawn process — ensure mpv's directory is in DLL search path
    const mpvDir = dirname(mpvBinary);
    this.process = spawn(mpvBinary, args, {
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
      env: {
        ...process.env,
        PATH: `${mpvDir};${process.env.PATH || ""}`,
      },
    });

    this.process.on("error", (err) => {
      logMpv.error(`[MpvManager] Process error: ${err.message}`);
      this.emit("error", err.message);
    });

    // Log stderr to capture crash details
    this.process.stderr?.on("data", (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) console.error(`[mpv:stderr] ${msg}`);
    });

    this.process.on("exit", (code, signal) => {
      logMpv.log(`[MpvManager] Process exited: code=${code} signal=${signal}`);
      if (code === 3221225501) {
        logMpv.error(
          `[MpvManager] STATUS_DLL_NOT_FOUND — mpv is missing dependency DLLs. Re-run: node scripts/download-mpv.mjs`,
        );
      }
      if (code !== 0 && code !== null) {
        logMpv.error(`[MpvManager] Check ${mpvDebugLogPath()} for details`);
      }
      this.cleanup();
      this.emit("exit", code);
    });

    // Connect IPC
    await this.connectIPC();
  }

  /** Connect to mpv's named pipe with retry. */
  private async connectIPC(): Promise<void> {
    for (let attempt = 0; attempt < MAX_CONNECT_RETRIES; attempt++) {
      // Bail immediately if mpv already exited
      if (!this.running) {
        throw new Error("mpv process exited before IPC connected");
      }

      try {
        logMpv.log(
          `[MpvManager] IPC connect attempt ${attempt + 1}/${MAX_CONNECT_RETRIES}...`,
        );
        await this.tryConnect();
        logMpv.log(`[MpvManager] IPC connected on attempt ${attempt + 1}`);
        return;
      } catch (err: any) {
        logMpv.warn(
          `[MpvManager] IPC connect attempt ${attempt + 1} failed: ${err.message}`,
        );
        // If process already exited, don't wait — fail fast
        if (!this.running) {
          throw new Error("mpv process exited before IPC connected");
        }
        await new Promise((r) => setTimeout(r, RECONNECT_DELAY_MS));
      }
    }
    throw new Error(
      `Failed to connect to mpv IPC after ${MAX_CONNECT_RETRIES} retries`,
    );
  }

  private tryConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const sock = net.connect(this.ipcPath);

      const timeout = setTimeout(() => {
        sock.destroy();
        reject(new Error("IPC connect timeout"));
      }, 5000);

      sock.on("connect", () => {
        clearTimeout(timeout);
        this.socket = sock;
        this.lineBuffer = "";
        this.setupSocketHandlers();
        // Disable mpv's default key bindings (OSC, OSD bar, etc.)
        this.sendCommand(["disable_event", "key-bindings"]).catch(() => {});
        // D8: Bind mouse click to pause (clicks over video go to mpv, not HTML)
        this.sendCommand(["keybind", "MBTN_LEFT", "cycle pause"]).catch(
          () => {},
        );
        resolve();
      });

      sock.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  private setupSocketHandlers(): void {
    if (!this.socket) return;

    this.socket.on("data", (chunk: Buffer) => {
      this.lineBuffer += chunk.toString("utf8");

      // mpv sends \n-terminated JSON lines
      let nlIdx: number;
      while ((nlIdx = this.lineBuffer.indexOf("\n")) !== -1) {
        const line = this.lineBuffer.slice(0, nlIdx).trim();
        this.lineBuffer = this.lineBuffer.slice(nlIdx + 1);
        if (line) this.handleLine(line);
      }
    });

    this.socket.on("close", () => {
      logMpv.log("[MpvManager] IPC socket closed");
      this.socket = null;
    });

    this.socket.on("error", (err) => {
      logMpv.error(`[MpvManager] IPC socket error: ${err.message}`);
    });
  }

  private handleLine(line: string): void {
    try {
      const msg = JSON.parse(line);

      // Response to a command
      if ("request_id" in msg && msg.request_id !== undefined) {
        const pending = this.pendingRequests.get(msg.request_id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingRequests.delete(msg.request_id);
          if (msg.error === "success") {
            pending.resolve(msg.data);
          } else {
            const err = new Error(msg.error || "mpv command failed");
            logMpv.warn(
              `[MpvManager] mpv rejected "${pending.cmdName}": ${msg.error}`,
            );
            pending.reject(err);
          }
        }
        return;
      }

      // Event (no request_id)
      if ("event" in msg) {
        this.handleEvent(msg);
      }
    } catch {
      // Non-JSON line — ignore
    }
  }

  private handleEvent(msg: any): void {
    const event = msg.event;

    switch (event) {
      case "property-change": {
        // mpv IPC shape: {"event":"property-change","id":N,"name":"...","data":<value>}
        // — name is TOP-LEVEL, data IS the value (msg.data?.name is always
        // undefined, which silently froze the cached state at its defaults).
        const prop = msg.name ?? msg.data?.name;
        const value = msg.data;
        if (prop && value !== undefined) {
          this.updateProperty(prop, value);
        }
        break;
      }
      case "playback-restart":
        // Playback resumed or started — sync state
        this.syncAllProperties();
        break;
      case "pause":
        this._state.paused = true;
        this.emit("event", { type: "pause" });
        break;
      case "unpause":
        this._state.paused = false;
        this.emit("event", { type: "unpause" });
        break;
      case "seek":
        this.emit("event", {
          type: "seek",
          time: this._state.position,
        });
        break;
      case "end-file":
        // reason: "eof" | "stop" | "quit" | "error" | "redirect" — the
        // renderer uses reason==="error" to trigger source fallback.
        this.emit("event", {
          type: "end-file",
          reason: msg.reason ?? msg.data?.reason,
        });
        break;
    }

    // Broadcast all events to the renderer
    this.emit("event", { type: event, raw: msg });
  }

  private updateProperty(name: string, value: any): void {
    switch (name) {
      case "time-pos":
        this._state.position = typeof value === "number" ? value : 0;
        this.emit("event", { type: "time-pos", value: this._state.position });
        break;
      case "duration":
        this._state.duration = typeof value === "number" ? value : 0;
        this.emit("event", { type: "duration", value: this._state.duration });
        break;
      case "pause":
        this._state.paused = !!value;
        break;
      case "volume":
        this._state.volume = typeof value === "number" ? value : 100;
        break;
      case "mute":
        this._state.muted = !!value;
        break;
      case "speed":
        this._state.speed = typeof value === "number" ? value : 1;
        break;
      case "aid":
        this._state.aid = typeof value === "number" ? value : 0;
        break;
      case "sid":
        this._state.sid = typeof value === "number" ? value : 0;
        break;
      case "track-list":
        this._state.trackList = Array.isArray(value) ? value : [];
        break;
    }
  }

  /** Sync all properties from mpv (called on playback-restart). */
  private async syncAllProperties(): Promise<void> {
    try {
      const [pos, dur, paused, vol, muted, speed, aid, sid, tracks] =
        await Promise.all([
          this.getProperty<number>("time-pos").catch(() => 0),
          this.getProperty<number>("duration").catch(() => 0),
          this.getProperty<boolean>("pause").catch(() => true),
          this.getProperty<number>("volume").catch(() => 100),
          this.getProperty<boolean>("mute").catch(() => false),
          this.getProperty<number>("speed").catch(() => 1),
          this.getProperty<number>("aid").catch(() => 0),
          this.getProperty<number>("sid").catch(() => 0),
          this.getProperty<MpvTrack[]>("track-list").catch(() => []),
        ]);

      this._state = {
        position: pos ?? 0,
        duration: dur ?? 0,
        paused: !!paused,
        volume: vol ?? 100,
        muted: !!muted,
        speed: speed ?? 1,
        aid: aid ?? 0,
        sid: sid ?? 0,
        trackList: Array.isArray(tracks) ? tracks : [],
      };
    } catch {
      // Partial sync is fine — properties update individually via events
    }
  }

  // ── Command Sending ──────────────────────────────────────────────

  /** Send a JSON IPC command and return the response data. */
  async sendCommand(command: any[], timeoutMs = 5000): Promise<any> {
    if (!this.socket) throw new Error("mpv IPC not connected");

    const id = ++this.requestId;
    const msg = JSON.stringify({ command, request_id: id }) + "\n";

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`mpv command timed out: ${command[0]}`));
      }, timeoutMs);

      this.pendingRequests.set(id, {
        resolve,
        reject,
        timer,
        cmdName: String(command[0] ?? "unknown"),
      });
      this.socket!.write(msg);
    });
  }

  async getProperty<T = any>(name: string): Promise<T> {
    const result = await this.sendCommand(["get_property", name]);
    return result as T;
  }

  async setProperty(name: string, value: any): Promise<void> {
    await this.sendCommand(["set_property", name, value]);
  }

  // ── Playback Control ─────────────────────────────────────────────

  /**
   * The local proxy URL that routes `url` through Electron's Chrome TLS
   * stack — the EXACT path playback uses. Health probes must go through
   * this too: a verdict from a different network path is a verdict about a
   * different pipeline ("probed green, didn't play").
   */
  getPlaybackProxyUrl(url: string): string | null {
    if (!this.proxy) return null;
    return `http://127.0.0.1:${this.proxy.port}/${url}`;
  }

  async play(url: string): Promise<void> {
    // If the process died (crash, killed), restart it before playing.
    // With --idle=yes, mpv stays alive after a failed loadfile, but if the
    // process itself crashed we need a fresh instance.
    if (!this.running) {
      logMpv.log("[MpvManager] play() — process dead, restarting");
      // Ensure proxy is alive (cleanup kills it; restart needs it)
      if (!this.proxy) {
        try {
          this.proxy = await startProxy();
        } catch {}
      }
      await this.spawnAndConnect(
        resolveMpvBinary(),
        this.buildArgs(this.ipcPath, resolveMpvBinary(), this.lastHwnd),
      );
    }
    // Route through local proxy so mpv uses Electron's Chrome TLS fingerprint
    // (bypasses Cloudflare bot detection / 403 blocks on CDN URLs).
    const playUrl = this.proxy
      ? `http://127.0.0.1:${this.proxy.port}/${url}`
      : url;
    logMpv.log(
      `[MpvManager] play() → ${this.proxy ? "proxy" : "direct"} → ${url.slice(0, 120)}`,
    );
    await this.sendCommand(["loadfile", playUrl, "replace"]);
    this.hasPlayed = true;
    logMpv.log("[MpvManager] loadfile sent, observing properties...");
    // Subscribe to property changes for real-time updates — once per process,
    // not once per play(): observe_property stacks duplicates on every call.
    // Only mark observed=true if ALL observations succeeded; otherwise the
    // next play() call will retry (controls won't sync without observations).
    if (!this.observed) {
      const ok = await this.observeProperties();
      if (ok) {
        this.observed = true;
        logMpv.log("[MpvManager] All properties observed successfully");
      } else {
        logMpv.error(
          "[MpvManager] Some observations failed — will retry on next play()",
        );
      }
    }
  }

  /** Observe the properties we care about for real-time event pushes.
   *  Returns true only if ALL observations succeeded.
   *  mpv IPC format: ["observe_property", <reply_userdata_int>, <name>]
   *  The integer ID is returned in property-change events to identify which
   *  observation triggered. */
  private async observeProperties(): Promise<boolean> {
    const props = [
      "time-pos",
      "duration",
      "pause",
      "volume",
      "mute",
      "speed",
      "aid",
      "sid",
      "track-list",
    ];
    let allOk = true;
    for (let i = 0; i < props.length; i++) {
      const prop = props[i];
      try {
        await this.sendCommand(["observe_property", i + 1, prop]);
      } catch (err: any) {
        logMpv.warn(
          `[MpvManager] observe_property ${prop} failed: ${err.message}`,
        );
        allOk = false;
      }
    }
    return allOk;
  }

  async pause(): Promise<void> {
    await this.setProperty("pause", true);
  }

  async resume(): Promise<void> {
    await this.setProperty("pause", false);
  }

  async stop(): Promise<void> {
    await this.sendCommand(["stop"]).catch(() => {});
  }

  async seek(seconds: number): Promise<void> {
    await this.sendCommand(["seek", seconds, "absolute"]);
    this._state.position = seconds;
  }

  async setVolume(vol01: number): Promise<void> {
    // Adapter passes 0-1; mpv uses 0-100
    const mpvVol = Math.round(Math.max(0, Math.min(1, vol01)) * 100);
    await this.setProperty("volume", mpvVol);
    this._state.volume = mpvVol;
  }

  /** Position and size the mpv native video window over the player area. */
  async setGeometry(
    width: number,
    height: number,
    x: number,
    y: number,
  ): Promise<void> {
    const geomStr = `${Math.round(width)}x${Math.round(height)}+${Math.round(x)}+${Math.round(y)}`;
    logMpv.log(`[MpvManager] setGeometry: ${geomStr}`);
    await this.setProperty("geometry", geomStr).catch(() => {});
  }

  async hideWindow(): Promise<void> {
    // Window visibility is managed by VLCVideoWindow (registerMpvIPC) —
    // minimizing the mpv window here can stall its render loop.
  }

  async showWindow(): Promise<void> {}

  async setMuted(muted: boolean): Promise<void> {
    await this.setProperty("mute", muted);
    this._state.muted = muted;
  }

  async setSpeed(rate: number): Promise<void> {
    await this.setProperty("speed", rate);
    this._state.speed = rate;
  }

  // ── Track Selection ──────────────────────────────────────────────

  async getAudioTracks(): Promise<MpvTrack[]> {
    const tracks = await this.getProperty<MpvTrack[]>("track-list");
    return (Array.isArray(tracks) ? tracks : []).filter(
      (t) => t.type === "audio",
    );
  }

  async getSubtitleTracks(): Promise<MpvTrack[]> {
    const tracks = await this.getProperty<MpvTrack[]>("track-list");
    return (Array.isArray(tracks) ? tracks : []).filter(
      (t) => t.type === "sub",
    );
  }

  async setAudioTrack(id: number): Promise<void> {
    await this.setProperty("aid", id);
    this._state.aid = id;
  }

  async setSubtitleTrack(id: number): Promise<void> {
    await this.setProperty("sid", id);
    this._state.sid = id;
  }

  async disableSubtitleTrack(): Promise<void> {
    await this.setProperty("sid", "no");
    this._state.sid = 0;
  }

  // ── Cleanup ──────────────────────────────────────────────────────

  private cleanup(): void {
    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error("mpv process exited"));
    }
    this.pendingRequests.clear();

    this.socket?.destroy();
    this.socket = null;
    this.process = null;
    this.lineBuffer = "";
    this.observed = false;
    this.starting = false;
    // hasPlayed resets so the NEXT start() knows this is a fresh process
    // (app-level failures before first play should not trigger link fallback).
    this.hasPlayed = false;

    // NOTE: proxy is NOT killed here — it persists for the process lifetime.
    // Only destroy() kills the proxy.
  }

  async destroy(): Promise<void> {
    if (!this.process) return;

    // Try graceful quit
    try {
      await this.sendCommand(["quit"], 1000);
    } catch {
      // Process may already be gone
    }

    // Force kill after timeout
    if (this.process && !this.process.killed) {
      this.process.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          if (this.process && !this.process.killed) {
            this.process.kill("SIGKILL");
          }
          resolve();
        }, KILL_TIMEOUT_MS);
        this.process!.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }

    this.cleanup();
    // Kill proxy — only destroy() tears it down (cleanup() preserves it for restart)
    if (this.proxy) {
      this.proxy.close();
      this.proxy = null;
    }
    this.emit("destroyed");
  }
}
