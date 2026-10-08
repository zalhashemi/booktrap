import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { AppShell } from './components/AppShell';
import { DeviceProvider } from './device/DeviceProvider';
import { AddPage } from './routes/AddPage';
import { NotFoundPage } from './routes/NotFoundPage';
import { SettingsPage } from './routes/SettingsPage';
import { ShelfPage } from './routes/ShelfPage';
import './styles/index.css';

const queryClient = new QueryClient();

const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { index: true, element: <AddPage /> },
      { path: 'shelf', element: <ShelfPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <DeviceProvider>
        <RouterProvider router={router} />
      </DeviceProvider>
    </QueryClientProvider>
  </StrictMode>,
);
