import { createSignal, createEffect, For, Show, onCleanup, onMount } from "solid-js";

const {
  flux: { storesFlat },
  plugin: { store, scoped },
  ui: { ReactiveRoot, injectCss },
  solidWeb: { render },
  util: { log, getFiber },
  observeDom,
  http,
} = shelter;

// Injected at runtime via shelter.ui.injectCss so class names stay literal
// (a bare .css import gets treated as a CSS Module and our selectors miss).
const CSS = `
@import url("https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@600;700&display=swap");
.mc-btn {
  background: var(--button-secondary-background, #4e5058);
  color: var(--text-normal, #dbdee1); border: none; border-radius: 4px;
  padding: 3px 8px; cursor: pointer; font-size: 13px;
}
.mc-btn:hover { filter: brightness(1.15); }
.mc-panes {
  flex: 1 1 auto; min-height: 0;
  display: flex; flex-wrap: nowrap; gap: 6px; padding: 6px;
  overflow-x: auto; overflow-y: hidden;
}
/* popout document layout: a header bar + panes filling the rest */
.mc-popout-root {
  position: fixed; inset: 0; display: flex; flex-direction: column;
  font-family: "gg sans", "Noto Sans", "Helvetica Neue", Helvetica, Arial, sans-serif;
  color: var(--text-normal, #dbdee1);
  background: var(--background-secondary, #2b2d31);
  /* subpixel smoothing + a hair of text-stroke thickens glyphs to match how
     Discord renders at its zoomed-out DPR (popout opens at native DPR, which
     makes identical-weight text rasterize thinner). */
  -webkit-font-smoothing: subpixel-antialiased;
}
.mc-popout-root,
.mc-popout-root * {
  -webkit-font-smoothing: inherit;
  -webkit-text-stroke: 0.1px currentColor;
}
.mc-popout-bar {
  display: flex; align-items: center; justify-content: center;
  padding: 8px 12px; flex: 0 0 auto;
  background: var(--background-tertiary, #1e1f22);
}
.mc-popout-title {
  font-family: "JetBrains Mono", ui-monospace, Consolas, monospace;
  font-weight: 700; font-size: 16px; letter-spacing: 0.02em;
  text-transform: lowercase;
  color: var(--header-primary, #f2f3f5);
}
.mc-panes-popout {
  flex: 1 1 auto; min-height: 0;
  color: var(--text-normal, #dbdee1);
}
.mc-pane {
  flex: 1 0 320px; min-width: 260px; height: 100%;
  display: flex; flex-direction: column; min-height: 0;
  background: var(--background-primary, #313338); border-radius: 6px; overflow: hidden;
}
.mc-pane-head {
  display: flex; align-items: center; gap: 6px; padding: 5px 8px;
  background: var(--background-secondary-alt, #232428); flex: 0 0 auto;
  cursor: grab; user-select: none;
}
.mc-pane-head:active { cursor: grabbing; }
.mc-pane-dragging { opacity: 0.55; outline: 2px solid #5865f2; outline-offset: -2px; }
.mc-pane-name { flex: 1 1 auto; font-weight: 600; }
/* wraps the scroll body so the jump-to-present button can float over it */
.mc-pane-bodywrap {
  flex: 1 1 auto; min-height: 0; position: relative;
  display: flex; flex-direction: column;
}
.mc-pane-body {
  flex: 1 1 auto; overflow-y: auto; padding: 8px 12px;
  display: flex; flex-direction: column;
  /* no gap: spacing lives in each message's padding so hover is contiguous */
}
.mc-jump {
  position: absolute; left: 50%; transform: translateX(-50%); bottom: 10px;
  display: flex; align-items: center; gap: 6px;
  padding: 8px 16px; border-radius: 16px; cursor: pointer; white-space: nowrap;
  background: var(--background-secondary-alt, #232428);
  color: var(--text-link, #00a8fc); font-size: 13px; font-weight: 500;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
}
.mc-jump svg { width: 14px; height: 14px; }
.mc-jump:hover { filter: brightness(1.15); }

/* thin Discord-style scrollbar; subtle when idle, brighter on pane hover */
.mc-pane-body::-webkit-scrollbar { width: 8px; height: 8px; }
.mc-pane-body::-webkit-scrollbar-track { background: transparent; }
.mc-pane-body::-webkit-scrollbar-thumb {
  background: transparent; border-radius: 4px; min-height: 40px;
  border: 2px solid transparent; background-clip: padding-box;
  transition: background 0.15s;
}
/* thumb shows while actively scrolling, and stays visible while scrolled up
   (not at bottom) as an indicator; hides once back at the bottom */
.mc-pane-body.mc-scrolling::-webkit-scrollbar-thumb,
.mc-pane-body.mc-scrolled-up::-webkit-scrollbar-thumb {
  background: var(--scrollbar-auto-thumb, #1a1b1e); background-clip: padding-box;
}
.mc-pane-body::-webkit-scrollbar-corner { background: transparent; }
.mc-panes::-webkit-scrollbar { height: 8px; }
.mc-panes::-webkit-scrollbar-thumb {
  background: var(--scrollbar-auto-thumb, #1a1b1e); border-radius: 4px;
}
/* message wrapper: column so an optional reply line sits above the row.
   vertical padding = spacing; full-width hover via negative margin, no gaps. */
.mc-msg {
  display: flex; flex-direction: column;
  padding: 2px 12px; margin: 0 -12px;
}
.mc-msg:not(.mc-msg-grouped) { margin-top: 17px; }
/* right-click selection highlight (replaces hover highlight) */
.mc-msg.mc-msg-active { background: var(--background-message-hover, rgba(4, 4, 5, 0.07)); }
/* highlight messages that mention the current user (Discord's gold tint + bar) */
.mc-msg.mc-msg-mentioned {
  background: var(--background-mentioned, rgba(250, 166, 26, 0.08));
  box-shadow: inset 2px 0 0 0 var(--info-warning-foreground, #f0b232);
}
/* flash a feed message when a reply link jumps to it (Discord-style) */
.mc-msg-flash { animation: mc-flash 1.6s ease; }
@keyframes mc-flash {
  0%, 30% { background: color-mix(in srgb, var(--text-link, #5865f2) 22%, transparent); }
  100% { background: transparent; }
}
.mc-msg-row { display: flex; gap: 16px; align-items: flex-start; }
.mc-avatar { width: 40px; height: 40px; border-radius: 50%; flex: 0 0 auto; margin-top: 2px; }
/* grouped continuation: avatar column becomes a timestamp gutter (shown on
   right-click-active row) */
.mc-msg-gutter {
  width: 40px; flex: 0 0 auto; text-align: center;
  font-size: 11px; color: var(--text-muted, #949ba4);
  line-height: 1.375; opacity: 0; user-select: none;
  align-self: flex-start; margin-top: 4px; padding-left: 1px;
}
/* show the grouped-message timestamp in the gutter on hover (like Discord) */
.mc-msg:hover .mc-msg-gutter,
.mc-msg.mc-msg-active .mc-msg-gutter { opacity: 1; }
.mc-msg-content { min-width: 0; flex: 1 1 auto; }
.mc-msg-head { display: flex; align-items: baseline; gap: 0; }
.mc-msg-author {
  font-weight: 500; font-size: 16px; line-height: 1.375;
  color: var(--header-primary, #f2f3f5);
  user-select: text; cursor: text;
}
/* Discord spaces the timestamp from the name with a small left margin */
.mc-msg-time {
  font-size: 12px; line-height: 1.375; margin-left: 6px;
  color: var(--text-muted, #949ba4); font-weight: 500;
}
.mc-msg-text {
  white-space: pre-wrap; word-break: break-word;
  /* match Discord exactly: 16px / 1.375 line-height (=22px) */
  font-size: 16px; line-height: 1.375; color: var(--text-normal, #dbdee1);
  /* allow normal text selection (the app root often sets user-select:none) */
  user-select: text; -webkit-user-select: text; cursor: text;
}
/* let embeds + reply text be selectable too */
.mc-embed-desc, .mc-embed-title, .mc-embed-field-value, .mc-reply-text {
  user-select: text; -webkit-user-select: text;
}
.mc-msg-text.mc-jumbo { line-height: 1; }
.mc-msg-text.mc-jumbo .mc-emoji { width: 48px; height: 48px; }
.mc-empty { color: var(--text-muted, #949ba4); padding: 8px; font-style: italic; }

/* line-level markdown */
.mc-h1 { font-size: 24px; font-weight: 700; line-height: 1.3; margin: 4px 0 2px; }
.mc-h2 { font-size: 20px; font-weight: 700; line-height: 1.3; margin: 4px 0 2px; }
.mc-h3 { font-size: 16px; font-weight: 700; line-height: 1.3; margin: 4px 0 2px; }
.mc-subtext { font-size: 13px; color: var(--text-muted, #949ba4); line-height: 1.3; }
/* inside subtext (webhook reply-context lines), tone down pills/links to match
   Discord's muted reply-reference look instead of loud inline pills */
.mc-subtext .mc-mention,
.mc-subtext .mc-channel-mention {
  background: none; color: var(--text-muted, #b5bac1); padding: 0; font-weight: 500;
}
.mc-subtext .mc-mention:hover,
.mc-subtext .mc-channel-mention:hover {
  background: none; color: var(--text-normal, #dbdee1); text-decoration: underline;
}
/* masked links in reply context render blue + bold like Discord */
.mc-subtext .mc-link {
  color: var(--text-link, #00a8fc); font-weight: 600; text-decoration: none;
}
.mc-subtext .mc-link:hover { text-decoration: underline; }
.mc-subtext strong { font-weight: 600; }
.mc-quote {
  border-left: 4px solid var(--background-modifier-accent, #4e5058);
  padding-left: 8px; margin: 2px 0; color: var(--text-normal, #dbdee1);
}

/* reply preview (the small line above a reply) */
.mc-reply {
  display: flex; align-items: center; gap: 4px;
  font-size: 13px; color: var(--text-muted, #b5bac1);
  margin-left: 20px; margin-bottom: 2px; position: relative;
}
.mc-reply-spine {
  width: 28px; height: 10px; flex: 0 0 auto;
  border-left: 2px solid var(--background-modifier-accent, #4e5058);
  border-top: 2px solid var(--background-modifier-accent, #4e5058);
  border-top-left-radius: 6px; margin-top: 8px; align-self: flex-start;
}
.mc-reply-avatar { width: 16px; height: 16px; border-radius: 50%; flex: 0 0 auto; }
.mc-reply-author { font-weight: 600; color: var(--header-primary, #f2f3f5); }
.mc-reply-text {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  opacity: 0.85; min-width: 0;
}
.mc-reply-deleted { font-style: italic; }

/* reaction pills under a message (Discord-style) */
.mc-reactions { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.mc-reaction {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 2px 8px; height: 25px; box-sizing: border-box; border-radius: 8px;
  background: var(--background-secondary, rgba(255, 255, 255, 0.04));
  border: 1px solid var(--border-faint, rgba(255, 255, 255, 0.06));
}
.mc-reaction-emoji {
  width: 18px; height: 18px; object-fit: contain; display: block;
  margin: 0 1px;
}
.mc-reaction-count {
  font-size: 15px; font-weight: 600; line-height: 1;
  color: var(--text-muted, #949ba4); min-width: 9px; text-align: center;
}

/* image lightbox modal */
.mc-lightbox {
  position: fixed; inset: 0; z-index: 2147483647;
  background: rgba(0, 0, 0, 0.85);
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 12px; cursor: zoom-out;
}
.mc-lightbox-img {
  max-width: 90vw; max-height: 85vh; border-radius: 6px;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.6); cursor: default;
}
.mc-lightbox-open {
  color: #fff; opacity: 0.85; cursor: pointer; font-size: 14px;
  text-decoration: none;
}
.mc-lightbox-open:hover { opacity: 1; text-decoration: underline; }

/* toast (e.g. "Opened in Discord") */
.mc-toast {
  position: fixed; left: 50%; bottom: 24px; transform: translate(-50%, 20px);
  z-index: 2147483647; pointer-events: none;
  background: var(--background-floating, #111214); color: var(--text-normal, #f2f3f5);
  padding: 10px 16px; border-radius: 8px; font-size: 14px; font-weight: 500;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  opacity: 0; transition: opacity 0.18s ease, transform 0.18s ease;
}
.mc-toast.mc-toast-show { opacity: 1; transform: translate(-50%, 0); }

/* right-click context menu */
.mc-ctx {
  position: fixed; z-index: 2147483647; min-width: 188px;
  background: var(--background-floating, #111214);
  border-radius: 4px; padding: 6px 8px;
  box-shadow: 0 8px 16px rgba(0, 0, 0, 0.24);
  font-size: 14px; user-select: none;
}
.mc-ctx-item {
  padding: 6px 8px; border-radius: 4px; cursor: pointer;
  color: var(--interactive-normal, #b5bac1); line-height: 1.2;
}
.mc-ctx-item:hover {
  background: var(--menu-item-default-hover-bg, #5865f2);
  color: #fff;
}
.mc-ctx-sep {
  height: 1px; margin: 4px 0;
  background: var(--background-modifier-accent, rgba(255, 255, 255, 0.08));
}

.mc-emoji { width: 22px; height: 22px; vertical-align: bottom; object-fit: contain; }
.mc-mention {
  background: color-mix(in srgb, #5865f2 25%, transparent);
  color: #c9cdfb; border-radius: 3px; padding: 0 2px; font-weight: 500;
}
.mc-channel-mention { cursor: pointer; }
.mc-channel-mention:hover { background: color-mix(in srgb, #5865f2 45%, transparent); }
.mc-pill-chevron { opacity: 0.7; font-weight: 600; }
.mc-role-mention { /* color/background set inline from role color */ }
.mc-spoiler {
  background: var(--spoiler-hidden-background, #1e1f22);
  border-radius: 4px; padding: 0 2px; cursor: pointer;
  transition: background 0.1s;
  /* hidden state: text nodes vanish via transparent color; */
  color: transparent;
}
/* element children (emoji imgs, mention pills) hidden via opacity so we don't
   touch their color and lose inline role colors on reveal */
.mc-spoiler > * { opacity: 0; }
.mc-spoiler:hover { background: var(--spoiler-hidden-background, #28292d); }
.mc-spoiler-revealed {
  background: var(--spoiler-revealed-background, rgba(120, 120, 130, 0.16));
  cursor: text;
  color: inherit; /* restores text-node color; inline-colored children keep theirs */
}
.mc-spoiler-revealed > * { opacity: 1; }
.mc-link { color: #00a8fc; cursor: pointer; text-decoration: none; word-break: break-all; }
.mc-link:hover { text-decoration: underline; }
.mc-code {
  background: var(--background-tertiary, #1e1f22); border-radius: 3px;
  padding: 0 3px; font-family: monospace; font-size: 0.9em;
}
.mc-codeblock {
  background: var(--background-secondary, #2b2d31);
  border: 1px solid var(--background-tertiary, #1e1f22);
  border-radius: 4px; padding: 8px 10px; margin: 4px 0;
  max-width: 100%; overflow-x: auto;
  font-family: Consolas, "Andale Mono", monospace; font-size: 13px;
  line-height: 1.3; color: var(--text-normal, #dbdee1);
  white-space: pre; word-break: normal; tab-size: 2;
  cursor: default; /* the scrollbar area (the block itself) uses default cursor */
}
/* text cursor only over the actual code text, not the scrollbar */
.mc-codeblock code {
  font-family: inherit; white-space: pre; cursor: text;
}
/* thin Discord-style scrollbar inside code blocks */
.mc-codeblock::-webkit-scrollbar { width: 8px; height: 8px; }
.mc-codeblock::-webkit-scrollbar-track { background: transparent; }
.mc-codeblock::-webkit-scrollbar-thumb {
  background: var(--scrollbar-auto-thumb, #1a1b1e);
  border-radius: 4px; border: 2px solid transparent; background-clip: padding-box;
}
.mc-codeblock::-webkit-scrollbar-corner { background: transparent; }
.mc-media-img {
  max-width: 100%; max-height: 300px; border-radius: 6px;
  margin-top: 4px; cursor: pointer; display: block;
}
.mc-media-video {
  max-width: 400px; max-height: 340px; width: auto; border-radius: 8px;
  margin-top: 4px; display: block; background: #000;
  outline: none;
}
/* non-media attachment download card */
.mc-file {
  display: flex; align-items: center; gap: 10px;
  margin-top: 4px; padding: 10px 12px; max-width: 400px;
  background: var(--background-secondary, #2b2d31);
  border: 1px solid var(--background-tertiary, #1e1f22);
  border-radius: 8px; text-decoration: none; cursor: pointer;
}
.mc-file:hover { border-color: var(--background-modifier-accent, #4e5058); }
.mc-file-icon { width: 30px; height: 40px; flex: 0 0 auto; color: #b5bac1; }
.mc-file-meta { min-width: 0; }
.mc-file-name {
  color: var(--text-link, #00a8fc); font-size: 15px; font-weight: 500;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.mc-file-size { color: var(--text-muted, #949ba4); font-size: 12px; }
/* video element used inside an embed card (FxTwitter etc.) */
.mc-embed-image[src] { border-radius: 8px; }
/* nudge the native player controls a touch closer to Discord's rounded look */
.mc-media-video::-webkit-media-controls-panel,
.mc-embed-image::-webkit-media-controls-panel {
  border-bottom-left-radius: 8px; border-bottom-right-radius: 8px;
}
.mc-embed {
  margin-top: 4px; padding: 8px 16px 12px 12px; border-radius: 4px;
  border-left: 4px solid var(--background-tertiary, #1e1f22);
  background: var(--background-secondary, #2b2d31);
  max-width: 432px; width: fit-content;
  display: flex; flex-direction: column; gap: 8px;
}
.mc-embed-main { display: flex; gap: 12px; }
.mc-embed-text { min-width: 0; flex: 1 1 auto; display: flex; flex-direction: column; gap: 2px; }
.mc-embed-author {
  display: flex; align-items: center; gap: 8px;
  font-size: 13px; font-weight: 600; color: var(--text-normal, #f2f3f5);
  margin-top: 8px;
}
.mc-embed-author-icon { width: 24px; height: 24px; border-radius: 50%; }
.mc-embed-title { font-weight: 600; margin-top: 2px; color: var(--text-link, #00a8fc); }
.mc-embed-title .mc-link { color: var(--text-link, #00a8fc); }
.mc-embed-desc {
  font-size: 14px; color: var(--text-normal, #dbdee1);
  white-space: pre-wrap; word-break: break-word; line-height: 1.375; margin-top: 4px;
}
.mc-embed-fields { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.mc-embed-field { flex: 1 1 100%; min-width: 0; }
.mc-embed-field-inline { flex: 1 1 30%; }
.mc-embed-field-name { font-size: 13px; font-weight: 600; margin-bottom: 2px; }
.mc-embed-field-value { font-size: 14px; color: var(--text-normal, #dbdee1); white-space: pre-wrap; }
.mc-embed-thumb { width: 80px; height: 80px; object-fit: cover; border-radius: 4px; flex: 0 0 auto; cursor: pointer; }
.mc-embed-image { max-width: 100%; max-height: 300px; border-radius: 4px; cursor: pointer; display: block; margin-top: 8px; }
.mc-embed-footer {
  display: flex; align-items: center; gap: 8px;
  font-size: 12px; color: var(--text-muted, #949ba4); margin-top: 4px;
}
.mc-embed-footer-icon { width: 20px; height: 20px; border-radius: 50%; }
.mc-embed-footer-sep { opacity: 0.6; }

/* toolbar button injected next to Discord's inbox/help icons */
.mc-toolbar-btn {
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; color: var(--interactive-normal, #b5bac1);
}
.mc-toolbar-btn:hover { color: var(--interactive-hover, #dbdee1); }
`;

