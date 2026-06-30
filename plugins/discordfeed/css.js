// All popout/plugin CSS, injected via shelter.ui.injectCss (a bare .css import
// would be treated as a CSS Module and mangle our literal class selectors).
export const CSS = `
@import url("https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@600;700&display=swap");
/* Discord's newer "visual-refresh" themes dropped the old --background-primary
   etc. vars in favor of --background-base-* / --background-surface-*. We expose
   our own --mc-* vars that prefer the NEW names, fall back to the OLD names (so
   older Discord still works), then a hardcoded default. Our rules below use the
   --mc-* vars, so the popup follows whatever theme is active (incl. Onyx). */
.mc-popout-root {
  --mc-bg-primary: var(--background-base-low, var(--background-primary, #313338));
  --mc-bg-secondary: var(--background-surface-high, var(--background-secondary, #2b2d31));
  --mc-bg-secondary-alt: var(--background-surface-higher, var(--background-secondary-alt, #232428));
  --mc-bg-tertiary: var(--background-base-lower, var(--background-tertiary, #1e1f22));
  --mc-bg-floating: var(--background-base-lowest, var(--background-floating, #111214));
  --mc-bg-accent: var(--background-mod-subtle, var(--background-modifier-accent, rgba(255,255,255,0.06)));
  --mc-bg-hover: var(--background-mod-subtle, var(--background-message-hover, rgba(255,255,255,0.05)));
  --mc-header: var(--text-default, var(--header-primary, #f2f3f5));
  --mc-text: var(--text-default, var(--text-normal, #dbdee1));
  --mc-text-muted: var(--text-muted, #949ba4);
  --mc-link: var(--text-link, #00a8fc);
  /* accents — follow the theme's brand/mention colors, not hardcoded blurple */
  --mc-accent: var(--background-accent, var(--brand-500, #5865f2));
  --mc-mention-bg: var(--mention-background, var(--background-mentioned, color-mix(in srgb, var(--mc-accent) 25%, transparent)));
  --mc-mention-bg-hover: var(--mention-background, color-mix(in srgb, var(--mc-accent) 45%, transparent));
  --mc-mention-fg: var(--mention-foreground, var(--text-default, #c9cdfb));
  --mc-interactive: var(--interactive-normal, #b5bac1);
  --mc-interactive-hover: var(--interactive-hover, #dbdee1);
  /* chat-font-scale factor (1 = Discord's default 16px). openPopout() sets a
     real value when the user's slider differs; message sizes calc() off it. */
  --mc-font-scale: 1;
  /* gap between message groups (Discord's "Space between message groups",
     default 16px). openPopout() sets the user's real value. */
  --mc-group-spacing: 16px;
}
.mc-btn {
  background: var(--button-secondary-background, #4e5058);
  color: var(--mc-text); border: none; border-radius: 4px;
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
  color: var(--mc-text);
  background: var(--mc-bg-secondary);
  /* subpixel smoothing renders glyphs slightly heavier, closer to how Discord
     looks (the popout opens at native DPR, which otherwise thins text out). */
  -webkit-font-smoothing: subpixel-antialiased;
}
.mc-popout-bar {
  display: flex; align-items: center; justify-content: center;
  padding: 8px 12px; flex: 0 0 auto;
  background: var(--mc-bg-tertiary);
}
.mc-popout-title {
  font-family: "JetBrains Mono", ui-monospace, Consolas, monospace;
  font-weight: 700; font-size: 16px; letter-spacing: 0.02em;
  text-transform: lowercase;
  color: var(--mc-header);
}
.mc-panes-popout {
  flex: 1 1 auto; min-height: 0;
  color: var(--mc-text);
}
/* Individual Feed: one fixed pane fills the window; no drag/reorder affordance */
.mc-panes-individual .mc-pane { flex: 1 1 auto; min-width: 0; }
.mc-panes-individual .mc-pane-head { cursor: default; }
.mc-panes-individual .mc-pane-head:active { cursor: default; }
.mc-pane {
  flex: 1 0 320px; min-width: 260px; height: 100%;
  display: flex; flex-direction: column; min-height: 0;
  background: var(--mc-bg-primary); border-radius: 6px; overflow: hidden;
}
.mc-pane-head {
  display: flex; align-items: center; gap: 6px; padding: 5px 8px;
  background: var(--mc-bg-secondary-alt); flex: 0 0 auto;
  cursor: grab; user-select: none;
}
.mc-pane-head:active { cursor: grabbing; }
.mc-pane-dragging { opacity: 0.55; outline: 2px solid var(--mc-accent); outline-offset: -2px; }
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
  background: var(--mc-bg-secondary-alt);
  color: var(--mc-link); font-size: 13px; font-weight: 500;
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
.mc-msg:not(.mc-msg-grouped) { margin-top: var(--mc-group-spacing); }
/* grouped continuation lines sit nearly flush, like Discord (no extra gap) */
.mc-msg.mc-msg-grouped { padding-top: 0; padding-bottom: 0; }
/* right-click selection highlight (replaces hover highlight) */
.mc-msg.mc-msg-active { background: var(--mc-bg-hover); }
/* highlight messages that mention the current user (Discord's gold tint + bar) */
.mc-msg.mc-msg-mentioned {
  background: var(--background-mentioned, rgba(250, 166, 26, 0.08));
  box-shadow: inset 2px 0 0 0 var(--info-warning-foreground, #f0b232);
}
/* flash a feed message when a reply link jumps to it (Discord-style) */
.mc-msg-flash { animation: mc-flash 1.6s ease; }
@keyframes mc-flash {
  0%, 30% { background: color-mix(in srgb, var(--mc-link) 22%, transparent); }
  100% { background: transparent; }
}
.mc-msg-row { display: flex; gap: 16px; align-items: flex-start; }
.mc-avatar { width: 40px; height: 40px; border-radius: 50%; flex: 0 0 auto; margin-top: 2px; }
/* grouped continuation: avatar column becomes a timestamp gutter (shown on
   right-click-active row) */
.mc-msg-gutter {
  width: 40px; flex: 0 0 auto; text-align: center;
  font-size: 10px; color: var(--mc-text-muted);
  line-height: 1.375; opacity: 0; user-select: none;
  white-space: nowrap; overflow: visible;
  align-self: flex-start; margin-top: 4px; padding-left: 1px;
}
/* show the grouped-message timestamp in the gutter on hover (like Discord) */
.mc-msg:hover .mc-msg-gutter,
.mc-msg.mc-msg-active .mc-msg-gutter { opacity: 1; }
.mc-msg-content { min-width: 0; flex: 1 1 auto; }
.mc-msg-head { display: flex; align-items: baseline; gap: 0; }
.mc-msg-author {
  font-weight: 500; font-size: calc(16px * var(--mc-font-scale)); line-height: 1.375;
  color: var(--mc-header);
  user-select: text; cursor: text;
}
/* Discord spaces the timestamp from the name with a small left margin */
.mc-msg-time {
  font-size: calc(12px * var(--mc-font-scale)); line-height: 1.375; margin-left: 6px;
  color: var(--mc-text-muted); font-weight: 500;
}
.mc-msg-text {
  white-space: pre-wrap; word-break: break-word;
  /* match Discord exactly: 16px / 1.375 line-height (=22px). Scales with the
     user's chat-font-scaling setting via --mc-font-scale (default 1). */
  font-size: calc(16px * var(--mc-font-scale)); line-height: 1.375; color: var(--mc-text);
  /* allow normal text selection (the app root often sets user-select:none) */
  user-select: text; -webkit-user-select: text; cursor: text;
}
/* let embeds + reply text be selectable too */
.mc-embed-desc, .mc-embed-title, .mc-embed-field-value, .mc-reply-text {
  user-select: text; -webkit-user-select: text;
}
.mc-msg-text.mc-jumbo { line-height: 1; }
.mc-msg-text.mc-jumbo .mc-emoji { width: 48px; height: 48px; }
.mc-empty { color: var(--mc-text-muted); padding: 8px; font-style: italic; }

/* line-level markdown */
.mc-h1 { font-size: 24px; font-weight: 700; line-height: 1.3; margin: 4px 0 2px; }
.mc-h2 { font-size: 20px; font-weight: 700; line-height: 1.3; margin: 4px 0 2px; }
.mc-h3 { font-size: 16px; font-weight: 700; line-height: 1.3; margin: 4px 0 2px; }
.mc-subtext { font-size: 13px; color: var(--mc-text-muted); line-height: 1.3; }
/* inside subtext (webhook reply-context lines), tone down pills/links to match
   Discord's muted reply-reference look instead of loud inline pills */
.mc-subtext .mc-mention,
.mc-subtext .mc-channel-mention {
  background: none; color: var(--mc-text-muted); padding: 0; font-weight: 500;
}
.mc-subtext .mc-mention:hover,
.mc-subtext .mc-channel-mention:hover {
  background: none; color: var(--mc-text); text-decoration: underline;
}
/* masked links in reply context render blue + bold like Discord */
.mc-subtext .mc-link {
  color: var(--mc-link); font-weight: 600; text-decoration: none;
}
.mc-subtext .mc-link:hover { text-decoration: underline; }
.mc-subtext strong { font-weight: 600; }
.mc-quote {
  border-left: 4px solid var(--mc-bg-accent);
  padding-left: 8px; margin: 2px 0; color: var(--mc-text);
}

/* reply preview (the small line above a reply) */
.mc-reply {
  display: flex; align-items: center; gap: 4px;
  font-size: 13px; color: var(--mc-text-muted);
  margin-left: 20px; margin-bottom: 2px; position: relative;
}
.mc-reply-spine {
  width: 28px; height: 10px; flex: 0 0 auto;
  border-left: 2px solid var(--mc-bg-accent);
  border-top: 2px solid var(--mc-bg-accent);
  border-top-left-radius: 6px; margin-top: 8px; align-self: flex-start;
}
.mc-reply-clickable { cursor: pointer; }
.mc-reply-clickable:hover .mc-reply-text,
.mc-reply-clickable:hover .mc-reply-author { opacity: 1; filter: brightness(1.15); }
.mc-reply-avatar { width: 16px; height: 16px; border-radius: 50%; flex: 0 0 auto; }
.mc-reply-author { font-weight: 600; color: var(--mc-header); flex: 0 0 auto; }
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
  background: var(--mc-bg-secondary);
  border: 1px solid var(--border-faint, rgba(255, 255, 255, 0.06));
}
.mc-reaction-emoji {
  width: 18px; height: 18px; object-fit: contain; display: block;
  margin: 0 1px;
}
.mc-reaction-count {
  font-size: 15px; font-weight: 600; line-height: 1;
  color: var(--mc-text-muted); min-width: 9px; text-align: center;
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
  background: var(--mc-bg-floating); color: var(--mc-text);
  padding: 10px 16px; border-radius: 8px; font-size: 14px; font-weight: 500;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  opacity: 0; transition: opacity 0.18s ease, transform 0.18s ease;
}
.mc-toast.mc-toast-show { opacity: 1; transform: translate(-50%, 0); }

/* right-click context menu */
.mc-ctx {
  position: fixed; z-index: 2147483647; min-width: 188px;
  background: var(--mc-bg-floating);
  border-radius: 4px; padding: 6px 8px;
  box-shadow: 0 8px 16px rgba(0, 0, 0, 0.24);
  font-size: 14px; user-select: none;
}
.mc-ctx-item {
  padding: 6px 8px; border-radius: 4px; cursor: pointer;
  color: var(--mc-interactive); line-height: 1.2;
}
.mc-ctx-item:hover {
  background: var(--menu-item-default-hover-bg, var(--mc-accent));
  color: var(--white-100, #fff);
}
.mc-ctx-sep {
  height: 1px; margin: 4px 0;
  background: var(--mc-bg-accent);
}

.mc-emoji { width: 22px; height: 22px; vertical-align: bottom; object-fit: contain; }
.mc-mention {
  background: var(--mc-mention-bg);
  color: var(--mc-mention-fg); border-radius: 3px; padding: 0 2px; font-weight: 500;
}
.mc-channel-mention { cursor: pointer; }
.mc-channel-mention:hover { background: var(--mc-mention-bg-hover); }
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
.mc-link { color: var(--mc-link); cursor: pointer; text-decoration: none; word-break: break-all; }
.mc-link:hover { text-decoration: underline; }
.mc-code {
  background: var(--mc-bg-tertiary); border-radius: 3px;
  padding: 0 3px; font-family: monospace; font-size: 0.9em;
}
.mc-codeblock {
  background: var(--mc-bg-secondary);
  border: 1px solid var(--mc-bg-tertiary);
  border-radius: 4px; padding: 8px 10px; margin: 4px 0;
  max-width: 100%; overflow-x: auto;
  font-family: Consolas, "Andale Mono", monospace; font-size: 13px;
  line-height: 1.3; color: var(--mc-text);
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
/* sticker -> fixed 160x160, like Discord (no zoom, no border) */
.mc-sticker {
  width: 160px; height: 160px; object-fit: contain;
  margin-top: 4px; display: block;
}
/* non-media attachment download card */
.mc-file {
  display: flex; align-items: center; gap: 10px;
  margin-top: 4px; padding: 10px 12px; max-width: 400px;
  background: var(--mc-bg-secondary);
  border: 1px solid var(--mc-bg-tertiary);
  border-radius: 8px; text-decoration: none; cursor: pointer;
}
.mc-file:hover { border-color: var(--mc-bg-accent); }
.mc-file-icon { width: 30px; height: 40px; flex: 0 0 auto; color: var(--mc-interactive); }
.mc-file-meta { min-width: 0; }
.mc-file-name {
  color: var(--mc-link); font-size: 15px; font-weight: 500;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.mc-file-size { color: var(--mc-text-muted); font-size: 12px; }
/* video element used inside an embed card (FxTwitter etc.) */
.mc-embed-image[src] { border-radius: 8px; }
/* nudge the native player controls a touch closer to Discord's rounded look */
.mc-media-video::-webkit-media-controls-panel,
.mc-embed-image::-webkit-media-controls-panel {
  border-bottom-left-radius: 8px; border-bottom-right-radius: 8px;
}
.mc-embed {
  margin-top: 4px; padding: 8px 16px 12px 12px; border-radius: 4px;
  border-left: 4px solid var(--mc-bg-tertiary);
  background: var(--mc-bg-secondary);
  max-width: 432px; width: fit-content;
  display: flex; flex-direction: column; gap: 8px;
}
.mc-embed-main { display: flex; gap: 12px; }
.mc-embed-text { min-width: 0; flex: 1 1 auto; display: flex; flex-direction: column; gap: 2px; }
.mc-embed-author {
  display: flex; align-items: center; gap: 8px;
  font-size: 13px; font-weight: 600; color: var(--mc-text);
  margin-top: 8px;
}
.mc-embed-author-icon { width: 24px; height: 24px; border-radius: 50%; }
.mc-embed-title { font-weight: 600; margin-top: 2px; color: var(--mc-link); }
.mc-embed-title .mc-link { color: var(--mc-link); }
.mc-embed-desc {
  font-size: 14px; color: var(--mc-text);
  white-space: pre-wrap; word-break: break-word; line-height: 1.375; margin-top: 4px;
}
.mc-embed-fields { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.mc-embed-field { flex: 1 1 100%; min-width: 0; }
.mc-embed-field-inline { flex: 1 1 30%; }
.mc-embed-field-name { font-size: 13px; font-weight: 600; margin-bottom: 2px; }
.mc-embed-field-value { font-size: 14px; color: var(--mc-text); white-space: pre-wrap; }
.mc-embed-thumb { width: 80px; height: 80px; object-fit: cover; border-radius: 4px; flex: 0 0 auto; cursor: pointer; }
.mc-embed-image { max-width: 100%; max-height: 300px; border-radius: 4px; cursor: pointer; display: block; margin-top: 8px; }
.mc-embed-footer {
  display: flex; align-items: center; gap: 8px;
  font-size: 12px; color: var(--mc-text-muted); margin-top: 4px;
}
.mc-embed-footer-icon { width: 20px; height: 20px; border-radius: 50%; }
.mc-embed-footer-sep { opacity: 0.6; }

/* toolbar button injected next to Discord's inbox/help icons.
   NOTE: this lives in the MAIN Discord document (not the popout), so it uses
   Discord's real theme vars directly -- the --mc-* vars don't exist here. */
.mc-toolbar-btn {
  position: relative;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; color: var(--interactive-normal, #b5bac1);
}
.mc-toolbar-btn:hover { color: var(--interactive-hover, #dbdee1); }
/* Discord-style tooltip shown on hover, centered BELOW the button.
   Values copied 1:1 from Discord's own Inbox tooltip (.tooltip__4e35b):
   16px/400 gg sans, 8px 12px padding, 8px radius, surface-highest bg,
   inset 1px border + soft drop shadow. Drops down because top-bar icons sit
   at the window edge (above would clip off-screen). */
.mc-tooltip {
  position: absolute; top: calc(100% + 11px); left: 50%;
  transform: translateX(-50%);
  background: var(--background-surface-highest, var(--background-floating, #1e1f22));
  color: var(--text-default, #f2f3f5);
  font-family: "gg sans", "Noto Sans", "Helvetica Neue", Helvetica, Arial, sans-serif;
  font-size: 16px; font-weight: 400; line-height: 16px;
  padding: 8px 12px; border-radius: 8px; max-width: 200px; white-space: nowrap;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06),
              0 12px 24px 0 rgba(0, 0, 0, 0.24);
  pointer-events: none; user-select: none; z-index: 10000;
  opacity: 0; transition: opacity 0.1s ease;
}
.mc-tooltip-arrow {
  /* the arrow sits mostly ABOVE the bubble, overlapping just 1px so the seam
     merges without the arrow sinking into the text (like Discord's). */
  position: absolute; bottom: calc(100% - 1px); left: 50%; transform: translateX(-50%);
  border-left: 9px solid transparent;
  border-right: 9px solid transparent;
  border-bottom: 8px solid var(--background-surface-highest, var(--background-floating, #1e1f22));
}
.mc-toolbar-btn:hover .mc-tooltip {
  opacity: 1;
}
`;
