import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

// If credentials are empty or placeholder, we run in LocalStorage Mock Mode
export const isSupabaseConfigured = Boolean(
  supabaseUrl && 
  supabaseAnonKey && 
  !supabaseUrl.includes('placeholder') && 
  !supabaseAnonKey.includes('placeholder')
);

// Real client instantiation (still created as fallback to prevent import crashes)
const realSupabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co', 
  supabaseAnonKey || 'placeholder'
);

// Mock implementation using LocalStorage
class MockSupabaseClient {
  private authCallbacks: Array<(event: string, session: any) => void> = [];
  
  constructor() {
    if (typeof window !== 'undefined') {
      // Listen to storage changes to keep session reactive
      window.addEventListener('storage', () => {
        this.triggerAuthStateChange();
      });
    }
  }

  private getSessionData() {
    if (typeof window === 'undefined') return null;
    const sessionStr = localStorage.getItem('stance_mock_session');
    return sessionStr ? JSON.parse(sessionStr) : null;
  }

  private saveSessionData(session: any) {
    if (typeof window === 'undefined') return;
    if (session) {
      localStorage.setItem('stance_mock_session', JSON.stringify(session));
    } else {
      localStorage.removeItem('stance_mock_session');
    }
    this.triggerAuthStateChange();
  }

  private triggerAuthStateChange() {
    const session = this.getSessionData();
    const event = session ? 'SIGNED_IN' : 'SIGNED_OUT';
    this.authCallbacks.forEach(cb => cb(event, session));
  }

  auth = {
    getSession: async () => {
      const session = this.getSessionData();
      return { data: { session }, error: null };
    },
    
    onAuthStateChange: (callback: (event: string, session: any) => void) => {
      this.authCallbacks.push(callback);
      // Immediately call once with current session
      const session = this.getSessionData();
      callback(session ? 'INITIAL_SESSION' : 'SIGNED_OUT', session);
      
      return {
        data: {
          subscription: {
            unsubscribe: () => {
              this.authCallbacks = this.authCallbacks.filter(cb => cb !== callback);
            }
          }
        }
      };
    },

    signUp: async ({ email }: { email: string }) => {
      if (typeof window === 'undefined') return { data: { user: null, session: null }, error: new Error('Window undefined') };
      
      // Simulate registration
      const mockUser = { id: `mock-user-${Date.now()}`, email };
      const mockSession = { user: mockUser, access_token: `mock-jwt-token-${Date.now()}` };
      
      this.saveSessionData(mockSession);
      return { data: { user: mockUser, session: mockSession }, error: null };
    },

    signInWithPassword: async ({ email }: { email: string }) => {
      if (typeof window === 'undefined') return { data: { user: null, session: null }, error: new Error('Window undefined') };
      
      const mockUser = { id: `mock-user-demo`, email };
      const mockSession = { user: mockUser, access_token: `mock-jwt-token-demo` };
      
      this.saveSessionData(mockSession);
      return { data: { user: mockUser, session: mockSession }, error: null };
    },

    signOut: async () => {
      this.saveSessionData(null);
      return { error: null };
    }
  };

  from(table: string) {
    return {
      select: () => {
        return {
          eq: (field: string, value: string) => {
            return {
              order: (sortField: string, { ascending }: { ascending: boolean }) => {
                if (typeof window === 'undefined') return { data: [], error: null };
                
                const analysesStr = localStorage.getItem('stance_mock_analyses') || '[]';
                let analyses = JSON.parse(analysesStr) as any[];
                
                // Filter by user ID if applicable
                if (field === 'user_id') {
                  analyses = analyses.filter(item => item.user_id === value);
                }
                
                // Sort by date
                analyses.sort((a, b) => {
                  const timeA = new Date(a.created_at).getTime();
                  const timeB = new Date(b.created_at).getTime();
                  return ascending ? timeA - timeB : timeB - timeA;
                });

                return { data: analyses, error: null };
              }
            };
          }
        };
      },

      insert: (record: any) => {
        return {
          select: () => {
            return {
              single: () => {
                if (typeof window === 'undefined') return { data: null, error: new Error('Window undefined') };
                
                const newRecord = {
                  id: `mock-analysis-${Date.now()}`,
                  created_at: new Date().toISOString(),
                  ...record
                };
                
                const analysesStr = localStorage.getItem('stance_mock_analyses') || '[]';
                const analyses = JSON.parse(analysesStr);
                analyses.push(newRecord);
                localStorage.setItem('stance_mock_analyses', JSON.stringify(analyses));
                
                return { data: newRecord, error: null };
              }
            };
          }
        };
      }
    };
  }
}

// Export the mock client if Supabase keys are missing
export const supabase = isSupabaseConfigured 
  ? realSupabase 
  : (new MockSupabaseClient() as any);
