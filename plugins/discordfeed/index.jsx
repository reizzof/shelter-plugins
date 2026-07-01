// DiscordFeed -- entry point. Wires CSS injection, the gateway subscriptions
// that fan messages out to panes, the toolbar button + channel-menu injection,
// the settings panel, and load/unload lifecycle. The heavy lifting lives in
// helpers.jsx (logic) and components.jsx (UI + shared state).
import { createSignal, createEffect, onCleanup, For, Show } from "solid-js";
import {
  store,
  scoped,
  injectCss,
  SwitchItem,
  TextBox,
  Button,
  ButtonSizes,
  Header,
  HeaderTags,
  observeDom,
  getFiber,
  log,
} from "./shelter.js";
import { CSS } from "./css.js";
import {
  openPopout,
  openProfilePopout,
  closePopup,
  fanout,
  listeners,
  addChannel,
  removeChannel,
  hasChannel,
  profiles,
  addProfile,
  renameAnyProfile,
  removeProfile,
  addToProfile,
  removeFromProfile,
} from "./components.jsx";
import { isChannelInProfile, PROFILE_NAME_MAX_LENGTH } from "./helpers.jsx";

// ---------------------------------------------------------------------------
// toolbar button injection (top window bar, to the LEFT of the Inbox icon)
// ---------------------------------------------------------------------------
// The top-right "trailing" bar holds Inbox, the devtools <> link, and the
// window controls. We watch it and insert our button before Inbox.
const TRAILING_SELECTOR = '[class*="trailing_"]';
const BTN_ID = "mc-toolbar-btn";

function findInbox(bar) {
  return (
    // data-jump-section="global" is Discord's own semantic attribute for the
    // Inbox button -- stable across locales, unlike its translated aria-label
    // (e.g. "Caixa de Entrada" in Portuguese, which the old aria-label match
    // below never finds).
    bar.querySelector('[data-jump-section="global"]') ||
    bar.querySelector('[aria-label="Inbox" i]') ||
    [...bar.querySelectorAll('[role="button"]')].find((b) =>
      /inbox/i.test(b.getAttribute("aria-label") || "")
    )
  );
}

// right-click quick-launch menu on the toolbar button: pick a profile to open
// its (persistent) feed window. Raw DOM (matches the toolbar button itself) --
// main-document territory, same convention as the rest of the toolbar.
function closeProfileMenu() {
  document.querySelector(".mc-profile-menu")?.remove();
}

// drops below the toolbar row (button sits at the top of the screen, so
// opening the OLD way -- straight at the cursor -- looked like it floated
// off to the side), but stays horizontally centered under the cursor rather
// than snapping to the button's own edge.
function openProfileMenu(anchorEl, clickX) {
  closeProfileMenu();
  const menu = document.createElement("div");
  menu.className = "mc-profile-menu";

  const names = profiles();
  if (!names.length) {
    const empty = document.createElement("div");
    empty.className = "mc-profile-menu-empty";
    empty.textContent = "No profiles yet — create one in settings";
    menu.appendChild(empty);
  } else {
    for (const name of names) {
      const item = document.createElement("div");
      item.className = "mc-profile-menu-item";
      item.textContent = name;
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        openProfilePopout(name);
        closeProfileMenu();
      });
      menu.appendChild(item);
    }
  }

  document.body.appendChild(menu);
  // vertically: below the button row (clamped so a long, scrollable profile
  // list never runs off the bottom of the screen). horizontally: centered
  // under the actual click position, clamped so it never runs off either
  // screen edge.
  const r = anchorEl.getBoundingClientRect();
  const gap = 6;
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  let left = clickX - mw / 2;
  left = Math.max(4, Math.min(left, window.innerWidth - mw - 4));
  let top = r.bottom + gap;
  if (top + mh > window.innerHeight) top = Math.max(4, window.innerHeight - mh - 4);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;

  const onDocClick = () => {
    closeProfileMenu();
    document.removeEventListener("click", onDocClick);
  };
  // defer so the click that opened the menu doesn't immediately close it
  setTimeout(() => document.addEventListener("click", onDocClick), 0);
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
  // right-click: pick a profile to open its persistent feed (left-click above
  // opens the transient Shared Feed)
  btn.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openProfileMenu(btn, e.clientX);
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

