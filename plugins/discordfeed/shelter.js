// Central access point for everything we use off the global `shelter` object,
// plus the Flux stores we read. Other modules import from here so the
// destructure lives in one place.

export const {
  flux: { storesFlat },
  plugin: { store, scoped },
  ui: { ReactiveRoot, injectCss, SwitchItem, TextBox, Button, ButtonSizes, Header, HeaderTags },
  solidWeb: { render },
  util: { log, getFiber },
  observeDom,
  http,
} = shelter;

export const {
  MessageStore,
  ChannelStore,
  UserStore,
  GuildStore,
  GuildRoleStore,
  GuildMemberStore,
  LocaleStore,
  AccessibilityStore,
} = storesFlat;
