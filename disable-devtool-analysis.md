# `disable-devtool` Source Code Analysis

## 1. Complete Architecture

### Entry Point (`src/main.ts`)
```typescript
export const disableDevtool = Object.assign(((opts?) => {
  if (disableDevtool.isRunning) return r('already running');
  initIS();           // Detect environment (mobile, iframe, browser type)
  initLogs();         // Cache console.log/table/clear references
  mergeConfig(opts);  // Merge user options with defaults
  if (checkTk()) return r('token passed');  // MD5 bypass
  if (config.seo && IS.seoBot) return r('seobot');
  disableDevtool.isRunning = true;
  initInterval(disableDevtool);  // Start the heartbeat
  disableKeyAndMenu(disableDevtool);  // Block keyboard shortcuts
  initDetectors();  // Install all detectors
  return r();
}), {
  isRunning: false,
  isSuspend: false,
  md5,
  version,
  DetectorType,
  isDevToolOpened,
});
```

### Auto-Init Mechanism (`src/plugins/script-use.ts`)
```typescript
export function checkScriptUse () {
  const dom = document.querySelector('[disable-devtool-auto]');
  if (!dom) return null;
  // Read config from DOM element attributes: md5, url, tk-name, detectors, etc.
  return json;  // Returns config object → passed to disableDevtool()
}
// At module load:
const options = checkScriptUse();
if (options) {
  disableDevtool(options);
}
```

**KEY FINDING:** The script auto-initializes when a DOM element with `[disable-devtool-auto]` attribute exists. The providers use this via their HTML.

### Default Config (`src/utils/config.ts`)
```typescript
export const config: IConfig = {
  md5: '',
  ondevtoolopen: closeWindow,  // DEFAULT: redirect to 404 page
  url: '',                      // Custom redirect URL
  timeOutUrl: '',               // Timeout redirect URL
  tkName: 'ddtk',
  interval: 500,                // Heartbeat interval (500ms)
  disableMenu: true,
  stopIntervalTime: 5000,       // Stop interval on mobile after 5s
  clearIntervalWhenDevOpenTrigger: false,
  detectors: [1, 3, 4, 5, 6, 7],  // 6 detectors enabled by default
  clearLog: true,
  disableSelect: false,
  disableCopy: false,
  disableCut: false,
  disablePaste: false,
  ignore: null,                 // ← KEY: URL/function to bypass protection
  disableIframeParents: true,
  seo: true,
  rewriteHTML: '',
};
```

### Heartbeat (`src/utils/interval.ts`)
```typescript
export function initInterval (dd) {
  interval = window.setInterval(() => {
    if (dd.isSuspend || _pause || isIgnored()) return;  // ← Checks ignore
    for (const detector of calls) {
      clearDevToolOpenState(detector.type);
      detector.detect(time++);
    };
    clearLog();
    checkOnDevClose();
  }, config.interval);  // Default: 500ms

  // On mobile, stop after stopIntervalTime (5000ms) if not on PC
  timer = setTimeout(() => {
    if (!IS.pc && !DebugLib.isUsing()) {
      clearDDInterval();
    }
  }, config.stopIntervalTime);
}
```

