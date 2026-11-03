import QRCode from 'qrcode';
import { POSTER_QR } from '@/constants/poster';

/** Vector QR: it stays sharp at any print size. */
const QR_OPTIONS = { type: 'svg', margin: POSTER_QR.margin, errorCorrectionLevel: POSTER_QR.errorCorrectionLevel, color: { dark: POSTER_QR.dark, light: POSTER_QR.light } } as const;

/** The poster's QR for the home's public link, as SVG markup. */
export function posterQrSvg(url: string) {
  return QRCode.toString(url, QR_OPTIONS);
}
