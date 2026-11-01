import React, { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink } from '@trpc/client';
import { createTRPCReact } from '@trpc/react-query';
import type { AppRouter } from '@/contracts';
import { BASE_URL } from './api/auth-client';
import { getAccessToken } from './auth';

/**
 * Type-safe tRPC React hooks connected to MusicBot AppRouter.
 */
export const trpc = createTRPCReact<AppRouter>();

export const sharedQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5000,
      refetchOnWindowFocus: false,
    },
  },
});

export function TRPCProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => sharedQueryClient);

  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: `${BASE_URL}/api/trpc`,
          headers() {
            const token = getAccessToken();
            const guildId =
              typeof localStorage !== 'undefined'
                ? localStorage.getItem('active_guild_id') || 'owner'
                : 'owner';
            const userId =
              typeof localStorage !== 'undefined'
                ? localStorage.getItem('active_user_id') || 'owner'
                : 'owner';

            return {
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
              'x-guild-id': guildId,
              'x-user-id': userId,
              'ngrok-skip-browser-warning': 'true',
            };
          },
        }),
      ],
    })
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </trpc.Provider>
  );
}