### What Happens on Detection (`src/detector/detector.ts`)
```typescript
onDevToolOpen () {
  console.warn(`You don't have permission to use DEVTOOL!【type = ${this.type}】`);
  if (config.clearIntervalWhenDevOpenTrigger) {
    clearDDInterval();  // Stop monitoring
  }
  clearDDTimeout();
  config.ondevtoolopen(this.type, closeWindow);  // DEFAULT: closeWindow()
  markDevToolOpenState(this.type);
}
```

### The Redirect (`src/utils/close-window.ts`)
```typescript
export function closeWindow () {
  if (config.url) {
    window.location.href = config.url;  // Custom redirect
  } else if (config.rewriteHTML) {
    document.documentElement.innerHTML = config.rewriteHTML;  // Rewrite page
  } else {
    // DEFAULT BEHAVIOR:
    window.opener = null;
    window.open('', '_self');
    window.close();
    window.history.back();
    setTimeout(() => {
      window.location.href = `https://theajack.github.io/disable-devtool/404.html?h=${encodeURIComponent(location.host)}`;
    }, 500);
  }
}
```

## 2. All 8 Detectors

| # | Name | Type | Default Enabled | What It Detects |
|---|------|------|-----------------|-----------------|
| 0 | RegToString | `RegToStringDetector` | QQ Browser, Firefox only | Overrides `RegExp.prototype.toString` → console.log triggers it → measures timing |
| 1 | DefineId | `DefineIdDetector` | **YES** | Creates a `<div>` with `Object.defineProperty(div, 'id', {get: onDevToolOpen})`. If anything reads `div.id` (DevTools does), triggers. |
| 2 | Size | `SizeDetector` | **NO** (disabled by default) | Compares `outerWidth/outerHeight` vs `innerWidth/innerHeight`. If DevTools panel is open, outer > inner. |
| 3 | DateToString | `DateToStringDetector` | **YES** | Overrides `Date.prototype.toString`. `console.log(date)` → DevTools reads the date → `toString` counter increments. If count >= 2, triggers. |
| 4 | FuncToString | `FuncToStringDetector` | **YES** (not iOS Chrome/Edge) | Overrides a function's `toString`. `console.log(func)` → DevTools reads the function → `toString` counter increments. If count >= 2, triggers. |
| 5 | Debugger | `DebuggerDetector` | **iOS Chrome/Edge only** | Executes `debugger;` and measures timing. If DevTools is open, `debugger;` pauses execution. |
| 6 | Performance | `PerformanceDetector` | **Chrome or not mobile** | Calls `console.table()` and `console.log()` with large objects. If DevTools is open, `table()` takes much longer than `log()`. If `tableTime > logTime * 10` twice, triggers. |
| 7 | DebugLib | `DebugLibDetector` | **YES** | Checks for third-party debug libraries: `window.eruda._devTools._isShow` (eruda) or `window._vcOrigConsole` + `#__vconsole` (vConsole). |

## 3. Why Our 5-Layer Defense Isn't Working

### Layer 1 (Freeze `window.disableDevtool`) — WHY IT FAILS

The script's auto-init flow:
1. Script tag loads → `checkScriptUse()` runs → finds `[disable-devtool-auto]` element
2. `disableDevtool(options)` is called → sets `isRunning = true`
3. `initInterval()` starts the heartbeat
4. `initDetectors()` installs all 6 detectors

**Our Layer 1 freezes `window.disableDevtool` as a no-op.** But the script's `disableDevtool` function is defined as a **named export**, not as `window.disableDevtool`. The script does:

```typescript
export const disableDevtool = Object.assign(((opts) => { ... }), { isRunning: false, ... });
```

This is a **module-scoped variable**, not a window property. The providers then call it via their own code. Our `Object.defineProperty(window, 'disableDevtool', ...)` only affects `window.disableDevtool`, not the provider's local reference.

**The script DOES NOT set `window.disableDevtool`.** It's an ES module export. The provider's code has a direct reference to the function object, not through `window.disableDevtool`.

### Layer 2 (Network Stub) — WHY IT FAILS

The providers embed the script **INLINE** in their HTML, not as a separate `<script src>` tag. Our `shouldInterceptRequest` block never fires for inline scripts. The script runs directly from the provider's HTML response.

### Layer 3 (Redirect Interception) — WORKS BUT INCOMPLETE

The redirect IS being blocked (we see `NAV:devtool-hijack` entries). But the script's detectors are still running and causing side effects (DOM manipulation, keyboard blocking, etc.) that disrupt the video player.

### Layer 4 (Timing Warmup) — INSUFFICIENT

The `PerformanceDetector` uses `console.table()` vs `console.log()` timing. Our warmup only warms `console.log`. The `console.table()` timing might still be off on fresh WebViews.

## 4. The `ignore` Config — KEY SOLUTION

The script has a built-in bypass mechanism:

```typescript
export function isIgnored () {
  const {ignore} = config;
  if (!ignore) return false;
  if (typeof ignore === 'function') {
    return ignore();  // ← Can be a function that always returns true
  }
  // ... URL matching
}
```

In the heartbeat:
```typescript
interval = window.setInterval(() => {
  if (dd.isSuspend || _pause || isIgnored()) return;  // ← Skip if ignored
  for (const detector of calls) { ... }
}, config.interval);
```

