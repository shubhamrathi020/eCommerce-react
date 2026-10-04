import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { InjectorProvider, createInjector, provideShopServiceWorker, setRootInjector } from '@shop/core';
import { storefrontProviders } from './config';
import { createRouter } from './routes';
import './styles.css';

const injector = createInjector([storefrontProviders(), provideShopServiceWorker()]);
setRootInjector(injector);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <InjectorProvider injector={injector}>
      <RouterProvider router={createRouter()} />
    </InjectorProvider>
  </StrictMode>,
);
