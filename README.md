# shelter-plugins

[shelter](https://shelter.uwu.network/) plugins built for [Dorion](https://github.com/SpikeHD/Dorion).

- **[DiscordFeed](#discordfeed)** — pop out guild channels into separate windows with near-1:1 Discord rendering; watch several chats at once, group them into saved profiles, and reply inline.
- **[No Taskbar Flash](#no-taskbar-flash)** — stops Dorion's taskbar flash / unread badge / tray icon on new notifications.

## Install

Add either plugin's URL in shelter's plugin settings:

```
https://reizzof.github.io/shelter-plugins/discordfeed
https://reizzof.github.io/shelter-plugins/mutedflashfix
```

---

# DiscordFeed

Pops out guild channels into separate windows with near‑1:1 Discord rendering — so you can keep an eye on several chats at once without switching channels. You can also **reply inline** and **react** without leaving the feed.

> **Built for Dorion.** It uses `window.open` to spawn real OS windows and relies on Dorion's webview behaviour. On vanilla shelter / other clients the pop‑out and some tuning (fonts, DPI) may differ.

## Three kinds of feed

- **Shared Feed** — one window with **multiple panes side‑by‑side**. Open it from the **toolbar button** (next to the Inbox icon). Add channels by right‑clicking a channel in Discord → **Add to Shared Feed**; **drag pane headers to reorder**. This list is **transient** — it lives in memory and resets when you restart Discord.
- **Individual Feed** — a standalone window for **one channel**. Right‑click a channel → **Open Individual Feed**. Open as many as you like (one per channel you want to watch) — each is its own window.
- **Profile Feed** — a **saved, named** set of channels. Build profiles in settings, add channels to them from a channel's right‑click menu → **Add to Profile ▸**, then open one from the toolbar button's **right‑click menu**. Unlike the Shared Feed, profiles **persist across restarts**.

All three reuse the same renderer, so they look identical.

## Profiles

Profiles are named channel lists that survive restarts (the Shared Feed doesn't).

- **Create / rename / delete** in the plugin settings. Click a profile's name to rename it inline; the **×** deletes it. Names are capped at 20 characters.
- **Add or remove channels** from Discord's channel right‑click menu → **Add to Profile ▸**, which opens a submenu of your profiles with a ✓ next to the ones the channel is already in. Clicking toggles membership.
- **Open a profile** by **right‑clicking the toolbar button** and picking it from the list (left‑click still opens the transient Shared Feed). You can open several profile windows at once.
- Removing a channel via a profile pane's **×** removes it from the saved profile permanently. Any open window for that profile updates live.

## Replying & reacting

The feeds are no longer display‑only — you can respond in place:

- **Reply** — right‑click a message → **Reply**, type in the composer that appears at the bottom of the pane, and press **Enter** to send (Shift+Enter for a newline, Esc to cancel). This posts a real reply to the channel.
- **Always‑on composer** — enable **Show message composer** in settings to keep a send box under every pane, so you can post without replying to anything specific.
- **React** — click an existing reaction pill to add/remove your own reaction. It updates instantly and rolls back if the request fails. (This toggles existing reactions; it doesn't open an emoji picker to add brand‑new ones.)

## How it works

- **Passive, no polling.** The plugin subscribes to Discord's gateway dispatches (`MESSAGE_CREATE` / `MESSAGE_UPDATE` / reaction add+remove) and fans them out to the panes watching that channel. Nothing is fetched on a timer — a channel is seeded once from Discord's in‑memory store (or a single REST call if it isn't cached), then kept live by the gateway.
- **Theme‑aware.** Colors follow Discord's active theme — including custom/very dark themes (e.g. Onyx) — by reading Discord's CSS variables, with fallbacks for older builds.
- **Follows your Discord settings.** Timestamps use your Discord locale's 12h/24h format, and font size + message‑group spacing mirror your Appearance settings (read when a window opens — reopen it to apply changes).
- The pop‑out windows are children of Discord's process, so the **main window keeps the subscriptions alive** — live updates flow into every open feed.

## Rendering (near‑1:1 with Discord)

gg sans font + live theme, message **grouping**, **replies** (with jump‑to‑message), **mentions** + mention highlight, **role colors** and server **nicknames**, **embeds**, **stickers**, **reactions** (live), **GIFs/videos** (autoplay + playable), **animated custom emoji**, **masked links**, **spoilers**, **code blocks**, **file attachments**, jumbo emoji, `-#` subtext / headers / quotes.

Plus: per‑pane **autoscroll** with a **"jump to present"** button, an image **lightbox**, a **right‑click menu** (Reply / Go to Message / Copy Text / Copy ID, plus image actions on images), and **feed‑first** message jumps — clicking a Discord message link scrolls to it in the feed if it's loaded, otherwise opens it in the main Discord window.

## Settings

Open the plugin's settings in shelter:

- **Hide title header** — hides the "discordfeed" bar at the top of pop‑out windows. Note: that bar is the only label a **profile** window carries, so hiding it makes multiple open profiles hard to tell apart.
- **Show message composer** — keeps an always‑visible message box under every pane, not just when replying.
- **Profiles** — create, rename, and delete your saved channel profiles (see [Profiles](#profiles) above).

---

# No Taskbar Flash

Stops Dorion's taskbar flash, unread badge, and tray icon indicator for new notifications.

> **Built for Dorion.** Dorion's own "Dorion Helpers" plugin flashes the taskbar whenever Discord's total mention count changes, regardless of mute state — it doesn't check whether the channel/guild/DM is muted. This disables that behavior entirely (not just for muted sources — there's no way to make it selective without patching Dorion's Rust source, since the invoke bridge it uses is frozen against interception from plugin JS).

## License

MIT
