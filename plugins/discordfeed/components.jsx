// All Solid components plus the shared module-level reactive state they close
// over (lightbox, context menu, channel list, popup windows, message routing).
// These are tightly coupled -- e.g. openPopout() renders PopoutContent which
// reads channels()/listeners -- so they live together to avoid circular imports.
import {
  createSignal,
  createEffect,
  For,
  Show,
  onCleanup,
  onMount,
} from "solid-js";
import {
  store,
  ReactiveRoot,
  render,
  log,
  http,
  MessageStore,
  ChannelStore,
  AccessibilityStore,
  UserStore,
} from "./shelter.js";
import { CSS } from "./css.js";
import {
  MAX_MESSAGES,
  SEED_FETCH_LIMIT,
  SCROLLBAR_HIDE_MS,
  FLASH_MS,
  TOAST_MS,
  resolveMember,
  channelName,
  avatarUrl,
  fmtTime,
  fmtFooterTime,
  formatSize,
  twemojiUrl,
  setupVideoVolume,
  openExternal,
  navigateToChannel,
  openLink,
  renderContent,
  isContinuation,
  normalize,
  listProfiles,
  createProfile,
  renameProfile,
  deleteProfile,
  getProfileChannels,
  addChannelToProfile,
  removeChannelFromProfile,
} from "./helpers.jsx";

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

// ---------------------------------------------------------------------------
// reply composer: one in-flight reply target per channel (Map so each pane
// tracks its own independently). { channelId: { msg, guildId } }
// ---------------------------------------------------------------------------
const [replyTargets, setReplyTargets] = createSignal({});
function startReply(channelId, msg, guildId) {
  setReplyTargets((cur) => ({ ...cur, [channelId]: { msg, guildId } }));
}
function cancelReply(channelId) {
  setReplyTargets((cur) => {
    const next = { ...cur };
    delete next[channelId];
    return next;
  });
}

async function sendReply(channelId, content) {
  const trimmed = content.trim();
  if (!trimmed) return;
  const target = replyTargets()[channelId];
  const body = {
    content: trimmed,
    ...(target && {
      message_reference: {
        message_id: target.msg.id,
        channel_id: channelId,
        guild_id: target.guildId,
      },
    }),
  };
  cancelReply(channelId);
  await http.ready;
  await http.post({ url: `/channels/${channelId}/messages`, body });
}

