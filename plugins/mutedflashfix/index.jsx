// Dorion's "Dorion Helpers" plugin flashes the taskbar off Discord's total
// mention count changing, regardless of mute state. Since core.invoke is
// frozen (can't intercept it), we instead re-clear notification_count right
// after -- queueMicrotask lets Dorion's own listener run first each time.
const {
  flux: { stores: { GuildReadStateStore, RelationshipStore } },
} = shelter;

function clearNotificationState() {
  try {
    window.__TAURI__.core.invoke("notification_count", { amount: 0 });
  } catch {}
}

function onStoreChange() {
  queueMicrotask(clearNotificationState);
}

GuildReadStateStore.addChangeListener(onStoreChange);
RelationshipStore.addChangeListener(onStoreChange);
clearNotificationState();

export const onUnload = () => {
  GuildReadStateStore.removeChangeListener(onStoreChange);
  RelationshipStore.removeChangeListener(onStoreChange);
};