// find a menu item by its stable Discord-internal id prefix (e.g.
// "channel-context-channel-copy-link") -- language-independent, unlike the
// visible label ("Copy Link" in English, "Copiar link" in Portuguese, etc).
function findMenuItemById(menu, idPrefix) {
  return [...menu.querySelectorAll('[role="menuitem"]')].find((i) =>
    i.id?.startsWith(idPrefix)
  );
}

// build one menu item by cloning a known-enabled anchor so it inherits
// Discord's native styling. `focusCls` (derived once by the caller) drives the
// JS-managed hover highlight Discord uses instead of CSS :hover.
//   onClick     -- fired on click (and closes the menu) unless omitted
//   caretSource -- an existing submenu-parent item (e.g. Mute) to borrow the
//                  trailing caret icon from -- "Copy Link" (our usual anchor)
//                  has no caret of its own, so there's nothing to "keep".
//   onEnter/onLeave -- extra hover hooks (used to open/close a flyout)
function buildMenuItem(menu, anchor, focusCls, { id, label, onClick, caretSource, onEnter, onLeave }) {
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
  // graft on a real caret, cloned from a genuine submenu-parent item (Mute),
  // so it's pixel-identical to Discord's own -- not something we're guessing
  if (caretSource) {
    const caretIcon = caretSource.querySelector('[class*="iconContainer"]');
    if (caretIcon) {
      item.appendChild(caretIcon.cloneNode(true));
      item.setAttribute("aria-haspopup", "true");
      item.setAttribute("aria-expanded", "false");
    }
  }
  // Discord drives item highlight via JS, not CSS :hover -- own it ourselves.
  if (focusCls) {
    item.addEventListener("mouseenter", () => {
      menu.querySelectorAll(`.${focusCls}`).forEach((el) => el.classList.remove(focusCls));
      item.classList.add(focusCls);
    });
    item.addEventListener("mouseleave", () => item.classList.remove(focusCls));
  }
  if (onEnter) item.addEventListener("mouseenter", onEnter);
  if (onLeave) item.addEventListener("mouseleave", onLeave);
  if (onClick) {
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick();
      closeAllMenus();
    });
  }
  return item;
}

