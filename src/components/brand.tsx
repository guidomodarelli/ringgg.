import Link from 'next/link';
import { BellRing } from 'lucide-react';
export function BrandContents() {
  return <><span className="brand-icon"><BellRing size={23} strokeWidth={2.2} /></span>ringgg<span className="brand-period">.</span></>;
}
export function Brand() {
  return <Link className="brand" href="/" aria-label="Ringgg, inicio"><BrandContents /></Link>;
}
