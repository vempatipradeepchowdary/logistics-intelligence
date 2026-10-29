import { useState } from 'react';
import { RouterProvider } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AppProvider } from '../context/AppContext.jsx';
import { createRouter } from './router.jsx';

export function App() {
  const [router] = useState(createRouter);
  return (
    <AppProvider>
      <RouterProvider router={router} />
      <Toaster position="bottom-right" richColors closeButton toastOptions={{ style: { fontSize: 13 } }} />
    </AppProvider>
  );
}
