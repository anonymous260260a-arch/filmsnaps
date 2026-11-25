--=====================================================================
-- FilmSnaps OSC — in-video control bar for mpv 0.42 (libmpv host)
-- Copyright (c) 2026 FilmSnaps. All rights reserved.
--
-- Original work written for FilmSnaps from the documented mpv Lua API
-- (DOCS/man/lua.rst, input.rst, properties.rst, mpv 0.42.0). The only
-- mpv-derived inputs are the public API/property names cited in the
-- documentation. Iconography is an original set drawn in a Lucide-like
-- idiom (2px-equivalent stroke, round caps) on a 24-unit grid.
--
-- File name matters: loaded as `filmsnaps-osc.lua`, the mpv client name
-- becomes `filmsnaps_osc` (dashes are replaced with underscores).
--
-- v1.1 (2026-11-22) hardening after the first in-app run:
--   * pause/mute/fullscreen were written via mp.set_property as Lua
--     booleans. That API takes strings only ("bad argument #2 to
--     'set_property' (string expected, got boolean)"), and the resulting
--     error terminated the whole script on the first click - the control
--     bar then vanished for the rest of the session and every later
--     script-message-to failed with mpv error -12 (MPV_ERROR_COMMAND,
--     dead target client). All property writes now go through
--     set_flag()/set_num() below.
--   * every registered callback is wrapped in shield(): no handler error
--     can kill the script again; errors are logged and swallowed.
--   * the bar scale is DPI-aware (display-hidpi-scale): OSD pixels are
--     physical, so on 125%/150% scaled Windows displays the bar previously
--     read far smaller than the design intends.
--
-- v1.2 (2026-11-22) visual fidelity pass after the first real screenshots:
--   * the hard #0D0D0D strip is gone; the bar sits on a tall gradient scrim
--     so it reads as the video darkening, not a panel pasted on top.
--   * chips are outline pills (1px ring, transparent fill); the old filled
--     chip read as a gray blob over the video.
--   * icons redrawn: ~40% thicker strokes (2 read as gray mush after
--     antialiasing), outline CC box (was a filled slab), simpler skip
--     arrows with the 10 label below, no hover pill.
--   * seek bar: always-visible amber thumb (grows on hover), buffered
--     ranges merged into one continuous run (no stubs), a separate white
--     hover marker, thinner pill track.
--
-- v2.0 (2026-11-22) full visual redesign after the second real screenshot
-- ("the design itself is ancient / borders look too much / wrong font"):
--   * ONE scale with hard floors (dp() below). The old mix of raw u,
--     clamp(u,0.85,1.2) and mur() broke proportions on a ~720p window
--     (u ~ 0.67): the bar collapsed into a cramped 40px strip while chips
--     and fonts kept their clamped heights - exactly what the screenshot
--     showed. Every metric now floors (bar >= 48px, icons >= 18px, hit >=
--     30px, text >= 11px) from a 720p window up to 4K fullscreen.
--   * borders de-emphasised everywhere: chip/outline rings cut from 0.40
--     alpha to 0.10-0.16, chips get a translucent 6% fill + 1px hairline
--     (the old outline-only pill was the hard "TV badge" border), the bar
--     top edge is a single 1px hairline, the menu/tooltips rings are 0.16.
--   * hover affordances: soft circular 8% wash behind every icon button
--     (12% pressed), seek thumb growth, time bubble above the bar.
--   * flat translucent bar + hairline top edge + two-step soft fade above
--     (the 32-band gradient banded on real 8-bit output and read as a hard
--     slab edge).
--   * text widths measured per character (narrow/digit/upper classes), so
--     labels stop clipping when fontselect falls back to Arial; timecodes
--     floor at 11.5px, chip text at 11px.
--
-- v2.1 (2026-11-22) modern overlay pass after the third screenshot ("grey,
-- ancient, double lines, low quality icons, blurry text"):
--   * the bar is no longer a plate. Three wide blurred black bands stack
--     into one soft ramp, so the picture simply darkens toward the bottom -
--     no strip edge, no grey rectangle, nothing to read as a second line.
--   * every ASS event now pins \bord0\shad0. Without it libass inflates each
--     glyph shape by the style outline: icons grew a halo, thin bars read as
--     two parallel lines and text picked up a soft edge (the "blurry" text).
--   * text sizes and anchors are rounded to whole OSD pixels (fractional
--     \fs/\pos is resampled by libass and blurs at 11-13px).
--   * chips are gone: the source and speed labels are plain text over the
--     video, so no rounded rectangle outlines anywhere in the bar.
--   * icons: bigger (30px), brighter (90% white), lighter stroke (2.2 units).
--
-- v2.2 layout and legibility pass:
--   * the transport (back 10 / play / forward 10) is centred on the bar; the
--     source pill, timecodes and utility cluster flank it, and the right
--     cluster drops items instead of overlapping when space runs out.
--   * the timeline uses its own smaller inset, so it spans nearly the full
--     width, and the thumb rests visible so the row reads as a timeline.
--   * the source label is a pill (server glyph + label + chevron) instead of
--     plain text, which read as a caption rather than a control.
--   * menus and tooltips: 15-17px body, 54px header band, hairline edge,
--     header rule, hover wash, active-row tint, secondary text at
--     0.72-0.86 alpha, and a fixed-width seek bubble.
--
-- Quick contract summary (see the design spec for the full tables):
--   Host -> script (script-message-to filmsnaps_osc ...):
--     fs-pointer move|down|up <x> <y>   (window client pixels)
--     fs-wheel   up|down <x> <y>
--     fs-state   source <label words...>
--     fs-status  buffering|switching|playing|idle|error [<detail...>]
--     fs-panel   open|closed
--     fs-menu    close
--     fs-bar     show|hide|auto
--     fs-refresh
--   Script -> host (broadcast script-message, host reads client-message):
--     fs-req source-picker
--     fs-req sub-file
--     fs-req sub-search
--     fs-req fullscreen
--     fs-visibility visible|hidden
--     fs-pointer-in-bar 1|0
--
-- Options (script-opts, identifier `filmsnaps_osc`):
--   filmsnaps_osc-input=mirror|native  (default mirror; native also works
--     with the host's plain `mouse x y` + `keydown/keyup MBTN_LEFT`
--     replay, and with a real mouse when running standalone mpv)
--   filmsnaps_osc-autohide_ms=2000
--   filmsnaps_osc-font_ui="Geist"  filmsnaps_osc-font_mono="Geist Mono"
--   filmsnaps_osc-delay_row=yes|no (subtitle delay stepper, default yes)
--   filmsnaps_osc-hover_preview=yes|no (seekbar hover time bubble)
--=====================================================================

local msg = require 'mp.msg'
local options = require 'mp.options'

--========================== 1. options ================================

local opts = {
    input          = "mirror",   -- "mirror" | "native"
    autohide_ms   = 2000,
    font_ui       = "Geist",
    font_mono     = "Geist Mono",
    delay_row      = true,      -- subtitle delay stepper row
    hover_preview  = true,      -- seekbar hover time bubble
    menu_rows_min  = 4,        -- menus never show fewer rows than this
    tooltip_ms     = 350,
    debug          = false,
}
options.read_options(opts, "filmsnaps_osc")

--========================== 2. design tokens =========================

local TK = {
    -- neutrals follow the mockup language: structure comes from fills, never
    -- from strong outlines (border alphas live at 0.10-0.16, not 0.28-0.40).
    surface    = {18, 18, 21, 0.94},   -- status pill (near black, not grey)
    elevated   = {11, 11, 14, 0.94},   -- menus, tooltips: near-black glass
    subtle     = {255, 255, 255, 0.10},-- hover fills (rows, key chips)
    hair       = {255, 255, 255, 0.13},-- menu dividers
    menu_ring  = {255, 255, 255, 0.20},-- menu edge: one crisp lit hairline
    hover      = {255, 255, 255, 0.12},-- menu row hover
    selected   = {212, 162, 55, 0.22}, -- active row: the accent marks the choice
    accent     = {212, 162, 55, 1.0},  -- #D4A237 (seek fill, checks, LIVE)
    accent_dim = {212, 162, 55, 0.55}, -- active rings at reduced strength
    accent_bri = {232, 188, 79, 1.0},  -- #E8BC4F (seek thumb, live text)
    text       = {255, 255, 255, 0.95},     -- primary
    text2       = {255, 255, 255, 0.86},    -- secondary (duration, labels)
    text3       = {255, 255, 255, 0.72},    -- tertiary (headers, hints)
    -- Glyphs are built from several overlapping primitives, each drawn as its
    -- own event: at partial alpha the overlaps stack and every joint shows as
    -- a brighter lump. Opaque white makes the joins invisible, which is also
    -- what modern players use over a scrim.
    icon        = {255, 255, 255, 1.0},     -- glyph idle
    divider     = {255, 255, 255, 0.12},     -- group separator
    track       = {255, 255, 255, 0.18},     -- seek/volume track
    buffered    = {255, 255, 255, 0.28},    -- buffered ranges
    vol_fill    = {255, 255, 255, 0.80},    -- volume fill (neutral, not amber)
}

--========================== 3. small utilities ========================

local function clamp(v, lo, hi) if v < lo then return lo elseif v > hi then return hi end return v end
local function round(v, d) local m = 10 ^ (d or 0) return math.floor(v * m + 0.5) / m end

--========================== 3b. error containment =====================
-- mpv does not isolate Lua callbacks: an error raised inside a script
-- message handler, observer, or timer escapes into the script's event loop
-- and terminates the whole script - the control bar then stays gone for the
-- rest of the session. Every callback is therefore shielded: the error is
-- logged once and the OSC keeps serving input.
local unpack = unpack or table.unpack   -- Lua 5.1/LuaJIT vs 5.2+
local function shield(what, fn)
    return function(...)
        local a = { ... }
        local ok, err = pcall(function() fn(unpack(a)) end)
        if not ok then msg.error("OSC " .. tostring(what) .. ": " .. tostring(err)) end
    end
end

-- mp.set_property takes a STRING value; a boolean raises
-- "bad argument #2 to 'set_property' (string expected, got boolean)",
-- which (pre-shield) killed the script. Flags go through set_flag as
-- yes/no strings, numbers through set_num/tostring.
local function set_flag(name, v) mp.set_property(name, v and "yes" or "no") end
local function set_num(name, v) mp.set_property(name, tostring(v)) end
local function fmt_time(t)
    if t == nil or t < 0 then return "--:--" end
    t = math.floor(t + 0.001)   -- epsilon guards sub-second float wobble
    local h = math.floor(t / 3600)
    local m = math.floor((t % 3600) / 60)
    local s = t % 60
    if h > 0 then return string.format("%d:%02d:%02d", h, m, s) end
    return string.format("%d:%02d", m, s)
end
local function fmt_speed(v)
    local t = { [0.25]="0.25×", [0.5]="0.5×", [0.75]="0.75×", [1]="1×",
                [1.25]="1.25×", [1.5]="1.5×", [1.75]="1.75×", [2]="2×" }
    return t[v] or (("%.2f×"):format(v):gsub("0+×$","×"))
end
local function fmt_delay(v)
    if v == 0 then return "0 s" end
    return ("%+g s"):format(round(v, 1))
end
local function fmt_fps(v)
    if not v then return nil end
    if math.abs(v - math.floor(v + 0.5)) < 0.005 then
        return ("%d"):format(math.floor(v + 0.5))
    end
    return (("%.3f"):format(v):gsub("0+$", ""):gsub("%.$", ""))
end
local function lang_code(track)
    local l = track.lang or ""
    if l == "" then return "--" end
    return l:sub(1, 3):upper():gsub("%-",""):gsub("%s","")
end

-- Track titles come from the release, so every row of a muxed file can carry
-- the same site name. The language is what tells the tracks apart, so it leads
-- the row and the release title becomes the quiet second line.
local LANG_NAMES = {
    en = "English", hi = "Hindi", ur = "Urdu", bn = "Bengali", ta = "Tamil",
    te = "Telugu", ml = "Malayalam", kn = "Kannada", mr = "Marathi", pa = "Punjabi",
    gu = "Gujarati", ["or"] = "Odia", as = "Assamese", ne = "Nepali", si = "Sinhala",
    ar = "Arabic", fa = "Persian", tr = "Turkish", ru = "Russian", uk = "Ukrainian",
    de = "German", fr = "French", es = "Spanish", pt = "Portuguese", it = "Italian",
    nl = "Dutch", pl = "Polish", cs = "Czech", sk = "Slovak", hu = "Hungarian",
    ro = "Romanian", el = "Greek", he = "Hebrew", th = "Thai", vi = "Vietnamese",
    id = "Indonesian", ms = "Malay", fil = "Filipino", tl = "Tagalog",
    ja = "Japanese", ko = "Korean", zh = "Chinese",
}
local LANG_CODES = {
    hin = "Hindi", eng = "English", urd = "Urdu", ben = "Bengali", tam = "Tamil",
    tel = "Telugu", mal = "Malayalam", kan = "Kannada", mar = "Marathi",
    pan = "Punjabi", guj = "Gujarati", ori = "Odia", ara = "Arabic", fas = "Persian",
    per = "Persian", tur = "Turkish", rus = "Russian", ukr = "Ukrainian",
    deu = "German", ger = "German", fra = "French", fre = "French", spa = "Spanish",
    por = "Portuguese", ita = "Italian", nld = "Dutch", dut = "Dutch", pol = "Polish",
    ces = "Czech", cze = "Czech", hun = "Hungarian", ron = "Romanian", ell = "Greek",
    heb = "Hebrew", tha = "Thai", vie = "Vietnamese", ind = "Indonesian",
    jpn = "Japanese", kor = "Korean", zho = "Chinese", chi = "Chinese",
}

local function lang_name(track)
    local l = (track.lang or ""):lower()
    local base = l:match("^%a+") or ""
    if base == "" then
        -- untagged track: fall back to its title, or say so plainly
        local t = track.title
        if t and t ~= "" then return t end
        return "Unknown language"
    end
    return LANG_NAMES[base] or LANG_CODES[base] or lang_code(track)
end

--========================== 4. ASS primitives =========================

-- ASS colors are &HBBGGRR (BGR) with separate alpha (&H00 = opaque).
local function col(c) return ("&H%02X%02X%02X&"):format(c[3], c[2], c[1]) end
local function alpha(c) return ("&H%02X&"):format(round((1 - (c[4] or 1)) * 255)) end

local function esc_text(s)
    s = tostring(s or "")
    return (s:gsub("[\\{}]", function(ch) return "\\" .. ch end))
end

-- Vector geometry (filled paths; "strokes" are capsules and arc sectors).
local V = {}

local function pt(x, y) return { x = x, y = y } end

local function bez(p0, c0, c1, p1) -- one cubic segment
    return ("b %.1f %.1f %.1f %.1f %.1f %.1f"):format(c0.x, c0.y, c1.x, c1.y, p1.x, p1.y)
end

-- approximate a circular arc (radius r, center c) from a0 to a1 (radians)
-- by <=90 degree cubic segments; supports BOTH sweep directions (the inner
-- edge of ring shapes is drawn with a negative sweep)
local function arc_to(path, cx, cy, r, a0, a1)
    local sweep = a1 - a0
    if sweep == 0 then return path end
    local n = math.ceil(math.abs(math.deg(sweep)) / 90)
    local da = sweep / n
    local sgn = sweep > 0 and 1 or -1
    local k = 4 / 3 * math.tan(math.abs(da) / 4)
    local a = a0
    for i = 1, n do
        local a2 = a + da
        local p0 = pt(cx + r * math.cos(a), cy + r * math.sin(a))
        local p1 = pt(cx + r * math.cos(a2), cy + r * math.sin(a2))
        local t0x, t0y = sgn * -r * math.sin(a), sgn * r * math.cos(a)
        local t1x, t1y = sgn * -r * math.sin(a2), sgn * r * math.cos(a2)
        path[#path + 1] = bez(p0, pt(p0.x + k * t0x, p0.y + k * t0y),
                              pt(p1.x - k * t1x, p1.y - k * t1y), p1)
        a = a2
    end
    return path
end

-- rounded rectangle path (outline; coordinates relative to 0,0)
function V.round_rect(x, y, w, h, r)
    r = math.min(r, w / 2, h / 2)
    local k = 0.5523 * r
    return table.concat({
        ("m %.1f %.1f"):format(x + r, y),
        ("l %.1f %.1f"):format(x + w - r, y),
        bez(pt(x + w - r, y), pt(x + w - r + k, y), pt(x + w, y + k), pt(x + w, y + r)),
        ("l %.1f %.1f"):format(x + w, y + h - r),
        bez(pt(x + w, y + h - r), pt(x + w, y + h - k), pt(x + w - r + k, y + h), pt(x + w - r, y + h)),
        ("l %.1f %.1f"):format(x + r, y + h),
        bez(pt(x + r, y + h), pt(x + r - k, y + h), pt(x, y + h - k), pt(x, y + h - r)),
        ("l %.1f %.1f"):format(x, y + r),
        bez(pt(x, y + r), pt(x, y + k), pt(x + r - k, y), pt(x + r, y)),
    }, " ")
end

-- counterclockwise rounded rect: same geometry traversed the other way, so
-- nesting it inside a CW contour punches a hole (nonzero and even-odd both)
function V.round_rect_ccw(x, y, w, h, r)
    r = math.min(r, w / 2, h / 2)
    local k = 0.5523 * r
    return table.concat({
        ("m %.1f %.1f"):format(x + r, y),
        bez(pt(x + r, y), pt(x + r - k, y), pt(x, y + k), pt(x, y + r)),
        ("l %.1f %.1f"):format(x, y + h - r),
        bez(pt(x, y + h - r), pt(x, y + h - k), pt(x + r - k, y + h), pt(x + r, y + h)),
        ("l %.1f %.1f"):format(x + w - r, y + h),
        bez(pt(x + w - r, y + h), pt(x + w - r + k, y + h), pt(x + w, y + h - k), pt(x + w, y + h - r)),
        ("l %.1f %.1f"):format(x + w, y + r),
        bez(pt(x + w, y + r), pt(x + w, y + r - k), pt(x + w - r + k, y), pt(x + w - r, y)),
        ("l %.1f %.1f"):format(x + r, y),
    }, " ")
end

-- rounded-rect RING (filled outline of thickness t): outer CW + inner CCW
function V.rr_ring(x, y, w, h, r, t)
    t = math.min(t, r, w / 4, h / 4)
    return V.round_rect(x, y, w, h, r) .. " " ..
           V.round_rect_ccw(x + t, y + t, w - 2 * t, h - 2 * t, math.max(r - t, 0.5))
end

-- filled disc
function V.disc(cx, cy, r)
    local p = { ("m %.1f %.1f"):format(cx + r, cy) }
    arc_to(p, cx, cy, r, 0, 2 * math.pi)
    return table.concat(p, " ")
end

local atan2 = math.atan2 or function(y, x) return math.atan(y, x) end -- LuaJIT / 5.4+

-- capsule: thick line (x0,y0)-(x1,y1) with round caps, width w
function V.capsule(x0, y0, x1, y1, w)
    local dx, dy = x1 - x0, y1 - y0
    local len = math.sqrt(dx * dx + dy * dy)
    if len < 1e-6 then return V.disc(x0, y0, w / 2) end
    local nx, ny = -dy / len * (w / 2), dx / len * (w / 2)
    local a0 = atan2(y1 - y0, x1 - x0)
    local p = { ("m %.1f %.1f"):format(x0 + nx, y0 + ny),
                ("l %.1f %.1f"):format(x1 + nx, y1 + ny) }
    arc_to(p, x1, y1, w / 2, a0, a0 + math.pi)          -- cap at p1
    p[#p + 1] = ("l %.1f %.1f"):format(x1 - nx, y1 - ny)
    p[#p + 1] = ("l %.1f %.1f"):format(x0 - nx, y0 - ny)
    arc_to(p, x0, y0, w / 2, a0 + math.pi, a0 + 2 * math.pi)  -- cap at p0
    return table.concat(p, " ")
end

-- thick circular arc stroke from angle a0 to a1 (degrees, screen coords,
-- y down, angles clockwise from +x axis), radius r, stroke width w, with
-- round caps. A partial arc is ONE closed contour (outer edge, cap
-- semicircle, inner edge, cap semicircle), so it fills correctly under any
-- fill rule; a full circle is an outer disc plus a REVERSED inner contour
-- (a true ring, not the filled disc the old broken inner-edge produced).
function V.arc_stroke(cx, cy, r, a0deg, a1deg, w)
    local function rad(d) return d * math.pi / 180 end
    local a0, a1 = rad(a0deg), rad(a1deg)
    local ro = r + w / 2
    local ri = r - w / 2
    if ri < 0.5 then ri = 0.5 end
    local sweep = a1 - a0
    if math.abs(sweep) >= 2 * math.pi - 0.02 then
        local p = { ("m %.1f %.1f"):format(cx + ro, cy) }
        arc_to(p, cx, cy, ro, 0, 2 * math.pi)
        p[#p + 1] = ("m %.1f %.1f"):format(cx + ri, cy)
        arc_to(p, cx, cy, ri, 0, -2 * math.pi)   -- reversed inner contour
        return table.concat(p, " ")
    end
    local p = { ("m %.1f %.1f"):format(cx + ro * math.cos(a0), cy + ro * math.sin(a0)) }
    arc_to(p, cx, cy, ro, a0, a1)                          -- outer edge
    local m1x, m1y = cx + r * math.cos(a1), cy + r * math.sin(a1)
    arc_to(p, m1x, m1y, w / 2, a1, a1 + math.pi)          -- end cap
    arc_to(p, cx, cy, ri, a1, a0)                          -- inner edge
    local m0x, m0y = cx + r * math.cos(a0), cy + r * math.sin(a0)
    arc_to(p, m0x, m0y, w / 2, a0 + math.pi, a0 + 2 * math.pi)  -- start cap
    return table.concat(p, " ")
end

-- rounded triangle: three vertices, each corner cut by d and joined with a
-- cubic (Lucide-like solid arrows / play marks without hand-tuned beziers)
function V.rtri(x1, y1, x2, y2, x3, y3, d)
    local P1, P2, P3 = pt(x1, y1), pt(x2, y2), pt(x3, y3)
    local function tw(pa, pb, n)
        local dx, dy = pb.x - pa.x, pb.y - pa.y
        local len = math.sqrt(dx * dx + dy * dy)
        if len < 1e-6 then return pt(pa.x, pa.y) end
        return pt(pa.x + dx / len * n, pa.y + dy / len * n)
    end
    local A1, A3 = tw(P1, P2, d), tw(P1, P3, d)
    local Ba, Bb = tw(P2, P1, d), tw(P2, P3, d)
    local Ca, Cb = tw(P3, P2, d), tw(P3, P1, d)
    local k = 0.5523 * d
    local function corner(pa, pb, P)
        local c0 = pt(pa.x + k * (P.x - pa.x), pa.y + k * (P.y - pa.y))
        local c1 = pt(pb.x + k * (P.x - pb.x), pb.y + k * (P.y - pb.y))
        return bez(pa, c0, c1, pb)
    end
    return table.concat({
        ("m %.1f %.1f"):format(A1.x, A1.y),
        ("l %.1f %.1f"):format(Ba.x, Ba.y),
        corner(Ba, Bb, P2),
        ("l %.1f %.1f"):format(Ca.x, Ca.y),
        corner(Ca, Cb, P3),
        ("l %.1f %.1f"):format(A3.x, A3.y),
        corner(A3, A1, P1),
    }, " ")
end

--========================== 5. glyph set =============================
-- Original FilmSnaps glyphs on a 24-unit grid, drawn as filled geometry
-- that mimics a 2px round-capped stroke. size s scales the grid.

local GLYPHS = {}

-- default glyph stroke weight on the 24-unit grid. 2.0 units reads as a
-- ~1.7px line at real overlay sizes, which antialiases into gray mush;
-- 2.5 keeps the Lucide-like feel but stays legible over video.
local GST = 2.2

local function g_disc(cx, cy, r, s) return V.disc(cx * s, cy * s, r * s) end
local function g_cap(x0, y0, x1, y1, w, s) return V.capsule(x0 * s, y0 * s, x1 * s, y1 * s, w * s) end
local function g_arc(cx, cy, r, a0, a1, s, w) return V.arc_stroke(cx * s, cy * s, r * s, a0, a1, (w or GST) * s) end

-- Every glyph returns a TABLE of path primitives; glyph_at emits each one
-- as its own drawing event. Separate fills always composite as a union, so
-- glyphs render identically whether libass resolves overlapping subpaths
-- by winding or by even-odd (chained capsules that share endpoints used to
-- punch notches into each other and "melt" the icons on real runs).

GLYPHS.play = function(s) -- rounded solid triangle (V.rtri)
    return { V.rtri(8.4 * s, 5.4 * s, 8.4 * s, 18.6 * s, 19.4 * s, 12.0 * s, 1.6 * s) }
end
GLYPHS.pause = function(s)
    return { V.round_rect(7.0 * s, 5.2 * s, 3.2 * s, 13.6 * s, 1.6 * s),
             V.round_rect(13.8 * s, 5.2 * s, 3.2 * s, 13.6 * s, 1.6 * s) }
end
GLYPHS.back10 = function(s)
    -- skip-back: bar + left triangle (the tooltip carries the "10 s"
    -- meaning; an inline 8px "10" label rendered as unreadable mush at
    -- real sizes)
    return { V.round_rect(4.6 * s, 5.4 * s, 2.6 * s, 13.2 * s, 1.3 * s),
             V.rtri(19.2 * s, 6.0 * s, 19.2 * s, 18.0 * s, 8.6 * s, 12.0 * s, 1.6 * s) }
end
GLYPHS.fwd10 = function(s)
    return { V.round_rect(16.8 * s, 5.4 * s, 2.6 * s, 13.2 * s, 1.3 * s),
             V.rtri(4.8 * s, 6.0 * s, 4.8 * s, 18.0 * s, 15.4 * s, 12.0 * s, 1.6 * s) }
end
local function speaker_body(s)
    local k = 0.5523 * 1.0 * s
    return table.concat({
        ("m %.1f %.1f"):format(4.6 * s, 9.3 * s),
        ("l %.1f %.1f"):format(7.4 * s, 9.3 * s),
        ("b %.1f %.1f %.1f %.1f %.1f %.1f"):format(9.6 * s, 7.2 * s, 10.4 * s, 4.9 * s, 12.0 * s, 4.9 * s),
        ("b %.1f %.1f %.1f %.1f %.1f %.1f"):format(13.4 * s, 4.9 * s, 13.8 * s, 5.7 * s, 13.8 * s, 6.2 * s),
        ("l %.1f %.1f"):format(13.8 * s, 17.8 * s),
        ("b %.1f %.1f %.1f %.1f %.1f %.1f"):format(13.8 * s, 18.3 * s, 13.4 * s, 19.1 * s, 12.0 * s, 19.1 * s),
        ("b %.1f %.1f %.1f %.1f %.1f %.1f"):format(10.4 * s, 19.1 * s, 9.6 * s, 17.6 * s, 7.4 * s, 15.5 * s),
        ("l %.1f %.1f"):format(4.6 * s, 15.5 * s),
        ("b %.1f %.1f %.1f %.1f %.1f %.1f"):format(3.6 * s, 15.5 * s, 3.4 * s, 15.1 * s, 3.4 * s, 14.0 * s),
        ("l %.1f %.1f"):format(3.4 * s, 10.8 * s),
        ("b %.1f %.1f %.1f %.1f %.1f %.1f"):format(3.4 * s, 9.9 * s, 3.6 * s, 9.3 * s, 4.6 * s, 9.3 * s),
    }, " ")
end
GLYPHS.vol = function(s)
    -- wave radii spaced apart (3.4/7.8) so the two arcs never fuse
    return { speaker_body(s),
             g_arc(16.4, 12.0, 3.4, -52, 52, s, 2.3),
             g_arc(16.4, 12.0, 7.8, -52, 52, s, 2.3) }
end
GLYPHS.vol_low = function(s)
    return { speaker_body(s), g_arc(16.4, 12.0, 3.4, -52, 52, s, 2.3) }
end
GLYPHS.mute = function(s)
    return { speaker_body(s),
             g_cap(16.6, 9.4, 21.4, 14.6, GST, s),
             g_cap(21.4, 9.4, 16.6, 14.6, GST, s) }
end
GLYPHS.expand = function(s)
    return {
        g_cap(4.0, 9.2, 4.0, 6.0, GST, s), g_cap(4.0, 6.0, 6.0, 4.0, GST, s), g_cap(6.0, 4.0, 9.4, 4.0, GST, s),
        g_cap(14.6, 4.0, 18.0, 4.0, GST, s), g_cap(18.0, 4.0, 20.0, 6.0, GST, s), g_cap(20.0, 6.0, 20.0, 9.2, GST, s),
        g_cap(20.0, 14.8, 20.0, 18.0, GST, s), g_cap(20.0, 18.0, 18.0, 20.0, GST, s), g_cap(18.0, 20.0, 14.6, 20.0, GST, s),
        g_cap(9.4, 20.0, 6.0, 20.0, GST, s), g_cap(6.0, 20.0, 4.0, 18.0, GST, s), g_cap(4.0, 18.0, 4.0, 14.8, GST, s),
    }
end
GLYPHS.compress = function(s)
    return {
        g_cap(9.4, 4.0, 9.4, 6.4, GST, s), g_cap(9.4, 6.4, 7.4, 8.4, GST, s), g_cap(7.4, 8.4, 4.0, 8.4, GST, s),
        g_cap(14.6, 4.0, 14.6, 6.4, GST, s), g_cap(14.6, 6.4, 16.6, 8.4, GST, s), g_cap(16.6, 8.4, 20.0, 8.4, GST, s),
        g_cap(20.0, 15.6, 16.6, 15.6, GST, s), g_cap(16.6, 15.6, 14.6, 17.6, GST, s), g_cap(14.6, 17.6, 14.6, 20.0, GST, s),
        g_cap(4.0, 15.6, 7.4, 15.6, GST, s), g_cap(7.4, 15.6, 9.4, 17.6, GST, s), g_cap(9.4, 17.6, 9.4, 20.0, GST, s),
    }
end
GLYPHS.audio = function(s)
    -- four-bar equalizer, clearly distinct heights
    return {
        g_cap(5.4, 8.8, 5.4, 15.2, GST, s),
        g_cap(9.8, 6.3, 9.8, 17.7, GST, s),
        g_cap(14.2, 4.3, 14.2, 19.7, GST, s),
        g_cap(18.6, 7.8, 18.6, 16.2, GST, s),
    }
end
GLYPHS.cc = function(s)
    -- Caption box: a wide, short frame holding two centred text lines. The old
    -- glyph left both lines short and flush left, so at bar size it read as an
    -- equals sign in a box rather than as subtitles.
    return {
        V.rr_ring(2.6 * s, 6.0 * s, 18.8 * s, 12.0 * s, 2.6 * s, 2.0 * s),
        g_cap(7.2, 10.6, 16.8, 10.6, GST, s),
        g_cap(7.2, 13.6, 13.2, 13.6, GST, s),
    }
end
GLYPHS.info = function(s)
    return {
        g_arc(12.0, 12.0, 8.7, 0, 360, s, GST),
        g_cap(12.0, 11.2, 12.0, 16.4, GST, s),
        g_disc(12.0, 7.9, 1.25, s),
    }
end
GLYPHS.check = function(s)
    return {
        g_cap(5.2, 12.6, 9.7, 17.1, GST, s),
        g_cap(9.7, 17.1, 18.8, 6.9, GST, s),
    }
end
GLYPHS.more = function(s)
    return { g_disc(5.4, 12.0, 1.7, s), g_disc(12.0, 12.0, 1.7, s), g_disc(18.6, 12.0, 1.7, s) }
end
GLYPHS.server = function(s)
    -- two rack bars + LED dots
    return {
        g_cap(8.2, 7.0, 19.6, 7.0, GST, s),
        g_cap(8.2, 17.0, 19.6, 17.0, GST, s),
        g_disc(5.6, 7.0, 1.4, s),
        g_disc(5.6, 17.0, 1.4, s),
    }
end
GLYPHS.globe = function(s)
    return {
        g_arc(12.0, 12.0, 8.7, 0, 360, s, GST),
        g_cap(3.3, 12.0, 20.7, 12.0, GST, s),
        g_cap(12.0, 3.3, 9.0, 5.6, GST, s), g_cap(9.0, 5.6, 9.0, 18.4, GST, s), g_cap(9.0, 18.4, 12.0, 20.7, GST, s),
        g_cap(12.0, 3.3, 15.0, 5.6, GST, s), g_cap(15.0, 5.6, 15.0, 18.4, GST, s), g_cap(15.0, 18.4, 12.0, 20.7, GST, s),
    }
end
GLYPHS.folder = function(s)
    return {
        V.round_rect(3.6 * s, 7.8 * s, 16.2 * s, 10.6 * s, 1.4 * s),
        g_cap(5.0, 5.2, 8.1, 5.2, GST, s), g_cap(8.1, 5.2, 10.3, 7.8, GST, s), g_cap(10.3, 7.8, 18.4, 7.8, GST, s),
        g_cap(16.4, 10.9, 16.4, 15.3, GST, s), g_cap(14.2, 13.1, 18.6, 13.1, GST, s),
    }
end
GLYPHS.chevron = function(s)
    -- points down: the source pill opens a panel below itself
    return { g_cap(7.2, 10.0, 12.0, 14.8, GST, s), g_cap(12.0, 14.8, 16.8, 10.0, GST, s) }
end
GLYPHS.minus = function(s) return { g_cap(6.0, 12.0, 18.0, 12.0, GST, s) } end
GLYPHS.plus = function(s)
    return { g_cap(12.0, 6.0, 12.0, 18.0, GST, s), g_cap(6.0, 12.0, 18.0, 12.0, GST, s) }
end
GLYPHS.fileext = function(s)
    return {
        V.round_rect(6.6 * s, 3.4 * s, 11.8 * s, 17.2 * s, 1.2 * s),
        g_cap(13.4, 3.4, 13.4, 8.4, GST, s), g_cap(13.4, 8.4, 18.4, 8.4, GST, s),
    }
end
GLYPHS.warn = function(s)
    local p = { ("m %.1f %.1f"):format(12.0 * s, 3.6 * s) }
    p[#p + 1] = ("l %.1f %.1f"):format(20.6 * s, 18.4 * s)
    p[#p + 1] = bez(pt(20.6 * s, 19.6 * s), pt(20.2 * s, 20.4 * s), pt(19.2 * s, 20.4 * s), pt(18.4 * s, 20.4 * s))
    p[#p + 1] = ("l %.1f %.1f"):format(5.6 * s, 20.4 * s)
    p[#p + 1] = bez(pt(4.8 * s, 20.4 * s), pt(3.4 * s, 20.4 * s), pt(3.4 * s, 19.6 * s), pt(3.4 * s, 18.4 * s))
    p[#p + 1] = ("l %.1f %.1f"):format(12.0 * s, 3.6 * s)
    return {
        table.concat(p, " "),
        g_cap(12.0, 9.6, 12.0, 14.6, 2.6, s),
        g_disc(12.0, 17.2, 1.15, s),
    }
end
GLYPHS.spin = function(s) -- 3/4 arc spinner
    return { g_arc(12.0, 12.0, 8.6, -64 + 0, 206, s, 2.9) }
end
GLYPHS.spin2 = function(s) return { g_arc(12.0, 12.0, 8.6, 16, 286, s, 2.9) } end
GLYPHS.spin3 = function(s) return { g_arc(12.0, 12.0, 8.6, 96, 366, s, 2.9) } end
GLYPHS.spin4 = function(s) return { g_arc(12.0, 12.0, 8.6, 176, 446, s, 2.9) } end

--========================== 6. canvas ================================

local overlay = nil      -- mp.create_osd_overlay object
local out_lines = {}

local function ev_reset()
    out_lines = {}
end
local function ev_flush()
    if not overlay then return end
    overlay.data = table.concat(out_lines, "\n")
    overlay:update()
end

-- text event, an = alignment 1..9, (x,y) = anchor, style overrides
local function ev_text(an, x, y, text, c, fs, o)
    o = o or {}
    -- \bord0\shad0 is mandatory: the default OSD style carries an outline, and
    -- libass inflates every glyph and drawing by it. Overlaid on video that
    -- reads as a halo around text ("blurry") and as a second edge on thin
    -- bars. Sizes/anchors are whole pixels for the same reason.
    local parts = {
        "{\\an" .. an .. "\\pos(" .. round(x,0) .. "," .. round(y,0) .. ")",
        "\\fn" .. (o.font or opts.font_ui),
        "\\fs" .. round(fs, 0),
        "\\bord0\\shad0",
        "\\1c" .. col(c),
        "\\1a" .. alpha(c),
    }
    if o.bold then parts[#parts + 1] = "\\b1" end
    if o.fad then parts[#parts + 1] = "\\fad(" .. o.fad[1] .. "," .. o.fad[2] .. ")" end
    if o.spacing then parts[#parts + 1] = "\\fsp" .. o.spacing end
    parts[#parts + 1] = "}"
    out_lines[#out_lines + 1] = table.concat(parts, "") .. esc_text(text)
end

-- drawing event anchored at top-left (x,y); path coordinates are relative
local function ev_draw(x, y, path, c, o)
    o = o or {}
    local parts = {
        "{\\an7\\pos(" .. round(x, 0) .. "," .. round(y, 0) .. ")",
        "\\p1\\bord0\\shad0\\1c" .. col(c),
        "\\1a" .. alpha(c),
    }
    if o.blur then parts[#parts + 1] = "\\blur" .. round(o.blur, 0) end
    if o.fad then parts[#parts + 1] = "\\fad(" .. o.fad[1] .. "," .. o.fad[2] .. ")" end
    parts[#parts + 1] = "}"
    out_lines[#out_lines + 1] = table.concat(parts, "") .. path
        .. "\\p0"
end

local function glyph_at(glyph, cx, cy, size, c, o)
    -- draws a glyph centered at (cx, cy); glyph grid is 24 units.
    -- Each primitive becomes its own drawing event so overlapping parts
    -- union instead of toggling each other off under even-odd filling.
    local s = size / 24.0
    local ox, oy = cx - 12 * s, cy - 12 * s
    local paths = glyph(s)
    if type(paths) == "string" then paths = { paths } end
    for _, p in ipairs(paths) do
        ev_draw(ox, oy, p, c, o)
    end
end

--========================== 7. player state ==========================

local P = { -- observed player state (never owned by the OSC)
    pause      = false,
    volume     = 100,
    mute       = false,
    speed      = 1,
    aid        = nil,   -- string/number from `aid` property
    sid        = nil,
    tracks     = {},    -- track-list snapshot
    duration   = nil,
    time_pos   = nil,
    seekable   = false,
    cache_ranges = {},  -- demuxer-cache-state seekable-ranges
    sub_delay  = 0,
    video_params = nil,
    audio_params = nil,
    container_fps = nil,
    video_bitrate = nil,
    audio_bitrate = nil,
    fullscreen = false,
    idle       = false,
}

local H = { -- host-supplied state
    source_label = nil,   -- e.g. "Server 1 · 1080p"
    status       = "none",  -- none|buffering|switching|playing|idle|error
    status_detail = nil,
    panel        = false,  -- HTML panel covering the video
    bar_override  = nil,   -- "show" | "hide" | nil (auto)
}

local function audio_tracks()
    local t = {}
    for _, tr in ipairs(P.tracks) do
        if tr.type == "audio" then t[#t + 1] = tr end
    end
    return t
end
local function sub_tracks()
    local t = {}
    for _, tr in ipairs(P.tracks) do
        if tr.type == "sub" then t[#t + 1] = tr end
    end
    -- English first, then language alpha, embedded before external
    local function en_first(tr)
        return ((tr.lang or ""):lower():sub(1, 2) == "en") and 0 or 1
    end
    table.sort(t, function(a, b)
        local ae, be = en_first(a), en_first(b)
        if ae ~= be then return ae < be end
        local al, bl = (a.lang or ""), (b.lang or "")
        if al ~= bl then return al < bl end
        local aext, bext = a.external and 1 or 0, b.external and 1 or 0
        if aext ~= bext then return aext < bext end
        return (a.title or "") < (b.title or "")
    end)
    return t
end
local function no_audio()
    return #audio_tracks() == 0
end
local function active_audio_track()
    local aid = P.aid
    if type(aid) ~= "number" then return nil end
    for _, tr in ipairs(P.tracks) do
        if tr.type == "audio" and tr.id == aid then return tr end
    end
    return nil
end
local function active_sub_track()
    local sid = P.sid
    if type(sid) ~= "number" then return nil end
    for _, tr in ipairs(P.tracks) do
        if tr.type == "sub" and tr.id == sid then return tr end
    end
    return nil
end

local function live_or_unknown()
    if P.seekable == false then return true end
    local d = P.duration
    if d == nil or d <= 0 then return true end
    return false
end

--========================== 8. layout ================================

local L = {
    w = 1920, h = 1080,          -- OSD pixel space (PlayRes == OSD pixels)
    u = 1, compact = false,
    bar_h = 72, bar_top = 1008, pad = 28, btn = 40, icon = 22,
    gap = 12, gap_s = 8, chip_h = 30, row_h = 52, row_s = 40,
    btn_big = 44, seek_pad = 12,
    seek_y = 1000, ctl_y = 1000,
    menu_w = 300,
}

-- OSD dimensions are physical pixels: on Windows 125%/150% scaled displays
-- a bar sized from osd_h alone reads 20-33% smaller than the design intends.
-- display-hidpi-scale (published by the vo) restores design proportions.
local function hidpi_scale()
    local v = mp.get_property_native("display-hidpi-scale")
    if type(v) == "number" and v > 0 and v < 8 then return v end
    return 1
end

-- design-px helper: ONE scale for every metric plus hard floors. The old
-- code mixed raw u, clamp(u,0.85,1.2) and mur(), so on a ~720p window
-- (u ~ 0.67) the bar shrank to 41px while chips stayed near 26px and fonts
-- fell to 9-10px - the cramped strip the second screenshot showed. Floors
-- keep every element readable from a 720p window up to 4K fullscreen.
local function dp(v, floorv, ceilv)
    local x = v * L.u
    if floorv and x < floorv then x = floorv end
    if ceilv and x > ceilv then x = ceilv end
    return x
end

local function compute_layout()
    local w, h = mp.get_osd_size()
    if w and h and w > 0 and h > 0 then L.w, L.h = w, h end
    local fs = P.fullscreen
    local u = clamp((L.h / 1080) * hidpi_scale(), 0.62, 2.4) * (fs and 1.05 or 1.0)
    L.u = u
    L.compact = L.w < 1150
    if L.compact then
        L.bar_h  = dp(72, 62)
        L.pad    = dp(14, 10)
        L.btn    = dp(34, 30)
        L.btn_big = dp(42, 36)
        L.seek_pad = dp(10, 6)
        L.icon   = dp(26, 22)
        L.gap    = dp(9, 6)
        L.gap_s  = dp(6, 4)
        L.chip_h = dp(26, 24)
        L.menu_w = dp(400, 340)
        L.row_h  = dp(72, 62)
        L.row_s  = dp(58, 50)
    else
        L.bar_h  = dp(fs and 96 or 86, 74)
        L.pad    = dp(fs and 30 or 18, 12)
        L.btn    = dp(40, 32)
        L.btn_big = dp(48, 40)
        L.seek_pad = dp(12, 8)
        L.icon   = dp(30, 26)
        L.gap    = dp(14, 8)
        L.gap_s  = dp(8, 5)
        L.chip_h = dp(28, 24)
        L.menu_w = dp(520, 440)
        L.row_h  = dp(84, 72)
        L.row_s  = dp(64, 56)
    end
    L.fs_time = dp(16, 14)     -- timecodes
    L.fs_chip = dp(14, 13)       -- source / speed label
    L.fs_menu = dp(20, 18)     -- menu body text
    L.fs_head = dp(18, 16)     -- menu header
    L.bar_top = L.h - L.bar_h
    -- two rows: the seek line gets its own full-width row above the controls
    L.seek_y = L.bar_top + (L.compact and dp(13, 11) or dp(fs and 20 or 18, 14))
    L.ctl_y  = L.bar_top + (L.compact and dp(37, 33) or dp(fs and 56 or 50, 40))
end

--========================== 9. hit registry ==========================

local hits = {}   -- rebuilt on every render: {x0,y0,x1,y1, id, data}
local function add_hit(x0, y0, x1, y1, id, data)
    hits[#hits + 1] = { x0 = x0, y0 = y0, x1 = x1, y1 = y1, id = id, data = data }
end
local function hit_at(x, y)
    -- iterate in reverse: later hits are drawn later (on top)
    for i = #hits, 1, -1 do
        local hr = hits[i]
        if x >= hr.x0 and x <= hr.x1 and y >= hr.y0 and y <= hr.y1 then return hr end
    end
    return nil
end

-- forward declarations (defined in later sections)
local PTR, render, request_render, update_timers, refresh_state, activate, menu_layout
local MENU, menu_toggle, menu_scroll, menu_row_activate, menu_close

--========================== 10. visibility & timers ==================

local VIS = { state = "hidden", t_show = 0, t_hide = 0 }  -- hidden|showing|visible|hiding
local timers = {}   -- named timer handles
local function t_kill(name)
    if timers[name] then timers[name]:kill() timers[name] = nil end
end
local function t_oneshot(name, seconds, fn)
    t_kill(name)
    timers[name] = mp.add_timeout(seconds, function()
        timers[name] = nil
        local ok, err = pcall(fn)
        if not ok then msg.error("OSC timer " .. tostring(name) .. ": " .. tostring(err)) end
    end)
end

local function host_msg(...)
    mp.commandv("script-message", ...)
end

local function menu_is_open() return MENU ~= nil end

local function suppress()
    return H.panel
end

local function bar_visible_for_render()
    if suppress() then return false end
    if H.bar_override == "hide" then return false end
    if H.bar_override == "show" then return true end
    return VIS.state ~= "hidden"
end

local function autohide_paused()
    if H.bar_override == "show" then return true end
    return menu_is_open() or (PTR.drag ~= nil) or PTR.in_bar
        or VIS.state == "showing"
end

local function vis_set(state)
    if VIS.state == state then return end
    VIS.state = state
    local now = mp.get_time()
    if state == "showing" then
        VIS.t_show = now
        t_oneshot("vis_show", 0.16, function() VIS.state = (VIS.state == "showing") and "visible" or VIS.state end)
    elseif state == "hiding" then
        VIS.t_hide = now
        t_oneshot("vis_hide", 0.18, function()
            VIS.state = (VIS.state == "hiding") and "hidden" or VIS.state
            update_timers()
            render()
        end)
    end
    host_msg("fs-visibility", (state == "hidden" or state == "hiding") and "hidden" or "visible")
    update_timers()
    render()
end

local function arm_autohide()
    local function fire()
        if suppress() then return end
        if menu_is_open() or autohide_paused() then
            t_oneshot("autohide", 0.5, fire)   -- conditions still active; re-check soon
        else
            vis_set("hiding")
        end
    end
    t_oneshot("autohide", opts.autohide_ms / 1000.0, fire)
end

local function wake()
    if suppress() or H.bar_override == "hide" then return end
    if VIS.state ~= "visible" and VIS.state ~= "showing" then vis_set("showing") end
    arm_autohide()
end

--========================== 11. pointer machine ======================

PTR = { x = -1, y = -1, in_bar = false, hover = nil, press = nil,
        drag = nil, drag_kind = nil, seek_preview = nil,
        vol_preview = nil, tooltip = nil, hover_data = nil, hover_key = nil }

local function ptr_activity()
    wake()
end

local function seek_fraction(x)
    local hr = hit_at(x, PTR.y)
    -- use seek rect from the current layout regardless of hover
    for _, h in ipairs(hits) do
        if h.id == "seek" then
            return clamp((x - h.x0) / (h.x1 - h.x0), 0, 1)
        end
    end
    return nil
end

local function set_volume_from(x)
    for _, h in ipairs(hits) do
        if h.id == "vol_slide" then
            local frac = clamp((x - h.x0) / (h.x1 - h.x0), 0, 1)
            PTR.vol_preview = math.floor(frac * 100 + 0.5)
            return true
        end
    end
    return false
end

local function tooltip_for(id)
    local noaud = no_audio()
    local map = {
        src      = { "Switch source", nil },
        play     = { P.pause and "Play" or "Pause", "K" },
        back10   = { "Back 10 s", "J" },
        fwd10    = { "Fwd 10 s", "L" },
        vol_mute = noaud and { "No audio track", nil } or { P.mute and "Unmute" or "Mute", "M" },
        speed    = { "Playback speed", "SPACE" },
        audio    = { "Audio tracks", nil },
        cc       = { "Subtitles", nil },
        info     = { "Info", nil },
        fs       = { P.fullscreen and "Exit fullscreen" or "Fullscreen", "F" },
        more     = { "More", nil },
    }
    return map[id]
end

local function tooltip_clear()
    if PTR.tooltip then
        PTR.tooltip = nil
        t_kill("tooltip")
        request_render()
    end
end

local function on_move(x, y)
    PTR.x, PTR.y = x, y
    ptr_activity()
    if suppress() then return end
    local hr = hit_at(x, y)
    local id = hr and hr.id or nil
    local in_bar = y >= L.bar_top - 4 and y <= L.h and bar_visible_for_render()
    if in_bar ~= PTR.in_bar then
        PTR.in_bar = in_bar
        host_msg("fs-pointer-in-bar", in_bar and "1" or "0")
    end
    -- Every menu row reports the same "menu" hit id, so the hover check keys
    -- on the row index as well; comparing ids alone froze the highlight on the
    -- first row and left every other row without feedback.
    local key = (id == "menu" and hr and hr.data and hr.data.row_idx)
        and ("menu:" .. hr.data.row_idx) or id
    if key ~= PTR.hover_key then
        PTR.hover_key = key
        PTR.hover = id
        PTR.hover_data = hr and hr.data or nil
        tooltip_clear()
        if id and not PTR.drag then
            local tt = (id == "seek") and true or tooltip_for(id)
            if tt then
                t_oneshot("tooltip", opts.tooltip_ms / 1000.0, function()
                    PTR.tooltip = id
                    request_render()
                end)
            end
        end
        request_render()
    end
    -- The seek bubble follows the pointer, so it has to repaint on move. It
    -- used to wait for the 200 ms progress tick, which is why the time under
    -- the cursor jumped behind it while scrubbing.
    if PTR.hover == "seek" or PTR.drag == "seek" then request_render() end
    -- drag previews
    if PTR.drag == "seek" then
        PTR.seek_preview = seek_fraction(x)
        request_render()
    elseif PTR.drag == "vol" then
        set_volume_from(x)
        request_render()
    elseif PTR.hover == "vol_slide" and not no_audio() then
        PTR.vol_preview = nil -- hover tooltip handled in render
    end
end

local function on_down(x, y)
    PTR.x, PTR.y = x, y
    ptr_activity()
    if suppress() then return end
    local hr = hit_at(x, y)
    if not hr then PTR.press = nil return end
    PTR.press = hr.id
    if hr.id == "seek" then
        if not live_or_unknown() then
            PTR.drag = "seek"
            PTR.seek_preview = seek_fraction(x)
        end
    elseif hr.id == "vol_slide" then
        if not no_audio() then
            PTR.drag = "vol"
            set_volume_from(x)
        end
    end
    request_render()
end

local function on_up(x, y)
    PTR.x, PTR.y = x, y
    ptr_activity()
    if suppress() then PTR.press, PTR.drag, PTR.drag_kind = nil, nil, nil return end
    local press = PTR.press
    local drag = PTR.drag
    PTR.press, PTR.drag = nil, nil
    local hr = hit_at(x, y)
    if drag == "seek" then
        local frac = seek_fraction(x)
        if frac and P.duration and not live_or_unknown() then
            local t = frac * P.duration
            mp.commandv("seek", ("%.3f"):format(t), "absolute+exact")
        end
        PTR.seek_preview = nil
        request_render()
        return
    elseif drag == "vol" then
        if PTR.vol_preview then
            set_num("volume", PTR.vol_preview)
        end
        PTR.vol_preview = nil
        request_render()
        return
    end
    if hr and hr.id == press then activate(hr) end
    request_render()
end

local function on_wheel(dir, x, y)
    if suppress() then return end
    local hr = hit_at(x, y)
    if hr and hr.id == "menu" then
        menu_scroll(hr.data.menu, dir == "up" and -1 or 1)
        return
    end
    if hr and hr.id == "seek" and not live_or_unknown() then
        mp.commandv("seek", dir == "up" and "5" or "-5")
        return
    end
    if hr and (hr.id == "vol_slide" or hr.id == "vol_mute") and not no_audio() then
        local v = clamp((P.volume or 0) + (dir == "up" and 5 or -5), 0, 100)
        set_num("volume", v)
        return
    end
end

--========================== 12. element activation ====================

activate = function(hr)
    local id = hr.id
    if id == "play" then
        set_flag("pause", not P.pause)
    elseif id == "back10" then
        mp.commandv("seek", "-10")
    elseif id == "fwd10" then
        mp.commandv("seek", "10")
    elseif id == "src" then
        host_msg("fs-req", "source-picker")
    elseif id == "vol_mute" then
        if not no_audio() then set_flag("mute", not P.mute) end
    elseif id == "fs" then
        if opts.input == "native" then
            set_flag("fullscreen", not P.fullscreen)
        else
            host_msg("fs-req", "fullscreen")  -- host owns the window chrome
        end
    elseif id == "speed" then
        menu_toggle("speed", hr.x1)
    elseif id == "audio" then
        menu_toggle("audio", hr.x1)
    elseif id == "cc" then
        menu_toggle("subs", hr.x1)
    elseif id == "info" then
        menu_toggle("info", hr.x1)
    elseif id == "more" then
        menu_toggle("more", hr.x1)
    elseif id == "delay_minus" then
        set_num("sub-delay", round((P.sub_delay or 0) - 0.1, 2))
    elseif id == "delay_plus" then
        set_num("sub-delay", round((P.sub_delay or 0) + 0.1, 2))
    elseif id == "menu" then
        menu_row_activate(hr.data)
    end
end

--========================== 13. menus ================================

MENU = nil   -- { kind, scroll, x, y, w }
local SPIN = { f = 1 }

local function mur() return clamp(L.u, 0.85, 1.25) end -- menu unit

menu_close = function(reason)
    if not MENU then return end
    MENU = nil
    -- the pointer has not moved, so drop the row key or the next menu would
    -- open with a highlight borrowed from the closed one
    PTR.hover_key = nil
    wake()
    update_timers()
    render()
end

-- The menus size from the same dp() scale as the bar. mur() clamped at 0.85,
-- so on a 720p window every menu label fell to ~11px while the bar kept its
-- floors - the panel read as small and cramped next to the controls.
local function menu_head_h() return dp(60, 50) end
local function menu_foot_h(kind) return (kind == "speed") and dp(40, 33) or 0 end

local function row_height(row)
    if row.kind == "divider" then return dp(15, 12) end
    if row.kind == "section" then return dp(38, 32) end
    if row.kind == "track" then return L.row_h end
    return L.row_s
end

local function build_menu_rows(kind)
    local rows = {}
    if kind == "speed" then
        for _, v in ipairs({ 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2 }) do
            rows[#rows + 1] = { kind = "speed", v = v, label = fmt_speed(v),
                                active = math.abs((P.speed or 1) - v) < 0.001 }
        end
    elseif kind == "audio" then
        local at = audio_tracks()
        if #at == 0 then
            rows[#rows + 1] = { kind = "none", label = "No audio tracks" }
        else
            for _, tr in ipairs(at) do
                local meta = tr.title or tr.codec or ("Track " .. tostring(tr.id))
                if tr.selected and P.audio_params then
                    local ch = P.audio_params["hr-channels"] or P.audio_params["channels"]
                    if ch and meta:find(ch, 1, true) == nil then meta = meta .. " · " .. ch end
                end
                rows[#rows + 1] = { kind = "track", tk = tr, primary = lang_name(tr),
                                    meta = meta, active = tr.selected }
            end
        end
    elseif kind == "subs" then
        local st = sub_tracks()
        rows[#rows + 1] = { kind = "off", label = "Off", active = (P.sid == "no" or P.sid == nil) }
        if #st > 0 then
            rows[#rows + 1] = { kind = "divider" }
            rows[#rows + 1] = { kind = "section", label = "In this file" }
            for _, tr in ipairs(st) do
                local meta = tr.title or tr.codec or ("Track " .. tostring(tr.id))
                if tr["hearing-impaired"] then meta = meta .. " · SDH" end
                rows[#rows + 1] = { kind = "track", tk = tr, primary = lang_name(tr),
                                    meta = meta, active = tr.selected, external = tr.external,
                                    band = "tracks" }
            end
        end
        rows[#rows + 1] = { kind = "divider" }
        rows[#rows + 1] = { kind = "section", label = "Add subtitles" }
        rows[#rows + 1] = { kind = "action", act = "load_file", label = "From a file…", band = "add" }
        rows[#rows + 1] = { kind = "action", act = "load_online", label = "From an online search…", band = "add" }
        if opts.delay_row then
            rows[#rows + 1] = { kind = "divider" }
            rows[#rows + 1] = { kind = "section", label = "Timing" }
            rows[#rows + 1] = { kind = "delay", label = "Subtitle delay" }
        end
    elseif kind == "more" then
        local at = active_audio_track()
        local sst = active_sub_track()
        rows[#rows + 1] = { kind = "more", act = "speed", label = "Speed",
                            value = fmt_speed(P.speed or 1), accent = (P.speed or 1) ~= 1 }
        rows[#rows + 1] = { kind = "more", act = "audio", label = "Audio",
                            value = at and lang_code(at) or "—" }
        rows[#rows + 1] = { kind = "more", act = "subs", label = "Subtitles",
                            value = sst and lang_code(sst) or "Off" }
        rows[#rows + 1] = { kind = "more", act = "info", label = "Info", value = "" }
    elseif kind == "info" then
        rows[#rows + 1] = { kind = "section", label = "Playback" }
        rows[#rows + 1] = { kind = "kvp", k = "Source", v = H.source_label or "Source", accent = true }
        local vtr
        for _, tr in ipairs(P.tracks or {}) do
            if tr.type == "video" and tr.selected then vtr = tr end
        end
        rows[#rows + 1] = { kind = "kvp", k = "Video", v = vtr and (vtr["codec-desc"] or vtr.codec) or "—" }
        rows[#rows + 1] = { kind = "kvp", k = "Resolution",
                            v = P.video_params and (P.video_params.w .. " × " .. P.video_params.h) or "—" }
        rows[#rows + 1] = { kind = "kvp", k = "Frame rate",
                            v = fmt_fps(P.container_fps) and (fmt_fps(P.container_fps) .. " fps") or "—" }
        rows[#rows + 1] = { kind = "kvp", k = "Bitrate",
                            v = P.video_bitrate and (("%.1f Mb/s"):format(P.video_bitrate / 1e6)) or "—" }
        rows[#rows + 1] = { kind = "section", label = "Tracks" }
        rows[#rows + 1] = { kind = "kvp", k = "Audio bitrate",
                            v = P.audio_bitrate and (("%.0f kb/s"):format(P.audio_bitrate / 1e3)) or "—" }
        local atr = active_audio_track()
        local ac = atr and (atr["codec-desc"] or atr.codec) or nil
        local ch = P.audio_params and (P.audio_params["hr-channels"] or P.audio_params.channels)
        rows[#rows + 1] = { kind = "kvp", k = "Audio", v = ac and (ch and (ac .. " · " .. ch) or ac) or "—" }
        local sbt = active_sub_track()
        rows[#rows + 1] = { kind = "kvp", k = "Subtitles",
                            v = sbt and (sbt.title or sbt.lang or "Track " .. tostring(sbt.id)) or "Off" }
    end
    return rows
end

local function menu_headers(kind, n)
    if kind == "audio" then return "Audio", (n > 0) and (n .. " track" .. (n > 1 and "s" or "")) or nil end
    if kind == "subs" then return "Subtitles", (n > 0) and (n .. " track" .. (n > 1 and "s" or "")) or nil end
    if kind == "speed" then return "Speed", "0.25 – 2×" end
    if kind == "more" then return "More", nil end
    if kind == "info" then return "Info", nil end
end

local function menu_anchor_x(kind)
    if not MENU then return 12 end
    local w = L.menu_w
    local ax = MENU.anchor
    if ax then
        local x1 = clamp(ax + 8 * L.u, w + 12, L.w - 4)
        return x1 - w
    end
    return clamp(L.w - w - 24 * L.u, 12, L.w - w - 12)
end

menu_toggle = function(kind, anchor)
    if MENU and MENU.kind == kind then
        menu_close("toggle")
        return
    end
    MENU = { kind = kind, scroll = 1, anchor = anchor }
    vis_set("showing")
    wake()
    render()
end

menu_scroll = function(m, delta)
    if not MENU or MENU ~= m then return end
    local rows = build_menu_rows(MENU.kind)
    local _, vis = menu_layout(rows)
    local max_scroll = math.max(1, #rows - vis + 1)
    MENU.scroll = clamp(MENU.scroll + delta, 1, max_scroll)
    render()
end

menu_row_activate = function(data)
    local row = (data and data.row) or data or {}
    local kind = row.kind
    if kind == "speed" then
        set_num("speed", row.v)
        menu_close("select")
    elseif kind == "track" then
        if MENU and MENU.kind == "audio" then
            mp.set_property("aid", tostring(row.tk.id))
        else
            mp.set_property("sid", tostring(row.tk.id))
        end
        menu_close("select")
    elseif kind == "off" then
        mp.set_property("sid", "no")
        menu_close("select")
    elseif kind == "action" then
        if row.act == "load_file" then host_msg("fs-req", "sub-file") end
        if row.act == "load_online" then host_msg("fs-req", "sub-search") end
        menu_close("action")
    elseif kind == "more" then
        MENU = { kind = row.act, scroll = 1, anchor = MENU and MENU.anchor }
        render()
    end
end

--========================== 14. widget drawing ========================

local function fad_for()
    if VIS.state == "showing" then return { 160, 0 } end
    if VIS.state == "hiding" then return { 0, 180 } end
    return nil
end

local function glyph_button(id, cx, cy, glyph, disabled, bw, isz)
    bw = bw or L.btn
    local hovered = (PTR.hover == id)
    local pressed = (PTR.press == id)
    -- hover affordance: a soft circular wash behind the icon; pressing
    -- deepens it. Icons brighten on hover.
    local wash = pressed and { 255, 255, 255, 0.14 }
        or (hovered and { 255, 255, 255, 0.10 } or nil)
    if wash then
        -- the wash fills the button's hit area, so hover feedback matches what
        -- you can actually click
        local wr = bw / 2
        ev_draw(cx - wr, cy - wr, V.disc(wr, wr, wr), wash, { fad = fad_for() })
    end
    -- idle and hover share the opaque white icon; the wash behind it carries
    -- the hover state, and pressing dims instead of brightening
    local c = disabled and { 255, 255, 255, 0.32 }
        or (pressed and { 255, 255, 255, 0.72 } or TK.icon)
    if id == "vol_mute" and disabled then
        glyph = GLYPHS.mute
    end
    glyph_at(glyph, cx, cy, isz or L.icon, c)
    add_hit(cx - bw / 2, cy - bw / 2, cx + bw / 2, cy + bw / 2, id)
end

-- per-character width model (em fractions) that holds for BOTH Geist and
-- the Arial fallback: a flat 0.58-per-char guess clipped real labels (the
-- first screenshot showed the clipped glyph at the chip's left edge).
local NARROW = "%.,:;'!|iljt()[]-"
local function char_w(ch)
    if ch == " " then return 0.32 end
    if NARROW:find(ch, 1, true) then return 0.30 end
    if ch:match("%d") then return 0.60 end
    if ch:match("%u") then return 0.72 end
    if ch:match("[mwMW@]") then return 0.92 end
    return 0.56
end

local function est_w(text, fs, mono)
    text = tostring(text)
    if mono then return #text * fs * 0.60 end
    local acc = 0
    for i = 1, #text do acc = acc + char_w(text:sub(i, i)) end
    return acc * fs * 1.06
end

local function truncate(s, maxw, fs, mono)
    if est_w(s, fs, mono) <= maxw then return s end
    while #s > 1 and est_w(s .. "…", fs, mono) > maxw do s = s:sub(1, -2) end
    return s .. "…"
end

--========================== 15. render ===============================

local last_cache_read = 0

local function draw_bar()
    local fad = fad_for()
    local w, bh, bt = L.w, L.bar_h, L.bar_top
    local cy = L.ctl_y
    local seek_y = L.seek_y
    local noaud = no_audio()
    local live = live_or_unknown()
    local chip_fs, t_fs = L.fs_chip, L.fs_time

    -- Scrim: three wide, blurred black bands stack into a single soft ramp.
    -- A flat plate is what read as a grey strip, and any hard step between
    -- two translucent plates draws a horizontal line across the picture.
    -- Blur feathers every edge, so only the darkening is visible.
    local scrim = {
        { top = bt - dp(130, 92), a = 0.14, blur = dp(56, 40) },
        { top = bt - dp(56, 40),  a = 0.24, blur = dp(30, 20) },
        { top = bt - dp(8, 6),    a = 0.30, blur = dp(12, 9) },
    }
    for _, sc in ipairs(scrim) do
        local band_h = L.h + 120 - sc.top
        ev_draw(-60, sc.top, V.round_rect(0, 0, w + 120, band_h, 0),
            { 0, 0, 0, sc.a }, { fad = fad, blur = sc.blur })
    end

    -- ── seek row: full width on its own line ─────────────────────────────
    -- the timeline runs wider than the control row, so scrubbing gets the
    -- whole picture width while the controls keep the page padding
    local sx0, sx1 = L.seek_pad, w - L.seek_pad
    local seek_hit = dp(22, 16)
    add_hit(sx0, seek_y - seek_hit, sx1, seek_y + seek_hit, "seek")

    if live then
        local dot_r = dp(3, 2.5)
        ev_draw(sx0, seek_y - dot_r, V.disc(dot_r, dot_r, dot_r), TK.accent_bri, { fad = fad })
        ev_text(4, sx0 + dot_r * 2 + dp(8, 6), seek_y, "LIVE", TK.text2, dp(11, 10),
            { font = opts.font_mono, spacing = 2 })
        local tx0 = sx0 + dot_r * 2 + dp(8, 6) + est_w("LIVE", dp(11, 10), true) + dp(12, 9)
        local th = dp(3, 3)
        ev_draw(tx0, seek_y - th / 2, V.capsule(0, th / 2, sx1 - tx0, th / 2, th),
            TK.track, { fad = fad })
    else
        local hovered = (PTR.hover == "seek") or (PTR.drag == "seek")
        local track_h = dp(hovered and 6 or 5, 3.5)
        local dur = P.duration or 0
        local frac = PTR.seek_preview
            or clamp((P.time_pos or 0) / (dur > 0 and dur or 1), 0, 1)
        local span = sx1 - sx0

        local rs = {}
        for _, r in ipairs(P.cache_ranges or {}) do
            local a = clamp((r.start or 0) / (dur > 0 and dur or 1), 0, 1)
            local b = clamp((r["end"] or 0) / (dur > 0 and dur or 1), 0, 1)
            if b > a + 0.002 then rs[#rs + 1] = { a, b } end
        end
        table.sort(rs, function(p, q) return p[1] < q[1] end)
        local merged = {}
        for _, rr in ipairs(rs) do
            local mm = merged[#merged]
            if mm and rr[1] <= mm[2] + 0.002 then
                if rr[2] > mm[2] then mm[2] = rr[2] end
            else
                merged[#merged + 1] = { rr[1], rr[2] }
            end
        end
        for _, mm in ipairs(merged) do
            local a, b = mm[1], mm[2]
            if b > frac then
                if a < frac then a = frac end
                ev_draw(sx0 + a * span, seek_y - track_h / 2,
                    V.capsule(0, track_h / 2, (b - a) * span, track_h / 2, track_h),
                    TK.buffered, { fad = fad })
            end
        end

        ev_draw(sx0, seek_y - track_h / 2,
            V.capsule(0, track_h / 2, span, track_h / 2, track_h), TK.track, { fad = fad })
        ev_draw(sx0, seek_y - track_h / 2,
            V.capsule(0, track_h / 2, frac * span, track_h / 2, track_h),
            TK.accent, { fad = fad })

        -- thumb only while the row is live; a permanent dot on a thin line
        -- reads as a slider, not as video chrome
        local th_r = hovered and dp(7, 5.5) or dp(4, 3.5)
        if th_r > 0 then
            local tx = sx0 + frac * span
            ev_draw(tx - th_r - 1, seek_y - th_r - 1,
                V.disc(th_r + 1, th_r + 1, th_r + 1), { 0, 0, 0, 0.45 }, { fad = fad })
            ev_draw(tx - th_r, seek_y - th_r, V.disc(th_r, th_r, th_r),
                TK.accent_bri, { fad = fad })
        end
    end

    -- ── controls row ─────────────────────────────────────────────────────
    local x = L.pad

    -- Source picker: server glyph + label + chevron in a soft pill. As plain
    -- text it read as a caption, so nothing showed that servers are swapped
    -- here. Compact windows keep the glyph and chevron only.
    local show_src_text = not L.compact
    local src_label = truncate(H.source_label or "Source",
        L.w * (L.compact and 0.16 or 0.24), chip_fs, false)
    local src_pad = dp(10, 8)
    local src_icon = dp(17, 15)
    local chev = dp(13, 11)
    local src_text_w = show_src_text and (dp(8, 6) + est_w(src_label, chip_fs, false)) or 0
    local src_w = src_pad + src_icon + src_text_w + dp(6, 5) + chev + src_pad
    local src_h = L.chip_h + dp(8, 6)
    local src_hot = (PTR.hover == "src") or (PTR.press == "src")
    ev_draw(x, cy - src_h / 2, V.round_rect(0, 0, src_w, src_h, src_h / 2),
        { 255, 255, 255, src_hot and 0.16 or 0.09 }, { fad = fad })
    glyph_at(GLYPHS.server, x + src_pad + src_icon / 2, cy, src_icon,
        src_hot and TK.text or TK.text2)
    if show_src_text then
        ev_text(4, x + src_pad + src_icon + dp(8, 6), cy, src_label,
            src_hot and TK.text or TK.text2, chip_fs)
    end
    glyph_at(GLYPHS.chevron, x + src_w - src_pad - chev / 2, cy, chev, TK.text3)
    add_hit(x, cy - src_h / 2, x + src_w, cy + src_h / 2, "src")
    x = x + src_w + L.gap

    local cur_t = PTR.drag == "seek" and PTR.seek_preview and P.duration
        and PTR.seek_preview * P.duration or P.time_pos
    local tot = live and "--:--" or fmt_time(P.duration)
    local cur_s = fmt_time(cur_t)
    ev_text(4, x, cy, cur_s, TK.text, t_fs, { font = opts.font_mono })
    x = x + est_w(cur_s, t_fs, true) + dp(7, 5)
    ev_text(4, x, cy, "/", TK.text3, t_fs, { font = opts.font_mono })
    x = x + est_w("/", t_fs, true) + dp(7, 5)
    ev_text(4, x, cy, tot, TK.text2, t_fs, { font = opts.font_mono })
    local left_end = x + est_w(tot, t_fs, true)

    -- transport: centred on the bar, so play/pause sits in the physical
    -- middle of the UI the way every modern player does it
    local group_w = L.btn * 2 + L.gap_s * 2 + L.btn_big
    local gx = math.max(w / 2 - group_w / 2, left_end + L.gap)
    glyph_button("back10", gx + L.btn / 2, cy, GLYPHS.back10)
    gx = gx + L.btn + L.gap_s
    glyph_button("play", gx + L.btn_big / 2, cy,
        P.pause and GLYPHS.play or GLYPHS.pause, nil, L.btn_big, L.icon * 1.1)
    gx = gx + L.btn_big + L.gap_s
    glyph_button("fwd10", gx + L.btn / 2, cy, GLYPHS.fwd10)
    local center_end = gx + L.btn

    -- right cluster: laid out from the right edge inwards so nothing can
    -- overlap the left cluster on narrow windows; items drop out instead
    local rx = w - L.pad
    local floor_x = math.max(left_end, center_end) + dp(26, 12)
    local function fits(need) return rx - need >= floor_x end

    glyph_button("fs", rx - L.btn / 2, cy, P.fullscreen and GLYPHS.compress or GLYPHS.expand)
    rx = rx - L.btn - L.gap_s

    if L.compact then
        if fits(L.btn) then
            glyph_button("more", rx - L.btn / 2, cy, GLYPHS.more)
            rx = rx - L.btn - L.gap_s
        end
        if fits(L.btn) then
            local vglyph = noaud and GLYPHS.mute
                or (P.mute and GLYPHS.mute
                or ((P.volume or 100) < 50 and GLYPHS.vol_low or GLYPHS.vol))
            glyph_button("vol_mute", rx - L.btn / 2, cy, vglyph, noaud)
        end
    else
        for _, item in ipairs({ { "info", GLYPHS.info }, { "cc", GLYPHS.cc },
                                { "audio", GLYPHS.audio } }) do
            if fits(L.btn) then
                glyph_button(item[1], rx - L.btn / 2, cy, item[2])
                rx = rx - L.btn - L.gap_s
            end
        end

        local slbl = fmt_speed(P.speed or 1)
        local sw = est_w(slbl, chip_fs, true)
        if fits(sw) then
            local active = (P.speed or 1) ~= 1
            ev_text(6, rx, cy, slbl, active and TK.accent_bri
                or (PTR.hover == "speed" and TK.text or TK.text2),
                chip_fs, { font = opts.font_mono })
            add_hit(rx - sw - dp(6, 4), cy - L.chip_h / 2, rx + dp(2, 2), cy + L.chip_h / 2, "speed")
            rx = rx - sw - L.gap
        end

        local vol_w = dp(70, 54)
        local need = L.btn + dp(6, 4) + vol_w
        if fits(need) then
            local ix = rx - need
            local vglyph = noaud and GLYPHS.mute
                or (P.mute and GLYPHS.mute
                or ((P.volume or 100) < 50 and GLYPHS.vol_low or GLYPHS.vol))
            glyph_button("vol_mute", ix + L.btn / 2, cy, vglyph, noaud)
            if not noaud then
                local sx = ix + L.btn + dp(6, 4)
                local v = PTR.vol_preview or (P.volume or 0)
                local vhov = (PTR.hover == "vol_slide") or (PTR.drag == "vol")
                local vth = dp(vhov and 4 or 3, 2.5)
                ev_draw(sx, cy - vth / 2, V.capsule(0, vth / 2, vol_w, vth / 2, vth),
                    TK.track, { fad = fad })
                if v > 0 then
                    ev_draw(sx, cy - vth / 2,
                        V.capsule(0, vth / 2, vol_w * v / 100, vth / 2, vth),
                        TK.vol_fill, { fad = fad })
                end
                local tr = vhov and dp(5.5, 4.5) or 0
                if tr > 0 then
                    local vx = sx + vol_w * v / 100
                    ev_draw(vx - tr, cy - tr, V.disc(tr, tr, tr), TK.accent_bri, { fad = fad })
                end
                add_hit(sx, cy - seek_hit, sx + vol_w, cy + seek_hit, "vol_slide")
            end
        end
    end
end
-- menu layout: returns geometry info and visible row count
menu_layout = function(rows)
    local head_h = menu_head_h()
    local footer = menu_foot_h(MENU.kind)
    local avail = L.bar_top - dp(12, 10) - 12 - head_h - footer
    local total = 0
    for _, r in ipairs(rows) do total = total + row_height(r) end
    local vis = #rows
    if total > avail then
        vis = 0
        local acc = 0
        for i, r in ipairs(rows) do
            local rh = row_height(r)
            if acc + rh > avail then vis = math.max(vis, i - 1) break end
            acc = acc + rh
            vis = i
        end
        vis = math.max(vis, 2)  -- never fewer than 2 visible rows (hard floor)
    end
    return nil, vis
end

local function draw_menu()
    if not MENU then return end
    local rows = build_menu_rows(MENU.kind)
    local _, vis = menu_layout(rows)
    local max_scroll = math.max(1, #rows - vis + 1)
    MENU.scroll = clamp(MENU.scroll or 1, 1, max_scroll)
    local vis_rows = {}
    for i = MENU.scroll, math.min(#rows, MENU.scroll + vis - 1) do
        vis_rows[#vis_rows + 1] = { row = rows[i], idx = i }
    end
    -- auto-scroll to active on open
    if not MENU.scrolled then
        MENU.scrolled = true
        for i, r in ipairs(rows) do
            if r.active and (i < MENU.scroll or i >= MENU.scroll + vis) then
                MENU.scroll = clamp(i - math.floor(vis / 2), 1, max_scroll)
            end
        end
    end

    local head_h, footer_h = menu_head_h(), menu_foot_h(MENU.kind)
    local body_h = 0
    for _, vr in ipairs(vis_rows) do body_h = body_h + row_height(vr.row) end
    local w = L.menu_w
    local x = menu_anchor_x(MENU.kind)
    local y1 = L.bar_top - dp(12, 10)  -- bottom edge (breathes above the bar)
    local y0 = y1 - head_h - body_h - footer_h
    local pad = dp(26, 20)
    local fs = dp(20, 18)
    local fs_meta = dp(16, 15)
    -- hits for the whole menu surface (wheel/click-outside semantics)
    add_hit(x, y0, x + w, y1, "menu", { menu = MENU, rows = vis_rows })

    local radius = dp(20, 16)
    -- A menu over video is a floating window, so it keeps a soft neutral shadow
    -- (surfaces alone carry depth elsewhere) plus a lit top edge. That pair is
    -- what makes the near-black panel read as a real surface instead of a hole.
    ev_draw(x, y0 + dp(10, 8), V.round_rect(0, 0, w, y1 - y0, radius),
        { 0, 0, 0, 0.55 }, { blur = dp(32, 22) })
    ev_draw(x, y0, V.round_rect(0, 0, w, y1 - y0, radius), TK.elevated)
    ev_draw(x, y0, V.rr_ring(0, 0, w, y1 - y0, radius, dp(1.5, 1.2)), TK.menu_ring)
    ev_draw(x + radius, y0 + dp(1, 1),
        ("m 0 0 l %.1f 0"):format(w - 2 * radius), { 255, 255, 255, 0.30 })

    local title, cnt
    if MENU.kind == "audio" then
        local n = #audio_tracks()
        title, cnt = "Audio", n > 0 and (n .. (n > 1 and " tracks" or " track")) or nil
    elseif MENU.kind == "subs" then
        local n = #sub_tracks()
        title, cnt = "Subtitles", n > 0 and (n .. (n > 1 and " tracks" or " track")) or nil
    else
        title, cnt = menu_headers(MENU.kind, 0)
    end
    ev_text(4, x + pad, y0 + head_h / 2, title or "", TK.text, L.fs_head,
        { bold = true, spacing = dp(0.4, 0.3) })
    if cnt then
        ev_text(6, x + w - pad, y0 + head_h / 2, cnt, TK.text3, dp(13, 12), { font = opts.font_mono })
    end
    ev_draw(x, y0 + head_h, ("m 0 0 l %.1f 0 l %.1f 1 l 0 1"):format(w, w), TK.hair)

    -- Rows that belong to one group share a soft inset band, so a long menu
    -- reads as sections instead of one list of equally weighted lines.
    local band_y = y0 + head_h
    local bi = 1
    while bi <= #vis_rows do
        local band = vis_rows[bi].row.band
        local bj = bi
        while bj <= #vis_rows and vis_rows[bj].row.band == band do
            bj = bj + 1
        end
        if band then
            local bh = 0
            for k = bi, bj - 1 do bh = bh + row_height(vis_rows[k].row) end
            ev_draw(x + dp(8, 6), band_y + dp(2, 1),
                V.round_rect(0, 0, w - dp(16, 12), bh - dp(4, 2), dp(10, 8)),
                { 255, 255, 255, 0.05 })
        end
        for k = bi, bj - 1 do band_y = band_y + row_height(vis_rows[k].row) end
        bi = bj
    end

    local yy = y0 + head_h
    for _, vr in ipairs(vis_rows) do
        local row = vr.row
        local rh = row_height(row)
        local cy = yy + rh / 2
        local ax = x + pad
        local rx = x + w - pad
        local hovered = (PTR.hover == "menu" and PTR.hover_data
                         and PTR.hover_data.row_idx == vr.idx)
        if row.kind == "divider" then
            ev_draw(x + pad, yy + rh / 2,
                ("m 0 0 l %.1f 0 l %.1f 1 l 0 1"):format(w - 2 * pad, w - 2 * pad), TK.hair)
        elseif row.kind == "section" then
            ev_text(4, ax, yy + rh * 0.62, row.label, TK.text2, dp(14, 13),
                { bold = true, spacing = dp(0.3, 0.2) })
        else
            if row.active and not hovered then
                ev_draw(x + dp(8, 6), yy + dp(2, 1),
                    V.round_rect(0, 0, w - dp(16, 12), rh - dp(4, 2), dp(10, 8)), TK.selected)
            end
            if hovered then
                ev_draw(x + dp(8, 6), yy + dp(2, 1),
                    V.round_rect(0, 0, w - dp(16, 12), rh - dp(4, 2), dp(10, 8)), TK.hover)
            end
            if row.kind == "track" then
                local tw = dp(34, 26)
                local fsz, msz = dp(22, 20), dp(16, 15)
                ev_text(4, ax, yy + rh * 0.35,
                    truncate(row.primary, w - 2 * pad - tw, fsz, false),
                    TK.text, fsz, { bold = row.active })
                ev_text(4, ax, yy + rh * 0.70,
                    truncate(row.meta, w - 2 * pad - tw, msz, false),
                    row.active and { 255, 255, 255, 0.92 } or { 255, 255, 255, 0.80 }, msz)
                if row.external then
                    local bw2 = est_w("FILE", dp(12, 11), true) + dp(13, 10)
                    local fx = rx - (row.active and dp(28, 22) or 0) - bw2
                    ev_draw(fx, yy + rh * 0.70 - dp(8, 7),
                        V.round_rect(0, 0, bw2, dp(17, 15), dp(4, 3)), TK.hair)
                    ev_text(5, fx + bw2 / 2, yy + rh * 0.70, "FILE", TK.text3, dp(12, 11),
                        { font = opts.font_mono })
                end
                if row.active then
                    glyph_at(GLYPHS.check, rx - dp(10, 8), cy, dp(20, 17), TK.accent)
                end
                add_hit(x + 4, yy, x + w - 4, yy + rh, "menu", { menu = MENU, row_idx = vr.idx, row = row })
            elseif row.kind == "action" then
                glyph_at(row.act == "load_file" and GLYPHS.folder or GLYPHS.globe,
                    ax + dp(12, 10), cy, dp(20, 17), TK.text2)
                ev_text(4, ax + dp(30, 24), cy,
                    truncate(row.label, w - 2 * pad - dp(34, 28), fs, false), TK.text2, fs)
                add_hit(x + 4, yy, x + w - 4, yy + rh, "menu", { menu = MENU, row_idx = vr.idx, row = row })
            elseif row.kind == "more" then
                ev_text(4, ax, cy, row.label, TK.text, fs)
                if row.value and row.value ~= "" then
                    ev_text(6, rx, cy, truncate(row.value, w * 0.45, fs_meta, false),
                        row.accent and TK.accent or TK.text2, fs_meta,
                        { font = opts.font_mono })
                end
                add_hit(x + 4, yy, x + w - 4, yy + rh, "menu", { menu = MENU, row_idx = vr.idx, row = row })
            elseif row.kind == "speed" then
                ev_text(4, ax, cy, row.label, row.active and TK.text or TK.text2, fs,
                    { font = opts.font_mono })
                if row.active then
                    glyph_at(GLYPHS.check, rx - dp(10, 8), cy, dp(20, 17), TK.accent)
                end
                add_hit(x + 4, yy, x + w - 4, yy + rh, "menu", { menu = MENU, row_idx = vr.idx, row = row })
            elseif row.kind == "off" then
                ev_text(4, ax, cy, row.label, row.active and TK.text or TK.text2, fs)
                if row.active then
                    glyph_at(GLYPHS.check, rx - dp(10, 8), cy, dp(20, 17), TK.accent)
                end
                add_hit(x + 4, yy, x + w - 4, yy + rh, "menu", { menu = MENU, row_idx = vr.idx, row = row })
            elseif row.kind == "delay" then
                ev_text(4, ax, cy, row.label, TK.text2, fs)
                local bw, bhh = dp(42, 36), dp(36, 31)
                local gap = dp(8, 6)
                local vw = est_w("-0.0 s", fs_meta, true)
                local plus_x = rx - bw
                local minus_x = plus_x - gap - vw - gap - bw
                local val = fmt_delay(P.sub_delay or 0)
                local active = (P.sub_delay or 0) ~= 0
                for i, id in ipairs({ "delay_minus", "delay_plus" }) do
                    local bx = (i == 1) and minus_x or plus_x
                    if PTR.hover == id then
                        ev_draw(bx, cy - bhh / 2, V.round_rect(0, 0, bw, bhh, dp(6, 5)), TK.subtle)
                    end
                    glyph_at(i == 1 and GLYPHS.minus or GLYPHS.plus, bx + bw / 2, cy,
                        dp(17, 15), TK.text2)
                    add_hit(bx, yy, bx + bw, yy + rh, id)
                end
                ev_text(5, minus_x + bw + gap + vw / 2, cy, val,
                    active and TK.accent or TK.text2, fs_meta, { font = opts.font_mono })
            elseif row.kind == "kvp" then
                ev_text(4, ax, cy, row.k, TK.text2, dp(15, 14),
                    { bold = true, spacing = dp(0.3, 0.2) })
                ev_text(6, rx, cy, truncate(row.v, w - 2 * pad - dp(124, 100), dp(20, 18), true),
                    row.accent and TK.accent or TK.text, dp(20, 18),
                    { font = row.accent and opts.font_ui or opts.font_mono })
            elseif row.kind == "none" then
                ev_text(4, ax, cy, row.label, TK.text2, fs)
            end
        end
        yy = yy + rh
    end

    -- scroll indicator when clipped; the knob tracks the real range, so it
    -- reaches the bottom with the last row instead of stopping short
    if #rows > vis then
        local body_y0 = y0 + head_h
        local body_y1 = y1 - footer_h
        local track_h = body_y1 - body_y0
        local th = math.max(dp(24, 18), track_h * vis / #rows)
        local ty = body_y0 + (MENU.scroll - 1) / math.max(1, #rows - vis) * (track_h - th)
        ev_draw(x + w - dp(7, 5), ty,
            V.round_rect(0, 0, dp(4, 3), th, dp(2, 1.5)), { 255, 255, 255, 0.40 })
    end

    -- speed footer hint: "Hold [Space] for 2x"
    if MENU.kind == "speed" then
        local fy = y1 - footer_h / 2
        local fs_hint = dp(13, 12)
        glyph_at(GLYPHS.info, x + pad + dp(6, 5), fy, dp(14, 12), TK.text3)
        local lx = x + pad + dp(19, 15)
        ev_text(4, lx, fy, "Hold", TK.text3, fs_hint)
        local cap_w = est_w("SPACE", dp(12, 11), true) + dp(16, 12)
        local cap_h2 = dp(24, 20)
        local kx = lx + est_w("Hold", fs_hint) + dp(7, 5)
        ev_draw(kx, fy - cap_h2 / 2, V.round_rect(0, 0, cap_w, cap_h2, dp(5, 4)),
            { 255, 255, 255, 0.12 })
        ev_text(5, kx + cap_w / 2, fy, "SPACE", TK.text, dp(12, 11), { font = opts.font_mono })
        ev_text(4, kx + cap_w + dp(7, 5), fy, "for 2x speed", TK.text3, fs_hint)
    end
end

local function draw_status_pill()
    local st = H.status
    if st ~= "buffering" and st ~= "switching" and st ~= "error" then return end
    local m = mur()
    local label = (st == "buffering" and "Buffering…")
                or (st == "switching" and (H.status_detail or "Switching source…"))
                or (H.status_detail or "Playback error")
    local glyph = (st == "error") and GLYPHS.warn
                or (SPIN.f == 1 and GLYPHS.spin or GLYPHS["spin" .. SPIN.f])
    local w = est_w(label, 13 * m) + 16 * m + 16 * m + 10 * m
    local cx = L.w / 2
    local cy
    if bar_visible_for_render() then cy = L.bar_top - dp(34, 26)
    else cy = L.h * 0.62 end
    local h = 38 * m
    ev_draw(cx - w / 2, cy - h / 2, V.round_rect(0, 0, w, h, 12 * m), TK.surface)
    glyph_at(glyph, cx - w / 2 + 17 * m + 9 * m, cy, 18 * m, TK.accent)
    ev_text(4, cx - w / 2 + 17 * m + 18 * m + 11 * m, cy, label, TK.text, dp(14, 12.5))
end

local function draw_tooltips()
    if not PTR.tooltip or menu_is_open() then return end
    local id = PTR.tooltip
    -- Same dp scale as the bar. The old bubble used mur() units, so on a 720p
    -- window it collapsed to ~25px with 10px mono text, and the key cap was a
    -- hairline ring over a fill (a double edge at that size).
    local fs = dp(17, 16)
    local bh = dp(44, 38)
    local pad = dp(15, 12)
    local cap_h = dp(26, 22)
    local cy = L.seek_y - dp(38, 30)

    -- keeps the bubble on screen and returns the clamped centre
    local function bubble(cx, w)
        local margin = dp(4, 3)
        cx = clamp(cx, w / 2 + margin, L.w - w / 2 - margin)
        ev_draw(cx - w / 2, cy - bh / 2, V.round_rect(0, 0, w, bh, dp(12, 9)), TK.elevated)
        return cx
    end

    if id == "seek" and not live_or_unknown() and P.duration then
        local x0, x1
        for _, h in ipairs(hits) do
            if h.id == "seek" then x0, x1 = h.x0, h.x1 break end
        end
        if not x0 then return end
        -- time at the pointer (or scrub preview while dragging)
        local frac = PTR.seek_preview
        if not frac then
            if PTR.hover == "seek" or PTR.drag == "seek" then
                frac = clamp((PTR.x - x0) / (x1 - x0), 0, 1)
            else
                frac = clamp((P.time_pos or 0) / P.duration, 0, 1)
            end
        end
        local txt = fmt_time(frac * P.duration)
        -- measure the longest time this title can show: the bubble then keeps
        -- one width while the pointer moves, instead of resizing per digit
        local w = est_w(fmt_time(P.duration), fs, true) + 2 * pad
        local tx = bubble(clamp(PTR.x, x0 + w / 2, x1 - w / 2), w)
        ev_text(5, tx, cy, txt, TK.text, fs, { font = opts.font_mono })
    else
        local tt = tooltip_for(id)
        if not tt then return end
        local hr
        for _, h in ipairs(hits) do if h.id == id then hr = h break end end
        if not hr then return end
        local label, key = tt[1], tt[2]
        local kw = key and (est_w(key, dp(14, 12.5), true) + dp(15, 12)) or 0
        local w = pad * 2 + est_w(label, fs, false) + (key and dp(9, 7) + kw or 0)
        local cx = bubble((hr.x0 + hr.x1) / 2, w)
        ev_text(4, cx - w / 2 + pad, cy, label, TK.text, fs)
        if key then
            local kx = cx + w / 2 - pad - kw
            ev_draw(kx, cy - cap_h / 2, V.round_rect(0, 0, kw, cap_h, dp(5, 4)),
                { 255, 255, 255, 0.12 })
            ev_text(5, kx + kw / 2, cy, key, TK.text2, dp(14, 12.5), { font = opts.font_mono })
        end
    end
end

render = function()
    compute_layout()
    hits = {}
    ev_reset()
    if suppress() then
        overlay.data = ""
        overlay:update()
        if opts.debug then _G.fs_dbg_vis = "suppressed" end
        return
    end
    if bar_visible_for_render() then draw_bar() end
    draw_menu()
    draw_status_pill()
    draw_tooltips()
    overlay.res_x = L.w
    overlay.res_y = L.h
    ev_flush()
    update_timers()
    if opts.debug then
        -- development-only introspection used by the self-test harness
        _G.fs_dbg_hits = hits
        _G.fs_dbg_menu = MENU
        _G.fs_dbg_vis  = VIS.state
        _G.fs_dbg_bar  = bar_visible_for_render()
        _G.fs_dbg_ptr  = PTR
        _G.fs_dbg_layout = { u = L.u, bar_h = L.bar_h, icon = L.icon, btn = L.btn,
                             chip_h = L.chip_h, fs_time = L.fs_time, fs_chip = L.fs_chip,
                             pad = L.pad, w = L.w, h = L.h, compact = L.compact }
    end
end

request_render = function()
    -- Coalesce, never reset. Restarting the 30 ms timer on every pointer event
    -- meant a fast drag kept pushing it out of reach, so the overlay only
    -- repainted on the 200 ms progress tick and the seek time trailed the
    -- cursor. One pending flush is enough: it reads live state when it fires.
    if timers.flush then return end
    timers.flush = mp.add_timeout(0.03, function()
        timers.flush = nil
        local ok, err = pcall(render)
        if not ok then msg.error("OSC render: " .. tostring(err)) end
    end)
end

update_timers = function()
    local want_progress = (not suppress()) and bar_visible_for_render()
        and (not P.pause) and (not P.idle)
    if want_progress and not timers.progress then
        timers.progress = mp.add_periodic_timer(0.2,
            shield("progress timer", function() render() end))
    elseif (not want_progress) and timers.progress then
        timers.progress:kill()
        timers.progress = nil
    end
    local want_spin = (not suppress()) and (H.status == "buffering" or H.status == "switching")
    if want_spin and not timers.spin then
        timers.spin = mp.add_periodic_timer(0.08, shield("spin timer", function()
            SPIN.f = SPIN.f % 4 + 1
            render()
        end))
    elseif (not want_spin) and timers.spin then
        timers.spin:kill()
        timers.spin = nil
    end
end

--========================== 16. input adapters ========================

local function native_pos()
    local p = mp.get_property_native("mouse-pos")
    if p and p.hover ~= false and p.x and p.y then return p.x, p.y end
    if p and p.x and p.y then return p.x, p.y end
    return nil
end

local function mirror_pos(fx, fy)
    local nx, ny = native_pos()
    if nx then return nx, ny end
    return tonumber(fx), tonumber(fy)   -- host already sent `mouse x y` first
end

local function input_mirror_setup()
    mp.register_script_message("fs-pointer", shield("fs-pointer", function(mode, fx, fy)
        local x, y = mirror_pos(fx, fy)
        if not x or not y then return end
        if mode == "move" then on_move(x, y)
        elseif mode == "down" then on_down(x, y)
        elseif mode == "up" then on_up(x, y) end
    end))
    mp.register_script_message("fs-wheel", shield("fs-wheel", function(dir, fx, fy)
        local x, y = mirror_pos(fx, fy)
        if not x or not y then return end
        on_wheel(dir, x, y)
    end))
end

local function input_native_setup()
    mp.observe_property("mouse-pos", "native", shield("native mouse-pos", function(_, v)
        if type(v) == "table" and v.x and v.y then on_move(v.x, v.y) end
    end))
    mp.add_key_binding("MBTN_LEFT", "fs_mbtn", shield("MBTN_LEFT", function(e)
        if e.event == "down" then
            local x, y = native_pos()
            if x then on_down(x, y) end
        elseif e.event == "up" then
            local x, y = native_pos()
            if x then on_up(x, y) end
        end
    end), { complex = true })
    mp.add_key_binding("WHEEL_UP", "fs_wheel_up", shield("WHEEL_UP", function()
        local x, y = native_pos()
        if x then on_wheel("up", x, y) end
    end))
    mp.add_key_binding("WHEEL_DOWN", "fs_wheel_down", shield("WHEEL_DOWN", function()
        local x, y = native_pos()
        if x then on_wheel("down", x, y) end
    end))
end

--========================== 17. host messages =========================

local function set_status(status, detail)
    H.status = status
    H.status_detail = detail
    if status == "error" then
        t_oneshot("err_dismiss", 4.0, function()
            if H.status == "error" then H.status = "none" render() end
        end)
    end
    update_timers()
    render()
end

local function host_message_handlers()
    mp.register_script_message("fs-state", shield("fs-state", function(key, ...)
        if key == "source" then
            H.source_label = table.concat({ ... }, " ")
            render()
        elseif key == "fullscreen" then
            local v = select(1, ...) == "yes"
            P.fullscreen = v
            render()
        end
    end))
    mp.register_script_message("fs-status", shield("fs-status", function(status, ...)
        set_status(status, table.concat({ ... }, " "))
    end))
    mp.register_script_message("fs-panel", shield("fs-panel", function(arg)
        local open = (arg == "open")
        H.panel = open
        if open then
            menu_close("panel")
            PTR.press, PTR.drag, PTR.hover, PTR.tooltip = nil, nil, nil, nil
            t_kill("autohide")
            t_kill("tooltip")
            t_kill("flush")
            overlay.data = ""
            overlay:update()
        else
            -- The panel hid the bar on open, so the bar has to come back when
            -- the video does; otherwise it stays hidden until the pointer moves.
            wake()
            update_timers()
            render()
        end
    end))
    mp.register_script_message("fs-menu", shield("fs-menu", function(arg)
        if arg == "close" then menu_close("host") end
    end))
    mp.register_script_message("fs-bar", shield("fs-bar", function(arg)
        if arg == "show" then
            H.bar_override = "show"
            vis_set("showing")
        elseif arg == "hide" then
            H.bar_override = "hide"
            vis_set("hiding")
        elseif arg == "auto" then
            H.bar_override = nil
            wake()
            request_render()
        end
    end))
    mp.register_script_message("fs-refresh", shield("fs-refresh", function()
        refresh_state()
    end))
end

--========================== 18. bootstrap ============================

refresh_state = function()
    local function g(name, default)
        local v = mp.get_property_native(name)
        if v == nil then return default end
        return v
    end
    P.pause          = g("pause", false)
    P.volume         = g("volume", 100)
    P.mute            = g("mute", false)
    P.speed           = g("speed", 1)
    P.aid             = g("aid", nil)
    P.sid             = g("sid", nil)
    P.tracks          = g("track-list", {})
    P.duration        = g("duration", nil)
    P.time_pos        = g("time-pos", nil)
    P.seekable        = g("seekable", false)
    P.sub_delay       = g("sub-delay", 0)
    P.video_params    = g("video-params", nil)
    P.audio_params    = g("audio-params", nil)
    P.container_fps  = g("container-fps", nil)
    P.video_bitrate  = g("video-bitrate", nil)
    P.audio_bitrate  = g("audio-bitrate", nil)
    P.fullscreen     = g("fullscreen", false)
    P.idle            = g("idle-active", false)
    local cs = g("demuxer-cache-state", nil)
    P.cache_ranges   = cs and cs["seekable-ranges"] or {}
    render()
end

local function init()
    overlay = mp.create_osd_overlay("ass-events")
    overlay.res_x = L.w
    overlay.res_y = L.h

    local function obs(name, fn)
        mp.observe_property(name, "native", shield("observe " .. name, fn))
    end
    obs("pause", function(_, v) P.pause = v request_render() end)
    obs("volume", function(_, v) P.volume = v request_render() end)
    obs("mute", function(_, v) P.mute = v request_render() end)
    obs("speed", function(_, v) P.speed = v request_render() end)
    obs("aid", function(_, v) P.aid = v request_render() end)
    obs("sid", function(_, v) P.sid = v request_render() end)
    obs("track-list", function(_, v) P.tracks = v or {} request_render() end)
    obs("duration", function(_, v) P.duration = v request_render() end)
    obs("time-pos", function(_, v)
        if P.time_pos ~= v then P.time_pos = v end
    end)
    obs("seekable", function(_, v) P.seekable = v request_render() end)
    obs("sub-delay", function(_, v) P.sub_delay = v request_render() end)
    obs("video-params", function(_, v) P.video_params = v request_render() end)
    obs("audio-params", function(_, v) P.audio_params = v request_render() end)
    obs("container-fps", function(_, v) P.container_fps = v request_render() end)
    obs("video-bitrate", function(_, v) P.video_bitrate = v request_render() end)
    obs("audio-bitrate", function(_, v) P.audio_bitrate = v request_render() end)
    obs("fullscreen", function(_, v) P.fullscreen = v request_render() end)
    obs("idle-active", function(_, v) P.idle = v request_render() end)
    obs("osd-width", function() request_render() end)
    local last_cache = 0
    obs("demuxer-cache-state", function(_, v)
        local now = mp.get_time()
        if now - last_cache < 0.4 then return end
        last_cache = now
        P.cache_ranges = (v and v["seekable-ranges"]) or {}
        request_render()
    end)

    if opts.input == "native" then
        input_native_setup()
    else
        input_mirror_setup()
    end
    host_message_handlers()

    mp.register_event("file-loaded", shield("file-loaded", function()
        menu_close("file")
        PTR.drag, PTR.press, PTR.seek_preview, PTR.vol_preview = nil, nil, nil, nil
        refresh_state()
        wake()
    end))
    mp.register_event("shutdown", shield("shutdown", function()
        if overlay then overlay:remove() end
    end))

    refresh_state()
    if opts.debug then msg.info("FilmSnaps OSC loaded (input=%s)", opts.input) end
end

init()
