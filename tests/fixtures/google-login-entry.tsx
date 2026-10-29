import { createRoot } from 'react-dom/client';
import { GoogleLogin } from '../../src/components/google-login';

createRoot(document.getElementById('root')!).render(<GoogleLogin clientId="" configured={false} />);
