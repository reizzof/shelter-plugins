# DiscordFeed

A [shelter](https://shelter.uwu.network/) plugin (built for [Dorion](https://github.com/SpikeHD/Dorion)) that opens a separate pop-out window monitoring multiple guild channels at once, side-by-side, in read-only panes — with near-1:1 Discord rendering.

> **Built for Dorion.** It relies on `window.open` to spawn a real OS window and on Dorion's webview behaviour. On vanilla shelter / other clients the pop-out and some tuning (fonts, DPI) may differ.

## Features

- **Toolbar button** (next to the Inbox icon) opens the pop-out feed.
- Monitor **multiple guild channels** side-by-side; **drag to reorder** panes.
- **Add channels** by right-clicking a channel in Discord → **Add to Feed**.
- Near-1:1 Discord rendering: gg sans font + theme, **embeds**, **GIFs/videos** (autoplay + playable), **reactions** (live), **masked links**, custom/jumbo **emoji**, **spoilers**, **replies**, message **grouping**, **role colors**, server **nicknames**, **mentions** + mention highlight, **code blocks**, **file attachments**, `-#` subtext / headers / quotes.
- Live updates (passive — no polling), per-pane **autoscroll** + "jump to present", **lightbox**, **right-click menu** (Copy Text/ID, Go to Message), **feed-first** message jump with Discord fallback.

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

## License

MIT
