// Pure logic + Discord-store resolvers + the markup tokenizer. Depends only on
// shelter.js (stores/store) and solid-js. No shared UI signals live here.
import { createSignal } from "solid-js";
import {
  store,
  log,
  MessageStore,
  ChannelStore,
  UserStore,
  GuildStore,
  GuildRoleStore,
  GuildMemberStore,
  LocaleStore,
} from "./shelter.js";

// use Discord's own locale so the feed's time format (12h/24h) matches Discord
function discordLocale() {
  return LocaleStore?.locale || undefined;
}

// ---------------------------------------------------------------------------
// tunable config (all timings in ms)
// ---------------------------------------------------------------------------
export const MAX_MESSAGES = 100; // messages kept per pane (bounds memory/DOM)
export const SEED_FETCH_LIMIT = 50; // messages fetched when a channel isn't cached
const GROUP_WINDOW_MS = 7 * 60 * 1000; // group consecutive msgs within this gap
export const SCROLLBAR_HIDE_MS = 900; // hide scrollbar this long after scrolling stops
export const FLASH_MS = 1600; // duration of the jump-to-message flash highlight
export const TOAST_MS = 2200; // how long the "Opened in Discord" toast shows
const DEFAULT_VOLUME = 0.5; // initial video volume (persisted after first change)
// stable per-session token to cache-bust animated emoji GIFs in the popup
// document (works around Chromium freezing GIFs on first frame in window.open).
const EMOJI_GIF_TOKEN = Math.random().toString(36).slice(2, 8);

// resolve a member's display name + role color within a guild.
// Important: the author object embedded in a message is a stale snapshot that
// often lacks globalName -- we read the LIVE user from UserStore for the real
// display name. Name priority (Discord default): nick -> globalName -> username.
// Color comes from the member's pre-computed colorString.
export function resolveMember(guildId, author, isWebhook = false) {
  const id = author?.id;
  // Webhooks set a custom username PER MESSAGE while reusing one author id, so
  // UserStore/GuildMember lookups would resolve them all to one wrong cached
  // identity. Use the message author's own username verbatim for webhooks.
  if (isWebhook) {
    return {
      name: author?.username ?? author?.global_name ?? "webhook",
      color: undefined,
    };
  }
  // prefer the live user object (has globalName); fall back to the snapshot
  const user = (id && UserStore?.getUser?.(id)) || author || {};
  const baseName = user.globalName ?? user.global_name ?? user.username ?? "unknown";
  if (!guildId || !id) return { name: baseName, color: undefined };
  const member = GuildMemberStore?.getMember?.(guildId, id);
  const name = member?.nick ?? baseName;
  const color =
    member?.colorString ?? member?.colorStrings?.primaryColor ?? undefined;
  return { name, color };
}

// resolve a role id -> { name, color } using whichever role store is present.
function resolveRole(guildId, roleId) {
  let role;
  // newer Discord: GuildRoleStore.getRole(guildId, roleId)
  role = GuildRoleStore?.getRole?.(guildId, roleId);
  // fallback: GuildStore guild.roles map
  if (!role) role = GuildStore?.getGuild?.(guildId)?.roles?.[roleId];
  if (!role) return null;
  const color =
    role.color && role.color !== 0
      ? `#${role.color.toString(16).padStart(6, "0")}`
      : undefined;
  return { name: role.name, color };
}

// resolve a channel id -> { name } and its guild id, for #channel pills
function resolveChannelRef(channelId) {
  const ch = ChannelStore.getChannel?.(channelId);
  if (!ch) return null;
  return { name: ch.name, guildId: ch.guild_id };
}

