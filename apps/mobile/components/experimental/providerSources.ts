/**
 * Compiled Nuvio provider JavaScript sources.
 *
 * Each entry is a self-contained JS bundle (transpiled for Hermes/es2016)
 * that exports `getStreams(tmdbId, mediaType, season, episode)` via
 * `module.exports`.
 *
 * Providers with external dependencies (cheerio, crypto-js) have those
 * shimmed in the sandbox HTML at runtime.
 */
import type { ExperimentalProvider } from './types';

// ────────────────────────────────────────────────
// Provider metadata registry
// ────────────────────────────────────────────────

export const EXPERIMENTAL_PROVIDERS: ExperimentalProvider[] = [
  {
    id: 'dooflix',
    name: 'DooFlix',
    languages: ['en', 'hi'],
    deps: {},
    complexity: 'simple',
  },
  {
    id: 'vidnest',
    name: 'Vidnest',
    languages: ['en'],
    deps: {},
    complexity: 'medium',
  },
  {
    id: 'vixsrc',
    name: 'Vixsrc',
    languages: ['en'],
    deps: {},
    complexity: 'medium',
  },
  {
    id: 'cinevibe',
    name: 'Cinevibe',
    languages: ['en'],
    deps: {},
    complexity: 'medium',
  },
  {
    id: 'yflix',
    name: 'YFlix',
    languages: ['en'],
    deps: {},
    complexity: 'complex',
  },
  {
    id: 'moviebox',
    name: 'MovieBox',
    languages: ['en', 'hin', 'tam', 'tel'],
    deps: { crypto: true },
    complexity: 'complex',
  },
  {
    id: 'castle',
    name: 'Castle',
    languages: ['en', 'hi', 'ta', 'te', 'ml', 'kn'],
    deps: { crypto: true },
    complexity: 'medium',
  },
];

// ────────────────────────────────────────────────
// Provider JS sources
// ────────────────────────────────────────────────

