import { APP_UPDATES } from '@/constants/app-updates';

/** A click the browser itself handles elsewhere (a new tab or window, a download): the reload leaves it alone. */
function opensElsewhere(event: MouseEvent, link: HTMLAnchorElement | null) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return true;
  return link !== null && (link.hasAttribute('download') || (link.target !== '' && link.target !== '_self'));
}

/**
 * Reloads the page without losing what the resident taps while the new version loads. Until the
 * reload replaces the page, the current one stays on screen and still takes taps, but whatever they
 * did would vanish with it: a section switch would open the old section again, and an action could be
 * cut short. So a tap on a link of the app opens that address instead of the reload (the new version
 * opens right where the tap was going), and any other tap is held, never run on a page about to go.
 *
 * Returns a function that undoes the hold; it also undoes itself if the reload has not replaced the
 * page after `APP_UPDATES.reloadGiveUpMs` (the browser stopped it), and calls `onGiveUp`.
 */
export function reloadFollowingTaps(onGiveUp: () => void) {
  const followTap = (event: MouseEvent) => {
    const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
    const anchor = link instanceof HTMLAnchorElement ? link : null;
    if (opensElsewhere(event, anchor)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (anchor?.origin === window.location.origin) window.location.assign(anchor.href);
  };
  // Capture on the document runs before React's listener on its root, so the page's own handlers never see the tap.
  document.addEventListener('click', followTap, true);
  const stop = () => {
    window.clearTimeout(giveUp);
    document.removeEventListener('click', followTap, true);
  };
  const giveUp = window.setTimeout(() => { stop(); onGiveUp(); }, APP_UPDATES.reloadGiveUpMs);
  window.location.reload();
  return stop;
}
