import { api } from '../../src/lib/api';

document.querySelector<HTMLButtonElement>('#read')!.onclick = () => { void api('read').catch((error: Error) => { document.querySelector('#result')!.textContent = error.message; }); };
document.querySelector<HTMLButtonElement>('#write')!.onclick = () => { void api('write', {}).catch((error: Error) => { document.querySelector('#result')!.textContent = error.message; }); };
document.querySelector<HTMLButtonElement>('#server-error')!.onclick = () => { void api('server-error').catch((error: Error) => { document.querySelector('#result')!.textContent = error.message; }); };
