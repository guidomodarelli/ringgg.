import { createRoot } from 'react-dom/client';
import { PosterView } from '../../src/components/poster-view';
import { posterQrSvg } from '../../src/lib/poster-qr';

const homeName = new URLSearchParams(location.search).get('name') ?? 'Casa del patio';
const url = `${location.origin}/t/poster-fixture-token`;
// The view the poster page renders on the server, with its real print button, QR and styles.
void posterQrSvg(url).then((qrSvg) => { createRoot(document.getElementById('root')!).render(<PosterView homeId={1} homeName={homeName} url={url} qrSvg={qrSvg} />); });
