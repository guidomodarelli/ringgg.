'use client';
import { Printer } from 'lucide-react';

/** The browser print dialog also saves the poster as a PDF. */
export function PrintButton() {
  return <button type="button" className="button primary" onClick={() => window.print()}><Printer size={17} /> Imprimir o guardar PDF</button>;
}