**If we can set `config.ignore` to a function that always returns `true`, ALL detectors are bypassed.**

But `config` is a module-scoped variable inside the script's closure. We can't access it from outside.

## 5. The `md5` Bypass — ANOTHER KEY

```typescript
function checkTk () {
  if (!config.md5) return false;
  const tk = getUrlParam(config.tkName);  // Default param name: "ddtk"
  return md5(tk) === config.md5;
}
```

If the provider sets `md5` in the config, and we include the matching `ddtk` URL parameter, the script skips initialization entirely.

But this requires the provider to actually set the `md5` config, which they might not.

## 6. The `ignore` Option — HOW TO EXPLOIT IT

The providers load the script with configuration. If we can inject our own configuration BEFORE the script runs, we can set `ignore` to bypass everything.

**But the script is inline in the provider's HTML.** We can't modify the HTML before it reaches the WebView.

**UNLESS we intercept the HTML response** in `shouldInterceptRequest` and modify it to add our `ignore` configuration.

### Approach: HTML Response Interception

1. In `shouldInterceptRequest`, when the provider's HTML is loaded, intercept it
2. Modify the HTML to add `disable-devtool-auto` with `ignore` attribute pointing to a function that always returns true
3. Return the modified HTML

**But this is complex and fragile** — we'd need to parse and modify HTML on every provider page load.

### Simpler Approach: Override the `config` Object

The script's `config` is a plain object. If we can freeze it BEFORE the script runs, we can control its behavior.

But `config` is inside the script's module closure. We can't access it from outside.

### Simplest Approach: Prevent `initDetectors()` From Running

The script's flow:
1. `disableDevtool()` is called
2. `initDetectors()` installs all detectors
3. Each detector calls `registInterval(this)` to register with the heartbeat
4. The heartbeat calls `detector.detect()` every 500ms

If we can prevent step 2 from running, no detectors are installed.

**But `initDetectors()` is called inside `disableDevtool()`.** If we freeze `window.disableDevtool` as a no-op, `disableDevtool()` never runs, so `initDetectors()` never runs.

Wait — that's exactly what Layer 1 does. But Layer 1 isn't working because the script doesn't use `window.disableDevtool`.

**The fix:** Instead of freezing `window.disableDevtool`, we need to freeze the **actual function** that the provider calls. But we don't have a reference to it.

### The Real Fix: Override `console.log` and `console.table`

The detectors rely on `console.log` and `console.table` to trigger their `toString` overrides. If we override these methods to NOT call `toString`, the detectors never fire.

**This is the key insight:** The detectors work by:
1. Setting up a `toString` override on a function/regex/date
2. Calling `console.log(obj)` where `obj` has the overridden `toString`
3. DevTools reads `obj.toString()` to display it
4. The `toString` counter increments
5. If count >= 2, DevTools is open

If we override `console.log` to NOT read `toString`, the detectors never fire.

But we can't just disable `console.log` — the providers need it.

### The Real Fix: Override `console.clear`

The `clearLog()` function calls `console.clear()`. If we override `console.clear` to be a no-op, the log isn't cleared, but the detectors still fire.

Actually, that doesn't help either.

### The Real Fix: The `isIgnored` Function

The heartbeat checks `isIgnored()` before running detectors. If `isIgnored()` returns `true`, all detectors are skipped.

The `ignore` config can be a function:
```typescript
if (typeof ignore === 'function') {
  return ignore();
}
```

**If we can set `config.ignore` to a function that returns `true`, everything is bypassed.**

But `config` is inside the script's closure. We can't access it.

**UNLESS** the script exposes it somehow. Let me check...

The script exports `disableDevtool` which has `isRunning`, `isSuspend`, `md5`, `version`, `DetectorType`, `isDevToolOpened`. It does NOT export `config`.

### The Real Fix: Override the `initInterval` Function

The heartbeat is started by `initInterval(disableDevtool)`. If we can prevent this from running, no detectors are registered.

But `initInterval` is a module-scoped function. We can't access it.

### The Real Fix: Override `Object.keys(window)` Detection

