import { createClient, type ClientOptions, type BreakwaterClient, type KeyValueStorage } from "@breakwater/core";

/** The slice of React Native's AppState this preset needs (keeps the package free of a hard RN import). */
export interface AppStateLike {
  addEventListener(type: "change", cb: (state: string) => void): { remove(): void };
}

/**
 * React Native / Expo preset. Hermes supports Proxy, so tracking works unchanged.
 *
 *   import { AppState } from "react-native";
 *   import AsyncStorage from "@react-native-async-storage/async-storage";
 *   import * as Application from "expo-application";
 *
 *   export const bw = await initBreakwater({
 *     endpoint: "https://bw.example.com",
 *     app: { version: Application.nativeApplicationVersion!, build: Application.nativeBuildVersion!, platform: Platform.OS },
 *     appState: AppState,
 *     storage: AsyncStorage,
 *     filter: (url) => url.startsWith("https://api.example.com"),
 *   });
 *   const order = await (await bw.fetch(`https://api.example.com/orders/${id}`)).json();
 */
export function initBreakwater(
  opts: Omit<ClientOptions, "onBackground" | "storage"> & { appState: AppStateLike; storage: KeyValueStorage },
): Promise<BreakwaterClient> {
  const { appState, ...rest } = opts;
  return createClient({
    ...rest,
    onBackground: (flush) => {
      const sub = appState.addEventListener("change", (s) => { if (s === "background" || s === "inactive") flush(); });
      return () => sub.remove();
    },
  });
}
export * from "@breakwater/core";
