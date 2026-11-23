// Web Push on this device: whether it can work here, turning it on and off, and the sign-out
// clean-up. The send side is server/supabase/functions/send-notifications.
import { deviceName } from "./settings.mjs";

/**
 * Where this browser stands. iPhone/iPad only offer push to an app added to the Home Screen
 * (iOS 16.4 or later), so Safari in a tab gets the "install first" hint.
 * @param {{ supported: boolean, ios: boolean, standalone: boolean, permission: string }} env
 * @returns {"ios-install" | "unsupported" | "blocked" | "available"}
 */
export function pushState({ supported, ios, standalone, permission }) {
  if (ios && !standalone) return "ios-install";
  if (!supported) return "unsupported";
  if (permission === "denied") return "blocked";
  return "available";
}

/** This browser's facts for pushState. Call only in the browser. */
export function browserPushEnv() {
  const ua = navigator.userAgent;
  return {
    supported: "serviceWorker" in navigator && "PushManager" in window && "Notification" in window,
    // iPadOS 13+ reports itself as a Mac; touch points tell them apart.
    ios: /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1),
    standalone:
      window.matchMedia("(display-mode: standalone)").matches ||
      /** @type {{ standalone?: boolean }} */ (navigator).standalone === true,
    permission: "Notification" in window ? Notification.permission : "default",
  };
}

/** A base64url VAPID key as the bytes pushManager.subscribe wants. @param {string} key */
export function vapidKeyBytes(key) {
  const b64 = (key + "=".repeat((4 - (key.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/** This browser's push subscription, if any. */
export async function currentSubscription() {
  const reg = await navigator.serviceWorker?.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/**
 * Is push on for this account on this device? A subscription left by another account in the
 * same browser doesn't count: RLS hides that row.
 * @param {import("@supabase/supabase-js").SupabaseClient} db
 */
export async function isSubscribedHere(db) {
  const sub = await currentSubscription();
  if (!sub) return false;
  const { data, error } = await db.from("push_subscriptions").select("id").eq("endpoint", sub.endpoint).maybeSingle();
  if (error) throw error;
  return !!data;
}

/**
 * Subscribes this device and saves it. Call after Notification.requestPermission() is granted.
 * @param {import("@supabase/supabase-js").SupabaseClient} db @param {string} vapidKey
 */
export async function subscribePush(db, vapidKey) {
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKeyBytes(vapidKey) }));
  const json = sub.toJSON();
  const { error } = await db.rpc("save_push_subscription", {
    p_endpoint: json.endpoint,
    p_p256dh: json.keys?.p256dh,
    p_auth: json.keys?.auth,
    p_label: deviceName(navigator.userAgent),
  });
  if (error) {
    await sub.unsubscribe().catch(() => {});
    throw error;
  }
}

/**
 * Stops push on this device: removes the saved row first, so a failure leaves nothing orphaned.
 * @param {import("@supabase/supabase-js").SupabaseClient} db
 */
export async function unsubscribePush(db) {
  const sub = await currentSubscription();
  if (!sub) return;
  const { error } = await db.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
  if (error) throw error;
  await sub.unsubscribe();
}

/**
 * Before sign-out on a possibly shared device: stop this account's push here and drop cached
 * files. Best effort; sign-out goes ahead either way.
 * @param {import("@supabase/supabase-js").SupabaseClient} db
 */
export async function clearDeviceOnSignOut(db) {
  await unsubscribePush(db).catch(() => {});
  if ("caches" in window) {
    const keys = await caches.keys().catch(() => /** @type {string[]} */ ([]));
    await Promise.all(keys.map((k) => caches.delete(k).catch(() => false)));
  }
}
