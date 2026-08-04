const fs = require("fs");
const code = fs.readFileSync("dist/preload/provider-preload.js", "utf8");
const N = console.log;

class El {
  constructor(tag) { this.tag = tag; }
  addEventListener() {}
  getAttribute() { return null; }
  get currentSrc() { return null; }
}
global.document = {
  referrer: "",
  location: { href: "https://peachify.top/embed/movie/1481343" },
  createElement: (t) => new El(t),
  getElementById: () => null,
  documentElement: null,
  addEventListener: () => {},
  querySelectorAll: () => [],
  readyState: "complete",
};
global.window = { fetch: () => Promise.resolve(new Response("", { status: 204 })), open: () => null, top: null, self: null };
global.self = global; global.top = global; global.Response = Response;
global.HTMLMediaElement = function () {}; HTMLMediaElement.prototype = {};
global.HTMLCanvasElement = function () {}; HTMLCanvasElement.prototype = {};
global.CanvasRenderingContext2D = function () {}; CanvasRenderingContext2D.prototype = {};
global.WebGLRenderingContext = function () {}; WebGLRenderingContext.prototype = {};
global.WebAssembly = { instantiate: () => Promise.resolve() };
global.Worker = function () {}; global.EventTarget = function () {};
global.Navigator = function () {}; Navigator.prototype = { sendBeacon: () => true };
global.Storage = function () {}; Storage.prototype = { setItem() {}, getItem() { return null; } };
global.MutationObserver = function () { this.observe = () => {}; this.disconnect = () => {}; };
global.XMLHttpRequest = function () {};
XMLHttpRequest.prototype = { open() {}, send() {}, addEventListener() {}, set status(v) {}, get status() { return 200; }, set statusText(v) {}, get statusText() { return "OK"; }, get responseText() { return ""; } };
global.URL = URL;

const logs = [];
require("console").Console.prototype.info = (...a) => { logs.push("I " + a.join(" ")); };
require("console").Console.prototype.log = (...a) => { logs.push("L " + a.join(" ")); };
require("console").Console.prototype.warn = (...a) => { logs.push("W " + a.join(" ")); };
require("console").Console.prototype.error = (...a) => { logs.push("E " + a.join(" ")); };
global.console = require("console").Console ? global.console : global.console;

try {
  new Function(code)();
  N("IIFE ran to completion");
} catch (e) {
  N("IIFE THREW:", e.message.slice(0, 200));
}
const aud = logs.filter((l) => l.includes("STREAM-AUDIT"));
N("STREAM-AUDIT lines:", aud.length);
aud.slice(0, 10).forEach((l) => N("  ", l.slice(0, 140)));
process.exit(0);