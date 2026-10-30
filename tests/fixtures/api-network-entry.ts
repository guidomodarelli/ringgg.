import { api } from '../../src/lib/api';

/** Each button sends one request and shows the message the resident would read when it fails. */
function showFailure(buttonSelector: string, request: () => Promise<unknown>) {
  document.querySelector<HTMLButtonElement>(buttonSelector)!.addEventListener('click', () => {
    void request().catch((error: unknown) => { document.querySelector('#result')!.textContent = error instanceof Error ? error.message : String(error); });
  });
}

showFailure('#read', () => api('read'));
showFailure('#write', () => api('write', {}));
showFailure('#server-error', () => api('server-error'));
