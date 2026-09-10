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
import { existsSync } from "fs";
import { platform } from "os";
import { net as electronNet } from "electron";
import { media as logMpv } from "../lib/log";

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

      try {
        const fetchHeaders: Record<string, string> = {
          "User-Agent": DESKTOP_UA,
          Accept: "*/*",
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
        logMpv.error(`[proxy] Fetch error: ${err.message}`);
        if (!res.headersSent) {
          res.writeHead(502);
          res.end(`Proxy error: ${err.message}`);
        }
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
    }
  >();
  private lineBuffer = "";
  private proxy: { port: number; close: () => void } | null = null;

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
   * Spawn the mpv process and connect IPC.
   * @param videoHwnd Optional Windows HWND (Buffer) to render video into.
   */
  async start(videoHwnd?: Buffer): Promise<void> {
    if (this.running) return;

    const mpvBinary = resolveMpvBinary();
    logMpv.log(
      `[MpvManager] Binary: ${mpvBinary} (exists=${existsSync(mpvBinary)})`,
    );
    if (!existsSync(mpvBinary)) {
      throw new Error(`mpv binary not found at ${mpvBinary}`);
    }

    // Generate unique IPC path
    const id = process.pid;
    this.ipcPath = IS_WIN
      ? `\\\\.\\pipe\\filmsnaps-mpv-${id}`
      : `/tmp/filmsnaps-mpv-${id}.sock`;
    logMpv.log(`[MpvManager] IPC path: ${this.ipcPath}`);

    // Build mpv arguments for high-performance native video window
    const args: string[] = [
      `--input-ipc-server=${this.ipcPath}`,
      "--no-terminal",
      "--idle=yes",
      "--force-window=yes",
      "--title=FilmSnapsPlayer",
      "--no-border",
      "--hwdec=auto-safe",
      "--vo=gpu",
      "--gpu-context=d3d11",
      `--user-agent=${DESKTOP_UA}`,
      "--hr-seek=yes",
      "--video-sync=display-resample",
      "--input-default-bindings=yes",
      "--input-vo-keyboard=yes",
      "--input-cursor-autohide=1000",
      "--osc=yes",
      "--osd-bar=yes",
      "--script-opts=osc-layout=bottombar,osc-seekbarstyle=bar",
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
      // Debug logging
      `--log-file=${join(dirname(mpvBinary), "mpv-debug.log")}`,
      "--msg-level=all=debug",
    ];

    // Optional --wid embedding if specified
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
        logMpv.error(
          `[MpvManager] Check ${join(dirname(mpvBinary), "mpv-debug.log")} for details`,
        );
      }
      this.cleanup();
      this.emit("exit", code);
    });

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

    // Connect IPC
    await this.connectIPC();

    console.log(
      `[MpvManager] Started (pid=${this.process.pid}, ipc=${this.ipcPath})`,
    );
  }

  /** Connect to mpv's named pipe with retry. */
  private async connectIPC(): Promise<void> {
    for (let attempt = 0; attempt < MAX_CONNECT_RETRIES; attempt++) {
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
            pending.reject(new Error(msg.error || "mpv command failed"));
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
        const prop = msg.data?.name;
        const value = msg.data?.data;
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
        this.emit("event", { type: "end-file" });
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

      this.pendingRequests.set(id, { resolve, reject, timer });
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

  async play(url: string): Promise<void> {
    // Stream direct URL for max network throughput and native HTTP Range seeking
    const playUrl = url;
    logMpv.log(`[MpvManager] play() → direct → ${url.slice(0, 120)}`);
    await this.sendCommand(["loadfile", playUrl, "replace"]);
    logMpv.log("[MpvManager] loadfile sent, observing properties...");
    // Subscribe to property changes for real-time updates
    await this.observeProperties();
    logMpv.log("[MpvManager] Properties observed, playback should start");
  }

  /** Observe the properties we care about for real-time event pushes. */
  private async observeProperties(): Promise<void> {
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
    for (const prop of props) {
      await this.sendCommand(["observe_property", prop, prop]).catch(() => {});
    }
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
    await this.setProperty("window-minimize", true).catch(() => {});
  }

  async showWindow(): Promise<void> {
    await this.setProperty("window-minimize", false).catch(() => {});
  }

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

    // Stop proxy
    if (this.proxy) {
      this.proxy.close();
      this.proxy = null;
    }
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
    this.emit("destroyed");
  }
}
