import type { ReactNode } from 'react';
import Link from 'next/link';
import { Brand } from './brand';
import { PRIVACY_POLICY } from '@/constants/legal';

/** Brand, welcome message and footer around the access card (`children`) of the sign-in screens. */
export function LoginShell({ children }: { children: ReactNode }) {
  return <main className="login-page"><Brand /><div className="login-layout"><section><span className="eyebrow">TU CASA, A UN TOQUE</span><h1>El timbre.<br />Ahora, con vos.</h1><p>Alguien llega. Tu celular te avisa.<br />Así de simple.</p><div className="bell-orbit"><div className="bell-shape"><span /><i /></div><span className="orbit-spark">✳</span></div></section>
    {children}</div><footer>Sin cables. Sin instalaciones. Más cerca. <Link href={PRIVACY_POLICY.path}>Política de privacidad</Link></footer></main>;
}
