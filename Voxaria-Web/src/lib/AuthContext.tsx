import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { AuthUser, loginWithDiscord, logout, validateSession, subscribeToAuth, isAuthenticated, getCurrentUser } from './auth';

type AuthContextType = {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (code: string, redirectUri: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<AuthUser | null>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = subscribeToAuth((newUser) => {
      setUser(newUser);
    });

    validateSession().then((validatedUser) => {
      setIsLoading(false);
    }).catch(() => {
      setIsLoading(false);
    });

    return unsubscribe;
  }, []);

  const login = useCallback(async (code: string, redirectUri: string) => {
    setIsLoading(true);
    try {
      const userData = await loginWithDiscord(code, redirectUri);
      setUser(userData);
      return userData;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleLogout = useCallback(async () => {
    setIsLoading(true);
    try {
      await logout();
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const refreshUser = useCallback(async () => {
    const validatedUser = await validateSession();
    setUser(validatedUser);
    return validatedUser;
  }, []);

  return (
    <AuthContext.Provider value={{
      user,
      isLoading,
      isAuthenticated: isAuthenticated(),
      login,
      logout: handleLogout,
      refreshUser
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}