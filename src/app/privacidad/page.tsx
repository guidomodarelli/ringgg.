import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Brand } from '@/components/brand';
import { CHAT } from '@/constants/chat';
import { DOORBELL } from '@/constants/doorbell';
import { PRIVACY_POLICY } from '@/constants/legal';
import { NEARBY_RINGING } from '@/constants/location';
import { TIME } from '@/constants/time';

export const metadata: Metadata = {
  title: 'Política de privacidad · ringgg.',
  description: 'Qué datos guarda Ringgg, para qué los usa, con quién los comparte y cómo borrarlos.',
  // Public on purpose: the OAuth consent screen and anyone deciding whether to use Ringgg read it.
  robots: { index: true, follow: true },
};

/** Public and static: it needs no session and reads no data, so the proxy and the database stay out of it. */
export default function PrivacyPolicyPage() {
  const contact = process.env[PRIVACY_POLICY.contactEnvironmentVariable]?.trim();
  return <main className="legal-page">
    <Link className="text-button legal-back" href="/"><ArrowLeft size={16} /> Volver a Ringgg</Link>
    <Brand />
    <h1>Política de privacidad<span>.</span></h1>
    <p className="legal-updated">Última actualización: {PRIVACY_POLICY.updatedAt}</p>
    <p>Ringgg es un timbre digital: un QR en la puerta que avisa en los celulares de quienes viven en la casa. Esta página explica qué datos guarda para funcionar, para qué los usa y cómo podés borrarlos.</p>

    <h2>Qué datos guardamos</h2>
    <ul>
      <li><strong>Tu cuenta:</strong> tu correo, tu nombre y si verificaste el correo. Si ingresás con Google, recibimos solo esos tres datos; no accedemos a tus contactos, archivos, calendario ni a ningún otro dato de tu cuenta de Google.</li>
      <li><strong>Tus casas:</strong> el nombre de cada casa, los correos autorizados como residentes, el nombre con el que te ven en cada casa, su QR y su configuración (pausa, horario de descanso y, si la cargan, la ubicación de la puerta).</li>
      <li><strong>Tus dispositivos:</strong> el nombre que le pusiste a cada uno, de quién es, la suscripción de notificaciones que da el navegador (una dirección del servicio de avisos y sus claves de cifrado), cuándo recibió el último aviso y qué respondió el servicio de avisos a cada aviso de una visita. Si el servicio da de baja una suscripción, borramos el dispositivo y la casa conserva su nombre, de quién era y la fecha durante {DOORBELL.retentionDays} días, para avisarles que dejó de recibir avisos.</li>
      <li><strong>Las visitas:</strong> el momento del timbrazo, cuánto tardó en salir el aviso, el mensaje que la visita quiera dejar (es opcional), la respuesta elegida, quién respondió y la nota que la visita deje si nadie atiende. Cuando el chat está disponible, también los mensajes que la visita y los residentes se escriban durante los {CHAT.windowSeconds / TIME.minuteSeconds} minutos siguientes al timbrazo. Se borran solas a los {DOORBELL.retentionDays} días.</li>
      <li><strong>Los timbrazos que no sonaron:</strong> por día, cuántos se rechazaron y por qué (por ejemplo, desde lejos de la puerta o con el timbre en pausa), sin ningún dato de quién tocó.</li>
      <li><strong>Las visitas no necesitan cuenta.</strong> Para evitar abusos guardamos una huella cifrada de su dirección de red, nunca la dirección, y vence a los pocos minutos.</li>
    </ul>

    <h2>Para qué los usamos</h2>
    <p>Solo para que el timbre funcione: avisarte cuando alguien toca, mostrarte el historial, dejar que respondas y administrar quién tiene acceso a cada casa. No hay publicidad, no vendemos datos, no armamos perfiles y no usamos herramientas de analítica ni de seguimiento.</p>

    <h2>Con quién se comparten</h2>
    <ul>
      <li><strong>Vercel</strong> aloja la aplicación y <strong>Neon</strong> guarda la base de datos y las cuentas.</li>
      <li><strong>Apple, Google y Mozilla</strong> entregan las notificaciones según el celular o el navegador. El contenido del aviso (el nombre de la casa y el mensaje de la visita) viaja cifrado: el servicio de avisos no puede leerlo.</li>
      <li><strong>Cloudflare</strong> transmite y guarda los mensajes del chat de cada visita, cuando el chat está disponible.</li>
      <li><strong>Google</strong>, solo si elegís ingresar con tu cuenta de Google.</li>
    </ul>
    <p>Las visitas nunca ven quién respondió ni datos de los residentes: solo la respuesta. En el chat, los mensajes de los residentes le llegan a la visita con el nombre de la casa.</p>

    <h2>Ubicación</h2>
    <p>Solo se usa si una casa activa «Tocar solo desde la puerta». En ese caso guardamos la ubicación de la puerta que registró un residente, y al tocar el timbre le pedimos su ubicación a la visita: la comparamos con la de la puerta para confirmar que está a menos de {NEARBY_RINGING.radiusMeters} metros y la descartamos. No guardamos dónde estaba la visita ni se la mostramos a los residentes.</p>

    <h2>Cookies y almacenamiento en tu navegador</h2>
    <p>Usamos una cookie de sesión para mantenerte adentro y otra que recuerda la última casa que abriste. Si elegís seguir sin avisos en un dispositivo, el navegador lo recuerda localmente. No hay cookies de terceros ni de seguimiento.</p>
    <p>Si tocás un timbre, tu celular guarda la referencia de ese timbrazo (no tu mensaje ni tu ubicación) para mostrarte la respuesta aunque recargues la página o vuelvas a escanear el QR. Deja de usarse a los {DOORBELL.noteWindowSeconds / TIME.minuteSeconds} minutos: se borra en ese momento si tenés la página abierta y, si no, la próxima vez que abras un timbre de Ringgg en ese navegador. También se borra si tocás «Volver a tocar» o si borrás los datos del sitio en tu navegador.</p>

    <h2>Cuánto tiempo los guardamos</h2>
    <p>Las visitas, sus mensajes, sus notas, su chat y el resultado de sus avisos se borran a los {DOORBELL.retentionDays} días, igual que los conteos de timbrazos rechazados y el rastro de los dispositivos dados de baja. Tu cuenta, tus casas y tus dispositivos se guardan mientras uses Ringgg. Cuando alguien deja de ser residente de una casa, pierde el acceso y sus celulares dejan de recibir avisos de esa casa; al eliminar una casa se borran su historial, su QR y los registros de sus celulares.</p>

    <h2>Cómo controlar o borrar tus datos</h2>
    <p>Desde el panel podés cambiar tu nombre y el de tus dispositivos, desconectar un dispositivo, quitar residentes, salir de una casa y eliminar una casa de la que seas el único residente.</p>
    {contact
      ? <p>Para borrar tu cuenta, pedir una copia de tus datos o hacer cualquier consulta, escribí a <a href={`mailto:${contact}`}>{contact}</a>.</p>
      : <p>Para borrar tu cuenta o pedir una copia de tus datos, pedíselo a quien administra Ringgg en tu casa.</p>}

    <h2>Cambios</h2>
    <p>Si esta política cambia, actualizamos esta página y su fecha de actualización.</p>
  </main>;
}
