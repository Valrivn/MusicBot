import { initTRPC, TRPCError } from '@trpc/server';
import { AppRouter } from '@voxaria/contracts';
import { getUserRole } from '../api/server';

export interface TrpcContext {
  client: any;
  user?: {
    id: string;
    username: string;
    role: number;
  };
  guildId?: string;
}

export function createContext({
  req,
  client,
}: {
  req: any;
  client: any;
}): TrpcContext {
  const authHeader = req.headers.authorization;
  let user: TrpcContext['user'] = undefined;
  let guildId = req.headers['x-guild-id'] as string | undefined;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    const sessionStore = req.app.get('sessionStore');
    if (sessionStore) {
      const sessionUser = sessionStore.get(token);
      if (sessionUser) {
        user = {
          id: sessionUser.id,
          username: sessionUser.username,
          role: getUserRole(sessionUser.id),
        };
      }
    }
  }

  if (!user) {
    user = {
      id: req.headers['x-user-id'] as string || 'guest',
      username: req.headers['x-user-username'] as string || 'Guest',
      role: 0,
    };
  }

  return {
    client,
    user,
    guildId,
  };
}

const t = initTRPC.context<TrpcContext>().create();

export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.user || ctx.user.role === 0) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Authentication required',
    });
  }
  return next({ ctx });
});

export const staffProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.user || ctx.user.role < 2) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Staff permissions required',
    });
  }
  return next({ ctx });
});

export const ownerProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.user || ctx.user.role < 3) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Owner permissions required',
    });
  }
  return next({ ctx });
});

export const router = t.router;
export const middleware = t.middleware;