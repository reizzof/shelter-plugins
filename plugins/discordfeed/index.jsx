// DiscordFeed -- entry point. Wires CSS injection, the gateway subscriptions
// that fan messages out to panes, the toolbar button + channel-menu injection,
// the settings panel, and load/unload lifecycle. The heavy lifting lives in
// helpers.jsx (logic) and components.jsx (UI + shared state).
import {
  store,
  scoped,
  injectCss,
  SwitchItem,
  observeDom,
  getFiber,
  log,
} from "./shelter.js";
import { CSS } from "./css.js";
import {
  openPopout,
  closePopup,
  fanout,
  listeners,
  addChannel,
  removeChannel,
  hasChannel,
} from "./components.jsx";

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
  btn.setAttribute("aria-label", "Shared Feed");
  btn.setAttribute("tabindex", "0");
  btn.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="4" width="7" height="16" rx="1.5" fill="currentColor"/>
      <rect x="12" y="4" width="9" height="16" rx="1.5" fill="currentColor" opacity="0.55"/>
    </svg>
    <span class="mc-tooltip" role="tooltip">Shared Feed<span class="mc-tooltip-arrow"></span></span>`;
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

// build one menu item by cloning a known-enabled anchor so it inherits
// Discord's native styling. `focusCls` (derived once by the caller) drives the
// JS-managed hover highlight Discord uses instead of CSS :hover.
function buildMenuItem(menu, anchor, focusCls, { id, label, onClick }) {
  const item = anchor.cloneNode(true); // copies the inner label/icon structure
  item.id = id;
  if (focusCls) item.classList.remove(focusCls); // start un-highlighted
  // replace the cloned label text with ours (keep the wrapper structure)
  const labelNode =
    [...item.querySelectorAll("*")].find(
      (el) => el.childNodes.length === 1 && el.firstChild?.nodeType === 3
    ) || item;
  labelNode.textContent = label;
  // remove any cloned trailing badges/icons (e.g. the "ID" pill)
  item
    .querySelectorAll('[class*="iconContainer"], [class*="caret"], svg')
    .forEach((n) => n.remove());
  // Discord drives item highlight via JS, not CSS :hover -- own it ourselves.
  if (focusCls) {
    item.addEventListener("mouseenter", () => {
      menu.querySelectorAll(`.${focusCls}`).forEach((el) => el.classList.remove(focusCls));
      item.classList.add(focusCls);
    });
    item.addEventListener("mouseleave", () => item.classList.remove(focusCls));
  }
  item.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
    closeAllMenus();
  });
  return item;
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

  // Discord's highlight class is `focused_<hash>`, sharing the hash with
  // `item_<hash>`. Derive it from the anchor's item class (hash changes per
  // Discord build, so never hardcode it).
  const itemCls = [...anchor.classList].find((c) => /^item_/.test(c));
  const hash = itemCls?.split("_")[1];
  const focusCls = hash ? `focused_${hash}` : null;

  const inFeed = hasChannel(channel.id);
  const sharedItem = buildMenuItem(menu, anchor, focusCls, {
    id: MENU_ITEM_ID,
    label: inFeed ? "Remove from Shared Feed" : "Add to Shared Feed",
    onClick: () => (inFeed ? removeChannel(channel.id) : addChannel(channel.id)),
  });
  const individualItem = buildMenuItem(menu, anchor, focusCls, {
    id: `${MENU_ITEM_ID}-individual`,
    label: "Open Individual Feed",
    onClick: () => openPopout(channel.id),
  });

  // insert both right after the anchor (Copy Link)
  anchor.parentElement.insertBefore(sharedItem, anchor.nextSibling);
  sharedItem.parentElement.insertBefore(individualItem, sharedItem.nextSibling);
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
// settings panel (rendered by Shelter in the plugin's settings view)
// ---------------------------------------------------------------------------
export function settings() {
  return (
    <SwitchItem
      value={store.hideTitle}
      onChange={(v) => (store.hideTitle = v)}
      note="Hide the “discordfeed” title bar at the top of pop-out windows."
    >
      Hide title header
    </SwitchItem>
  );
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
