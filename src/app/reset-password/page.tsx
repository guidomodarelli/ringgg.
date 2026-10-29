import { Login } from '@/components/login';
import { authConfigured } from '@/server/neon-auth';
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return <Login configured={authConfigured()} resetToken={token || ''} initialMessage={token ? '' : 'El enlace no es válido. Pedí uno nuevo desde Olvidé mi contraseña.'} />;
}
