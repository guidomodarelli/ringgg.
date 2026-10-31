import { api, ApiError } from '../../src/lib/api';

/** Each button sends one request and shows the message the resident would read when it fails. */
function showFailure(buttonSelector: string, request: () => Promise<unknown>) {
  document.querySelector<HTMLButtonElement>(buttonSelector)!.addEventListener('click', () => {
    void request().catch((error: unknown) => { document.querySelector('#result')!.textContent = error instanceof Error ? error.message : String(error); });
  });
}

showFailure('#read', () => api('read'));
showFailure('#write', () => api('write', {}));
showFailure('#server-error', () => api('server-error'));

/** Shows what a caller can branch on: the status, `code` and `requestId` the server sent. */
document.querySelector<HTMLButtonElement>('#server-code')!.addEventListener('click', () => {
  void api('server-error').catch((error: unknown) => {
    document.querySelector('#result')!.textContent = error instanceof ApiError ? `${error.status} ${error.code ?? '-'} ${error.requestId ?? '-'}` : 'sin detalle';
  });
});