// ---------------------------------------------------------------------------
// persisted state: named "profiles", each a list of channel IDs to monitor
// in the Shared Feed. { [name]: string[] }. Everything persists as a JSON
// STRING (a primitive), not a nested object/array, because shelter's plugin
// store is a Solid proxy and storing/spreading a nested proxy triggers
// "Please use proxy object" errors.
//
// Migration: older installs only ever had store.channelsJson (a flat
// array). On first load with the new format missing, wrap that array into
// a single "Default" profile so nobody's existing list disappears.
// ---------------------------------------------------------------------------
// Profiles are named, PERSISTENT channel lists. Each is opened on demand into
// its own feed window (multiple can be open at once). There is no "active"
// profile -- the Shared Feed is a separate, transient (in-memory only) list
// that lives in components.jsx and isn't persisted here.
//
// keeps names short enough to never wrap/crowd the toolbar flyout, the "Add
// to Profile" submenu, or the settings rows.
export const PROFILE_NAME_MAX_LENGTH = 20;
//
// profile display order is tracked SEPARATELY from the profiles map, because
// JS object key order isn't stable under rename (delete+re-add moves a key
// to the end) -- this keeps "created first" ordering regardless of renames.
store.profilesJson ??= (() => {
  // one-time migration: older installs kept a single flat channel list in
  // channelsJson -- fold it into a "Default" profile so it isn't lost.
  try {
    const legacy = JSON.parse(store.channelsJson ?? "[]");
    if (Array.isArray(legacy) && legacy.length) {
      return JSON.stringify({ Default: legacy });
    }
  } catch {}
  return JSON.stringify({});
})();
store.profileOrderJson ??= (() => {
  try {
    return JSON.stringify(Object.keys(JSON.parse(store.profilesJson)));
  } catch {
    return JSON.stringify([]);
  }
})();

function loadProfiles() {
  try {
    const v = JSON.parse(store.profilesJson);
    if (v && typeof v === "object" && !Array.isArray(v)) return v;
    log(["discordfeed: profilesJson was valid JSON but not an object -- refusing to treat as empty", store.profilesJson], "warn");
  } catch (e) {
    log(["discordfeed: profilesJson failed to parse -- refusing to treat as empty (data NOT wiped)", store.profilesJson, e], "warn");
  }
  // IMPORTANT: never return {} here. A caller that reads {} and then saves
  // (e.g. addChannelToProfile) would permanently overwrite real data with
  // an empty object on what might just be a transient read glitch. Throwing
  // instead means a broken read surfaces as an error, not silent data loss.
  throw new Error("discordfeed: could not read profiles from storage");
}

function saveProfiles(profiles) {
  store.profilesJson = JSON.stringify(profiles);
}

