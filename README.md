# DiscordFeed

A [shelter](https://shelter.uwu.network/) plugin (built for [Dorion](https://github.com/SpikeHD/Dorion)) that pops out guild channels into separate, read-only windows with near‑1:1 Discord rendering — so you can keep an eye on several chats at once without switching channels.

> **Built for Dorion.** It uses `window.open` to spawn real OS windows and relies on Dorion's webview behaviour. On vanilla shelter / other clients the pop‑out and some tuning (fonts, DPI) may differ.

## Two kinds of feed

- **Shared Feed** — one window with **multiple panes side‑by‑side**. Open it from the **toolbar button** (next to the Inbox icon). Add channels by right‑clicking a channel in Discord → **Add to Shared Feed**; **drag pane headers to reorder**. The pane list is persisted.
- **Individual Feed** — a standalone window for **one channel**. Right‑click a channel → **Open Individual Feed**. Open as many as you like (one per channel you want to watch) — each is its own window.

Both reuse the same renderer, so they look identical; the Individual Feed is just locked to a single channel.

## How it works

- **Passive, no polling.** The plugin subscribes to Discord's gateway dispatches (`MESSAGE_CREATE` / `MESSAGE_UPDATE` / reaction add+remove) and fans them out to the panes watching that channel. Nothing is fetched on a timer — a channel is seeded once from Discord's in‑memory store (or a single REST call if it isn't cached), then kept live by the gateway.
- **Theme‑aware.** Colors follow Discord's active theme — including custom/very dark themes (e.g. Onyx) — by reading Discord's CSS variables, with fallbacks for older builds.
- **Follows your Discord settings.** Time stamps use your Discord locale's 12h/24h format.
- The pop‑out windows are children of Discord's process, so the **main window keeps the subscriptions alive** — live updates flow into every open feed.

## Rendering (near‑1:1 with Discord)

gg sans font + live theme, message **grouping**, **replies** (with jump‑to‑message), **mentions** + mention highlight, **role colors** and server **nicknames**, **embeds**, **stickers**, **reactions** (live), **GIFs/videos** (autoplay + playable), **animated custom emoji**, **masked links**, **spoilers**, **code blocks**, **file attachments**, jumbo emoji, `-#` subtext / headers / quotes.

Plus: per‑pane **autoscroll** with a **"jump to present"** button, an image **lightbox**, a **right‑click menu** (Copy Text / Copy ID / Go to Message), and **feed‑first** message jumps — clicking a Discord message link scrolls to it in the feed if it's loaded, otherwise opens it in the main Discord window.

> Read‑only by design: the feeds never send messages or perform actions on your account — they only display.

## Settings

Open the plugin's settings in shelter:

- **Hide title header** — hides the "discordfeed" bar at the top of pop‑out windows.

## Install

Add this URL as a plugin in shelter's plugin settings:

```
https://reizzof.github.io/shelter-plugins/discordfeed
```

*(replace `reizzof` with your GitHub username if you forked it)*

## Development

```sh
npm i
npm run dev        # serves the dev build; shelter auto-tethers in Lune dev mode
```

Build the production bundle:

```sh
npm run build      # lune ci -> dist/discordfeed/
```

### Source layout

| File | Responsibility |
| --- | --- |
| `index.jsx` | entry: CSS injection, gateway subscriptions, toolbar + channel‑menu injection, settings, lifecycle |
| `components.jsx` | Solid components (panes, messages, popout) + shared reactive state (channel list, popups, routing) |
| `helpers.jsx` | pure logic: store resolvers, the markup tokenizer, message normalization |
| `css.js` | the injected stylesheet |
| `shelter.js` | central access to the `shelter` API and Flux stores |

## License

MIT
