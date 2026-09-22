import { create } from 'zustand';
import { api, ApiError, getErrorMessage } from '@/lib/api';
import { User } from '@/types';

interface AuthState {
  user: User | null;
  loading: boolean;
  error: string | null;
  initialize: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, inviteCode?: string) => Promise<void>;
  signOut: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: true,
  error: null,
  initialize: async () => {
    try {
      const user = await api.me();
      set({ user, loading: false, error: null });
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) {
        console.error('Auth initialization error:', error);
      }
      set({ user: null, loading: false, error: null });
    }
  },
  login: async (email, password) => {
    set({ loading: true, error: null });
    try {
      const user = await api.login(email, password);
      set({ user, loading: false });
    } catch (error: unknown) {
      set({ loading: false, error: getErrorMessage(error, '登录失败') });
      throw error;
    }
  },
  register: async (email, password, inviteCode) => {
    set({ loading: true, error: null });
    try {
      const user = await api.register(email, password, inviteCode);
      set({ user, loading: false });
    } catch (error: unknown) {
      set({ loading: false, error: getErrorMessage(error, '注册失败') });
      throw error;
    }
  },
  signOut: async () => {
    await api.logout();
    set({ user: null, error: null });
  },
}));