function loadOrder() {
  try {
    const v = JSON.parse(store.profileOrderJson);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function saveOrder(order) {
  store.profileOrderJson = JSON.stringify(order);
}

export function listProfiles() {
  let profiles;
  try {
    profiles = loadProfiles();
  } catch {
    // surfaced (loadProfiles already logged) -- show an empty list rather
    // than crash the settings panel, but do NOT touch storage (no save).
    return [];
  }
  const order = loadOrder();
  // names in the map but missing from order (e.g. pre-order-tracking
  // installs) are appended once, in whatever order Object.keys gives --
  // self-healing without losing anything
  const known = new Set(order);
  const healed = [...order.filter((n) => n in profiles), ...Object.keys(profiles).filter((n) => !known.has(n))];
  if (healed.length !== order.length || healed.some((n, i) => n !== order[i])) saveOrder(healed);
  return healed;
}

// channels belonging to a specific profile (empty array if unknown)
export function getProfileChannels(name) {
  const arr = loadProfiles()[name];
  return Array.isArray(arr) ? arr : [];
}

export function isChannelInProfile(name, id) {
  return getProfileChannels(name).includes(id);
}

export function addChannelToProfile(name, id) {
  const profiles = loadProfiles();
  if (!(name in profiles) || !id) return false;
  if (profiles[name].includes(id)) return false;
  profiles[name] = [...profiles[name], id];
  saveProfiles(profiles);
  return true;
}

export function removeChannelFromProfile(name, id) {
  const profiles = loadProfiles();
  if (!(name in profiles)) return false;
  if (!profiles[name].includes(id)) return false;
  profiles[name] = profiles[name].filter((c) => c !== id);
  saveProfiles(profiles);
  return true;
}

export function createProfile(name) {
  const trimmed = name.trim().slice(0, PROFILE_NAME_MAX_LENGTH);
  if (!trimmed) return false;
  const profiles = loadProfiles();
  if (trimmed in profiles) return false;
  profiles[trimmed] = [];
  saveProfiles(profiles);
  saveOrder([...loadOrder(), trimmed]);
  return true;
}

export function renameProfile(oldName, newName) {
  const trimmed = newName.trim().slice(0, PROFILE_NAME_MAX_LENGTH);
  if (!trimmed || oldName === trimmed) return false;
  const profiles = loadProfiles();
  if (!(oldName in profiles) || trimmed in profiles) return false;
  profiles[trimmed] = profiles[oldName];
  delete profiles[oldName];
  saveProfiles(profiles);
  // swap the name in place so its position in the order is preserved
  saveOrder(loadOrder().map((n) => (n === oldName ? trimmed : n)));
  return true;
}

export function deleteProfile(name) {
  const profiles = loadProfiles();
  if (!(name in profiles)) return false;
  delete profiles[name];
  saveProfiles(profiles);
  saveOrder(loadOrder().filter((n) => n !== name));
  return true;
}

// hide the "discordfeed" title header bar in popout windows (user setting)
store.hideTitle ??= false;

// show an always-visible message composer under every pane (not just when
// replying to a specific message via right-click)
store.showComposer ??= false;

// persisted player volume (0..1), so videos don't blast at full volume each time
store.videoVolume ??= DEFAULT_VOLUME;
// set up a <video> ref to use + remember the saved volume
export function setupVideoVolume(el) {
  if (!el) return;
  const apply = () => {
    el.volume = store.videoVolume;
  };
  // apply once metadata is ready (volume can reset before the media loads)
  el.addEventListener("loadedmetadata", apply);
  apply();
  // remember whatever the user sets
  el.addEventListener("volumechange", () => {
    if (!el.muted) store.videoVolume = el.volume;
  });
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
export function channelName(id) {
  const ch = ChannelStore.getChannel(id);
  if (!ch) return id;
  return ch.name ? `#${ch.name}` : id;
}

export function avatarUrl(author) {
  if (!author) return undefined;
  if (author.avatar)
    return `https://cdn.discordapp.com/avatars/${author.id}/${author.avatar}.png?size=32`;
  // default avatar (new-style index by user id)
  const idx = Number((BigInt(author.id) >> 22n) % 6n);
  return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
}

// time in Discord's locale (so 12h/24h matches Discord's setting)
export function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString(discordLocale(), {
    hour: "numeric",
    minute: "2-digit",
  });
}

// human file size: 402.00 KB / 1.20 MB
export function formatSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

// unicode emoji -> Twemoji image URL (how Discord renders unicode emoji).
// builds the dashed codepoint sequence Twemoji uses (drops VS16 ️).
export function twemojiUrl(str) {
  const cps = [];
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    if (cp !== 0xfe0f) cps.push(cp.toString(16));
  }
  return `https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/svg/${cps.join("-")}.svg`;
}

// Discord embed footer style: "Today at 6:51 AM" / "Yesterday at ..." / date
export function fmtFooterTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = (a, b) => a.toDateString() === b.toDateString();
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  const time = fmtTime(ts);
  if (sameDay(d, now)) return `Today at ${time}`;
  if (sameDay(d, yest)) return `Yesterday at ${time}`;
  return `${d.toLocaleDateString(discordLocale())} ${time}`;
}

// open a url in the user's real browser (safe; never auto-navigates Discord)
export function openExternal(url) {
  window.open(url, "_blank", "noopener,noreferrer");
}

// navigate the main Discord window to a channel, or a specific message when a
// messageId is given. The message jump goes through Discord's ROUTER (not Flux
// -- captured dispatches are empty; only "[Routing/Utils] transitionTo" logs),
// so we drive the router via the History API: push the full path and emit
// popstate. Discord's router picks it up and jumps to (and flashes) the message.
export function navigateToChannel(guildId, channelId, messageId) {
  const path = `/channels/${guildId ?? "@me"}/${channelId}${
    messageId ? `/${messageId}` : ""
  }`;
  try {
    window.history.pushState(null, "", path);
    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
  } catch {}
  try {
    window.focus();
  } catch {}
}

