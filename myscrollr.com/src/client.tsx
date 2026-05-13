import { StrictMode } from 'react'
import { StartClient } from '@tanstack/react-start/client'
import { hydrateRoot } from 'react-dom/client'
import { LogtoProvider } from '@logto/react'
import type { LogtoConfig } from '@logto/react'
import { ScrollrAuthProvider } from '@/hooks/useScrollrAuth'

import '@/styles.css'

// Logto configuration — values come from VITE_ env vars (see .env.example)
const logtoResource =
  import.meta.env.VITE_LOGTO_RESOURCE || import.meta.env.VITE_API_URL || ''

const logtoConfig: LogtoConfig = {
  endpoint: import.meta.env.VITE_LOGTO_ENDPOINT || '',
  appId: import.meta.env.VITE_LOGTO_APP_ID || '',
  resources: [logtoResource],
}

hydrateRoot(
  document,
  <StrictMode>
    <LogtoProvider config={logtoConfig}>
      <ScrollrAuthProvider>
        <StartClient />
      </ScrollrAuthProvider>
    </LogtoProvider>
  </StrictMode>,
)
