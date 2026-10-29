import { Login } from '@/components/login';
import { authConfigured } from '@/server/neon-auth';
import { isSelfManagedAuth } from '@/server/auth-mode';
import { GoogleLogin } from '@/components/google-login';
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  if (isSelfManagedAuth()) return <GoogleLogin configured={authConfigured()} clientId={process.env.GOOGLE_CLIENT_ID || ''} initialMessage="Para recuperar el acceso, ingresá con tu cuenta de Google." />;
  return <Login configured={authConfigured()} resetToken={token || ''} initialMessage={token ? '' : 'El enlace no es válido. Pedí uno nuevo desde Olvidé mi contraseña.'} />;
}