// decide: internal discord link -> navigate in place; everything else -> browser
export function openLink(url) {
  // capture guild / channel / optional message id (3rd segment)
  const m = url.match(/discord(?:app)?\.com\/channels\/(@me|\d+)\/(\d+)(?:\/(\d+))?/);
  if (m) {
    navigateToChannel(m[1] === "@me" ? null : m[1], m[2], m[3]);
    return;
  }
  openExternal(url);
}

// ---------------------------------------------------------------------------
// content rendering: tokenize Discord markup into Solid nodes.
// Handles (in priority order): custom emoji, user/channel/role mentions,
// @everyone/@here, channel links, plain URLs, **bold**, *italic*, `code`.
// ---------------------------------------------------------------------------
// Pattern SOURCE only. We build a fresh RegExp per call so the recursive
// renderContent (used by spoilers) never shares stateful lastIndex with an
// outer in-progress scan -- sharing it caused infinite loops / freezes.
const TOKEN_SRC = [
  "\\[[^\\]]+\\]\\(\\s*<?https?://[^)\\s]+>?\\s*\\)", // masked link [label](url)
  "<a?:\\w+:\\d+>", // custom emoji
  "<@!?\\d+>", // user mention
  "<@&\\d+>", // role mention
  "<#\\d+>", // channel mention
  "@everyone|@here",
  "\\|\\|[^|]+(?:\\|[^|]+)*\\|\\|", // spoiler ||text|| (no catastrophic backtracking)
  "https?://(?:\\w+\\.)?discord(?:app)?\\.com/channels/[\\d@me]+/\\d+(?:/\\d+)?", // channel/message link
  "https?://[^\\s]+", // generic url
  "`[^`]+`", // inline code
  "\\*\\*[^*]+\\*\\*", // bold
  "\\*[^*]+\\*", // italic
].join("|");

