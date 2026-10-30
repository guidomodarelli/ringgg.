/** Panel navigations (a router push, replace or refresh) whose next page has not rendered yet. */
let navigationsInFlight = 0;

/** How many navigations are still loading; reloading the page now would cut them off. */
export function pendingNavigations() {
  return navigationsInFlight;
}

/** Counts one navigation until the returned function is called; calling it again changes nothing. */
export function holdNavigation() {
  navigationsInFlight += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    navigationsInFlight -= 1;
  };
}