// the "Add to Profile ▸" flyout: a submenu listing every profile, with a check
// on the ones this channel already belongs to. Clones Discord's own menu
// container (same outer classes as the real right-click menu, e.g. Mute's
// submenu) so it gets native background/shadow/padding/radius for free
// instead of our own approximation. Appended to <body> (not the parent menu)
// so the parent's overflow can't clip it. Positioned to the right of the
// parent item with a real gap (not overlapping), flipping left if no room.
const SUBMENU_ID = "mc-profile-submenu";
function closeProfileSubmenu() {
  document.getElementById(SUBMENU_ID)?.remove();
}
function openProfileSubmenu(menu, parentItem, itemAnchor, focusCls, submenuCls, channelId) {
  closeProfileSubmenu();
  // clone the real menu's FULL chrome, not just the outer shell -- the
  // vertical-stacking layout lives on inner wrappers (.scroller_*,
  // [role="group"]), not the outermost [role="menu"], so a shallow clone put
  // items side-by-side instead of stacked. Deep-clone the whole menu, then
  // gut just the innermost item-holding group and refill it with ours.
  const nativeMenu = menu.closest('[role="menu"]') || menu;
  const sub = nativeMenu.cloneNode(true);
  sub.id = SUBMENU_ID;
  sub.style.position = "fixed";
  // force interactivity explicitly -- cloning Discord's real menu classes
  // risks inheriting a CSS rule (animation/visibility-linked pointer-events)
  // scoped to menus rendered inside Discord's own layer/portal wrapper,
  // which our flyout (appended straight to <body>) isn't inside.
  sub.style.pointerEvents = "auto";
  sub.style.zIndex = "2147483647";
  sub.style.opacity = "1";
  sub.style.visibility = "visible";
  // Discord's real submenus (e.g. Mute's) carry an EXTRA "submenu_<hash>"
  // class alongside "menu_<hash>" -- confirmed via a real submenu's DOM
  // (shares the same hash suffix as item_/label_/menu_). That class is what
  // drives the wider real gap (~12px, not our old 6px guess) and other
  // submenu-specific chrome our shallow "menu_<hash>" clone alone lacked.
  if (submenuCls) sub.classList.add(submenuCls);

  // the real menu has MULTIPLE [role="group"] sections (separated by
  // [role="separator"]s) -- Mark as Read, Invite/Pin/Copy Link, Mute/
  // Notifications, Copy Channel ID, etc. Keep only the first group (for its
  // layout wrapper) and drop every other group + separator, then empty the
  // one we kept and refill it with just our profile items.
  const groups = [...sub.querySelectorAll('[role="group"]')];
  const group = groups[0] || sub;
  groups.slice(1).forEach((g) => g.remove());
  sub.querySelectorAll('[role="separator"]').forEach((s) => s.remove());
  group.innerHTML = "";

  const names = profiles();
  if (!names.length) {
    const empty = itemAnchor.cloneNode(true);
    empty.removeAttribute("id");
    empty.querySelectorAll('[class*="iconContainer"], svg').forEach((n) => n.remove());
    const labelNode =
      [...empty.querySelectorAll("*")].find(
        (el) => el.childNodes.length === 1 && el.firstChild?.nodeType === 3
      ) || empty;
    labelNode.textContent = "No profiles yet — create one in settings";
    empty.classList.add("mc-profile-submenu-empty");
    group.appendChild(empty);
  } else {
    for (const name of names) {
      const inProfile = isChannelInProfile(name, channelId);
      // scope hover-highlight clearing to OUR submenu (sub), not the parent
      // channel-context menu, so hovering an item here doesn't touch it
      const item = buildMenuItem(sub, itemAnchor, focusCls, {
        id: `mc-profile-submenu-item-${name}`,
        label: name,
        onClick: () => {
          if (isChannelInProfile(name, channelId)) removeFromProfile(name, channelId);
          else addToProfile(name, channelId);
        },
      });
      // checkmark trails the row (end-aligned), not prefixed on the label
      if (inProfile) {
        const check = document.createElement("span");
        check.className = "mc-profile-submenu-check";
        check.textContent = "✓";
        item.appendChild(check);
      }
      group.appendChild(item);
    }
  }

  document.body.appendChild(sub);
  // position: to the right of the parent item WITH a gap (Discord's own
  // submenus don't overlap the parent), flip left if it won't fit.
  // 12px measured directly off Mute's real submenu vs. its parent item's
  // rects (submenu.left - muteItem.right ≈ 12px) -- not a guess.
  const r = parentItem.getBoundingClientRect();
  const gap = 12;
  const sw = sub.offsetWidth;
  const sh = sub.offsetHeight;
  let left = r.right + gap;
  if (left + sw > window.innerWidth) left = r.left - sw - gap;
  let top = r.top;
  if (top + sh > window.innerHeight) top = Math.max(4, window.innerHeight - sh - 4);
  sub.style.left = `${left}px`;
  sub.style.top = `${top}px`;
}