// toggle the current user's own reaction on an existing emoji pill (never
// adds a brand new emoji -- only reacts where one is already present).
// Updates local state immediately (the real gateway echo would otherwise
// take a beat, making the click feel unresponsive), then rolls back if the
// REST call fails. Discord's REST emoji path segment: custom = "name:id",
// unicode = the raw emoji character, URI-encoded.
async function toggleReaction(channelId, messageId, emoji, isActive, onReact) {
  const delta = isActive ? -1 : 1;
  onReact(messageId, emoji, delta, true, "local");
  const encoded = emoji.id
    ? encodeURIComponent(`${emoji.name}:${emoji.id}`)
    : encodeURIComponent(emoji.name);
  const url = `/channels/${channelId}/messages/${messageId}/reactions/${encoded}/@me`;
  try {
    await http.ready;
    if (isActive) await http.del({ url });
    else await http.put({ url });
  } catch {
    onReact(messageId, emoji, -delta, !isActive, "rollback"); // undo on failure
  }
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
          onClick={() =>
            startReply(ctxMenu().channelId, ctxMenu().msg, ctxMenu().guildId)
          }
        >
          Reply
        </Item>
        <div class="mc-ctx-sep" />
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

// Discord's sticker CDN is unreliable, particularly for animated formats
// (APNG/Lottie/GIF stickers routinely 404 across every known host -- a
// known, unresolved issue on Discord's own end, not something we can fix).
// Fall back to a placeholder instead of a broken image icon.
function StickerMedia(props) {
  const [failed, setFailed] = createSignal(false);
  return (
    <Show
      when={!failed()}
      fallback={
        <div class="mc-sticker mc-sticker-unsupported" title={props.media.name}>
          Unsupported media type
        </div>
      }
    >
      <img
        class="mc-sticker"
        src={props.media.url}
        alt={props.media.name}
        title={props.media.name}
        loading="lazy"
        onLoad={props.onMediaLoad}
        onError={() => setFailed(true)}
      />
    </Show>
  );
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
              <path d="M14 3v5h5" fill="none" stroke="var(--mc-bg-primary)" stroke-width="1.5"/>
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
            ref={(el) => setupVideoVolume(el)}
            onLoadedData={onMediaLoad}
          />
        ) : md.type === "sticker" ? (
          <StickerMedia media={md} onMediaLoad={onMediaLoad} />
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
              // collectMedia already normalized md.color to a hex string
              md.color
                ? `border-left-color: ${md.color}`
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
                ref={(el) => setupVideoVolume(el)}
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
  // a message link to the referenced message, so the delegated click handler
  // can jump-in-feed (or fall back to opening it in Discord).
  const jumpUrl =
    r.messageId && r.channelId
      ? `https://discord.com/channels/${r.guildId ?? props.guildId ?? "@me"}/${r.channelId}/${r.messageId}`
      : undefined;
  return (
    <div class="mc-reply mc-reply-clickable" data-mc-url={jumpUrl}>
      <span class="mc-reply-spine" />
      <img class="mc-reply-avatar" src={avatarUrl(r.author)} />
      <span
        class="mc-reply-author"
        style={member.color ? `color:${member.color}` : undefined}
      >
        @{member.name}
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
        "mc-msg-active": ctxMenu()?.msg?.id === m.id,
        "mc-msg-mentioned": m.mentioned,
        "mc-msg-replying": replyTargets()[props.channelId]?.msg.id === m.id,
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
                  <span
                    class="mc-reaction"
                    classList={{ "mc-reaction-me": r.me }}
                    on:click={(e) => {
                      e.stopPropagation();
                      const el = e.currentTarget;
                      el.classList.remove("mc-reaction-pop");
                      void el.offsetWidth; // restart the animation on repeat clicks
                      el.classList.add("mc-reaction-pop");
                      toggleReaction(
                        props.channelId,
                        m.id,
                        { name: r.name, id: r.id },
                        r.me,
                        props.onReact
                      );
                    }}
                  >
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

// composer shown at the bottom of a pane whenever replying to a specific
// message (right-click -> Reply), or always if the user enabled the
// "Show message composer" setting -- in which case it doubles as a plain
// send box, with the reply-target header shown only while one is active.
function ReplyComposer(props) {
  const channelId = props.channelId;
  const target = () => replyTargets()[channelId];
  const visible = () => !!target() || store.showComposer;
  const member = () =>
    resolveMember(target()?.guildId, target()?.msg.author, target()?.msg.webhook);

  let inputRef;
  createEffect(() => {
    if (target() && inputRef) {
      inputRef.focus();
      autoGrow();
    }
  });

  // grow/shrink the textarea to fit its content, up to the CSS max-height
  // (which then takes over and scrolls internally). Reset to "auto" first
  // and force a synchronous reflow read (offsetHeight) so scrollHeight
  // reflects the SHRUNK size when text is deleted, not the previous height.
  function autoGrow() {
    if (!inputRef) return;
    inputRef.style.height = "auto";
    void inputRef.offsetHeight;
    inputRef.style.height = `${inputRef.scrollHeight}px`;
  }

  function send() {
    const content = inputRef?.value ?? "";
    inputRef.value = "";
    autoGrow();
    sendReply(channelId, content);
  }

  function onKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    } else if (e.key === "Escape") {
      cancelReply(channelId);
    }
  }

  return (
    <Show when={visible()}>
      <div class="mc-reply-composer">
        <Show when={target()}>
          <div class="mc-reply-composer-target">
            <span>
              Replying to <span style={member().color ? `color:${member().color}` : undefined}>@{member().name}</span>
            </span>
            <span class="mc-reply-composer-cancel" on:click={() => cancelReply(channelId)}>
              ×
            </span>
          </div>
        </Show>
        <textarea
          class="mc-reply-composer-input"
          ref={inputRef}
          placeholder={target() ? "Reply…" : "Message…"}
          rows="1"
          on:keydown={onKeyDown}
          on:input={autoGrow}
        />
      </div>
    </Show>
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

  let scrollHideTimer = null;
  onCleanup(() => {
    paneScrollRestores.delete(scrollHandle);
    clearTimeout(scrollHideTimer); // pane closed mid-scroll -> don't leave it pending
  });

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

  function pushMessages(list) {
    setMsgs((cur) => {
      let next = cur.slice();
      const idxById = new Map(next.map((m, i) => [m.id, i]));
      // dedup by nonce too: Discord sends an optimistic local message then the
      // confirmed server message (different ids, same nonce) -> would dupe.
      const idxByNonce = new Map();
      next.forEach((m, i) => {
        if (m._raw?.nonce != null) idxByNonce.set(m._raw.nonce, i);
      });
      for (const raw of list) {
        const norm = normalize(raw);
        if (idxById.has(norm.id)) continue; // already have this exact message
        const nonce = raw.nonce;
        if (nonce != null && idxByNonce.has(nonce)) {
          // replace the optimistic copy in place with the confirmed one
          next[idxByNonce.get(nonce)] = norm;
          continue;
        }
        next.push(norm);
      }
      // cap retained messages to bound memory/DOM
      if (next.length > MAX_MESSAGES) next = next.slice(next.length - MAX_MESSAGES);
      return next;
    });
    if (pinned) queueMicrotask(scrollToBottom);
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

  // toggleReaction() applies our own click optimistically (isMe, local=true)
  // so the pill responds instantly; the real gateway echo for that same
  // action arrives a moment later also tagged isMe. Track pending optimistic
  // deltas per (messageId, key) so that echo is consumed as confirmation
  // instead of being applied a second time (which would double-count).
  const pendingReacts = new Map(); // `${messageId}:${key}` -> count of un-echoed local deltas

  // MESSAGE_REACTION_ADD/REMOVE: adjust the reaction pill counts, and track
  // whether the CURRENT user is the one who (un)reacted so the pill can
  // render as active/toggleable. `mode: "local"` = our own optimistic update
  // (from toggleReaction, before the server confirms); "rollback" = undo a
  // local update after the REST call failed (applied directly, doesn't wait
  // for/consume an echo since none will arrive); omitted = a real dispatch
  // (someone else's reaction, or our own action's gateway echo).
  function reactMessage(messageId, emoji, delta, isMe, mode) {
    const key = emoji?.id || emoji?.name;
    if (!key) return;
    const pendingKey = `${messageId}:${key}`;
    if (mode === "local") {
      pendingReacts.set(pendingKey, (pendingReacts.get(pendingKey) ?? 0) + 1);
    } else if (mode === "rollback") {
      const n = (pendingReacts.get(pendingKey) ?? 0) - 1;
      if (n <= 0) pendingReacts.delete(pendingKey);
      else pendingReacts.set(pendingKey, n);
    } else if (isMe && pendingReacts.get(pendingKey) > 0) {
      // this is the echo of our own optimistic update -- already applied
      const n = pendingReacts.get(pendingKey) - 1;
      if (n <= 0) pendingReacts.delete(pendingKey);
      else pendingReacts.set(pendingKey, n);
      return;
    }
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
            me: isMe,
          });
      } else {
        const count = reactions[ri].count + delta;
        if (count <= 0) reactions.splice(ri, 1);
        else
          reactions[ri] = {
            ...reactions[ri],
            count,
            me: isMe ? delta > 0 : reactions[ri].me,
          };
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
  const seedScrollTimer = setTimeout(scrollToBottom, 120); // catch late layout after first paint
  onCleanup(() => clearTimeout(seedScrollTimer));

  // live: receive new + updated messages + reactions for this channel
  const unregister = register(id, {
    create: (m) => pushMessages([m]),
    update: (m) => updateMessage(m),
    reactAdd: (d) =>
      reactMessage(
        d.messageId ?? d.message_id,
        d.emoji,
        +1,
        (d.userId ?? d.user_id) === UserStore.getCurrentUser()?.id
      ),
    reactRemove: (d) =>
      reactMessage(
        d.messageId ?? d.message_id,
        d.emoji,
        -1,
        (d.userId ?? d.user_id) === UserStore.getCurrentUser()?.id
      ),
  });
  onCleanup(unregister);

  return (
    <div class="mc-pane" data-mc-pane={id}>
      <div class="mc-pane-head" data-mc-drag={id}>
        <span class="mc-pane-name">{name}</span>
        {/* close button only in the Shared Feed (individual feed has no
            onClose -- the single pane is the whole window). */}
        <Show when={props.onClose}>
          <button class="mc-btn" on:click={() => props.onClose(id)}>
            ×
          </button>
        </Show>
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
                  onReact={reactMessage}
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
      <ReplyComposer channelId={id} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// SHARED FEED state: a transient, in-memory-only channel list (NOT persisted).
// Right-click "Add to Shared Feed" appends; reorderable; gone on restart.
// ---------------------------------------------------------------------------
const [channels, setChannels] = createSignal([]);
export function addChannel(id) {
  if (!id || channels().includes(id)) return false;
  setChannels([...channels(), id]);
  return true;
}
export function removeChannel(id) {
  setChannels(channels().filter((c) => c !== id));
}
export function hasChannel(id) {
  return channels().includes(id);
}

// ---------------------------------------------------------------------------
// PROFILE state: named, PERSISTENT lists. `profiles` is the ordered list of
// profile NAMES (drives settings + toolbar menu). Per-profile channel lists
// are backed by storage but mirrored into reactive signals so any OPEN profile
// feed window updates live when a channel is added (from Discord's menu) or
// removed (from the pane's × button).
// ---------------------------------------------------------------------------
export const [profiles, setProfiles] = createSignal(listProfiles());

// name -> [channelsSignal, setChannelsSignal]; created lazily on first open.
const profileChannelSignals = new Map();
function profileChannelsSignal(name) {
  let sig = profileChannelSignals.get(name);
  if (!sig) {
    sig = createSignal(getProfileChannels(name));
    profileChannelSignals.set(name, sig);
  }
  return sig;
}
// reactive accessor for a profile's channels (used inside a profile popout)
export function profileChannels(name) {
  return profileChannelsSignal(name)[0]();
}
// re-sync a profile's reactive signal from storage (after a mutation)
function syncProfileChannels(name) {
  const sig = profileChannelSignals.get(name);
  if (sig) sig[1](getProfileChannels(name));
}

export function addToProfile(name, id) {
  if (!addChannelToProfile(name, id)) return false;
  syncProfileChannels(name);
  return true;
}
export function removeFromProfile(name, id) {
  if (!removeChannelFromProfile(name, id)) return false;
  syncProfileChannels(name);
  return true;
}

export function addProfile(name) {
  if (!createProfile(name)) return false;
  setProfiles(listProfiles());
  return true;
}
export function renameAnyProfile(oldName, newName) {
  if (!renameProfile(oldName, newName)) return false;
  // carry the reactive signal over to the new name so an open window keeps working
  const sig = profileChannelSignals.get(oldName);
  if (sig) {
    profileChannelSignals.delete(oldName);
    profileChannelSignals.set(newName, sig);
  }
  setProfiles(listProfiles());
  return true;
}
export function removeProfile(name) {
  if (!deleteProfile(name)) return false;
  profileChannelSignals.delete(name);
  setProfiles(listProfiles());
  return true;
}

// panes register a scroll-restore fn here; called after a reorder, since
// moving a scrollable node in the DOM resets its scrollTop.
const paneScrollRestores = new Set();

// move the channel `id` to index `toIndex` in the SHARED FEED (drag-to-reorder;
// profiles aren't reorderable). Transient, so no persistence.
function moveChannel(id, toIndex) {
  const cur = channels();
  const from = cur.indexOf(id);
  if (from === -1 || from === toIndex) return;
  // snapshot every pane's scroll BEFORE the DOM moves reset it
  paneScrollRestores.forEach((h) => h.save());
  const next = cur.slice();
  next.splice(from, 1);
  next.splice(toIndex, 0, id);
  setChannels(next);
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
    // append INSIDE .mc-popout-root so the toast inherits the --mc-* theme vars
    // (they're scoped to that element; appending to <body> leaves them unset and
    // the toast renders with a broken/transparent background).
    (doc.querySelector(".mc-popout-root") || doc.body).appendChild(el);
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

// the content rendered inside the popped-out OS window. Three modes:
//  - Individual: props.individual = channelId -> one fixed pane, no close.
//  - Profile:    props.profile   = name      -> that profile's persistent
//                list; the pane × removes the channel from the saved profile.
//  - Shared:     neither          -> the transient in-memory shared list;
//                drag-to-reorder, × removes from the shared list.
function PopoutContent(props) {
  let panesRef;
  const individual = props.individual;
  const profile = props.profile;
  // channel list + how × behaves depend on the mode
  const list = () => (profile ? profileChannels(profile) : channels());
  const onClose = profile
    ? (id) => removeFromProfile(profile, id)
    : removeChannel;
  // only the Shared Feed gets drag-to-reorder (individual = one pane, profiles
  // are managed via the Discord menu, not reordered here)
  onMount(() => {
    if (!individual && !profile && panesRef) setupPaneDrag(panesRef, props.win);
  });
  return (
    <>
      <Show when={!store.hideTitle}>
        <div class="mc-popout-bar">
          <span class="mc-popout-title">{profile ? profile : "discordfeed"}</span>
        </div>
      </Show>
      {/* delegated click handler catches all data-mc-url / data-mc-channel
          links inside the panes (per-element on:click doesn't fire reliably
          for nodes returned from renderContent's arrays) */}
      <div
        class="mc-panes mc-panes-popout"
        classList={{ "mc-panes-individual": !!individual }}
        ref={panesRef}
        on:click={handleDelegatedClick}
      >
        <Show
          when={individual ? true : list().length}
          fallback={
            <div class="mc-empty">
              {profile
                ? "This profile has no channels. Right-click a channel in Discord → “Add to Profile” to add one."
                : "Right-click a channel in Discord → “Add to Shared Feed” to start monitoring it here."}
            </div>
          }
        >
          <Show
            when={individual}
            fallback={
              <For each={list()}>
                {(id) => <Pane id={id} onClose={onClose} />}
              </For>
            }
          >
            {/* single fixed pane, no close button (it's the whole window) */}
            <Pane id={individual} />
          </Show>
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
// Every open feed window we've spawned (shared, individual, or profile), so
// onUnload can dispose the Solid tree + close them. Each entry: {win, dispose}.
const openPopups = new Set();

// dispose the Solid tree and best-effort close every window (used on unload).
export function closePopup() {
  openPopups.forEach(({ win, dispose }) => {
    try { dispose?.(); } catch {}
    try { win?.close(); } catch {}
    try { win?.eval?.("window.close()"); } catch {}
  });
  openPopups.clear();
}

// public entry points:
//   openPopout()          -> Shared Feed (transient multi-pane list)
//   openPopout(channelId) -> Individual Feed (one fixed channel)
//   openProfilePopout(nm) -> a feed window bound to persistent profile `nm`
// Multiple windows may be open at once (Dorion gives us no way to reuse a
// named window, so each call spawns a fresh one).
export function openPopout(channelId) {
  createFeedWindow({ individual: channelId || null, profile: null });
}
export function openProfilePopout(name) {
  createFeedWindow({ individual: null, profile: name });
}

// NOTE: Dorion's webview gives us no reliable control over popup windows --
// we cannot detect when one is closed, reuse a named window, or close one from
// script. Duplicates are expected and accepted (close extras via their OS
// window controls).
function createFeedWindow({ individual, profile }) {
  // Individual Feeds open narrower (single column); shared/profile stay wide.
  const w = individual ? 500 : 1000;
  const h = 640;
  const left = Math.round(window.screenX + (window.outerWidth - w) / 2);
  const top = Math.round(window.screenY + (window.outerHeight - h) / 2);
  const dims = `width=${w},height=${h},left=${left},top=${top}`;
  const popup = window.open("about:blank", "_blank", dims);
  if (!popup) {
    alert("Pop-out was blocked. Allow popups for Discord/Dorion and retry.");
    return;
  }

  try {
    popup.moveTo(left, top);
    popup.resizeTo(w, h);
  } catch {}
  const doc = popup.document;
  const winTitle = individual
    ? channelName(individual)
    : profile
      ? profile
      : "DiscordFeed";

  doc.open();
  doc.write(
    `<!doctype html><html><head><title>${winTitle}</title></head><body></body></html>`
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
  doc.body.style.background = "var(--mc-bg-secondary)";

  // our plugin CSS (after Discord's, so it can override)
  const ourStyle = doc.createElement("style");
  ourStyle.textContent = CSS;
  doc.head.appendChild(ourStyle);

  // render into the popup. The MAIN window keeps store subscriptions alive,
  // so live updates still flow into these panes.
  const mount = doc.createElement("div");
  mount.className = "mc-popout-root";
  // mirror Discord's Appearance settings exactly (read at open; reopen to
  // apply changes). fontSize: effective px 12..24 (default 16), scaled
  // relative to 16 so the default is exactly 1 and the CSS calc()s track the
  // slider. messageGroupSpacing: gap between groups in px (default 16).
  try {
    const fs = AccessibilityStore?.fontSize;
    if (fs) mount.style.setProperty("--mc-font-scale", String(fs / 16));
    const gs = AccessibilityStore?.messageGroupSpacing;
    if (gs) mount.style.setProperty("--mc-group-spacing", `${gs}px`);
  } catch {}
  doc.body.appendChild(mount);
  const dispose = render(
    () => (
      <ReactiveRoot>
        <PopoutContent win={popup} individual={individual} profile={profile} />
      </ReactiveRoot>
    ),
    mount
  );
  openPopups.add({ win: popup, dispose });
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
export const listeners = new Map(); // channelId -> Set<{create, update}>

function register(channelId, handlers) {
  let set = listeners.get(channelId);
  if (!set) listeners.set(channelId, (set = new Set()));
  set.add(handlers);
  return () => {
    set.delete(handlers);
    if (!set.size) listeners.delete(channelId); // don't keep empty sets around
  };
}

export function fanout(channelId, kind, message) {
  const set = listeners.get(channelId);
  if (!set) return;
  for (const h of set) h[kind]?.(message);
}
