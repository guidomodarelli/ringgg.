import { Login } from '@/components/login';
import { authConfigured } from '@/server/neon-auth';

export const dynamic = 'force-dynamic';
export default function SignInPage() { return <Login configured={authConfigured()} />; }
