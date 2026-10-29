import { Login } from '@/components/login';
import { authConfigured } from '@/server/neon-auth';
import { isSelfManagedAuth } from '@/server/auth-mode';
import { GoogleLogin } from '@/components/google-login';

export const dynamic = 'force-dynamic';
export default function SignInPage() { return isSelfManagedAuth() ? <GoogleLogin configured={authConfigured()} clientId={process.env.GOOGLE_CLIENT_ID || ''} /> : <Login configured={authConfigured()} />; }