function injectChannelMenuItem(menu) {
  if (!menu || menu.querySelector(`#${MENU_ITEM_ID}`)) return;
  const channel = getMenuChannel(menu);
  if (!channel?.id) return;
  // only makes sense for guild text channels (skip categories/voice/etc.)
  if (channel.type !== 0 && channel.type !== 5) return;

  // Clone "Copy Link" -- it's always ENABLED, so we don't inherit the disabled
  // styling that "Mark As Read" has when greyed out. IDs (not labels) so this
  // works regardless of Discord's UI language. Fall back to any item.
  const anchor =
    findMenuItemById(menu, "channel-context-channel-copy-link") ||
    findMenuItemById(menu, "channel-context-devmode-copy-id") ||
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

  // "Add to Profile ▸" -- hover opens a flyout submenu of profiles, styled to
  // match Discord's own "Mute Channel ▸" submenu (borrow its caret icon since
  // "Copy Link" -- our usual clone source -- has no caret of its own). A
  // small close-delay lets the pointer travel from the parent item into the
  // flyout without it vanishing.
  const muteItem = findMenuItemById(menu, "channel-context-mute-channel");
  const submenuCls = hash ? `submenu_${hash}` : null;
  let closeTimer = null;
  const cancelClose = () => {
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer = setTimeout(closeProfileSubmenu, 180);
  };
  const profileParent = buildMenuItem(menu, anchor, focusCls, {
    id: `${MENU_ITEM_ID}-profile`,
    label: "Add to Profile",
    caretSource: muteItem,
    onEnter: () => {
      cancelClose();
      openProfileSubmenu(menu, profileParent, anchor, focusCls, submenuCls, channel.id);
      // keep the flyout alive while the pointer is over it
      const sub = document.getElementById(SUBMENU_ID);
      if (sub) {
        sub.addEventListener("mouseenter", cancelClose);
        sub.addEventListener("mouseleave", scheduleClose);
      }
    },
    onLeave: scheduleClose,
  });

  // insert all three right after the anchor (Copy Link)
  anchor.parentElement.insertBefore(sharedItem, anchor.nextSibling);
  sharedItem.parentElement.insertBefore(individualItem, sharedItem.nextSibling);
  individualItem.parentElement.insertBefore(profileParent, individualItem.nextSibling);
}

