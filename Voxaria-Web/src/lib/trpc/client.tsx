import { createTRPCReact, httpBatchLink } from '@trpc/react-query';
import type { AppRouter } from '@voxaria/contracts';
import { BASE_URL } from '../voxaria-api';

export const trpc = createTRPCReact<AppRouter>();

export function createTRPCClient() {
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: `${BASE_URL}/api/trpc`,
        headers() {
          const headers: Record<string, string> = {
            'ngrok-skip-browser-warning': 'true',
            'x-api-key': 'owner',
          };
          const userId = localStorage.getItem('voxaria_user_id');
          const guildId = localStorage.getItem('voxaria_guild_id');
          const sessionToken = localStorage.getItem('voxaria_session_token');
          if (userId) headers['x-user-id'] = userId;
          if (guildId) headers['x-guild-id'] = guildId;
          if (sessionToken) headers['Authorization'] = `Bearer ${sessionToken}`;
          return headers;
        },
      }),
    ],
  });
}