// inline tokenizer: emoji, mentions, links, bold/italic/code/spoiler, etc.
function renderInline(text, guildId, depth = 0) {
  if (!text) return null;
  if (depth > 4) return text; // hard stop against pathological recursion
  const re = new RegExp(TOKEN_SRC, "g"); // fresh, per-call -> no shared state
  const out = [];
  let last = 0;
  let match;
  let guard = 0;
  while ((match = re.exec(text)) !== null) {
    if (++guard > 5000) break; // safety: never spin forever
    // zero-length match would loop forever; force progress
    if (match.index === re.lastIndex) {
      re.lastIndex++;
      continue;
    }
    if (match.index > last) out.push(text.slice(last, match.index));
    out.push(renderToken(match[0], guildId, depth));
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// line-level markdown: headers (#/##/###), subtext (-#), blockquote (>) are
// per-line prefixes. Split into lines, wrap each, delegate inline to above.
export function renderContent(text, guildId, depth = 0) {
  if (!text) return null;
  if (depth > 4) return text;

  // fenced code blocks ```...``` take precedence and render raw (no markdown
  // inside). Split on fences; render code parts as <pre>, rest normally.
  if (depth === 0 && text.includes("```")) {
    const out = [];
    const fence = /```(?:(\w+)\n)?([\s\S]*?)```/g;
    let last = 0;
    let fm;
    while ((fm = fence.exec(text)) !== null) {
      if (fm.index > last)
        out.push(renderContent(text.slice(last, fm.index), guildId, 1));
      out.push(
        <pre class="mc-codeblock">
          <code>{fm[2].replace(/\n$/, "")}</code>
        </pre>
      );
      last = fm.index + fm[0].length;
    }
    if (last < text.length) out.push(renderContent(text.slice(last), guildId, 1));
    if (out.length) return out;
  }

  // fast path: no line-level prefixes anywhere -> just inline-render
  if (!/(^|\n)\s*(#{1,3}\s|-#\s|>\s)/.test(text))
    return renderInline(text, guildId, depth);

  const lines = text.split("\n");
  return lines.map((line, i) => {
    const br = i < lines.length - 1; // newline after every line but the last
    let m;
    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) {
      const cls = `mc-h${m[1].length}`;
      return (
        <div class={cls}>{renderInline(m[2], guildId, depth + 1)}</div>
      );
    }
    if ((m = line.match(/^-#\s+(.*)$/))) {
      return <div class="mc-subtext">{renderInline(m[1], guildId, depth + 1)}</div>;
    }
    if ((m = line.match(/^>\s+(.*)$/))) {
      return (
        <div class="mc-quote">{renderInline(m[1], guildId, depth + 1)}</div>
      );
    }
    return (
      <>
        {renderInline(line, guildId, depth + 1)}
        {br ? "\n" : null}
      </>
    );
  });
}

function ChannelPill(props) {
  // a message link carries the full url (data-mc-url) so clicking jumps to the
  // message; a plain channel link uses data-mc-channel. Message links also show
  // a › chevron, like Discord.
  return (
    <span
      class="mc-mention mc-channel-mention"
      data-mc-channel={props.messageUrl ? undefined : props.channelId}
      data-mc-guild={props.messageUrl ? undefined : props.guildId ?? ""}
      data-mc-url={props.messageUrl}
    >
      #{props.name}
      {props.messageUrl ? <span class="mc-pill-chevron"> › </span> : null}
    </span>
  );
}

// click-to-reveal spoiler, like Discord's ||text||
function Spoiler(props) {
  const [revealed, setRevealed] = createSignal(false);
  return (
    <span
      class="mc-spoiler"
      classList={{ "mc-spoiler-revealed": revealed() }}
      on:click={(e) => {
        if (!revealed()) {
          e.stopPropagation();
          setRevealed(true);
        }
      }}
    >
      {props.children}
    </span>
  );
}

function renderToken(tok, guildId, depth = 0) {
  // masked link [label](url) -> show only the label, clickable, url hidden
  let m = tok.match(/^\[([^\]]+)\]\(\s*<?(https?:\/\/[^)\s]+?)>?\s*\)$/);
  if (m) {
    const label = m[1];
    const url = m[2];
    return (
      <a class="mc-link" title={url} data-mc-url={url}>
        {renderContent(label, guildId, depth + 1)}
      </a>
    );
  }

  // spoiler ||text|| (inner content can itself contain markup)
  m = tok.match(/^\|\|([\s\S]+)\|\|$/);
  if (m) return <Spoiler>{renderContent(m[1], guildId, depth + 1)}</Spoiler>;

  // custom emoji <a:name:id> / <:name:id>
  m = tok.match(/^<(a)?:(\w+):(\d+)>$/);
  if (m) {
    const animated = !!m[1];
    const ext = animated ? "gif" : "webp";
    // Animated GIFs decoded in a window.open popup often freeze on the first
    // frame (Chromium reuses the main document's static-decoded cache entry).
    // A stable per-session cache-bust forces a fresh animated decode in the
    // popup document. Static (webp) emojis don't need it.
    const bust = animated ? `&_d=${EMOJI_GIF_TOKEN}` : "";
    return (
      <img
        class="mc-emoji"
        src={`https://cdn.discordapp.com/emojis/${m[3]}.${ext}?size=48${bust}`}
        alt={`:${m[2]}:`}
        title={`:${m[2]}:`}
      />
    );
  }
  // user mention
  m = tok.match(/^<@!?(\d+)>$/);
  if (m) {
    const u = UserStore.getUser?.(m[1]);
    return <span class="mc-mention">@{u?.username ?? "user"}</span>;
  }
  // role mention <@&id>
  m = tok.match(/^<@&(\d+)>$/);
  if (m) {
    const r = resolveRole(guildId, m[1]);
    return (
      <span
        class="mc-mention mc-role-mention"
        style={
          r?.color
            ? `color:${r.color};background:color-mix(in srgb, ${r.color} 15%, transparent)`
            : undefined
        }
      >
        @{r?.name ?? "role"}
      </span>
    );
  }
  // channel mention <#id> -> navigate main window in place
  m = tok.match(/^<#(\d+)>$/);
  if (m) {
    const cid = m[1];
    const ref = resolveChannelRef(cid);
    return (
      <ChannelPill name={ref?.name ?? "unknown"} channelId={cid} guildId={ref?.guildId} />
    );
  }
  if (tok === "@everyone" || tok === "@here")
    return <span class="mc-mention">{tok}</span>;
  // discord.com/channels/<guild>/<channel>[/<message>] -- ANCHORED so it only
  // matches when the whole token IS the url, not when a bold/masked token
  // merely contains one (that bug routed "**[x](url)**" here instead of bold).
  m = tok.match(
    /^https?:\/\/(?:\w+\.)?discord(?:app)?\.com\/channels\/(@me|\d+)\/(\d+)(?:\/(\d+))?\/?$/
  );
  if (m) {
    const gid = m[1] === "@me" ? null : m[1];
    const cid = m[2];
    const msgId = m[3]; // present only for message links (3 segments)
    const ref = resolveChannelRef(cid);
    // Discord renders both channel and message links as a "#channel" pill;
    // message links also get a › chevron. We carry the full url on message
    // links so the click still jumps to the specific message (feed or Discord).
    return (
      <ChannelPill
        name={ref?.name ?? "channel"}
        channelId={cid}
        guildId={gid}
        messageUrl={msgId ? tok : undefined}
      />
    );
  }
  // generic url -> real browser
  if (/^https?:\/\//.test(tok))
    return (
      <a class="mc-link" data-mc-url={tok}>
        {tok}
      </a>
    );
  // inline code (not re-parsed -- code is literal)
  if (tok.startsWith("`")) return <code class="mc-code">{tok.slice(1, -1)}</code>;
  // bold -- recurse so nested markup (masked links, emoji, mentions) renders
  if (tok.startsWith("**"))
    return <strong>{renderContent(tok.slice(2, -2), guildId, depth + 1)}</strong>;
  // italic -- recurse too
  if (tok.startsWith("*"))
    return <em>{renderContent(tok.slice(1, -1), guildId, depth + 1)}</em>;
  return tok;
}

// processed embeds use camelCase (proxyURL/url); API embeds use proxy_url/url.
function pickUrl(o) {
  if (!o) return undefined;
  return o.proxyURL ?? o.proxy_url ?? o.url;
}

// pull renderable media out of a message's attachments + embeds
function collectMedia(m) {
  const media = [];
  for (const a of m.attachments ?? []) {
    const url = a.proxy_url ?? a.proxyURL ?? a.url;
    const name = url ?? a.filename ?? "";
    const ct = a.content_type ?? a.contentType ?? "";
    if (ct.startsWith("image/") || /\.(png|jpe?g|gif|webp)(\?|$)/i.test(name)) {
      media.push({ type: "image", url, w: a.width, h: a.height });
    } else if (ct.startsWith("video/") || /\.(mp4|webm|mov|mkv)(\?|$)/i.test(name)) {
      // a posted video file -> playable player with controls (not autoplay)
      media.push({ type: "file-video", url, w: a.width, h: a.height });
    } else {
      // any other file -> a download card (filename + size), like Discord
      media.push({
        type: "file",
        url: a.url ?? url, // real download url
        filename: a.filename ?? "file",
        size: a.size ?? 0,
      });
    }
  }
  // stickers are their own message field (not attachments/embeds).
  // format_type: 1=PNG, 2=APNG, 3=Lottie (JSON), 4=GIF.
  // cdn.discordapp.com/stickers/* is dead (404s -- Discord broke it, see
  // discord/discord-api-docs#6457); discord.com/stickers/* is the current
  // working host. GIF-format stickers specifically only ever worked via
  // media.discordapp.net (never had a cdn.discordapp.com path at all, see
  // discord-api-docs#6675). APNG (2) plays natively in an <img>; Lottie (3)
  // is vector JSON with no raster form, so it falls back to a static .png
  // still (no Lottie player dependency).
  for (const s of m.stickerItems ?? m.sticker_items ?? m.stickers ?? []) {
    const fmt = s.format_type ?? s.formatType ?? 1;
    const url =
      fmt === 4
        ? `https://media.discordapp.net/stickers/${s.id}.gif`
        : `https://discord.com/stickers/${s.id}.png`;
    media.push({
      type: "sticker",
      url,
      name: s.name ?? "sticker",
    });
  }
  for (const e of m.embeds ?? []) {
    const vUrl = e.video?.proxyURL ?? e.video?.proxy_url ?? e.video?.url;
    const poster = e.thumbnail?.proxyURL ?? e.thumbnail?.proxy_url ?? e.thumbnail?.url;
    const directVideo = /\.(mp4|webm|mov)(\?|$)/i.test(vUrl ?? "");
    // gifv (Tenor/Giphy) -> autoplaying muted loop
    if (e.type === "gifv" && vUrl) {
      media.push({ type: "video", url: vUrl, poster });
      continue;
    }
    // a video embed pointing at a DIRECT media file -> player with controls.
    // (non-direct video embeds like YouTube fall through to the embed card)
    if (e.type === "video" && directVideo) {
      media.push({ type: "file-video", url: vUrl, poster });
      continue;
    }
    // a pure image embed (e.g. a posted image/gif link) -> render as image
    if (e.type === "image" && (e.image || e.thumbnail)) {
      const im = e.image ?? e.thumbnail;
      media.push({ type: "image", url: im.proxyURL ?? im.proxy_url ?? im.url });
      continue;
    }
    // rich / link-preview embed -> full card.
    // NOTE: Discord's *processed* embeds use rawTitle/rawDescription/rawName/
    // rawValue (not title/description) -- fall back to the API names too.
    const colorHex =
      typeof e.color === "number"
        ? `#${(e.color >>> 0).toString(16).padStart(6, "0").slice(-6)}`
        : e.color;
    media.push({
      type: "embed",
      color: colorHex,
      provider: e.provider?.name,
      author: e.author?.name,
      authorIcon: e.author?.proxy_icon_url ?? e.author?.icon_url ?? e.author?.iconProxyURL,
      title: e.rawTitle ?? e.title,
      url: e.url,
      description: e.rawDescription ?? e.description,
      fields: (e.fields ?? []).map((f) => ({
        name: f.rawName ?? f.name,
        value: f.rawValue ?? f.value,
        inline: f.inline,
      })),
      image: pickUrl(e.image),
      thumbnail: pickUrl(e.thumbnail),
      // a rich embed (FxTwitter, etc.) can carry a playable video file
      video:
        e.video && /\.(mp4|webm|mov)/i.test(e.video.url ?? e.video.proxyURL ?? "")
          ? pickUrl(e.video)
          : undefined,
      videoPoster: pickUrl(e.thumbnail) ?? pickUrl(e.image),
      footer: e.footer?.text,
      footerIcon: e.footer?.proxy_icon_url ?? e.footer?.icon_url ?? e.footer?.iconProxyURL,
      footerTime: e.timestamp ? +new Date(e.timestamp) : undefined,
    });
  }
  return media;
}

// should `cur` render as a continuation (grouped under `prev`)?
// same author, not a reply, within 7 minutes of the previous message.
export function isContinuation(prev, cur) {
  if (!prev || !cur) return false;
  if (cur.reply) return false;
  if (prev.author?.id !== cur.author?.id) return false;
  return cur.timestamp - prev.timestamp < GROUP_WINDOW_MS;
}

// is a message content only custom/unicode emoji (-> jumbo sizing)?
const ONLY_EMOJI_RE =
  /^(?:\s|<a?:\w+:\d+>|\p{Extended_Pictographic}|‍|[\u{1f3fb}-\u{1f3ff}️])+$/u;
function isEmojiOnly(content) {
  if (!content) return false;
  return ONLY_EMOJI_RE.test(content.trim());
}

// does this message mention the current user (directly, via a role, or @everyone)?
function mentionsMe(m) {
  const me = UserStore?.getCurrentUser?.();
  if (!me) return false;
  // direct user mention -- m.mentions is an array of user objects or ids
  for (const u of m.mentions ?? []) {
    if ((typeof u === "string" ? u : u?.id) === me.id) return true;
  }
  // @everyone / @here
  if (m.mention_everyone || m.mentionEveryone) return true;
  // role mention -- check if I have any mentioned role in this channel's guild
  const roleIds = m.mention_roles ?? m.mentionRoles ?? [];
  if (roleIds.length) {
    const guildId = ChannelStore.getChannel?.(m.channel_id)?.guild_id;
    const member = guildId && GuildMemberStore?.getMember?.(guildId, me.id);
    const myRoles = member?.roles ?? [];
    if (roleIds.some((r) => myRoles.includes(r))) return true;
  }
  return false;
}

// extract reply reference (the message this one is replying to), if any.
// The processed Flux store uses `messageReference` (camelCase) and does NOT
// inline the referenced message -- we resolve it from MessageStore by id.
function extractReply(m) {
  const ref = m.messageReference ?? m.message_reference;
  if (!ref && m.type !== 19) return null;

  const refMsgId = ref?.message_id ?? ref?.messageId;
  const refChId = ref?.channel_id ?? ref?.channelId ?? m.channel_id ?? m.channelId;
  const refGuildId = ref?.guild_id ?? ref?.guildId;

  // some messages still inline the referenced message; prefer it if present.
  let r = m.referencedMessage ?? m.referenced_message;
  // otherwise resolve from the store using the reference's message id.
  if (!r && refChId && refMsgId) r = MessageStore.getMessage(refChId, refMsgId);

  if (r && r.author) {
    return {
      author: r.author,
      content: r.content ?? "",
      hasMedia:
        (r.attachments?.length ?? 0) +
          (r.embeds?.length ?? 0) +
          (r.stickerItems?.length ?? r.sticker_items?.length ?? 0) >
        0,
      // target ids let the reply line jump-in-feed / open-in-Discord
      messageId: refMsgId,
      channelId: refChId,
      guildId: refGuildId,
    };
  }
  // a reply whose target is deleted or not cached
  if (ref || m.type === 19) return { deleted: true };
  return null;
}

// normalize reactions into { key, name, id, animated, count } pills.
// `key` uniquely identifies an emoji (id for custom, name for unicode).
function extractReactions(m) {
  return (m.reactions ?? [])
    .map((r) => {
      const e = r.emoji ?? r;
      return {
        key: e.id || e.name,
        name: e.name,
        id: e.id ?? null,
        animated: !!e.animated,
        count: r.count ?? 1,
        me: !!r.me,
      };
    })
    .filter((r) => r.count > 0);
}

// normalize a message (from store or REST) into our render shape.
// keeps _raw so a later MESSAGE_UPDATE can re-derive media from merged raw.
export function normalize(m) {
  let content = m.content ?? "";
  // Discord hides a bare URL in the content when it has a matching embed (e.g.
  // a posted image/gif/link). Strip embed urls if they're the whole content.
  const embedUrls = (m.embeds ?? []).map((e) => e.url).filter(Boolean);
  if (embedUrls.length) {
    const trimmed = content.trim();
    if (embedUrls.includes(trimmed)) content = ""; // content was just the url
  }
  return {
    id: m.id,
    author: m.author,
    webhook: !!(m.webhookId ?? m.webhook_id),
    content,
    timestamp: m.timestamp ? +new Date(m.timestamp) : Date.now(),
    media: collectMedia(m),
    reply: extractReply(m),
    reactions: extractReactions(m),
    jumbo: isEmojiOnly(content),
    mentioned: mentionsMe(m),
    _raw: m,
  };
}
