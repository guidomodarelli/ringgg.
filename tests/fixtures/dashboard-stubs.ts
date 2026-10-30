export const authClient = { signOut: async () => ({ error: null }) };

/** Router calls in order (`push /?home=2`, `refresh`...), so a spec can assert where the panel navigated. */
const routerCalls: string[] = [];
(window as unknown as { __routerCalls: string[] }).__routerCalls = routerCalls;

/** Next's App Router instance is the same object on every render; so is this stand-in. */
const router = {
  refresh() { routerCalls.push('refresh'); },
  push(url: string) { routerCalls.push(`push ${url}`); },
  replace(url: string) { routerCalls.push(`replace ${url}`); },
};

export function useRouter() { return router; }