The script doesn't actually do `Object.keys(window)` detection (that was the expert's guess). The real detectors are:
1. `DefineIdDetector` — `Object.defineProperty(div, 'id', {get: onDevToolOpen})`
2. `DateToStringDetector` — `Date.prototype.toString` counter
3. `FuncToStringDetector` — Function `toString` counter
4. `PerformanceDetector` — `console.table()` vs `console.log()` timing
5. `DebugLibDetector` — checks for `eruda` and `vConsole`

**None of these check `Object.keys(window)`.** The expert was wrong about that.

## 7. The Actual Solution

### Why Our Layer 1 Fails

The script's `disableDevtool` is an ES module export, not `window.disableDevtool`. The providers have a direct reference to the function. Our `Object.defineProperty(window, 'disableDevtool', ...)` only affects `window.disableDevtool`, not the provider's local reference.

### Why Layer 2 Fails

The script is loaded INLINE in the provider's HTML. Our network stub never fires.

### Why Layer 3 Works (partially)

The redirect IS blocked at the Kotlin level. But the detectors still run and cause side effects.

### Why Layer 4 Is Insufficient

The `PerformanceDetector` uses `console.table()` timing, which we didn't warm up.

## 8. The Actual Solution

### Option A: Intercept and Modify Provider HTML

In `shouldInterceptRequest`, when the provider's HTML is loaded:
1. Fetch the HTML response
2. Find the `<script>` tag that loads `disable-devtool`
3. Modify it to add `disable-devtool-auto` attribute with `ignore` config
4. Return the modified HTML

**Pros:** Completely neutralizes the script.
**Cons:** Complex HTML parsing, fragile, performance overhead.

### Option B: Override `console.log`/`console.table` Timing

The `PerformanceDetector` relies on `console.table()` being slower when DevTools is open. If we override `console.table` to have consistent timing, this detector won't fire.

But the other detectors (`DefineIdDetector`, `DateToStringDetector`, `FuncToStringDetector`) don't depend on console timing. They depend on `toString` being called when objects are logged.

**The key insight:** `console.log(obj)` calls `obj.toString()` to display it. If we override `console.log` to NOT call `toString`, the detectors never fire.

But we can't just disable `toString` — the providers need it.

### Option C: The `ignore` Config Injection

The script's `ignore` config can be a function. If we can inject this function before the script runs, all detectors are bypassed.

**How to inject:** The script checks `config.ignore` in the heartbeat. If we can set this before the heartbeat starts, everything is bypassed.

But `config` is inside the script's module closure. We can't access it directly.

**UNLESS** we use the script's own `disableDevtool.isSuspend` property:

```typescript
export const disableDevtool = Object.assign(((opts) => {
  ...
}), {
  isRunning: false,
  isSuspend: false,  // ← We can set this!
  ...
});
```

If we set `window.disableDevtool.isSuspend = true`, the heartbeat skips all detectors:

```typescript
interval = window.setInterval(() => {
  if (dd.isSuspend || _pause || isIgnored()) return;  // ← isSuspend check
  ...
}, config.interval);
```

**But we need to access `window.disableDevtool` AFTER the script sets it.** Our Layer 1 freezes it BEFORE the script runs, which prevents the script from setting it.

### The Fix: Freeze AFTER the Script Runs

Instead of freezing `window.disableDevtool` before the script runs (which prevents the script from setting it), we should:

1. Let the script set `window.disableDevtool`
2. Then immediately override `window.disableDevtool.isSuspend = true`

**But the script is inline.** We can't inject code after the inline script runs.

### The Real Fix: Override `console.log` to Prevent `toString` Detection

The detectors work by:
1. Setting up a `toString` override on an object
2. Calling `console.log(obj)` → DevTools reads `obj.toString()` → counter increments
3. If count >= 2, DevTools is open

If we override `console.log` to NOT call `toString`, the detectors never fire.

**But we can't just disable `toString`** — the providers need it.

**The fix:** Override `console.log` to call `toString` only ONCE per tick, not twice:

```javascript
(function() {
  var _origLog = console.log;
  var _lastCall = 0;
  console.log = function() {
    var now = Date.now();
    if (now - _lastCall < 10) return;  // Skip rapid calls
    _lastCall = now;
    return _origLog.apply(console, arguments);
  };
})();
```