// close any open Discord context menu. Discord dismisses on an outside
// pointerdown/mousedown -- those alone do it. We deliberately avoid firing a
// synthetic `click`, which makes Discord's router log "Unable to determine
// render window".
function closeAllMenus() {
  closeProfileSubmenu(); // our "Add to Profile" flyout
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
// profile management (settings panel): create, rename (click a name), delete.
// Channels are added to profiles via Discord's channel right-click menu and
// removed via the × on a pane inside an open profile feed -- NOT here.
// ---------------------------------------------------------------------------
// ONE persistent <span contenteditable> instead of swapping between a
// <span> (view) and an <input> (edit) -- swapping element types was causing
// a visible text shift on edit that survived every attempt to match box
// models exactly (proved via computed-style diffs: identical CSS on both,
// shift persisted anyway -- almost certainly <input>'s own internal text
// rendering, not something reachable via CSS). A single node that's always
// the same element, just toggling `contentEditable`, can't misalign by
// construction since nothing is ever swapped.
//
// contenteditable has no `value` prop -- content lives in the DOM directly.
// We set el.textContent imperatively when edit mode opens (not through
// Solid's reactive {props.name} binding while editable, which would fight
// the user's live typing) and read it back via el.textContent on commit.
function ProfileRow(props) {
  const editing = () => props.editingName() === props.name;
  let nameRef;

  function startEdit() {
    props.setEditingName(props.name);
  }

  function commit() {
    const next = (nameRef?.textContent ?? "").trim();
    if (next) renameAnyProfile(props.name, next);
    props.setEditingName(null);
  }

  function cancel() {
    if (nameRef) nameRef.textContent = props.name;
    props.setEditingName(null);
  }

  function onKeyDown(e) {
    if (!editing()) return;
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  }

  // contenteditable has no native maxlength -- truncate live so the input
  // never LOOKS like it accepts more than it actually will on commit
  // (renameAnyProfile/createProfile already enforce this server-side too).
  function onInput(e) {
    const text = e.currentTarget.textContent ?? "";
    if (text.length > PROFILE_NAME_MAX_LENGTH) {
      e.currentTarget.textContent = text.slice(0, PROFILE_NAME_MAX_LENGTH);
      // put the caret back at the end after truncating
      const range = document.createRange();
      range.selectNodeContents(e.currentTarget);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  createEffect(() => {
    if (!nameRef) return;
    if (editing()) {
      nameRef.textContent = props.name;
      nameRef.focus();
      // select all existing text so typing replaces it outright
      const range = document.createRange();
      range.selectNodeContents(nameRef);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);

      const onDocClick = (e) => {
        if (!nameRef.contains(e.target)) commit();
      };
      // defer so the click that OPENED editing doesn't immediately close it
      const id = setTimeout(() => document.addEventListener("click", onDocClick), 0);
      onCleanup(() => {
        clearTimeout(id);
        document.removeEventListener("click", onDocClick);
      });
    } else {
      nameRef.textContent = props.name;
    }
  });

  return (
    <div class="mc-profile-row">
      <span
        class="mc-profile-name"
        classList={{ "mc-profile-name-editing": editing() }}
        ref={nameRef}
        contentEditable={editing()}
        on:click={() => !editing() && startEdit()}
        on:keydown={onKeyDown}
        on:input={onInput}
      >
        {props.name}
      </span>
      <Show when={!editing()}>
        <span
          class="mc-profile-delete"
          on:click={() => removeProfile(props.name)}
          title="Delete profile"
        >
          ×
        </span>
      </Show>
    </div>
  );
}

function ProfileSettings() {
  const [newName, setNewName] = createSignal("");
  const [editingName, setEditingName] = createSignal(null);

  function handleCreate() {
    if (addProfile(newName())) setNewName("");
  }

  return (
    <div class="mc-profile-settings">
      <Show when={profiles().length}>
        <div class="mc-profile-list">
          <For each={profiles()}>
            {(name) => (
              <ProfileRow
                name={name}
                editingName={editingName}
                setEditingName={setEditingName}
              />
            )}
          </For>
        </div>
      </Show>

      <div class="mc-profile-add">
        <TextBox
          value={newName()}
          onInput={setNewName}
          placeholder="New profile"
          aria-label="New profile"
          maxlength={PROFILE_NAME_MAX_LENGTH}
        />
        <Button
          size={ButtonSizes.SMALL}
          disabled={!newName().trim()}
          onClick={handleCreate}
        >
          Create
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// settings panel (rendered by Shelter in the plugin's settings view)
// ---------------------------------------------------------------------------
export function settings() {
  return (
    <div class="mc-settings">
      <SwitchItem
        value={store.hideTitle}
        onChange={(v) => (store.hideTitle = v)}
        note={
          <>
            Hide the “discordfeed” title bar at the top of pop-out windows.
            <div class="mc-hide-title-warning">
              Note: the title bar is the only place a profile feed shows which
              profile it is — hide it and open profiles become hard to tell
              apart.
            </div>
          </>
        }
      >
        Hide title header
      </SwitchItem>
      <SwitchItem
        value={store.showComposer}
        onChange={(v) => (store.showComposer = v)}
        note="Show an always-visible message box under every pane, not just when replying."
      >
        Show message composer
      </SwitchItem>
      <Header tag={HeaderTags.HeadingXL} class="mc-profile-header">
        Profiles
      </Header>
      <ProfileSettings />
    </div>
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
    // data-jump-section="global" (Inbox's stable, locale-independent
    // attribute) instead of its translated aria-label -- see findInbox().
    const unobsInbox = observeDom('[data-jump-section="global"]', injectAll);
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
