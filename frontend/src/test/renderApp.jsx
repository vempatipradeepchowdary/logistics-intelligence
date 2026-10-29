import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { AppProvider } from '../context/AppContext.jsx';
import { routes } from '../app/router.jsx';

/** Render the real application routes at `path` (API module mocked by the calling test). */
export function renderApp(path = '/') {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const utils = render(
    <AppProvider>
      <RouterProvider router={router} />
    </AppProvider>,
  );
  return { ...utils, router };
}