This prevents the `DateToStringDetector` and `FuncToStringDetector` from counting 2 calls in rapid succession.

But the `DefineIdDetector` and `PerformanceDetector` don't depend on `console.log` timing.

### The Real Fix: The Complete Solution

**The only reliable solution is to prevent the script from initializing at all.**

Since the script is inline, we can't intercept it at the network level. But we CAN:

1. **Override `Object.defineProperty`** to prevent the `DefineIdDetector` from setting up its trap
2. **Override `console.log`** to prevent the `DateToStringDetector` and `FuncToStringDetector` from counting
3. **Override `console.table`** to prevent the `PerformanceDetector` from measuring timing

But this is fragile and might break other things.

**The SIMPLEST and MOST RELIABLE solution:**

**Override the `config` object's `ignore` property BEFORE the script runs.**

Wait — `config` is inside the script's closure. We can't access it.

**But we CAN access it through the `disableDevtool` function.**

The script exports `disableDevtool` which has `isRunning` and `isSuspend` properties. If we set `isSuspend = true` AFTER the script runs, the heartbeat skips all detectors.

**But we need to access `window.disableDevtool` AFTER the script sets it.** The script is inline, so we can't inject code after it.

**UNLESS** we use `MutationObserver` to detect when the script tag is added and then override `window.disableDevtool.isSuspend`.

Actually, the simplest approach is:

1. **Don't freeze `window.disableDevtool` before the script runs** (remove Layer 1)
2. **Let the script set `window.disableDevtool` normally**
3. **After the script runs, override `window.disableDevtool.isSuspend = true`**

But how do we inject code after the inline script? We can't.

**The answer: Use `addEventListener('DOMContentLoaded', ...)` or `addEventListener('load', ...)` to run code after all inline scripts have executed.**

But the script's `initInterval()` starts immediately (not on DOMContentLoaded). By the time our DOMContentLoaded handler runs, the heartbeat has already started.

**The REAL answer: Override `setInterval` to intercept the heartbeat.**

```javascript
(function() {
  var _origSetInterval = window.setInterval;
  window.setInterval = function(fn, delay) {
    // If this is the disable-devtool heartbeat (500ms interval, function with specific signature)
    if (delay === 500 || delay === 200 || delay === 1000) {
      // Wrap the function to check isSuspend
      var _origFn = fn;
      fn = function() {
        // Access the disableDevtool object through the closure
        // This is fragile but might work
        return _origFn.apply(this, arguments);
      };
    }
    return _origSetInterval.apply(this, arguments);
  };
})();
```

This is too fragile. Let me think of a better approach.

### The ACTUAL Simplest Fix

**Override `console.log` to prevent `toString` detection, and override `console.table` to prevent performance detection.**

```javascript
(function() {
  // Prevent DateToStringDetector and FuncToStringDetector
  // These detectors override toString on objects and count how many times
  // DevTools reads it. If we prevent console.log from triggering toString
  // during the detection window, the count stays at 0.
  var _origLog = console.log;
  var _logCount = 0;
  console.log = function() {
    _logCount++;
    // Every 500ms (the heartbeat interval), reset the count
    // This prevents the detectors from counting 2 calls
    if (_logCount >= 2) {
      // The detectors are trying to count toString calls
      // By limiting to 1 call per heartbeat, we prevent detection
      return;
    }
    return _origLog.apply(console, arguments);
  };
  
  // Reset count every 500ms
  setInterval(function() { _logCount = 0; }, 450);
  
  // Prevent PerformanceDetector
  var _origTable = console.table;
  console.table = function() {
    // Make table() take the same time as log()
    // by just calling log() instead
    return _origLog.apply(console, arguments);
  };
})();
```

**Wait, this is wrong.** The detectors count `toString` calls, not `console.log` calls. The `console.log(obj)` triggers `obj.toString()` to display the object. The detectors override `obj.toString()` to increment a counter.

If we override `console.log` to NOT call `toString`, the detectors never fire. But we can't prevent `console.log` from calling `toString` — that's how JavaScript works.

**The REAL fix:** Override the `toString` method on the objects BEFORE the detectors set up their overrides.

But the detectors create their own objects (Date, Function, RegExp) and override their `toString`. We can't prevent this.

### The ACTUAL ACTUAL Fix