const {
  MessageStore,
  ChannelStore,
  SelectedChannelStore,
  UserStore,
  GuildStore,
  GuildRoleStore,
  GuildMemberStore,
  LocaleStore,
} = storesFlat;

// use Discord's own locale so the feed's time format (12h/24h) matches Discord
function discordLocale() {
  return LocaleStore?.locale || undefined;
}

// ---------------------------------------------------------------------------
// tunable config (all timings in ms)
// ---------------------------------------------------------------------------
const MAX_MESSAGES = 100; // messages kept per pane (bounds memory/DOM)
const SEED_FETCH_LIMIT = 50; // messages fetched when a channel isn't cached
const GROUP_WINDOW_MS = 7 * 60 * 1000; // group consecutive msgs within this gap
const SCROLLBAR_HIDE_MS = 900; // hide scrollbar this long after scrolling stops
const FLASH_MS = 1600; // duration of the jump-to-message flash highlight
const TOAST_MS = 2200; // how long the "Opened in Discord" toast shows
const DEFAULT_VOLUME = 0.5; // initial video volume (persisted after first change)

// resolve a member's display name + role color within a guild.
// Important: the author object embedded in a message is a stale snapshot that
// often lacks globalName -- we read the LIVE user from UserStore for the real
// display name. Name priority (Discord default): nick -> globalName -> username.
// Color comes from the member's pre-computed colorString.
function resolveMember(guildId, author, isWebhook = false) {
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
// persisted state: the list of channel IDs we're monitoring.
// We persist a JSON STRING (a primitive) rather than an array, because
// shelter's plugin store is a Solid proxy and storing/spreading a nested
// array proxy triggers "Please use proxy object" errors. A string is safe.
// ---------------------------------------------------------------------------
store.channelsJson ??= "[]";

function loadChannels() {
  try {
    const v = JSON.parse(store.channelsJson);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function saveChannels(arr) {
  store.channelsJson = JSON.stringify(arr);
}

// persisted player volume (0..1), so videos don't blast at full volume each time
store.videoVolume ??= DEFAULT_VOLUME;
// set up a <video> ref to use + remember the saved volume
function setupVideoVolume(el) {
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
function channelName(id) {
  const ch = ChannelStore.getChannel(id);
  if (!ch) return id;
  return ch.name ? `#${ch.name}` : id;
}

function avatarUrl(author) {
  if (!author) return undefined;
  if (author.avatar)
    return `https://cdn.discordapp.com/avatars/${author.id}/${author.avatar}.png?size=32`;
  // default avatar (new-style index by user id)
  const idx = Number((BigInt(author.id) >> 22n) % 6n);
  return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
}

// time in Discord's locale (so 12h/24h matches Discord's setting)
function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString(discordLocale(), {
    hour: "numeric",
    minute: "2-digit",
  });
}

// human file size: 402.00 KB / 1.20 MB
function formatSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

// unicode emoji -> Twemoji image URL (how Discord renders unicode emoji).
// builds the dashed codepoint sequence Twemoji uses (drops VS16 ️).
function twemojiUrl(str) {
  const cps = [];
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    if (cp !== 0xfe0f) cps.push(cp.toString(16));
  }
  return `https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/svg/${cps.join("-")}.svg`;
}

// Discord embed footer style: "Today at 6:51 AM" / "Yesterday at ..." / date
function fmtFooterTime(ts) {
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
function openExternal(url) {
  window.open(url, "_blank", "noopener,noreferrer");
}

// ---------------------------------------------------------------------------
// image lightbox: click an image -> full-size modal overlay (like Discord),
// instead of redirecting to the browser.
// ---------------------------------------------------------------------------
const [lightbox, setLightbox] = createSignal(null); // url | null
function openImage(url) {
  setLightbox(url);
}

function Lightbox(props) {
  // attach to the owning window (main or popup) so Escape works in both
  const w = props.win ?? window;
  const onKey = (e) => {
    if (e.key === "Escape") setLightbox(null);
  };
  w.addEventListener("keydown", onKey);
  onCleanup(() => w.removeEventListener("keydown", onKey));

  return (
    <Show when={lightbox()}>
      <div class="mc-lightbox" on:click={() => setLightbox(null)}>
        <img
          class="mc-lightbox-img"
          src={lightbox()}
          on:click={(e) => e.stopPropagation()}
        />
        <a
          class="mc-lightbox-open"
          on:click={(e) => {
            e.stopPropagation();
            openExternal(lightbox());
          }}
        >
          Open original
        </a>
      </div>
    </Show>
  );
}

// ---------------------------------------------------------------------------
// right-click context menu: { x, y, msg, channelId, guildId, imageUrl? } | null
// ---------------------------------------------------------------------------
const [ctxMenu, setCtxMenu] = createSignal(null);
function closeCtxMenu() {
  setCtxMenu(null);
}

// copy text reliably. The async clipboard API throws "Document is not focused"
// from a popup, so we fall back to a hidden-textarea + execCommand("copy") in
// the document where the action happened.
function copyText(text, doc = document) {
  const value = text ?? "";
  // try the modern API first (works when the doc has focus)
  try {
    const nav = (doc.defaultView || window).navigator;
    if (nav?.clipboard?.writeText) {
      nav.clipboard.writeText(value).catch(() => execCopy(value, doc));
      return;
    }
  } catch {}
  execCopy(value, doc);
}

function execCopy(value, doc) {
  try {
    const ta = doc.createElement("textarea");
    ta.value = value;
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.opacity = "0";
    doc.body.appendChild(ta);
    ta.focus();
    ta.select();
    doc.execCommand("copy");
    doc.body.removeChild(ta);
  } catch {}
}

async function copyImage(url) {
  // best-effort: fetch the image and write a blob to the clipboard
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    await navigator.clipboard.write([
      new ClipboardItem({ [blob.type]: blob }),
    ]);
  } catch {
    // clipboard image write can fail (type/permission) -> copy the URL instead
    copyText(url);
  }
}

function ContextMenu(props) {
  // attach to the owning window (main or popup) so dismissal works in both
  const w = props.win ?? window;
  const onDocClick = () => closeCtxMenu();
  const onKey = (e) => e.key === "Escape" && closeCtxMenu();
  w.addEventListener("click", onDocClick);
  w.addEventListener("keydown", onKey);
  w.addEventListener("blur", onDocClick);
  onCleanup(() => {
    w.removeEventListener("click", onDocClick);
    w.removeEventListener("keydown", onKey);
    w.removeEventListener("blur", onDocClick);
  });

  const Item = (p) => (
    <div
      class="mc-ctx-item"
      on:click={(e) => {
        e.stopPropagation();
        p.onClick();
        closeCtxMenu();
      }}
    >
      {p.children}
    </div>
  );

  // position the menu's corner exactly at the cursor, flipping/shifting so it
  // never overflows. The popup body has a `zoom` applied (DPR match), and a
  // position:fixed element's left/top are interpreted in the ZOOMED space --
  // so we divide the cursor coords by the zoom factor to land at the cursor.
  function placeMenu(el) {
    if (!el) return;
    const win = props.win ?? window;
    const zoom = parseFloat(win.document.body.style.zoom) || 1;
    const vw = win.innerWidth / zoom;
    const vh = win.innerHeight / zoom;
    const x = ctxMenu().x / zoom;
    const y = ctxMenu().y / zoom;
    const rect = el.getBoundingClientRect();
    const w = rect.width / zoom;
    const h = rect.height / zoom;
    const pad = 8;
    // horizontal: corner at cursor (right side); flip left if it won't fit
    let left = x;
    if (x + w + pad > vw) left = Math.max(pad, x - w);
    // vertical: corner at cursor (below); shift up if it won't fit
    let top = y;
    if (y + h + pad > vh) top = Math.max(pad, vh - h - pad);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }

  let menuEl;
  // re-position on EVERY right-click (ctxMenu changes), not just first open --
  // the element persists across opens, so the ref callback alone won't re-run.
  createEffect(() => {
    if (ctxMenu() && menuEl) {
      menuEl.style.left = "-9999px"; // hide before measuring to avoid flash
      menuEl.style.top = "-9999px";
      queueMicrotask(() => placeMenu(menuEl));
    }
  });

  return (
    <Show when={ctxMenu()}>
      <div
        class="mc-ctx"
        style="left:-9999px; top:-9999px"
        ref={menuEl}
        on:click={(e) => e.stopPropagation()}
        on:contextmenu={(e) => e.preventDefault()}
      >
        <Item
          onClick={() => {
            showToast(w.document, "Opened in Discord ↗");
            navigateToChannel(
              ctxMenu().guildId,
              ctxMenu().channelId,
              ctxMenu().msg.id
            );
          }}
        >
          Go to Message
        </Item>
        <Show when={ctxMenu().msg.content}>
          <Item onClick={() => copyText(ctxMenu().msg.content, w.document)}>Copy Text</Item>
        </Show>
        <Show when={ctxMenu().imageUrl}>
          <div class="mc-ctx-sep" />
          <Item onClick={() => openImage(ctxMenu().imageUrl)}>View Image</Item>
          <Item onClick={() => copyImage(ctxMenu().imageUrl)}>Copy Image</Item>
          <Item onClick={() => openExternal(ctxMenu().imageUrl)}>Open in Browser</Item>
        </Show>
        <div class="mc-ctx-sep" />
        <Item onClick={() => copyText(ctxMenu().msg.id, w.document)}>Copy Message ID</Item>
      </div>
    </Show>
  );
}

// navigate the main Discord window to a channel, or a specific message when a
// messageId is given. The message jump goes through Discord's ROUTER (not Flux
// -- captured dispatches are empty; only "[Routing/Utils] transitionTo" logs),
// so we drive the router via the History API: push the full path and emit
// popstate. Discord's router picks it up and jumps to (and flashes) the message.
function navigateToChannel(guildId, channelId, messageId) {
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
function openLink(url) {
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
function renderContent(text, guildId, depth = 0) {
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
    const ext = m[1] ? "gif" : "webp";
    return (
      <img
        class="mc-emoji"
        src={`https://cdn.discordapp.com/emojis/${m[3]}.${ext}?size=48`}
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
function isContinuation(prev, cur) {
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

// extract reply reference (the message this one is replying to), if any
function extractReply(m) {
  if (m.message_reference && m.referenced_message) {
    const r = m.referenced_message;
    return {
      author: r.author,
      content: r.content ?? "",
      hasMedia: (r.attachments?.length ?? 0) + (r.embeds?.length ?? 0) > 0,
    };
  }
  // a reply with a deleted/uncached target
  if (m.message_reference && m.type === 19) return { deleted: true };
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
      };
    })
    .filter((r) => r.count > 0);
}

// normalize a message (from store or REST) into our render shape.
// keeps _raw so a later MESSAGE_UPDATE can re-derive media from merged raw.
function normalize(m) {
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

// ---------------------------------------------------------------------------
// media (images + rich embeds) for one message
// ---------------------------------------------------------------------------
function MediaList(props) {
  const guildId = props.guildId;
  const onMediaLoad = props.onMediaLoad ?? (() => {});
  return (
    <For each={props.media}>
      {(md) =>
        md.type === "file" ? (
          // non-media attachment -> download card (icon + name + size)
          <a
            class="mc-file"
            href={md.url}
            target="_blank"
            rel="noopener noreferrer"
            title={md.filename}
          >
            <svg class="mc-file-icon" viewBox="0 0 24 24" fill="none">
              <path
                d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z"
                fill="currentColor" opacity="0.9"
              />
              <path d="M14 3v5h5" fill="none" stroke="var(--background-primary,#313338)" stroke-width="1.5"/>
            </svg>
            <div class="mc-file-meta">
              <div class="mc-file-name">{md.filename}</div>
              <div class="mc-file-size">{formatSize(md.size)}</div>
            </div>
          </a>
        ) : md.type === "video" ? (
          // Tenor/Giphy gifv -> autoplaying muted loop, like Discord
          <video
            class="mc-media-img"
            src={md.url}
            poster={md.poster}
            autoplay
            loop
            muted
            playsinline
            onLoadedData={onMediaLoad}
          />
        ) : md.type === "file-video" ? (
          // a posted video file -> player with controls (click to play/seek)
          <video
            class="mc-media-video"
            src={md.url}
            controls
            preload="metadata"
            playsinline
            ref={setupVideoVolume}
            onLoadedData={onMediaLoad}
          />
        ) : md.type === "image" ? (
          <img
            class="mc-media-img"
            src={md.url}
            loading="lazy"
            onLoad={onMediaLoad}
            on:click={() => openImage(md.url)}
          />
        ) : (
          <div
            class="mc-embed"
            style={
              md.color
                ? `border-left-color: ${
                    typeof md.color === "number"
                      ? "#" + (md.color >>> 0).toString(16).padStart(6, "0").slice(-6)
                      : md.color
                  }`
                : undefined
            }
          >
            <div class="mc-embed-main">
              <div class="mc-embed-text">
                <Show when={md.provider || md.author}>
                  <div class="mc-embed-author">
                    <Show when={md.authorIcon}>
                      <img class="mc-embed-author-icon" src={md.authorIcon} />
                    </Show>
                    {md.author ?? md.provider}
                  </div>
                </Show>
                <Show when={md.title}>
                  <div class="mc-embed-title">
                    {md.url ? (
                      <a class="mc-link" data-mc-url={md.url}>
                        {md.title}
                      </a>
                    ) : (
                      md.title
                    )}
                  </div>
                </Show>
                <Show when={md.description}>
                  <div class="mc-embed-desc">
                    {renderContent(md.description, guildId)}
                  </div>
                </Show>
                <Show when={md.fields.length}>
                  <div class="mc-embed-fields">
                    <For each={md.fields}>
                      {(f) => (
                        <div
                          class="mc-embed-field"
                          classList={{ "mc-embed-field-inline": f.inline }}
                        >
                          <div class="mc-embed-field-name">{f.name}</div>
                          <div class="mc-embed-field-value">
                            {renderContent(f.value, guildId)}
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
              <Show when={md.thumbnail && !md.video}>
                <img
                  class="mc-embed-thumb"
                  src={md.thumbnail}
                  loading="lazy"
                  onLoad={onMediaLoad}
                  on:click={() => openImage(md.thumbnail)}
                />
              </Show>
            </div>
            <Show when={md.video}>
              <video
                class="mc-embed-image"
                src={md.video}
                poster={md.videoPoster}
                controls
                preload="metadata"
                playsinline
                ref={setupVideoVolume}
                onLoadedData={onMediaLoad}
              />
            </Show>
            <Show when={md.image && !md.video}>
              <img
                class="mc-embed-image"
                src={md.image}
                loading="lazy"
                onLoad={onMediaLoad}
                on:click={() => openImage(md.image)}
              />
            </Show>
            <Show when={md.footer || md.footerTime}>
              <div class="mc-embed-footer">
                <Show when={md.footerIcon}>
                  <img class="mc-embed-footer-icon" src={md.footerIcon} />
                </Show>
                <span>{md.footer}</span>
                <Show when={md.footer && md.footerTime}>
                  <span class="mc-embed-footer-sep">•</span>
                </Show>
                <Show when={md.footerTime}>
                  <span>{fmtFooterTime(md.footerTime)}</span>
                </Show>
              </div>
            </Show>
          </div>
        )
      }
    </For>
  );
}

// reply preview line shown above a message that replies to another
function ReplyPreview(props) {
  const r = props.reply;
  if (r.deleted)
    return (
      <div class="mc-reply">
        <span class="mc-reply-spine" />
        <span class="mc-reply-text mc-reply-deleted">
          Original message was deleted
        </span>
      </div>
    );
  const member = resolveMember(props.guildId, r.author);
  return (
    <div class="mc-reply">
      <span class="mc-reply-spine" />
      <img class="mc-reply-avatar" src={avatarUrl(r.author)} />
      <span
        class="mc-reply-author"
        style={member.color ? `color:${member.color}` : undefined}
      >
        {member.name}
      </span>
      <span class="mc-reply-text">
        {r.content
          ? renderContent(r.content, props.guildId)
          : r.hasMedia
            ? "Click to see attachment"
            : ""}
      </span>
    </div>
  );
}

// a single message row, with grouping (continuation) + reply support
function MessageRow(props) {
  const m = props.msg;
  const guildId = props.guildId;
  const member = () => resolveMember(guildId, m.author, m.webhook);

  function onContextMenu(e) {
    e.preventDefault();
    e.stopPropagation();
    // if the right-click landed on an image, surface image actions
    const imgEl = e.target.closest("img.mc-media-img, img.mc-embed-image, img.mc-embed-thumb");
    setCtxMenu({
      x: e.clientX,
      y: e.clientY,
      msg: m,
      channelId: props.channelId,
      guildId,
      imageUrl: imgEl?.src,
    });
  }

  return (
    <div
      class="mc-msg"
      data-mc-msgid={m.id}
      classList={{
        "mc-msg-grouped": props.grouped,
        "mc-msg-reply": !!m.reply,
        "mc-msg-active": ctxMenu()?.msg?.id === m.id,
        "mc-msg-mentioned": m.mentioned,
      }}
      on:contextmenu={onContextMenu}
    >
      <Show when={m.reply}>
        <ReplyPreview reply={m.reply} guildId={guildId} />
      </Show>
      <div class="mc-msg-row">
        <Show
          when={!props.grouped}
          fallback={<span class="mc-msg-gutter">{fmtTime(m.timestamp)}</span>}
        >
          <img class="mc-avatar" src={avatarUrl(m.author)} />
        </Show>
        <div class="mc-msg-content">
          <Show when={!props.grouped}>
            <div class="mc-msg-head">
              <span
                class="mc-msg-author"
                style={member().color ? `color:${member().color}` : undefined}
              >
                {member().name}
              </span>
              <span class="mc-msg-time">{fmtTime(m.timestamp)}</span>
            </div>
          </Show>
          <Show when={m.content}>
            <div
              class="mc-msg-text"
              classList={{ "mc-jumbo": m.jumbo }}
            >
              {renderContent(m.content, guildId)}
            </div>
          </Show>
          <MediaList media={m.media} guildId={guildId} onMediaLoad={props.onMediaLoad} />
          <Show when={m.reactions.length}>
            <div class="mc-reactions">
              <For each={m.reactions}>
                {(r) => (
                  <span class="mc-reaction">
                    <img
                      class="mc-reaction-emoji"
                      src={
                        r.id
                          ? `https://cdn.discordapp.com/emojis/${r.id}.${r.animated ? "gif" : "webp"}?size=32`
                          : twemojiUrl(r.name)
                      }
                      alt={r.name}
                    />
                    <span class="mc-reaction-count">{r.count}</span>
                  </span>
                )}
              </For>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// a single monitored pane
// ---------------------------------------------------------------------------
function Pane(props) {
  const id = props.id;
  const guildId = ChannelStore.getChannel?.(id)?.guild_id; // for role resolution
  const [msgs, setMsgs] = createSignal([]);
  // reactive flag: are we scrolled up away from the bottom? (drives jump button)
  const [scrolledUp, setScrolledUp] = createSignal(false);
  const name = channelName(id);
  let bodyRef;
  // when pinned, the pane always follows the newest message. Unpinned only
  // when the user scrolls up away from the bottom.
  let pinned = true;

  const atBottom = () =>
    !bodyRef ||
    bodyRef.scrollHeight - bodyRef.scrollTop - bodyRef.clientHeight < 60;

  function scrollToBottom() {
    if (!bodyRef) return;
    bodyRef.scrollTop = bodyRef.scrollHeight;
    pinned = true;
    setScrolledUp(false);
    // run again after layout/late images settle so we land truly at the end
    requestAnimationFrame(() => {
      if (pinned && bodyRef) bodyRef.scrollTop = bodyRef.scrollHeight;
    });
  }

  // Moving a scrollable node in the DOM (during reorder) resets its scrollTop.
  // Snapshot the position before a reorder and restore it after: pinned panes
  // go back to the bottom, unpinned panes keep their exact offset.
  let savedTop = 0;
  const scrollHandle = {
    save: () => {
      savedTop = bodyRef ? bodyRef.scrollTop : 0;
    },
    restore: () => {
      if (!bodyRef) return;
      if (pinned) scrollToBottom();
      else bodyRef.scrollTop = savedTop;
    },
  };
  paneScrollRestores.add(scrollHandle);
  onCleanup(() => paneScrollRestores.delete(scrollHandle));

  let scrollHideTimer = null;
  function onScroll() {
    // user-driven scroll position decides whether we keep following
    pinned = atBottom();
    setScrolledUp(!pinned);
    if (bodyRef) {
      // persistent thumb while scrolled up (not at bottom); hidden at bottom
      bodyRef.classList.toggle("mc-scrolled-up", !pinned);
      // also flash the thumb briefly during active scrolling, then fade
      bodyRef.classList.add("mc-scrolling");
      clearTimeout(scrollHideTimer);
      scrollHideTimer = setTimeout(
        () => bodyRef?.classList.remove("mc-scrolling"),
        SCROLLBAR_HIDE_MS
      );
    }
  }

  function pushMessages(list, { prepend = false } = {}) {
    setMsgs((cur) => {
      let next = cur.slice();
      const idxById = new Map(next.map((m, i) => [m.id, i]));
      // dedup by nonce too: Discord sends an optimistic local message then the
      // confirmed server message (different ids, same nonce) -> would dupe.
      const idxByNonce = new Map(
        next.filter((m) => m._raw?.nonce).map((m, i) => [m._raw.nonce, i])
      );
      for (const raw of list) {
        const norm = normalize(raw);
        if (idxById.has(norm.id)) continue; // already have this exact message
        const nonce = raw.nonce;
        if (nonce != null && idxByNonce.has(nonce)) {
          // replace the optimistic copy in place with the confirmed one
          next[idxByNonce.get(nonce)] = norm;
          continue;
        }
        if (prepend) next.unshift(norm);
        else next.push(norm);
      }
      // cap retained messages to bound memory/DOM
      if (next.length > MAX_MESSAGES) next = next.slice(next.length - MAX_MESSAGES);
      return next;
    });
    if (pinned && !prepend) queueMicrotask(scrollToBottom);
  }

  // MESSAGE_UPDATE: Discord adds link-preview embeds / edits a moment after
  // send. Merge the new fields into the existing message so embeds appear.
  function updateMessage(partial) {
    setMsgs((cur) => {
      const i = cur.findIndex((m) => m.id === partial.id);
      if (i === -1) return cur;
      const next = cur.slice();
      next[i] = normalize({ ...cur[i]._raw, ...partial });
      return next;
    });
    if (pinned) queueMicrotask(scrollToBottom);
  }

  // MESSAGE_REACTION_ADD/REMOVE: adjust the reaction pill counts live.
  function reactMessage(messageId, emoji, delta) {
    const key = emoji?.id || emoji?.name;
    if (!key) return;
    setMsgs((cur) => {
      const i = cur.findIndex((m) => m.id === messageId);
      if (i === -1) return cur;
      const msg = cur[i];
      const reactions = msg.reactions.slice();
      const ri = reactions.findIndex((r) => r.key === key);
      if (ri === -1) {
        if (delta > 0)
          reactions.push({
            key,
            name: emoji.name,
            id: emoji.id ?? null,
            animated: !!emoji.animated,
            count: 1,
          });
      } else {
        const count = reactions[ri].count + delta;
        if (count <= 0) reactions.splice(ri, 1);
        else reactions[ri] = { ...reactions[ri], count };
      }
      const next = cur.slice();
      next[i] = { ...msg, reactions };
      return next;
    });
  }

  // seed: prefer in-memory store, fall back to REST
  const seeded = MessageStore.getMessages(id);
  const arr = seeded?.toArray?.() ?? seeded?._array ?? [];
  if (arr.length) {
    pushMessages(arr);
  } else {
    // http functions are only safe after http.ready resolves
    http.ready
      .then(() =>
        http.get({ url: `/channels/${id}/messages?limit=${SEED_FETCH_LIMIT}` })
      )
      .then((res) => {
        const body = res.body ?? res;
        if (Array.isArray(body)) pushMessages([...body].reverse());
      })
      .catch(() => {});
  }

  // after the initial seed renders, force-scroll to the newest message
  queueMicrotask(scrollToBottom);
  setTimeout(scrollToBottom, 120); // catch late layout after first paint

  // live: receive new + updated messages + reactions for this channel
  const unregister = register(id, {
    create: (m) => pushMessages([m]),
    update: (m) => updateMessage(m),
    reactAdd: (d) => reactMessage(d.messageId ?? d.message_id, d.emoji, +1),
    reactRemove: (d) => reactMessage(d.messageId ?? d.message_id, d.emoji, -1),
  });
  onCleanup(unregister);

  return (
    <div class="mc-pane" data-mc-pane={id}>
      <div class="mc-pane-head" data-mc-drag={id}>
        <span class="mc-pane-name">{name}</span>
        <button class="mc-btn" on:click={() => props.onClose(id)}>
          ×
        </button>
      </div>
      <div class="mc-pane-bodywrap">
        <div class="mc-pane-body" ref={bodyRef} onScroll={onScroll}>
          <Show
            when={msgs().length}
            fallback={<div class="mc-empty">No messages yet…</div>}
          >
            <For each={msgs()}>
              {(m, i) => (
                <MessageRow
                  msg={m}
                  guildId={guildId}
                  channelId={id}
                  grouped={isContinuation(msgs()[i() - 1], m)}
                  onMediaLoad={() => pinned && scrollToBottom()}
                />
              )}
            </For>
          </Show>
        </div>
        <Show when={scrolledUp()}>
          <div class="mc-jump" on:click={scrollToBottom}>
            Jump to present
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M12 16l-6-6h12z" fill="currentColor" />
            </svg>
          </div>
        </Show>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// channel list state (module level so toolbar button + popout share it)
// ---------------------------------------------------------------------------
const [channels, setChannels] = createSignal(loadChannels());

function persistChannels(next) {
  saveChannels(next);
  setChannels(next);
}
function addChannel(id) {
  if (!id || channels().includes(id)) return false;
  persistChannels([...channels(), id]);
  return true;
}
function removeChannel(id) {
  persistChannels(channels().filter((c) => c !== id));
}
function hasChannel(id) {
  return channels().includes(id);
}
// panes register a scroll-restore fn here; called after a reorder, since
// moving a scrollable node in the DOM resets its scrollTop.
const paneScrollRestores = new Set();

// move the channel `id` to index `toIndex` (used by drag-to-reorder)
function moveChannel(id, toIndex) {
  const cur = channels();
  const from = cur.indexOf(id);
  if (from === -1 || from === toIndex) return;
  // snapshot every pane's scroll BEFORE the DOM moves reset it
  paneScrollRestores.forEach((h) => h.save());
  const next = cur.slice();
  next.splice(from, 1);
  next.splice(toIndex, 0, id);
  persistChannels(next);
  // after the reorder settles, restore each pane's scroll position
  requestAnimationFrame(() => paneScrollRestores.forEach((h) => h.restore()));
}

// try to find a message already in the feed (any pane in `doc`) and scroll to
// + flash it. Returns true if found/handled, false to fall back to Discord.
function jumpToFeedMessage(doc, messageId) {
  if (!messageId) return false;
  const el = doc.querySelector(`[data-mc-msgid="${messageId}"]`);
  if (!el) return false;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("mc-msg-flash");
  setTimeout(() => el.classList.remove("mc-msg-flash"), FLASH_MS);
  return true;
}

// brief toast in the popout (e.g. to confirm we navigated to Discord)
let toastTimer = null;
function showToast(doc, text) {
  if (!doc?.body) return;
  let el = doc.querySelector(".mc-toast");
  if (!el) {
    el = doc.createElement("div");
    el.className = "mc-toast";
    doc.body.appendChild(el);
  }
  el.textContent = text;
  el.classList.add("mc-toast-show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("mc-toast-show"), TOAST_MS);
}

// is a discord link internal (a channel/message we'd navigate to)?
function isInternalDiscordLink(url) {
  return /discord(?:app)?\.com\/channels\//.test(url);
}

// one delegated click handler for all links/pills (works in popup where
// Solid's per-element delegation does not reach across documents).
function handleDelegatedClick(e) {
  const link = e.target.closest("[data-mc-url]");
  if (link) {
    e.preventDefault();
    e.stopPropagation();
    const url = link.getAttribute("data-mc-url");
    const doc = e.target.ownerDocument;
    // if this is a discord message link, prefer jumping to it IN THE FEED
    const mm = url.match(/discord(?:app)?\.com\/channels\/\d+\/\d+\/(\d+)/);
    if (mm && jumpToFeedMessage(doc, mm[1])) return;
    // not in feed -> navigating to the main Discord window; tell the user
    if (isInternalDiscordLink(url)) showToast(doc, "Opened in Discord ↗");
    openLink(url);
    return;
  }
  const pill = e.target.closest("[data-mc-channel]");
  if (pill) {
    e.preventDefault();
    e.stopPropagation();
    const cid = pill.getAttribute("data-mc-channel");
    const gid = pill.getAttribute("data-mc-guild") || null;
    showToast(e.target.ownerDocument, "Opened in Discord ↗");
    navigateToChannel(gid, cid);
  }
}

// pointer-based drag-to-reorder for panes. Grabbing a pane header and moving
// over another pane reorders the channels list live (panes shift as you drag).
function setupPaneDrag(container, win) {
  let draggingId = null;
  let dragEl = null;

  function paneIdAt(x, y) {
    // which pane is under the cursor right now?
    const el = win.document.elementFromPoint(x, y)?.closest("[data-mc-pane]");
    return el?.getAttribute("data-mc-pane") ?? null;
  }

  function onMove(e) {
    if (!draggingId) return;
    const overId = paneIdAt(e.clientX, e.clientY);
    if (overId && overId !== draggingId) {
      const order = channels();
      moveChannel(draggingId, order.indexOf(overId));
    }
  }

  function onUp() {
    if (dragEl) dragEl.classList.remove("mc-pane-dragging");
    draggingId = null;
    dragEl = null;
    win.removeEventListener("mousemove", onMove, true);
    win.removeEventListener("mouseup", onUp, true);
  }

  container.addEventListener("mousedown", (e) => {
    const head = e.target.closest("[data-mc-drag]");
    if (!head) return;
    if (e.target.closest(".mc-btn")) return; // don't start on the × button
    e.preventDefault();
    draggingId = head.getAttribute("data-mc-drag");
    dragEl = head.closest("[data-mc-pane]");
    dragEl?.classList.add("mc-pane-dragging");
    win.addEventListener("mousemove", onMove, true);
    win.addEventListener("mouseup", onUp, true);
  });
}

// the content rendered inside the popped-out OS window
function PopoutContent(props) {
  let panesRef;
  onMount(() => panesRef && setupPaneDrag(panesRef, props.win));
  return (
    <>
      <div class="mc-popout-bar">
        <span class="mc-popout-title">discordfeed</span>
      </div>
      {/* delegated click handler catches all data-mc-url / data-mc-channel
          links inside the panes (per-element on:click doesn't fire reliably
          for nodes returned from renderContent's arrays) */}
      <div
        class="mc-panes mc-panes-popout"
        ref={panesRef}
        on:click={handleDelegatedClick}
      >
        <Show
          when={channels().length}
          fallback={
            <div class="mc-empty">
              Right-click a channel in Discord → “Add to Feed” to start
              monitoring it here.
            </div>
          }
        >
          <For each={channels()}>
            {(id) => <Pane id={id} onClose={removeChannel} />}
          </For>
        </Show>
      </div>
      <Lightbox win={props.win} />
      <ContextMenu win={props.win} />
    </>
  );
}

// ---------------------------------------------------------------------------
// popout window management (module level; opened from the toolbar button)
// ---------------------------------------------------------------------------
let popupWin = null;
let popupDispose = null;

// dispose the Solid tree and best-effort close the window (used on unload).
function closePopup() {
  try {
    popupDispose?.();
  } catch {}
  popupDispose = null;
  try {
    popupWin?.close();
  } catch {}
  try {
    popupWin?.eval?.("window.close()");
  } catch {}
  popupWin = null;
}

// NOTE: Dorion's webview gives us no reliable control over popup windows --
// we cannot detect when one is closed, reuse a named window, or close one from
// script. So the button simply opens a popout each time; duplicates are
// expected and accepted (close extras via their OS window controls).
function openPopout() {
  const popup = window.open("about:blank", "_blank", "width=1000,height=640");
  if (!popup) {
    alert("Pop-out was blocked. Allow popups for Discord/Dorion and retry.");
    return;
  }
  popupWin = popup;
  const doc = popup.document;

  doc.open();
  doc.write(
    "<!doctype html><html><head><title>DiscordFeed</title></head><body></body></html>"
  );
  doc.close();

  // Carry over Discord's full styling so fonts (gg sans @font-face) + theme
  // variables resolve in the popup. Copy <link rel=stylesheet> + <style> nodes
  // AND the theme/font class names from <html>/<body>.
  try {
    // 1) clone every stylesheet link and style tag from the main document
    document
      .querySelectorAll('link[rel="stylesheet"], style')
      .forEach((node) => {
        doc.head.appendChild(node.cloneNode(true));
      });
    // 2) copy the html + body class names (theme-dark, font-size, etc.)
    doc.documentElement.className = document.documentElement.className;
    doc.body.className = document.body.className;
    // 2b) match Discord's font rendering exactly (it sets these on the root;
    //     without them the popup text renders thinner/lighter than Discord).
    // 2c) match the main window's zoom level. Discord is often zoomed (e.g.
    //     90%); the popup opens at 100%, which makes text render differently.
    //     Applying the same zoom keeps the popout visually identical.
    const dpr = window.devicePixelRatio || 1;
    if (Math.abs(dpr - 1) > 0.01) doc.body.style.zoom = String(dpr);
    // 3) belt-and-suspenders: also dump computed custom properties from the
    //    element that actually carries them (the <body>, not always :root)
    const themed = document.body;
    const cs = getComputedStyle(themed);
    const varDump = [];
    for (let i = 0; i < cs.length; i++) {
      const p = cs[i];
      if (p.startsWith("--")) varDump.push(`${p}:${cs.getPropertyValue(p)}`);
    }
    if (varDump.length) {
      const vStyle = doc.createElement("style");
      vStyle.textContent = `:root,body{${varDump.join(";")}}`;
      doc.head.appendChild(vStyle);
    }
  } catch (e) {
    log(["DiscordFeed popout style copy failed", e], "warn");
  }

  doc.body.style.margin = "0";
  doc.body.style.background = "var(--background-secondary, #2b2d31)";

  // our plugin CSS (after Discord's, so it can override)
  const ourStyle = doc.createElement("style");
  ourStyle.textContent = CSS;
  doc.head.appendChild(ourStyle);

  // render into the popup. The MAIN window keeps store subscriptions alive,
  // so live updates still flow into these panes.
  const mount = doc.createElement("div");
  mount.className = "mc-popout-root";
  doc.body.appendChild(mount);
  popupDispose = render(
    () => (
      <ReactiveRoot>
        <PopoutContent win={popup} />
      </ReactiveRoot>
    ),
    mount
  );
  // Blur Discord's message input before handing focus to the popup. Otherwise,
  // when focus returns to the main window on close, Discord's Slate editor
  // re-focuses and resurfaces text left in its undo buffer (looks like a stray
  // paste). Blurring it leaves nothing for Discord to "restore".
  try {
    const box = document.querySelector(
      'div[contenteditable="true"][role="textbox"], [data-slate-editor="true"]'
    );
    box?.blur?.();
  } catch {}

  try {
    popup.focus();
  } catch {}
}

// ---------------------------------------------------------------------------
// live message routing: one global subscription fans out to panes
// ---------------------------------------------------------------------------
// We keep a registry of per-channel listeners so each Pane can react to new
// messages for its own channel only.
const listeners = new Map(); // channelId -> Set<{create, update}>

function register(channelId, handlers) {
  let set = listeners.get(channelId);
  if (!set) listeners.set(channelId, (set = new Set()));
  set.add(handlers);
  return () => set.delete(handlers);
}

function fanout(channelId, kind, message) {
  const set = listeners.get(channelId);
  if (!set) return;
  for (const h of set) h[kind]?.(message);
}

// ---------------------------------------------------------------------------
// toolbar button injection (top window bar, to the LEFT of the Inbox icon)
// ---------------------------------------------------------------------------
// The top-right "trailing" bar holds Inbox, the devtools <> link, and the
// window controls. We watch it and insert our button before Inbox.
const TRAILING_SELECTOR = '[class*="trailing_"]';
const BTN_ID = "mc-toolbar-btn";

function findInbox(bar) {
  return (
    bar.querySelector('[aria-label="Inbox" i]') ||
    [...bar.querySelectorAll('[role="button"]')].find((b) =>
      /inbox/i.test(b.getAttribute("aria-label") || "")
    )
  );
}

function makeToolbarButton(inbox) {
  const btn = document.createElement("div");
  btn.id = BTN_ID;
  // clone the inbox button's classes so sizing/hover match the native icons
  btn.className = inbox ? inbox.className : "";
  btn.classList.add("mc-toolbar-btn");
  btn.setAttribute("role", "button");
  btn.setAttribute("aria-label", "DiscordFeed");
  btn.setAttribute("tabindex", "0");
  btn.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="4" width="7" height="16" rx="1.5" fill="currentColor"/>
      <rect x="12" y="4" width="9" height="16" rx="1.5" fill="currentColor" opacity="0.55"/>
    </svg>`;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    openPopout();
  });
  return btn;
}

function injectToolbarButton(bar) {
  if (!bar || bar.querySelector(`#${BTN_ID}`)) return;
  const inbox = findInbox(bar);
  if (!inbox) return; // not the right bar
  const btn = makeToolbarButton(inbox);
  inbox.parentElement.insertBefore(btn, inbox); // left of Inbox
}

// ---------------------------------------------------------------------------
// channel right-click menu: inject an "Add to Feed" / "Remove from Feed" item
// ---------------------------------------------------------------------------
const MENU_ITEM_ID = "mc-menu-additem";

// read the channel object off the menu's React fiber
function getMenuChannel(menu) {
  try {
    let n = getFiber(menu);
    let hops = 0;
    while (n && hops++ < 40) {
      const p = n.memoizedProps || n.pendingProps;
      if (p?.channel?.id) return p.channel;
      n = n.return;
    }
  } catch {}
  return null;
}

// find a menu item by its visible label (case-insensitive, trimmed)
function findMenuItem(menu, label) {
  return [...menu.querySelectorAll('[role="menuitem"]')].find(
    (i) => i.textContent?.trim().toLowerCase() === label.toLowerCase()
  );
}

function injectChannelMenuItem(menu) {
  if (!menu || menu.querySelector(`#${MENU_ITEM_ID}`)) return;
  const channel = getMenuChannel(menu);
  if (!channel?.id) return;
  // only makes sense for guild text channels (skip categories/voice/etc.)
  if (channel.type !== 0 && channel.type !== 5) return;

  // Clone "Copy Link" -- it's always ENABLED, so we don't inherit the disabled
  // styling that "Mark As Read" has when greyed out. Fall back to any item.
  const anchor =
    findMenuItem(menu, "Copy Link") ||
    findMenuItem(menu, "Copy Channel ID") ||
    menu.querySelector('[role="menuitem"]');
  if (!anchor) return;

  const item = anchor.cloneNode(true); // copies the inner label/icon structure
  item.id = MENU_ITEM_ID;
  // Discord's highlight class is `focused_<hash>`, sharing the hash with
  // `item_<hash>`. Derive it from the anchor's item class (hash changes per
  // Discord build, so never hardcode it).
  const itemCls = [...anchor.classList].find((c) => /^item_/.test(c));
  const hash = itemCls?.split("_")[1];
  const focusCls = hash ? `focused_${hash}` : null;
  if (focusCls) item.classList.remove(focusCls); // start un-highlighted
  // replace the cloned label text with ours (keep the wrapper structure)
  const inFeed = hasChannel(channel.id);
  const labelText = inFeed ? "Remove from Feed" : "Add to Feed";
  const labelNode =
    [...item.querySelectorAll("*")].find(
      (el) => el.childNodes.length === 1 && el.firstChild?.nodeType === 3
    ) || item;
  labelNode.textContent = labelText;
  // remove any cloned trailing badges/icons (e.g. the "ID" pill)
  item
    .querySelectorAll('[class*="iconContainer"], [class*="caret"], svg')
    .forEach((n) => n.remove());

  // Discord drives item highlight via JS, not CSS :hover. Manually own it:
  // on hover, clear the focus class from every sibling and apply it to us.
  if (focusCls) {
    item.addEventListener("mouseenter", () => {
      menu
        .querySelectorAll(`.${focusCls}`)
        .forEach((el) => el.classList.remove(focusCls));
      item.classList.add(focusCls);
    });
    item.addEventListener("mouseleave", () => item.classList.remove(focusCls));
  }

  item.addEventListener("click", (e) => {
    e.stopPropagation();
    if (inFeed) removeChannel(channel.id);
    else addChannel(channel.id);
    closeAllMenus();
  });

  // insert right after Copy Link
  anchor.parentElement.insertBefore(item, anchor.nextSibling);
}

// close any open Discord context menu. Discord dismisses on an outside
// pointerdown/mousedown -- those alone do it. We deliberately avoid firing a
// synthetic `click`, which makes Discord's router log "Unable to determine
// render window".
function closeAllMenus() {
  const fire = (target, type, Ctor, init) => {
    try {
      target.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, ...init }));
    } catch {}
  };
  for (const type of ["pointerdown", "mousedown"]) {
    const Ctor = type.startsWith("pointer") ? PointerEvent : MouseEvent;
    fire(document.documentElement, type, Ctor, { clientX: 0, clientY: 0 });
  }
  // Escape as a fallback
  fire(document, "keydown", KeyboardEvent, { key: "Escape", keyCode: 27 });
}

// ---------------------------------------------------------------------------
// lifecycle
// ---------------------------------------------------------------------------
let removeCss; // injectCss disposer
let unobserveDom; // disposes all observeDom watchers (toolbar + channel menu)

export function onLoad() {
  try {
    removeCss = injectCss(CSS);

    // live updates: scoped subscriptions are auto-removed on unload.
    scoped.flux.subscribe("MESSAGE_CREATE", (payload) => {
      const m = payload.message;
      if (m) fanout(m.channel_id, "create", m);
    });
    scoped.flux.subscribe("MESSAGE_UPDATE", (payload) => {
      const m = payload.message;
      if (m) fanout(m.channel_id, "update", m);
    });
    // reactions (passive, from the gateway -- no fetching).
    // skip the optimistic dispatch: Discord fires your own reaction twice
    // (optimistic=true then the confirmed one) -> would double-count.
    scoped.flux.subscribe("MESSAGE_REACTION_ADD", (d) => {
      if (d?.optimistic) return;
      const cid = d?.channelId ?? d?.channel_id;
      if (cid) fanout(cid, "reactAdd", d);
    });
    scoped.flux.subscribe("MESSAGE_REACTION_REMOVE", (d) => {
      if (d?.optimistic) return;
      const cid = d?.channelId ?? d?.channel_id;
      if (cid) fanout(cid, "reactRemove", d);
    });

    // remove any stray buttons left over from a previous build/hot-reload
    document.querySelectorAll(`#${BTN_ID}, .mc-toolbar-btn`).forEach((b) => b.remove());

    // inject our button into the top trailing bar (left of Inbox) now, and
    // re-inject whenever Discord re-renders that bar or the inbox button.
    const injectAll = () =>
      document.querySelectorAll(TRAILING_SELECTOR).forEach(injectToolbarButton);
    injectAll();
    // watching the Inbox button is the most reliable re-injection trigger:
    // whenever Discord re-renders it, we re-add our button to its bar.
    const unobsBar = observeDom(TRAILING_SELECTOR, injectAll);
    const unobsInbox = observeDom('[aria-label="Inbox" i]', injectAll);
    // inject "Add to Feed" into the channel right-click menu whenever it opens
    const unobsMenu = observeDom("#channel-context", injectChannelMenuItem);
    unobserveDom = () => {
      unobsBar?.();
      unobsInbox?.();
      unobsMenu?.();
    };

    log("DiscordFeed loaded");
  } catch (e) {
    log(["DiscordFeed onLoad failed", e], "error");
    throw e;
  }
}

export function onUnload() {
  listeners.clear();
  // close the popout window if open
  closePopup();
  // stop re-injecting and remove any buttons we added
  unobserveDom?.();
  unobserveDom = undefined;
  document.querySelectorAll(`#${BTN_ID}, .mc-toolbar-btn`).forEach((b) => b.remove());
  removeCss?.();
  removeCss = undefined;
}