export const PROVIDER_SOURCES: Record<string, string> = {
  // ── DooFlix (compiled by esbuild) ──
  dooflix: `
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = (value) => {
      try {
        step(generator.next(value));
      } catch (e) {
        reject(e);
      }
    };
    var rejected = (value) => {
      try {
        step(generator.throw(value));
      } catch (e) {
        reject(e);
      }
    };
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};
var dooflix_exports = {};
__export(dooflix_exports, { getStreams: () => getStreams });
module.exports = __toCommonJS(dooflix_exports);
var BASE_API = "https://panel.watchkaroabhi.com";
var API_KEY = "qNhKLJiZVyoKdi9NCQGz8CIGrpUijujE";
var HEADERS = { "X-Package-Name": "com.king.moja", "User-Agent": "dooflix", "X-App-Version": "305" };
var STREAM_REFERER = "https://molop.art/";
function getStreams(tmdbId, mediaType, season, episode) {
  return __async(this, null, function* () {
    try {
      let requestUrl;
      if (mediaType === "movie") {
        requestUrl = BASE_API + "/api/3/movie/" + tmdbId + "/links?api_key=" + API_KEY;
      } else {
        if (!season || !episode) return [];
        requestUrl = BASE_API + "/api/3/tv/" + tmdbId + "/season/" + season + "/episode/" + episode + "/links?api_key=" + API_KEY;
      }
      const response = yield fetch(requestUrl, { headers: HEADERS });
      if (!response.ok) return [];
      const data = yield response.json();
      const links = data.links || [];
      const streams = [];
      for (const linkObj of links) {
        try {
          const res = yield fetch(linkObj.url, {
            method: "GET",
            headers: { "Referer": STREAM_REFERER, "User-Agent": HEADERS["User-Agent"] },
            redirect: "manual"
          });
          let streamUrl = res.headers.get("location") || res.url;
          if (streamUrl && streamUrl !== linkObj.url) {
            streams.push({
              name: "DooFlix",
              title: "DooFlix - " + (linkObj.host || "Server"),
              url: streamUrl,
              quality: "Auto",
              headers: { "Referer": STREAM_REFERER, "User-Agent": HEADERS["User-Agent"] },
              provider: "dooflix"
            });
          }
        } catch (e) {}
      }
      return streams;
    } catch (error) {
      return [];
    }
  });
}
`.trim(),

  // ── Vidnest (hand-written, no deps) ──
  vidnest: `
var TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
var TMDB_BASE_URL = 'https://api.themoviedb.org/3';
var VIDNEST_BASE_URL = 'https://first.vidnest.fun';
var PASSPHRASE = 'A7kP9mQeXU2BWcD4fRZV+Sg8yN0/M5tLbC1HJQwYe6o=';
var SERVERS = ['hollymoviehd', 'primesrc', 'ophim', 'flixhq', 'vidlink', 'rogflix'];
var WORKING_HEADERS = {
  'accept': '*/*',
  'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8',
  'origin': 'https://vidnest.fun',
  'referer': 'https://vidnest.fun/',
  'sec-ch-ua': '"Google Chrome";v="143", "Chromium";v="143", "Not A(Brand";v="24"',
  'sec-ch-ua-mobile': '?1',
  'sec-ch-ua-platform': '"Android"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-site',
  'user-agent': 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Mobile Safari/537.36'
};
var PLAYBACK_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
  'Accept': 'video/webm,video/ogg,video/*;q=0.9,*/*;q=0.5',
  'Accept-Language': 'en-US,en;q=0.9',
  'Connection': 'keep-alive'
};
var BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
function base64ToBytes(base64) {
  if (!base64) return new Uint8Array(0);
  var input = String(base64).replace(/=+$/, '');
  var output = '', bc = 0, bs, buffer, idx = 0;
  while ((buffer = input.charAt(idx++))) {
    buffer = BASE64_CHARS.indexOf(buffer);
    if (~buffer) {
      bs = bc % 4 ? bs * 64 + buffer : buffer;
      if (bc++ % 4) output += String.fromCharCode(255 & (bs >> ((-2 * bc) & 6)));
    }
  }
  var bytes = new Uint8Array(output.length);
  for (var i = 0; i < output.length; i++) bytes[i] = output.charCodeAt(i);
  return bytes;
}
function bytesToBase64(bytes) {
  if (!bytes || bytes.length === 0) return '';
  var output = '', i = 0, len = bytes.length;
  while (i < len) {
    var a = bytes[i++], b = i < len ? bytes[i++] : 0, c = i < len ? bytes[i++] : 0;
    var bitmap = (a << 16) | (b << 8) | c;
    output += BASE64_CHARS.charAt((bitmap >> 18) & 63);
    output += BASE64_CHARS.charAt((bitmap >> 12) & 63);
    output += i - 2 < len ? BASE64_CHARS.charAt((bitmap >> 6) & 63) : '=';
    output += i - 1 < len ? BASE64_CHARS.charAt(bitmap & 63) : '=';
  }
  return output;
}
function atob(str) { return base64ToBytes(str).map(function(b){ return String.fromCharCode(b); }).join(''); }
function decryptAesGcm(encryptedB64, passphraseB64) {
  var decryptServerUrl = 'https://aesdec.nuvioapp.space/decrypt';
  return fetch(decryptServerUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ encryptedData: encryptedB64, passphrase: passphraseB64 })
  }).then(function(response){ return response.json(); })
  .then(function(data){
    if (data.error) throw new Error(data.error);
    return data.decrypted;
  });
}
function makeRequest(url, options) {
  return fetch(url, {
    method: (options && options.method) || 'GET',
    headers: Object.assign({}, WORKING_HEADERS, (options && options.headers) || {})
  }).then(function(response) {
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return response;
  });
}
function getTMDBDetails(tmdbId, mediaType) {
  var endpoint = mediaType === 'tv' ? 'tv' : 'movie';
  var url = TMDB_BASE_URL + '/' + endpoint + '/' + tmdbId + '?api_key=' + TMDB_API_KEY;
  return makeRequest(url).then(function(response){ return response.json(); })
  .then(function(data) {
    return { title: mediaType === 'tv' ? data.name : data.title, year: (mediaType === 'tv' ? data.first_air_date : data.release_date) || null, imdbId: data.external_ids ? (data.external_ids.imdb_id || null) : null };
  });
}
function processVidnestResponse(data, serverName) {
  var streams = [];
  var sources = [];
  if (data.sources && Array.isArray(data.sources)) sources = data.sources;
  else if (data.streams && Array.isArray(data.streams)) sources = data.streams;
  else if (data.url && typeof data.url === 'string') sources = [{ url: data.url }];
  else if (data.data && typeof data.data === 'string') sources = [{ url: data.data }];
  sources.forEach(function(source) {
    if (!source) return;
    var videoUrl = source.file || source.url || source.src || source.link;
    if (!videoUrl) return;
    streams.push({ name: 'Vidnest ' + serverName, title: 'Stream', url: videoUrl, quality: 'auto', provider: 'vidnest' });
  });
  return streams;
}
function fetchFromServer(serverName, mediaType, tmdbId, seasonNum, episodeNum) {
  var apiUrl;
  if (mediaType === 'tv' && seasonNum && episodeNum) {
    apiUrl = VIDNEST_BASE_URL + '/' + serverName + '/' + mediaType + '/' + tmdbId + '/' + seasonNum + '/' + episodeNum;
  } else {
    apiUrl = VIDNEST_BASE_URL + '/' + serverName + '/' + mediaType + '/' + tmdbId;
  }
  if (serverName === 'flixhq') apiUrl += '?server=upcloud';
  return makeRequest(apiUrl).then(function(response){ return response.text(); })
  .then(function(responseText) {
    try {
      var data = JSON.parse(responseText);
      if (data.encrypted && data.data) {
        return decryptAesGcm(data.data, PASSPHRASE).then(function(decryptedText) {
          try { return processVidnestResponse(JSON.parse(decryptedText), serverName); }
          catch(e) { return []; }
        });
      }
      return processVidnestResponse(data, serverName);
    } catch(e) { return []; }
  }).catch(function(){ return []; });
}
function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  return new Promise(function(resolve) {
    getTMDBDetails(tmdbId, mediaType).then(function(mediaInfo) {
      var promises = SERVERS.map(function(serverName) {
        return fetchFromServer(serverName, mediaType, tmdbId, seasonNum, episodeNum);
      });
      Promise.all(promises).then(function(results) {
        var all = [];
        results.forEach(function(s){ all.push.apply(all, s); });
        resolve(all);
      });
    }).catch(function(){ resolve([]); });
  });
}
module.exports = { getStreams: getStreams };
`.trim(),

  // ── Vixsrc (compiled by esbuild) ──
  vixsrc: `
var __defProp = Object.defineProperty;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    }
  return a;
};
var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = (value) => { try { step(generator.next(value)); } catch (e) { reject(e); } };
    var rejected = (value) => { try { step(generator.throw(value)); } catch (e) { reject(e); } };
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};
var TMDB_API_KEY = "68e094699525b18a70bab2f86b1fa706";
var BASE_URL = "https://vixsrc.to";
var USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
function makeRequest(url, options) {
  return __async(this, arguments, function* (url, options) {
    if (options === void 0) options = {};
    var _a;
    const defaultHeaders = __spreadValues({
      "User-Agent": USER_AGENT,
      "Accept": "application/json,*/*",
      "Accept-Language": "en-US,en;q=0.5"
    }, options.headers);
    try {
      const response = yield fetch(url, __spreadValues({ method: options.method || "GET", headers: defaultHeaders }, options));
      if (!response.ok) throw new Error("HTTP " + response.status);
      return response;
    } catch (error) {
      console.error("[Vixsrc] Request failed:", error.message);
      throw error;
    }
  });
}
function getTmdbInfo(tmdbId, mediaType) {
  return __async(this, null, function* () {
    var _a, _b;
    const endpoint = mediaType === "tv" ? "tv" : "movie";
    const url = "https://api.themoviedb.org/3/" + endpoint + "/" + tmdbId + "?api_key=" + TMDB_API_KEY;
    const response = yield makeRequest(url);
    const data = yield response.json();
    const title = mediaType === "tv" ? data.name : data.title;
    const year = mediaType === "tv" ? (_a = data.first_air_date) == null ? void 0 : _a.substring(0, 4) : (_b = data.release_date) == null ? void 0 : _b.substring(0, 4);
    return { title: title, year: year };
  });
}
function extractStreamFromPage(contentType, contentId, seasonNum, episodeNum) {
  return __async(this, null, function* () {
    let vixsrcUrl;
    if (contentType === "movie") {
      vixsrcUrl = BASE_URL + "/movie/" + contentId;
    } else {
      vixsrcUrl = BASE_URL + "/tv/" + contentId + "/" + seasonNum + "/" + episodeNum;
    }
    const response = yield makeRequest(vixsrcUrl, {
      headers: { "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" }
    });
    const html = yield response.text();
    let masterPlaylistUrl = null;
    if (html.includes("window.masterPlaylist")) {
      const urlMatch = html.match(/url:\s*['"]([^'"]+)['"]/);
      const tokenMatch = html.match(/['"]?token['"]?\s*:\s*['"]([^'"]+)['"]/);
      const expiresMatch = html.match(/['"]?expires['"]?\s*:\s*['"]([^'"]+)['"]/);
      if (urlMatch && tokenMatch && expiresMatch) {
        const baseUrl = urlMatch[1];
        const token = tokenMatch[1];
        const expires = expiresMatch[1];
        if (baseUrl.includes("?b=1")) {
          masterPlaylistUrl = baseUrl + "&token=" + token + "&expires=" + expires + "&h=1&lang=en";
        } else {
          masterPlaylistUrl = baseUrl + "?token=" + token + "&expires=" + expires + "&h=1&lang=en";
        }
      }
    }
    if (!masterPlaylistUrl) {
      const m3u8Match = html.match(/(https?:\\\/\\\/[^'"\\s]+\\.m3u8[^'"\\s]*)/);
      if (m3u8Match) masterPlaylistUrl = m3u8Match[1];
    }
    if (!masterPlaylistUrl) return null;
    return { masterPlaylistUrl: masterPlaylistUrl };
  });
}
function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  return __async(this, null, function* () {
    try {
      const tmdbInfo = yield getTmdbInfo(tmdbId, mediaType);
      const streamData = yield extractStreamFromPage(mediaType, tmdbId, seasonNum, episodeNum);
      if (!streamData) return [];
      return [{
        name: "Vixsrc",
        title: "Auto Quality Stream",
        url: streamData.masterPlaylistUrl,
        quality: "Auto",
        headers: { "Referer": BASE_URL, "User-Agent": USER_AGENT },
        provider: "vixsrc"
      }];
    } catch (error) {
      return [];
    }
  });
}
module.exports = { getStreams: getStreams };
`.trim(),

  // ── Cinevibe (hand-written, simple API) ──
  cinevibe: `
var BASE_URL = 'https://cinevibe.asia';
var TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
var TMDB_BASE_URL = 'https://api.themoviedb.org/3';
var USER_AGENT = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
var BROWSER_FINGERPRINT = "eyJzY3JlZW4iOiIzNjB4ODA2eDI0Iiwi";
var SESSION_ENTROPY = "pjght152dw2rb.ssst4bzleDI0Iiwibv78";
var WORKING_HEADERS = {
  'Referer': BASE_URL + '/',
  'User-Agent': USER_AGENT,
  'X-CV-Fingerprint': BROWSER_FINGERPRINT,
  'X-CV-Session': SESSION_ENTROPY,
  'X-Requested-With': 'XMLHttpRequest'
};
function fnv1a32(s) {
  var hash = 2166136261;
  for (var i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = (hash + (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
function rot13(str) {
  return str.replace(/[A-Za-z]/g, function(char) {
    var code = char.charCodeAt(0);
    if (code >= 65 && code <= 90) return String.fromCharCode(((code - 65 + 13) % 26) + 65);
    if (code >= 97 && code <= 122) return String.fromCharCode(((code - 97 + 13) % 26) + 97);
    return char;
  });
}
function base64Encode(str) { return btoa(unescape(encodeURIComponent(str))); }
function customEncode(e) {
  var encoded = base64Encode(e);
  encoded = encoded.split('').reverse().join('');
  encoded = rot13(encoded);
  encoded = base64Encode(encoded);
  encoded = encoded.replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=/g, '');
  return encoded;
}
function getTMDBDetails(tmdbId, mediaType) {
  var endpoint = mediaType === 'tv' ? 'tv' : 'movie';
  return fetch(TMDB_BASE_URL + '/' + endpoint + '/' + tmdbId + '?api_key=' + TMDB_API_KEY, {
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' }
  }).then(function(r) { return r.json(); }).then(function(data) {
    var title = mediaType === 'tv' ? data.name : data.title;
    var year = (mediaType === 'tv' ? data.first_air_date : data.release_date) || '';
    if (year) year = year.split('-')[0];
    return { title: title, releaseYear: year, imdbId: data.imdb_id || null };
  });
}
function generateToken(tmdbId, title, releaseYear) {
  var cleanTitle = title.toLowerCase().replace(/[^a-z0-9]/g, '');
  var timeWindow = Math.floor(Date.now() / 300000);
  var hashedKey = fnv1a32(timeWindow + '_' + BROWSER_FINGERPRINT + '_cinevibe_2025');
  var timeStamp = Math.floor(Date.now() / 1000 / 600);
  var tokenString = SESSION_ENTROPY + '|' + tmdbId + '|' + cleanTitle + '|' + releaseYear + '||' + hashedKey + '|' + timeStamp + '|' + BROWSER_FINGERPRINT;
  return customEncode(tokenString);
}
function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  if (mediaType === 'tv') return Promise.resolve([]);
  return getTMDBDetails(tmdbId, mediaType).then(function(mediaInfo) {
    if (!mediaInfo.title || !mediaInfo.releaseYear) return [];
    var token = generateToken(tmdbId, mediaInfo.title, mediaInfo.releaseYear);
    var apiUrl = BASE_URL + '/api/stream/fetch?server=cinebox-1&type=' + mediaType + '&mediaId=' + tmdbId + '&title=' + encodeURIComponent(mediaInfo.title) + '&releaseYear=' + mediaInfo.releaseYear + '&_token=' + token + '&_ts=' + Date.now();
    return fetch(apiUrl, { method: 'GET', headers: WORKING_HEADERS })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (!data || !data.sources || !Array.isArray(data.sources)) return [];
      return data.sources.filter(function(s) { return s && s.url; }).map(function(source) {
        return { name: 'Cinevibe', title: mediaInfo.title, url: source.url, quality: 'Auto', headers: WORKING_HEADERS, provider: 'cinevibe' };
      });
    });
  }).catch(function() { return []; });
}
module.exports = { getStreams: getStreams };
`.trim(),

  // ── YFlix (hand-written, complex API chain) ──
  yflix: `
var HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36', 'Connection': 'keep-alive' };
var API = 'https://enc-dec.app/api';
var DB_API = 'https://enc-dec.app/db/flix';
var YFLIX_AJAX = 'https://1moviesz.to/ajax';
function getText(url) { return fetch(url, { headers: HEADERS }).then(function(r){ if(!r.ok)throw new Error('HTTP '+r.status); return r.text(); }); }
function getJson(url) { return fetch(url, { headers: HEADERS }).then(function(r){ if(!r.ok)throw new Error('HTTP '+r.status); return r.json(); }); }
function postJson(url, jsonBody) {
  return fetch(url, { method: 'POST', headers: Object.assign({}, HEADERS, {'Content-Type':'application/json'}), body: JSON.stringify(jsonBody) })
  .then(function(r){ if(!r.ok)throw new Error('HTTP '+r.status); return r.json(); });
}
function encrypt(text) { return getJson(API + '/enc-movies-flix?text=' + encodeURIComponent(text)).then(function(j){ return j.result; }); }
function decrypt(text) { return postJson(API + '/dec-movies-flix', { text: text }).then(function(j){ return j.result; }); }
function parseHtml(html) { return postJson(API + '/parse-html', { text: html }).then(function(j){ return j.result; }); }
function findInDatabase(tmdbId, mediaType) {
  return getJson(DB_API + '/find?tmdb_id=' + tmdbId + '&type=' + mediaType)
  .then(function(results) { return results && results.length > 0 ? results[0] : null; });
}
function decryptRapidMedia(embedUrl) {
  var media = embedUrl.replace('/e/', '/media/').replace('/e2/', '/media/');
  return getJson(media).then(function(mediaJson) {
    var encrypted = mediaJson && mediaJson.result;
    if (!encrypted) throw new Error('No encrypted media');
    return postJson(API + '/dec-rapid', { text: encrypted, agent: HEADERS['User-Agent'] });
  }).then(function(j) { return j.result; });
}
function formatStreamsData(rapidResult) {
  var streams = [];
  if (rapidResult && typeof rapidResult === 'object') {
    (rapidResult.sources || []).forEach(function(src) {
      if (src && src.file) streams.push({ url: src.file, quality: src.file.includes('.m3u8') ? 'Adaptive' : src.label || 'unknown', provider: 'rapidshare' });
    });
  }
  return streams;
}
function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  return new Promise(function(resolve) {
    findInDatabase(tmdbId, mediaType).then(function(dbResult) {
      if (!dbResult) { resolve([]); return; }
      var info = dbResult.info;
      var eid = null;
      var selSeason = String(seasonNum || 1);
      var selEpisode = String(episodeNum || 1);
      if (dbResult.episodes && dbResult.episodes[selSeason] && dbResult.episodes[selSeason][selEpisode]) {
        eid = dbResult.episodes[selSeason][selEpisode].eid;
      }
      if (!eid) { resolve([]); return; }
      encrypt(eid).then(function(encEid) {
        return getJson(YFLIX_AJAX + '/links/list?eid=' + eid + '&_=' + encEid);
      }).then(function(serversResp) { return parseHtml(serversResp.result); })
      .then(function(servers) {
        var allStreams = [];
        var promises = [];
        Object.keys(servers).forEach(function(serverType) {
          Object.keys(servers[serverType]).forEach(function(serverKey) {
            var lid = servers[serverType][serverKey].lid;
            promises.push(encrypt(lid).then(function(encLid) {
              return getJson(YFLIX_AJAX + '/links/view?id=' + lid + '&_=' + encLid);
            }).then(function(embedResp) { return decrypt(embedResp.result); })
            .then(function(decrypted) {
              if (decrypted && decrypted.url && decrypted.url.includes('rapidshare.cc')) {
                return decryptRapidMedia(decrypted.url).then(function(rapidData) {
                  var formatted = formatStreamsData(rapidData);
                  formatted.forEach(function(s) { s.serverType = serverType; s.serverKey = serverKey; allStreams.push(s); });
                });
              }
              return null;
            }).catch(function() { return null; }));
          });
        });
        return Promise.all(promises).then(function() {
          var seen = new Set();
          var unique = allStreams.filter(function(s) { if (!s || !s.url || seen.has(s.url)) return false; seen.add(s.url); return true; });
          resolve(unique.map(function(s) { return { name: 'YFlix ' + (s.serverType || 'Server') + ' - ' + (s.quality || 'Unknown'), title: info.title_en || 'Stream', url: s.url, quality: s.quality || 'Unknown', headers: HEADERS, provider: 'yflix' }; }));
        });
      });
    }).catch(function() { resolve([]); });
  });
}
module.exports = { getStreams: getStreams };
`.trim(),

  // ── MovieBox (compiled, requires crypto-js) ──
  moviebox: `
var __create = Object.create;
var __defProp = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    }
  return a;
};
var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target, mod));
var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = (value) => { try { step(generator.next(value)); } catch (e) { reject(e); } };
    var rejected = (value) => { try { step(generator.throw(value)); } catch (e) { reject(e); } };
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};
var API_BASE = "https://api3.aoneroom.com";
var KEY_B64_DEFAULT = "NzZpUmwwN3MweFNOOWpxbUVXQXQ3OUVCSlp1bElRSXNWNjRGWnIyTw==";
var KEY_B64_ALT = "WHFuMm5uTzQxL0w5Mm8xaXVYaFNMSFRiWHZZNFo1Wlo2Mm04bVNMQQ==";
var TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
var TMDB_BASE_URL = "https://api.themoviedb.org/3";
var BRAND_MODELS = { "Samsung": ["SM-S918B", "SM-A528B", "SM-M336B"], "Xiaomi": ["2201117TI", "M2012K11AI", "Redmi Note 11"], "OnePlus": ["LE2111", "CPH2449", "IN2023"], "Google": ["Pixel 6", "Pixel 7", "Pixel 8"], "Realme": ["RMX3085", "RMX3360", "RMX3551"] };
var PACKAGE_INFO = { package_name: "com.community.mbox.in", version_name: "3.0.03.0529.03", version_code: 50020042 };
var SECRET_KEY_DEFAULT, SECRET_KEY_ALT;
var deviceId = "", selectedBrand = "", selectedModel = "";
function initializeSession() {
  if (!deviceId) {
    var chars = "0123456789abcdef";
    for (var i = 0; i < 32; i++) deviceId += chars[Math.floor(Math.random() * 16)];
    var brands = Object.keys(BRAND_MODELS);
    selectedBrand = brands[Math.floor(Math.random() * brands.length)];
    var models = BRAND_MODELS[selectedBrand];
    selectedModel = models[Math.floor(Math.random() * models.length)];
  }
}
function md5(input) { return CryptoJS.MD5(input).toString(CryptoJS.enc.Hex); }
function hmacMd5(key, data) { return CryptoJS.HmacMD5(data, key).toString(CryptoJS.enc.Base64); }
function generateXClientToken(timestamp) {
  var ts = (timestamp || Date.now()).toString();
  var reversed = ts.split("").reverse().join("");
  var hash = md5(reversed);
  return ts + "," + hash;
}
function buildCanonicalString(method, accept, contentType, url, body, timestamp) {
  var path = "", query = "";
  try {
    var urlObj = new URL(url);
    path = urlObj.pathname;
    var params = Array.from(urlObj.searchParams.keys()).sort();
    if (params.length > 0) query = params.map(function(k) { return urlObj.searchParams.getAll(k).map(function(v) { return k + "=" + v; }).join("&"); }).join("&");
  } catch(e) {
    if (url.includes("?")) { var parts = url.split("?"); path = parts[0].replace(/https?:\\\/\\\/[^\\/]+/, ""); query = parts[1].split("&").sort().join("&"); }
    else path = url.replace(/https?:\\\/\\\/[^\\/]+/, "");
  }
  var canonicalUrl = query ? path + "?" + query : path;
  var bodyHash = "", bodyLength = "";
  if (body) { var bodyWords = CryptoJS.enc.Utf8.parse(body); bodyHash = md5(bodyWords); bodyLength = bodyWords.sigBytes.toString(); }
  return method.toUpperCase() + "\\n" + (accept || "") + "\\n" + (contentType || "") + "\\n" + bodyLength + "\\n" + timestamp + "\\n" + bodyHash + "\\n" + canonicalUrl;
}
function generateXTrSignature(method, accept, contentType, url, body, useAltKey, customTimestamp) {
  var timestamp = customTimestamp || Date.now();
  var canonical = buildCanonicalString(method, accept, contentType, url, body, timestamp);
  var secret = useAltKey ? SECRET_KEY_ALT : SECRET_KEY_DEFAULT;
  var signatureB64 = hmacMd5(secret, canonical);
  return timestamp + "|2|" + signatureB64;
}
function movieBoxRequest(method, url, body, customHeaders) {
  return __async(this, null, function* () {
    initializeSession();
    var timestamp = Date.now();
    var xClientToken = generateXClientToken(timestamp);
    var contentType = (customHeaders && customHeaders["Content-Type"]) || (body ? "application/json; charset=utf-8" : "application/json");
    var accept = (customHeaders && customHeaders["Accept"]) || "application/json";
    var xTrSignature = generateXTrSignature(method, accept, contentType, url, body, false, timestamp);
    var xClientInfo = JSON.stringify(__spreadProps(__spreadValues({}, PACKAGE_INFO), { os: "android", os_version: "16", device_id: deviceId, install_store: "ps", gaid: "d7578036d13336cc", brand: selectedBrand.toLowerCase(), model: selectedModel, system_language: "en", net: "NETWORK_WIFI", region: "IN", timezone: "Asia/Calcutta", sp_code: "" }));
    var headers = __spreadValues({ "Accept": accept, "Content-Type": contentType, "x-client-token": xClientToken, "x-tr-signature": xTrSignature, "User-Agent": PACKAGE_INFO.package_name + "/" + PACKAGE_INFO.version_code + " (Linux; U; Android 16; en_IN; " + selectedModel + "; Build/BP22.250325.006; Cronet/133.0.6876.3)", "x-client-info": xClientInfo, "x-client-status": "0" }, customHeaders);
    var options = { method: method, headers: headers };
    if (body) options.body = body;
    var retries = 2;
    while (retries > 0) {
      try {
        var res = yield fetch(url, options);
        if (!res.ok) { if (res.status === 403 || res.status === 429) { retries--; yield new Promise(function(r) { setTimeout(r, 1000); }); continue; } return null; }
        var text = yield res.text();
        var parsed = null;
        try { parsed = JSON.parse(text); } catch(e) { parsed = text; }
        return { data: parsed, headers: res.headers };
      } catch(err) { retries--; if (retries === 0) return null; yield new Promise(function(r) { setTimeout(r, 1000); }); }
    }
    return null;
  });
}
function fetchTmdbDetails(tmdbId, mediaType) {
  return __async(this, null, function* () {
    try {
      var url = TMDB_BASE_URL + "/" + mediaType + "/" + tmdbId + "?api_key=" + TMDB_API_KEY;
      var res = yield fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36", "Accept": "application/json" } });
      var data = yield res.json();
      return { title: mediaType === "movie" ? data.title || data.original_title : data.name || data.original_name, year: (data.release_date || data.first_air_date || "").substring(0, 4), imdbId: data.external_ids ? data.external_ids.imdb_id : null, originalTitle: data.original_title || data.original_name };
    } catch(e) { return null; }
  });
}
function normalizeTitle(s) {
  if (!s) return "";
  return s.replace(/\\[.*?\\]/g, " ").replace(/\\(.*?|/g, " ").replace(/\\b(dub|dubbed|hd|4k|hindi|tamil|telugu|dual audio)\\b/gi, " ").trim().toLowerCase().replace(/:/g, " ").replace(/[^\\w\\s]/g, " ").replace(/\\s+/g, " ");
}
function parseQualityNumber(value) { var m = String(value||"").match(/(\\d{3,4})/); return m ? parseInt(m[1],10) : 0; }
function getFormatType(url) { var u = String(url||"").toLowerCase(); if(u.includes(".mpd"))return "DASH"; if(u.includes(".m3u8"))return "HLS"; if(u.includes(".mp4"))return "MP4"; if(u.includes(".mkv"))return "MKV"; return "VIDEO"; }
function searchMovieBox(query) {
  return __async(this, null, function* () {
    var url = API_BASE + "/wefeed-mobile-bff/subject-api/search/v2";
    var body = JSON.stringify({ page: 1, perPage: 20, keyword: query });
    var response = yield movieBoxRequest("POST", url, body);
    if (response && response.data && response.data.data && response.data.data.results) {
      var allSubjects = [];
      response.data.data.results.forEach(function(group) { if (group.subjects) allSubjects = allSubjects.concat(group.subjects); });
      return allSubjects;
    }
    return [];
  });
}
function findBestMatch(subjects, tmdbTitle, tmdbYear, mediaType) {
  var normTmdbTitle = normalizeTitle(tmdbTitle);
  var targetType = mediaType === "movie" ? 1 : 2;
  var bestMatch = null, bestScore = 0;
  for(var _i=0; _i<subjects.length; _i++) {
    var subject = subjects[_i];
    if (subject.subjectType !== targetType) continue;
    var title = subject.title;
    var normTitle = normalizeTitle(title);
    var year = subject.year || (subject.releaseDate ? subject.releaseDate.substring(0,4) : null);
    var score = 0;
    if (normTitle === normTmdbTitle) score += 50;
    else if (normTitle.includes(normTmdbTitle) || normTmdbTitle.includes(normTitle)) score += 15;
    if (tmdbYear && year && tmdbYear == year) score += 35;
    if (score > bestScore) { bestScore = score; bestMatch = subject; }
  }
  return bestScore >= 40 ? bestMatch : null;
}
function fetchSubtitles(subjectId, streamId, authHeaders, langLabel) {
  return __async(this, null, function* () {
    var subtitles = [];
    try {
      var capUrl = API_BASE + "/wefeed-mobile-bff/subject-api/get-stream-captions?subjectId=" + subjectId + "&streamId=" + streamId;
      var capRes = yield movieBoxRequest("GET", capUrl, null, authHeaders);
      if (capRes && capRes.data && capRes.data.data && Array.isArray(capRes.data.data.extCaptions)) {
        capRes.data.data.extCaptions.forEach(function(cap) { if (cap.url) subtitles.push({ url: cap.url, language: cap.language || cap.lanName || cap.lan || "en", name: (cap.lanName || cap.language || "Subtitle") + " (" + langLabel + ")", headers: { "Referer": API_BASE } }); });
      }
    } catch(e) {}
    try {
      var extCapUrl = API_BASE + "/wefeed-mobile-bff/subject-api/get-ext-captions?subjectId=" + subjectId + "&resourceId=" + streamId + "&episode=0";
      var extRes = yield movieBoxRequest("GET", extCapUrl, null, authHeaders);
      if (extRes && extRes.data && extRes.data.data && Array.isArray(extRes.data.data.extCaptions)) {
        extRes.data.data.extCaptions.forEach(function(cap) { if (cap.url) subtitles.push({ url: cap.url, language: cap.lan || cap.lanName || cap.language || "en", name: (cap.lanName || cap.lan || "Subtitle") + " (" + langLabel + ")", headers: { "Referer": API_BASE } }); });
      }
    } catch(e) {}
    return subtitles;
  });
}
function getStreamLinks(subjectId, season, episode, mediaTitle, mediaType) {
  return __async(this, null, function* () {
    var subjectUrl = API_BASE + "/wefeed-mobile-bff/subject-api/get?subjectId=" + subjectId;
    var detailRes = yield movieBoxRequest("GET", subjectUrl);
    if (!detailRes || !detailRes.data || !detailRes.data.data) return [];
    var xUserHeader = detailRes.headers ? detailRes.headers.get("x-user") : null;
    var token = null;
    if (xUserHeader) { try { token = JSON.parse(xUserHeader).token; } catch(e) {} }
    var subjectIds = [];
    var originalLang = "Original";
    var dubs = detailRes.data.data.dubs;
    if (Array.isArray(dubs)) {
      dubs.forEach(function(dub) { if (dub.subjectId == subjectId) originalLang = dub.lanName || "Original"; else subjectIds.push({ id: dub.subjectId, lang: dub.lanName }); });
    }
    subjectIds.unshift({ id: subjectId, lang: originalLang });
    var authHeaders = token ? { "Authorization": "Bearer " + token } : {};
    var allStreams = [];
    for(var _i=0; _i<subjectIds.length; _i++) {
      var item = subjectIds[_i];
      try {
        var playUrl = API_BASE + "/wefeed-mobile-bff/subject-api/play-info?subjectId=" + item.id + "&se=" + season + "&ep=" + episode;
        var playRes = yield movieBoxRequest("GET", playUrl, null, authHeaders);
        if (playRes && playRes.data && playRes.data.data) {
          var playData = playRes.data.data;
          var streamsList = playData.streams;
          if (Array.isArray(streamsList) && streamsList.length > 0) {
            for(var _a=0; _a<streamsList.length; _a++) {
              var stream = streamsList[_a];
              if (!stream.url) continue;
              var formatType = getFormatType(stream.url);
              var qualLabel = stream.resolutions || stream.quality || "Auto";
              var qualNum = parseQualityNumber(qualLabel);
              var quality = qualNum ? qualNum + "p" : "Auto";
              var streamId = stream.id || item.id + "|" + season + "|" + episode;
              var subtitles = yield fetchSubtitles(item.id, streamId, authHeaders, item.lang);
              allStreams.push({ name: "MovieBox", title: mediaTitle + (season > 0 ? " S" + season + "E" + episode : "") + " (" + item.lang + ") - " + quality + " [" + formatType + "]", url: stream.url, quality: quality, headers: __spreadValues({ "Referer": API_BASE, "User-Agent": "com.community.mbox.in/50020042 (Linux; U; Android 16; en_IN; MovieBox; Build/BP22.250325.006; Cronet/133.0.6876.3)" }, stream.signCookie ? { "Cookie": stream.signCookie } : {}), subtitles: subtitles, provider: "moviebox" });
            }
          }
        }
      } catch(err) {}
    }
    return allStreams;
  });
}
function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  return __async(this, null, function* () {
    var details = yield fetchTmdbDetails(tmdbId, mediaType);
    if (!details) return [];
    var subjects = yield searchMovieBox(details.title);
    var bestMatch = findBestMatch(subjects, details.title, details.year, mediaType);
    if (!bestMatch && details.originalTitle && details.originalTitle !== details.title) {
      subjects = yield searchMovieBox(details.originalTitle);
      bestMatch = findBestMatch(subjects, details.originalTitle, details.year, mediaType);
    }
    if (bestMatch) {
      var s = mediaType === "tv" ? seasonNum : 0;
      var e = mediaType === "tv" ? episodeNum : 0;
      return yield getStreamLinks(bestMatch.subjectId, s, e, details.title, mediaType);
    }
    return [];
  });
}
module.exports = { getStreams: getStreams };
`.trim(),

  // ── Castle (compiled, requires crypto-js) ──
  castle: `
var __defProp = Object.defineProperty;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => { for (var name in all) __defProp(target, name, { get: all[name], enumerable: true }); };
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of Object.getOwnPropertyNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = Object.getOwnPropertyDescriptor(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = (value) => { try { step(generator.next(value)); } catch (e) { reject(e); } };
    var rejected = (value) => { try { step(generator.throw(value)); } catch (e) { reject(e); } };
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};
var castle_exports = {};
__export(castle_exports, { getStreams: () => getStreams });
module.exports = __toCommonJS(castle_exports);
var CryptoJS = require("crypto-js");
var SITE = "https://castle-downloader.xyz";
var HEADERS = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36" };
function md5(text) { return CryptoJS.MD5(text).toString(); }
function generateToken(apiKey) {
  var time = Math.floor(Date.now() / 1e3);
  var tokenStr = time + apiKey;
  return btoa(time + "::" + md5(tokenStr));
}
function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  return __async(this, null, function* () {
    var keyUrl = SITE + "/api/v1/credentials";
    var keyRes = yield fetch(keyUrl, { headers: HEADERS });
    var keyData = yield keyRes.json();
    if (!keyData || !keyData.api_key) return [];
    var apiKey = keyData.api_key;
    var token = generateToken(apiKey);
    var searchUrl = SITE + "/api/v1/omdb/search?tmdb_id=" + tmdbId + "&type=" + mediaType + "&token=" + token + "&api_key=" + apiKey;
    var searchRes = yield fetch(searchUrl, { headers: HEADERS });
    var searchData = yield searchRes.json();
    if (!searchData || !searchData.id) return [];
    var contentId = searchData.id;
    var streamUrl;
    if (mediaType === "tv" && seasonNum && episodeNum) {
      streamUrl = SITE + "/api/v1/omdb/stream?content_id=" + contentId + "&season=" + seasonNum + "&episode=" + episodeNum + "&token=" + token + "&api_key=" + apiKey;
    } else {
      streamUrl = SITE + "/api/v1/omdb/stream?content_id=" + contentId + "&token=" + token + "&api_key=" + apiKey;
    }
    var streamRes = yield fetch(streamUrl, { headers: HEADERS });
    var streamData = yield streamRes.json();
    if (!streamData || !streamData.sources || !Array.isArray(streamData.sources)) return [];
    return streamData.sources.filter(function(s) { return s && s.url; }).map(function(s) {
      return { name: "Castle", title: searchData.title || "Stream", url: s.url, quality: s.quality || "Auto", headers: HEADERS, provider: "castle" };
    });
  });
}
module.exports = { getStreams: getStreams };
`.trim(),
};