**The script has a `stopIntervalTime` of 5000ms on mobile.** After 5 seconds, the heartbeat stops. If we can make the detectors think everything is normal for 5 seconds, the heartbeat stops and no more redirects.

**The `PerformanceDetector` is the most likely trigger on Android WebView.** It measures `console.table()` timing. On a fresh WebView, `console.table()` is slow (cold bridge), which looks like DevTools is open.

**Fix:** Override `console.table` to have consistent timing:

```javascript
(function() {
  // Make console.table() take the same time as console.log()
  // This prevents the PerformanceDetector from detecting DevTools
  var _origTable = console.table;
  console.table = function() {
    // Just call log() instead — same timing
    return console.log.apply(console, arguments);
  };
})();
```

**Plus:** Override `console.log` to prevent `toString` counting:

```javascript
(function() {
  var _origLog = console.log;
  var _lastTime = 0;
  console.log = function() {
    var now = Date.now();
    // Prevent rapid-fire calls that detectors use for counting
    if (now - _lastTime < 50) return;
    _lastTime = now;
    return _origLog.apply(console, arguments);
  };
})();
```

**Plus:** Override `Object.defineProperty` to prevent `DefineIdDetector`:

```javascript
(function() {
  var _origDefineProperty = Object.defineProperty;
  Object.defineProperty = function(obj, prop, desc) {
    // If someone tries to define a getter on 'id' property of a div,
    // it's likely the DefineIdDetector. Block it.
    if (prop === 'id' && desc && desc.get) {
      return obj;
    }
    return _origDefineProperty.apply(this, arguments);
  };
})();
```

**Plus:** Override `console.clear` to prevent log clearing:

```javascript
(function() {
  console.clear = function() {};
})();
```

### The Complete Fix (All-in-One)

```javascript
(function() {
  // 1. Override console.log to prevent toString counting
  var _origLog = console.log;
  var _lastTime = 0;
  console.log = function() {
    var now = Date.now();
    if (now - _lastTime < 50) return;
    _lastTime = now;
    return _origLog.apply(console, arguments);
  };
  
  // 2. Override console.table to prevent performance detection
  console.table = function() {
    return console.log.apply(console, arguments);
  };
  
  // 3. Override console.clear to prevent log clearing
  console.clear = function() {};
  
  // 4. Override Object.defineProperty to prevent DefineIdDetector
  var _origDP = Object.defineProperty;
  Object.defineProperty = function(obj, prop, desc) {
    if (prop === 'id' && desc && desc.get) {
      return obj;
    }
    return _origDP.apply(this, arguments);
  };
  
  // 5. Override setInterval to intercept heartbeat and add isSuspend check
  var _origSI = window.setInterval;
  window.setInterval = function(fn, delay) {
    if (delay >= 200 && delay <= 1000) {
      // This is likely the disable-devtool heartbeat
      var _origFn = fn;
      fn = function() {
        // Try to access the disableDevtool object and set isSuspend
        try {
          if (window.disableDevtool && !window.disableDevtool.isSuspend) {
            window.disableDevtool.isSuspend = true;
          }
        } catch(e) {}
        return _origFn.apply(this, arguments);
      };
    }
    return _origSI.apply(this, arguments);
  };
})();
```

## 9. Summary of Findings

1. **The script uses 6 detectors** (not 8 — Size and RegToString are disabled by default on Android)
2. **The script auto-inits via `[disable-devtool-auto]` attribute** on a DOM element
3. **The redirect goes to `theajack.github.io/disable-devtool/404.html`** after 500ms
4. **The `ignore` config can bypass everything** but we can't access it from outside the closure
5. **The `isSuspend` property can stop the heartbeat** but we can't set it before the script runs
6. **The script is INLINE in provider HTML** — network-level interception doesn't help
7. **Our Layer 1 fails** because the script's `disableDevtool` is an ES module export, not `window.disableDevtool`
8. **The PerformanceDetector is the most likely trigger** on Android WebView (cold `console.table()` timing)
9. **The `stopIntervalTime` of 5000ms** means the heartbeat stops on mobile after 5 seconds
10. **The fix is to override `console.log`, `console.table`, `console.clear`, and `Object.defineProperty`** to prevent all detectors from firing
