'use client';

import { useState, useEffect, useRef } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { 
  LogOut, 
  Link as LinkIcon, 
  Globe, 
  BookOpen, 
  Compass, 
  MessageSquare, 
  Loader2, 
  AlertCircle, 
  History, 
  ExternalLink,
  ChevronRight,
  ChevronDown,
  User,
  Sparkles,
  Send,
  Plus,
  Zap
} from 'lucide-react';

interface Perspective {
  name: string;
  stance: string;
  tone: string;
}

interface Analysis {
  id: string;
  link: string;
  source: string;
  content: string;
  summary: string;
  perspectives: Perspective[];
  created_at: string;
}

// Structured analysis types
interface BulletPoint {
  bullet: string;
  detail: string;
  impact?: string;
}

interface PovSection {
  name: string;
  stance?: string;
  points: BulletPoint[];
}

interface StructuredAnalysis {
  title: string;
  overview: BulletPoint[];
  perspectives: PovSection[];
}

// Collapsible Bullet Item Component
function CollapsibleBullet({ item, index, accentClass }: { item: BulletPoint; index: number; accentClass?: string }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className={`collapsible-bullet ${isOpen ? 'open' : ''}`}>
      <button
        className="bullet-header"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
      >
        <div className="bullet-icon-wrap">
          {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </div>
        <span className="bullet-text">{item.bullet}</span>
      </button>
      
      {isOpen && (
        <div className="bullet-detail animate-slide-down">
          <p className="detail-text">{item.detail}</p>
          {item.impact && (
            <div className="impact-badge">
              <Zap size={12} />
              <span><strong>Impact:</strong> {item.impact}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Helper to extract the thinking portion and JSON portion from the summary stream
function extractThinkingAndJson(summary: string) {
  let thinking = '';
  let jsonPart = summary;

  if (summary.includes('<think>')) {
    const startIdx = summary.indexOf('<think>') + 7;
    const endIdx = summary.indexOf('</think>');
    if (endIdx !== -1) {
      thinking = summary.substring(startIdx, endIdx);
      jsonPart = summary.substring(endIdx + 8);
    } else {
      thinking = summary.substring(startIdx);
      jsonPart = '';
    }
  } else if (summary.trim() && summary.trim().startsWith('{') === false) {
    const firstBrace = summary.indexOf('{');
    if (firstBrace !== -1) {
      thinking = summary.substring(0, firstBrace);
      jsonPart = summary.substring(firstBrace);
    } else {
      thinking = summary;
      jsonPart = '';
    }
  }

  return { thinking: thinking.trim(), jsonPart: jsonPart.trim() };
}

// Try to parse the summary as structured JSON
function parseStructuredAnalysis(summary: string): StructuredAnalysis | null {
  if (!summary) return null;
  
  const { jsonPart } = extractThinkingAndJson(summary);
  if (!jsonPart || jsonPart.length < 10) return null;
  
  // Helper: attempt parse and validate
  const tryParse = (str: string): StructuredAnalysis | null => {
    try {
      const parsed = JSON.parse(str);
      if (parsed && parsed.overview && Array.isArray(parsed.overview) && parsed.perspectives && Array.isArray(parsed.perspectives)) {
        return parsed as StructuredAnalysis;
      }
      // Also accept if it has title + perspectives (some models skip overview)
      if (parsed && parsed.title && parsed.perspectives && Array.isArray(parsed.perspectives)) {
        return { ...parsed, overview: parsed.overview || [] } as StructuredAnalysis;
      }
    } catch {
      // parse failed
    }
    return null;
  };

  let jsonStr = jsonPart.trim();
  
  // 1. Remove markdown code fences if present
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  }

  // 2. Try direct parse
  let result = tryParse(jsonStr);
  if (result) return result;

  // 3. Try to extract JSON object from the string (LLM might add text before/after)
  const jsonObjMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (jsonObjMatch) {
    result = tryParse(jsonObjMatch[0]);
    if (result) return result;

    // 4. Try fixing common LLM JSON issues
    let fixedJson = jsonObjMatch[0]
      .replace(/,\s*}/g, '}')       // Remove trailing commas before }
      .replace(/,\s*\]/g, ']')      // Remove trailing commas before ]
      .replace(/'/g, '"')           // Replace single quotes with double quotes
      .replace(/\n/g, ' ')          // Remove newlines inside strings
      .replace(/\t/g, ' ');         // Remove tabs

    result = tryParse(fixedJson);
    if (result) return result;

    // 5. Try to fix unclosed brackets/braces
    let openBraces = 0, openBrackets = 0;
    for (const ch of fixedJson) {
      if (ch === '{') openBraces++;
      if (ch === '}') openBraces--;
      if (ch === '[') openBrackets++;
      if (ch === ']') openBrackets--;
    }
    // Add missing closing characters
    while (openBrackets > 0) { fixedJson += ']'; openBrackets--; }
    while (openBraces > 0) { fixedJson += '}'; openBraces--; }
    
    result = tryParse(fixedJson);
    if (result) return result;
  }

  return null;
}

// Structured Analysis Renderer
function StructuredAnalysisView({ data }: { data: StructuredAnalysis }) {
  return (
    <div className="structured-analysis">
      {/* Title */}
      <h3 className="analysis-title">{data.title}</h3>
      
      {/* Overview Section */}
      <div className="analysis-section">
        <div className="section-label">
          <BookOpen size={14} />
          <span>Overview</span>
        </div>
        <div className="bullet-list">
          {data.overview.map((item, idx) => (
            <CollapsibleBullet key={idx} item={item} index={idx} />
          ))}
        </div>
      </div>

      {/* Perspectives / POV Sections */}
      <div className="pov-container">
        <div className="section-label" style={{ marginBottom: '0.75rem' }}>
          <Compass size={14} />
          <span>Perspectives</span>
        </div>
        
        {data.perspectives.map((pov, povIdx) => (
          <PovCard key={povIdx} pov={pov} index={povIdx} />
        ))}
      </div>
    </div>
  );
}

// POV Card Component
function PovCard({ pov, index }: { pov: PovSection; index: number }) {
  const [isExpanded, setIsExpanded] = useState(true);
  const colorClasses = ['pov-blue', 'pov-rose', 'pov-amber', 'pov-emerald', 'pov-violet'];
  const colorClass = colorClasses[index % colorClasses.length];

  return (
    <div className={`pov-card ${colorClass}`}>
      <button 
        className="pov-header"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
      >
        <div className="pov-title-row">
          <span className="pov-name">{pov.name}</span>
        </div>
        <div className="pov-toggle">
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </div>
      </button>
      
      {isExpanded && (
        <div className="pov-body animate-slide-down">
          {pov.stance && (
            <p style={{
              fontSize: '0.85rem',
              color: 'var(--text-secondary)',
              lineHeight: 1.55,
              marginBottom: '0.75rem',
              padding: '0.25rem 0.5rem 0.75rem 0.5rem',
              borderBottom: '1px dashed var(--border-color)',
              fontWeight: 500
            }}>
              <strong>Perspective:</strong> {pov.stance}
            </p>
          )}
          {pov.points.map((point, ptIdx) => (
            <CollapsibleBullet key={ptIdx} item={point} index={ptIdx} accentClass={colorClass} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function ChatbotPage() {
  // Auth States
  const [session, setSession] = useState<any>(null);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [demoMode, setDemoMode] = useState(false);

  // Chat UI States
  const [urlInput, setUrlInput] = useState('');
  const [detectedSource, setDetectedSource] = useState('other');
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0); // 0 = Idle, 1 = Scraping, 2 = AI, 3 = Save
  const [isStreaming, setIsStreaming] = useState(false); // True while receiving LLM response
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  
  // Active Thread State (The currently viewed analysis)
  const [activeAnalysis, setActiveAnalysis] = useState<Analysis | null>(null);
  const [history, setHistory] = useState<Analysis[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Auto scroll reference for chat stream
  const messageEndRef = useRef<HTMLDivElement>(null);

  // 1. Listen for Auth Session
  useEffect(() => {
    supabase.auth.getSession().then((res: any) => {
      const session = res?.data?.session;
      setSession(session);
      if (session) {
        fetchHistory(session.user.id);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event: any, session: any) => {
      setSession(session);
      if (session) {
        fetchHistory(session.user.id);
      } else {
        setHistory([]);
        setActiveAnalysis(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // 2. Auto-scroll to bottom of chat when state changes
  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeAnalysis, loading, loadingStep, analysisError, isStreaming]);

  // 3. Detect source platform from URL input
  useEffect(() => {
    if (!urlInput) {
      setDetectedSource('other');
      return;
    }
    const lower = urlInput.toLowerCase();
    if (lower.includes('twitter.com') || lower.includes('x.com')) {
      setDetectedSource('twitter');
    } else if (lower.includes('reddit.com')) {
      setDetectedSource('reddit');
    } else if (lower.includes('linkedin.com')) {
      setDetectedSource('linkedin');
    } else if (lower.includes('facebook.com')) {
      setDetectedSource('facebook');
    } else if (lower.includes('medium.com')) {
      setDetectedSource('medium');
    } else {
      setDetectedSource('other');
    }
  }, [urlInput]);

  // 4. Fetch past analyses history
  const fetchHistory = async (userId: string, selectFirst = false) => {
    if (!isSupabaseConfigured && !demoMode) return;
    setHistoryLoading(true);
    try {
      const { data, error } = await supabase
        .from('analyses')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      const historyList = data || [];
      setHistory(historyList);
      
      if (selectFirst && historyList.length > 0 && !activeAnalysis) {
        setActiveAnalysis(historyList[0]);
      }
    } catch (err: any) {
      console.error('Error fetching history:', err);
    } finally {
      setHistoryLoading(false);
    }
  };

  // 5. Handle Sign Up and Log In
  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    // Allow authentication in both standard and mock demo modes
    setAuthLoading(true);
    setAuthError(null);

    try {
      if (isSignUp) {
        const { data, error } = await supabase.auth.signUp({
          email: authEmail,
          password: authPassword,
        });
        if (error) throw error;
        if (data?.user && !data.session) {
          setAuthError('Sign up successful! Please check your email for confirmation.');
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: authEmail,
          password: authPassword,
        });
        if (error) throw error;
      }
    } catch (err: any) {
      setAuthError(err.message || 'Authentication failed');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  // 6. Execute stance analysis — REAL-TIME SSE token streaming
  const triggerAnalysis = async (targetUrl: string) => {
    setLoading(true);
    setAnalysisError(null);
    setActiveAnalysis(null);
    setLoadingStep(1);

    try {
      setLoadingStep(2); // Skip to LLM step immediately — no artificial delay
      
      const sessionRes: any = await supabase.auth.getSession();
      const currentSession = sessionRes?.data?.session;
      const token = currentSession?.access_token;
      const isUrl = targetUrl.startsWith('http://') || targetUrl.startsWith('https://') || targetUrl.startsWith('www.');

      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : '',
        },
        body: JSON.stringify({
          link: targetUrl,
          userId: session.user.id,
        }),
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.error || 'Server error during analysis.');
      }

      // Create the streaming analysis record
      const streamingRecord: Analysis = {
        id: `streaming-${Date.now()}`,
        link: targetUrl,
        source: isUrl ? detectedSource : 'manual',
        content: '',
        summary: '',
        perspectives: [],
        created_at: new Date().toISOString()
      };
      
      setActiveAnalysis(streamingRecord);
      setLoading(false);
      setLoadingStep(0);
      setIsStreaming(true);

      const reader = response.body?.getReader();
      if (!reader) throw new Error('Failed to read response stream.');

      const decoder = new TextDecoder();
      let fullText = '';
      let buffer = ''; // Buffer for incomplete SSE lines

      // Detect response type from content-type
      const contentType = response.headers.get('content-type') || '';
      const isSSE = contentType.includes('text/event-stream');

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });

        if (isSSE) {
          // === SSE PARSING: real-time token display ===
          buffer += chunk;
          const events = buffer.split('\n\n');
          buffer = events.pop() || ''; // Keep incomplete event in buffer

          for (const event of events) {
            const dataLine = event.trim();
            if (!dataLine.startsWith('data: ')) continue;
            
            try {
              const payload = JSON.parse(dataLine.slice(6));
              if (payload.token) {
                fullText += payload.token;
                // Update UI in real-time — token by token
                setActiveAnalysis(prev => prev ? { ...prev, summary: fullText } : null);
              }
              if (payload.done && payload.full) {
                fullText = payload.full;
              }
            } catch { /* skip malformed events */ }
          }
        } else {
          // === Plain response (fallback engine) — accumulate and set ===
          fullText += chunk;
        }
      }

      // Stream finished — set final text
      setIsStreaming(false);
      setActiveAnalysis(prev => prev ? { ...prev, summary: fullText } : null);

      // Save to LocalStorage if in demo mode
      if (!isSupabaseConfigured || demoMode) {
        const { data } = await supabase
          .from('analyses')
          .insert({
            user_id: session.user.id,
            link: targetUrl,
            source: isUrl ? detectedSource : 'manual',
            content: '',
            summary: fullText,
            perspectives: []
          })
          .select()
          .single();
        if (data) {
          setActiveAnalysis(data);
        }
      }

      fetchHistory(session.user.id);
    } catch (err: any) {
      setAnalysisError(err.message || 'Could not analyze post. Check that your local Ollama is running.');
    } finally {
      setLoading(false);
      setLoadingStep(0);
      setIsStreaming(false);
    }
  };

  const handleSendLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput || !session) return;
    const targetUrl = urlInput;
    setUrlInput('');
    await triggerAnalysis(targetUrl);
  };

  // Badge helpers
  const getSourceBadge = (source: string) => {
    const labels: Record<string, string> = {
      twitter: 'X / Twitter',
      reddit: 'Reddit',
      linkedin: 'LinkedIn',
      facebook: 'Facebook',
      medium: 'Medium',
      other: 'Web Link'
    };
    return labels[source] || source;
  };

  const getToneStyle = (tone: string) => {
    const t = tone.toLowerCase();
    if (t.includes('skeptical') || t.includes('critical') || t.includes('concern')) {
      return { background: 'rgba(239, 68, 68, 0.08)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.15)' };
    }
    if (t.includes('enthusiastic') || t.includes('positive') || t.includes('support')) {
      return { background: 'rgba(16, 185, 129, 0.08)', color: '#34d399', border: '1px solid rgba(16, 185, 129, 0.15)' };
    }
    if (t.includes('pragmatic') || t.includes('neutral') || t.includes('objective')) {
      return { background: 'rgba(94, 234, 212, 0.08)', color: '#2dd4bf', border: '1px solid rgba(94, 234, 212, 0.15)' };
    }
    return { background: 'rgba(96, 165, 250, 0.08)', color: '#60a5fa', border: '1px solid rgba(96, 165, 250, 0.15)' };
  };

  // Render the analysis summary — structured if JSON, formatted text if not
  const renderAnalysisSummary = (summary: string) => {
    if (!summary) return null;
    
    const structured = parseStructuredAnalysis(summary);
    
    if (structured) {
      return <StructuredAnalysisView data={structured} />;
    }
    
    // Fallback: try to render as formatted paragraphs (not raw JSON)
    // Split by double newlines for paragraph breaks
    const paragraphs = summary.split(/\n\n+/).filter(p => p.trim());
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {paragraphs.map((para, idx) => (
          <p key={idx} style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', lineHeight: 1.6 }}>
            {para.trim()}
          </p>
        ))}
      </div>
    );
  };

  // Onboarding Screen if Supabase is unconfigured
  if (!isSupabaseConfigured && !demoMode) {
    return (
      <main className="container" style={{ maxWidth: '640px', minHeight: '100vh', display: 'flex', alignItems: 'center' }}>
        <div className="card animate-fade-in" style={{ width: '100%', border: '1px solid rgba(245, 158, 11, 0.2)' }}>
          <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', color: 'var(--warning-color)' }}>
            <AlertCircle size={32} />
            <h2 style={{ fontSize: '1.5rem', fontWeight: 600 }}>Configure Supabase Backend</h2>
          </div>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', fontSize: '0.95rem' }}>
            To run this chatbot website, you must configure your Supabase variables. Copy your project credentials into an <code>.env.local</code> file:
          </p>
          <pre style={{
            background: '#04060b',
            border: '1px solid var(--border-color)',
            padding: '1rem',
            borderRadius: '6px',
            fontSize: '0.85rem',
            marginBottom: '1.5rem',
            overflowX: 'auto',
            color: '#a5f3fc'
          }}>
{`NEXT_PUBLIC_SUPABASE_URL=your-supabase-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
OLLAMA_HOST=http://localhost:11434`}
          </pre>
          <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1.5rem' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 500, marginBottom: '0.75rem' }}>Next, run this SQL script in your Supabase SQL Editor:</h3>
            <pre style={{
              background: '#04060b',
              border: '1px solid var(--border-color)',
              padding: '1rem',
              borderRadius: '6px',
              fontSize: '0.75rem',
              overflowX: 'auto',
              maxHeight: '180px',
              color: 'var(--text-secondary)'
            }}>
{`create table public.analyses (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  link text not null,
  source varchar(50) not null,
  content text not null,
  summary text not null,
  perspectives jsonb not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.analyses enable row level security;

create policy "Allow users to read their own analyses" on public.analyses for select using (auth.uid() = user_id);
create policy "Allow users to insert their own analyses" on public.analyses for insert with check (auth.uid() = user_id);`}
            </pre>
            
            <button 
              onClick={() => {
                setDemoMode(true);
                supabase.auth.getSession().then((res: any) => {
                  const session = res?.data?.session;
                  if (session) {
                    // Force fetch history in local storage
                    // We bypass the isSupabaseConfigured guard since demoMode will be true
                    fetchHistory(session.user.id);
                  }
                });
              }}
              className="btn"
              style={{ width: '100%', marginTop: '1.5rem', background: 'var(--accent-gradient)' }}
            >
              <span>Use Local Demo Mode (No Database Needed)</span>
            </button>
          </div>
        </div>
      </main>
    );
  }

  // Auth Guard
  if (!session) {
    return (
      <main className="container" style={{ display: 'flex', minHeight: '90vh', alignItems: 'center', justifyContent: 'center' }}>
        <div className="card animate-fade-in" style={{ width: '100%', maxWidth: '420px', padding: '2.5rem 2rem' }}>
          <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
            <div style={{
              background: 'var(--accent-gradient)',
              width: '48px',
              height: '48px',
              borderRadius: '10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 1rem',
              color: '#080c14'
            }}>
              <Compass size={24} />
            </div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.02em', marginBottom: '0.25rem' }}>Stance Chatbot</h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
              Conversational multi-perspective stance analyses
            </p>
          </div>

          <form onSubmit={handleAuth} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div className="input-group">
              <label className="input-label">Email Address</label>
              <input 
                type="email" 
                required 
                className="text-input" 
                placeholder="you@domain.com"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
              />
            </div>

            <div className="input-group">
              <label className="input-label">Password</label>
              <input 
                type="password" 
                required 
                className="text-input" 
                placeholder="••••••••"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
              />
            </div>

            {authError && (
              <div style={{ 
                background: 'rgba(239, 68, 68, 0.08)', 
                color: 'var(--error-color)',
                border: '1px solid rgba(239, 68, 68, 0.1)',
                padding: '0.75rem',
                borderRadius: '6px',
                fontSize: '0.85rem',
                display: 'flex',
                gap: '0.5rem',
                alignItems: 'center'
              }}>
                <AlertCircle size={16} />
                <span>{authError}</span>
              </div>
            )}

            <button type="submit" disabled={authLoading} className="btn" style={{ width: '100%', marginTop: '0.5rem' }}>
              {authLoading ? (
                <>
                  <Loader2 size={16} className="animate-spin" style={{ animation: 'spin 1s linear infinite' }} />
                  <span>Please wait...</span>
                </>
              ) : (
                <span>{isSignUp ? 'Create Account' : 'Sign In'}</span>
              )}
            </button>
          </form>

          <div style={{ textAlign: 'center', marginTop: '1.5rem', fontSize: '0.85rem' }}>
            <span style={{ color: 'var(--text-muted)' }}>
              {isSignUp ? 'Already have an account? ' : "Don't have an account? "}
            </span>
            <button 
              type="button"
              onClick={() => {
                setIsSignUp(!isSignUp);
                setAuthError(null);
              }}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--accent-color)',
                fontWeight: 500,
                cursor: 'pointer',
                padding: '0 0.25rem'
              }}
            >
              {isSignUp ? 'Sign In' : 'Sign Up'}
            </button>
          </div>
        </div>
      </main>
    );
  }

  // App Shell (Sidebar + Chat Window)
  return (
    <div className="app-container">
      
      {/* Sidebar - Threads History Drawer */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
            <Compass size={20} style={{ color: 'var(--accent-color)' }} />
            <span style={{ fontWeight: 700, fontSize: '1.05rem', letterSpacing: '-0.02em' }}>Stance Chatbot</span>
          </div>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Ollama Local NLP Agent</span>
        </div>

        <div className="sidebar-content">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '0.5rem 0.75rem', color: 'var(--text-muted)', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            <History size={12} />
            <span>Recent Analysed Links</span>
          </div>

          <button 
            onClick={() => setActiveAnalysis(null)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid var(--border-color)',
              color: 'var(--text-primary)',
              borderRadius: '8px',
              padding: '0.6rem 0.75rem',
              fontSize: '0.85rem',
              cursor: 'pointer',
              width: '100%',
              textAlign: 'left',
              fontWeight: 500,
              marginBottom: '0.5rem'
            }}
          >
            <Plus size={14} />
            <span>New Link Analysis</span>
          </button>

          {historyLoading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem 0' }}>
              <Loader2 size={18} className="animate-spin" style={{ animation: 'spin 1s linear infinite', color: 'var(--text-muted)' }} />
            </div>
          ) : history.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
              No links analyzed yet. Submit a URL in the chat to start.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              {history.map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    setActiveAnalysis(item);
                    setAnalysisError(null);
                  }}
                  style={{
                    background: activeAnalysis?.id === item.id ? 'rgba(255, 255, 255, 0.04)' : 'transparent',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '0.65rem 0.75rem',
                    textAlign: 'left',
                    cursor: 'pointer',
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.5rem',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <div style={{ overflow: 'hidden', flex: 1 }}>
                    <p style={{
                      fontSize: '0.85rem',
                      fontWeight: activeAnalysis?.id === item.id ? 500 : 400,
                      color: activeAnalysis?.id === item.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}>
                      {item.link}
                    </p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.2rem' }}>
                      <span style={{
                        fontSize: '0.65rem',
                        background: 'rgba(255,255,255,0.03)',
                        padding: '0.05rem 0.3rem',
                        borderRadius: '3px',
                        color: 'var(--text-muted)',
                        textTransform: 'capitalize'
                      }}>
                        {getSourceBadge(item.source)}
                      </span>
                    </div>
                  </div>
                  <ChevronRight size={12} style={{ color: 'var(--text-muted)', opacity: activeAnalysis?.id === item.id ? 1 : 0.4 }} />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Sidebar Footer Profile */}
        <div style={{
          borderTop: '1px solid var(--border-color)',
          padding: '1rem 1.25rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', overflow: 'hidden' }}>
            <User size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {session.user.email}
            </span>
          </div>
          <button onClick={handleSignOut} className="btn btn-secondary" style={{ width: '100%', padding: '0.45rem', fontSize: '0.8rem', display: 'flex', gap: '0.4rem', justifyContent: 'center' }}>
            <LogOut size={12} />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Chat Viewport Area */}
      <section className="chat-viewport">
        
        {/* Chat header */}
        <header className="chat-header">
          <div>
            {activeAnalysis ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{
                  fontSize: '0.65rem',
                  fontWeight: 600,
                  background: 'rgba(56, 189, 248, 0.08)',
                  color: 'var(--accent-color)',
                  padding: '0.15rem 0.4rem',
                  borderRadius: '4px',
                  textTransform: 'uppercase'
                }}>
                  {getSourceBadge(activeAnalysis.source)}
                </span>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '300px' }}>
                  {activeAnalysis.link}
                </span>
              </div>
            ) : (
              <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
                New Analysis Conversation
              </span>
            )}
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem' }}>
            <span className="dot" style={{ width: '6px', height: '6px', background: 'var(--success-color)', borderRadius: '50%' }}></span>
            <span style={{ color: 'var(--text-muted)' }}>Ollama Active</span>
          </div>
        </header>

        {/* Chat stream container */}
        <div className="message-stream">
          
          {/* Welcome Screen (If no active thread and not loading) */}
          {!activeAnalysis && !loading && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', margin: 'auto 0', padding: '3rem 1.5rem', textAlign: 'center' }}>
              <div style={{
                background: 'var(--accent-gradient)',
                width: '56px', height: '56px', borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#080c14', marginBottom: '1.5rem'
              }}>
                <Sparkles size={24} />
              </div>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem' }}>NLP Stance Chatbot</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', maxWidth: '420px', lineHeight: 1.5, marginBottom: '1.75rem' }}>
                Send a social media link or type a topic. Get concise bullet-point analysis with multiple perspectives — click any point to expand details.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: '480px', width: '100%', borderTop: '1px solid var(--border-color)', paddingTop: '1.5rem' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Or select a topic to see how the stances shift:
                </span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', justifyContent: 'center' }}>
                  {[
                    "Iran Israel War",
                    "Universal Basic Income",
                    "Nuclear Energy Expansion",
                    "Generative AI replacing creative jobs"
                  ].map((topic, i) => (
                    <button
                      key={i}
                      disabled={loading}
                      onClick={() => triggerAnalysis(topic)}
                      style={{
                        background: 'rgba(255, 255, 255, 0.02)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '20px',
                        padding: '0.5rem 1rem',
                        color: 'var(--text-secondary)',
                        fontSize: '0.8rem',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease'
                      }}
                      className="topic-suggestion-btn"
                    >
                      {topic}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Chat conversations */}
          {activeAnalysis && (
            <>
              {/* User Bubble Row */}
              <div className="message-row user">
                <div className="chat-bubble user">
                  <p style={{ fontSize: '0.9rem', lineHeight: 1.5, wordBreak: 'break-all' }}>
                    {activeAnalysis.source === 'manual' ? 'Please analyze this topic:' : `Please analyze this link from ${getSourceBadge(activeAnalysis.source)}:`}
                  </p>
                  {activeAnalysis.source !== 'manual' ? (
                    <a 
                      href={activeAnalysis.link} 
                      target="_blank" 
                      rel="noopener noreferrer" 
                      style={{ 
                        display: 'inline-flex', 
                        alignItems: 'center', 
                        gap: '0.4rem', 
                        marginTop: '0.5rem',
                        color: 'var(--accent-color)',
                        fontSize: '0.85rem',
                        fontWeight: 500,
                        textDecoration: 'underline'
                      }}
                    >
                      <span>{activeAnalysis.link}</span>
                      <ExternalLink size={12} />
                    </a>
                  ) : (
                    <p style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--text-primary)', marginTop: '0.25rem' }}>
                      &quot;{activeAnalysis.link}&quot;
                    </p>
                  )}
                </div>
              </div>

              {/* AI Bubble Row */}
              <div className="message-row ai">
                <div className="chat-bubble ai" style={{ width: '90%' }}>
                  <div className="badge-row">
                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--accent-color)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <Compass size={14} />
                      <span>Stance Bot Response</span>
                    </span>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      {new Date(activeAnalysis.created_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  <div style={{ marginTop: '1rem' }}>
                    {(() => {
                      const { thinking, jsonPart } = extractThinkingAndJson(activeAnalysis.summary);
                      const structuredData = parseStructuredAnalysis(activeAnalysis.summary);
                      
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                          {/* Render Thinking Block if present */}
                          {thinking && (
                            <div className="thinking-block animate-fade-in" style={{
                              background: 'rgba(255, 255, 255, 0.02)',
                              borderLeft: '3px solid var(--accent-color)',
                              padding: '0.75rem 1rem',
                              borderRadius: '0 8px 8px 0',
                              fontSize: '0.82rem',
                              color: 'var(--text-secondary)',
                              fontStyle: 'italic',
                              lineHeight: 1.5,
                              whiteSpace: 'pre-wrap',
                              maxHeight: '180px',
                              overflowY: 'auto'
                            }}>
                              <div style={{ 
                                fontWeight: 600, 
                                fontSize: '0.72rem', 
                                textTransform: 'uppercase', 
                                letterSpacing: '0.05em', 
                                color: (isStreaming && !jsonPart) ? 'var(--accent-color)' : 'var(--text-muted)', 
                                marginBottom: '0.4rem', 
                                display: 'flex', 
                                alignItems: 'center', 
                                gap: '0.4rem' 
                              }}>
                                {(isStreaming && !jsonPart) ? (
                                  <Loader2 size={12} className="animate-spin" style={{ animation: 'spin 1s linear infinite' }} />
                                ) : (
                                  <span style={{ color: 'var(--success-color)', fontWeight: 'bold' }}>✓</span>
                                )}
                                <span>Thinking Process</span>
                              </div>
                              {thinking}
                            </div>
                          )}

                          {/* Render Main Content (Structured View or Raw Live Stream) */}
                          {structuredData ? (
                            <div>
                              <StructuredAnalysisView data={structuredData} />
                              {isStreaming && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '1rem' }}>
                                  <Loader2 size={12} className="animate-spin" style={{ animation: 'spin 1s linear infinite', color: 'var(--accent-color)' }} />
                                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                    Streaming additional perspectives...
                                  </span>
                                </div>
                              )}
                            </div>
                          ) : (
                            <div>
                              {isStreaming ? (
                                <div>
                                  {jsonPart ? (
                                    <div className="streaming-text" style={{
                                      fontSize: '0.82rem',
                                      lineHeight: 1.7,
                                      color: 'var(--text-secondary)',
                                      fontFamily: '"JetBrains Mono", "Fira Code", monospace',
                                      whiteSpace: 'pre-wrap',
                                      wordBreak: 'break-word',
                                      maxHeight: '300px',
                                      overflowY: 'auto',
                                      padding: '0.75rem',
                                      background: 'rgba(0,0,0,0.2)',
                                      borderRadius: '8px',
                                      border: '1px solid var(--border-color)'
                                    }}>
                                      {jsonPart}
                                      <span className="streaming-cursor" style={{
                                        display: 'inline-block',
                                        width: '2px',
                                        height: '1em',
                                        background: 'var(--accent-color)',
                                        marginLeft: '2px',
                                        animation: 'blink 0.8s infinite',
                                        verticalAlign: 'text-bottom'
                                      }} />
                                    </div>
                                  ) : (
                                    <div className="typing-indicator">
                                      <Loader2 size={14} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent-color)' }} />
                                      <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Connecting to Ollama...</span>
                                    </div>
                                  )}
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem' }}>
                                    <Loader2 size={12} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent-color)' }} />
                                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                      Streaming from local LLM... ({activeAnalysis.summary.length} chars)
                                    </span>
                                  </div>
                                </div>
                              ) : (
                                renderAnalysisSummary(activeAnalysis.summary)
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>

                  {activeAnalysis.perspectives && activeAnalysis.perspectives.length > 0 && (
                    <div style={{ marginTop: '1.5rem' }}>
                      <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.25rem' }}>Multi-Perspective breakdown</h3>
                      <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: '1rem' }}>
                        Extracted ideological viewpoints from the shared link content:
                      </p>
                      
                      <div className="perspective-card-grid">
                        {activeAnalysis.perspectives.map((pov, idx) => (
                          <div key={idx} className="perspective-bubble-card">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                                {pov.name}
                              </span>
                              <span style={{
                                fontSize: '0.65rem',
                                padding: '0.1rem 0.35rem',
                                borderRadius: '3px',
                                fontWeight: 500,
                                ...getToneStyle(pov.tone)
                              }}>
                                {pov.tone}
                              </span>
                            </div>
                            <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', lineHeight: 1.45 }}>
                              {pov.stance}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* Stepper Shimmer Loading Chat Bubble */}
          {loading && (
            <>
              {/* User Bubble placeholder */}
              <div className="message-row user animate-fade-in">
                <div className="chat-bubble user">
                  <p style={{ fontSize: '0.9rem' }}>Running analysis on new link...</p>
                </div>
              </div>

              {/* Shimmering AI Bubble */}
              <div className="message-row ai animate-fade-in">
                <div className="chat-bubble ai" style={{ width: '90%' }}>
                  <div className="badge-row">
                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--accent-color)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <Loader2 size={12} className="animate-spin" style={{ animation: 'spin 1s linear infinite' }} />
                      <span>Analyzing Point of Views...</span>
                    </span>
                  </div>

                  {/* Stepper Status Indicators */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', background: 'rgba(0,0,0,0.15)', padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid var(--border-color)', margin: '1rem 0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem' }}>
                      <div style={{
                        width: '16px', height: '16px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem',
                        background: loadingStep >= 1 ? 'var(--accent-color)' : 'var(--border-color)',
                        color: loadingStep >= 1 ? '#040811' : 'var(--text-muted)',
                        fontWeight: 600
                      }}>
                        {loadingStep > 1 ? '✓' : '1'}
                      </div>
                      <span style={{ color: loadingStep === 1 ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                        Fetching web link contents and scrubbing HTML tags...
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem' }}>
                      <div style={{
                        width: '16px', height: '16px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem',
                        background: loadingStep >= 2 ? 'var(--accent-color)' : 'var(--border-color)',
                        color: loadingStep >= 2 ? '#040811' : 'var(--text-muted)',
                        fontWeight: 600
                      }}>
                        {loadingStep > 2 ? '✓' : '2'}
                      </div>
                      <span style={{ color: loadingStep === 2 ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                        Running local LLM stance synthesis...
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem' }}>
                      <div style={{
                        width: '16px', height: '16px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem',
                        background: loadingStep >= 3 ? 'var(--accent-color)' : 'var(--border-color)',
                        color: loadingStep >= 3 ? '#040811' : 'var(--text-muted)',
                        fontWeight: 600
                      }}>
                        {loadingStep > 3 ? '✓' : '3'}
                      </div>
                      <span style={{ color: loadingStep === 3 ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                        Storing perspectives into database...
                      </span>
                    </div>
                  </div>

                  {/* Shimmer skeleton */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '1rem' }}>
                    <div className="skeleton skeleton-title"></div>
                    <div className="skeleton skeleton-text" style={{ width: '90%' }}></div>
                    <div className="skeleton skeleton-text" style={{ width: '80%' }}></div>
                    <div className="perspective-card-grid" style={{ marginTop: '0.5rem' }}>
                      <div className="skeleton" style={{ height: '90px', borderRadius: '8px' }}></div>
                      <div className="skeleton" style={{ height: '90px', borderRadius: '8px' }}></div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Server / API Errors */}
          {analysisError && (
            <div className="message-row ai animate-fade-in">
              <div className="chat-bubble ai" style={{ border: '1px solid rgba(239, 68, 68, 0.15)', background: 'rgba(239, 68, 68, 0.03)' }}>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', color: 'var(--error-color)' }}>
                  <AlertCircle size={16} />
                  <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>Analysis Error</span>
                </div>
                <p style={{ marginTop: '0.5rem', color: 'var(--text-secondary)', fontSize: '0.85rem', lineHeight: 1.5 }}>
                  {analysisError}
                </p>
              </div>
            </div>
          )}

          {/* Anchor to scroll to bottom */}
          <div ref={messageEndRef} />
        </div>

        {/* Floating Input area */}
        <footer className="chat-footer">
          <form onSubmit={handleSendLink} className="input-container">
            <LinkIcon size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <input
              type="text"
              required
              className="chat-input"
              placeholder="Paste a link or type a topic (e.g., Iran Israel war, Bitcoin, AI)..."
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              disabled={loading}
            />
            {urlInput && (
              <span style={{
                fontSize: '0.65rem',
                background: 'rgba(56, 189, 248, 0.08)',
                color: 'var(--accent-color)',
                padding: '0.2rem 0.4rem',
                borderRadius: '12px',
                fontWeight: 600,
                textTransform: 'uppercase',
                marginRight: '0.25rem',
                letterSpacing: '0.025em',
                flexShrink: 0
              }}>
                {detectedSource !== 'other' ? `${detectedSource} link` : 'topic mode'}
              </span>
            )}
            <button type="submit" disabled={loading || !urlInput} className="send-btn">
              {loading ? (
                <Loader2 size={16} className="animate-spin" style={{ animation: 'spin 1s linear infinite' }} />
              ) : (
                <Send size={16} />
              )}
            </button>
          </form>
          <p style={{ textAlign: 'center', fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
            Powered by local Ollama AI. Web content parsing complies with robots.txt directives.
          </p>
        </footer>

      </section>

    </div>
  );
}
