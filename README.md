# Social Media Sentiment & Stance Analysis Dashboard

A high-performance local AI chatbot web application for multi-perspective stance analysis of social media links or general topics. Powered by **Next.js**, **Ollama**, and **Supabase**, with a seamless, zero-latency streaming UX.

---

## ⚡ Key Features
- **Real-Time SSE Streaming**: Instant, token-by-token streaming UI that displays responses in real-time.
- **Local Ollama Integration**: Powered by local LLMs (optimized for `llama3.2:1b`) with a reduced context window for maximum generation speed and minimum VRAM usage.
- **Dual-Mode Backend**: 
  - **Local Demo Mode**: No database setup required. Stores session data and analyses directly in `localStorage`.
  - **Database Mode**: Securely persists histories, users, and stance analyses using Supabase.
- **Multi-Perspective NLP**: Extracts distinct viewpoints, core arguments, impacts, and overall alignment.

---

## 🛠️ Environment Configuration

Before launching the Next.js development server, configure your local environment by setting up the environment variables.

### 1. Create Environment File
Copy the example environment file:
```bash
cp .env.local.example .env.local
```

### 2. Configure Environment Variables
Open your `.env.local` file and update the following settings:

```env
# --- Supabase Configuration ---
# If left as placeholders, the application automatically runs in local "Demo Mode" (saving to localStorage).
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_public_anon_key

# --- Ollama Configuration ---
# The local host address where your Ollama daemon is running.
OLLAMA_HOST=http://127.0.0.1:11434

# The local model name to run (defaults to llama3.2:1b if unset)
OLLAMA_MODEL=llama3.2:1b
```

---

## 🦙 Ollama Local Setup

To run stance analyses locally:

1. **Install Ollama**: Download and install Ollama from [ollama.com](https://ollama.com).
2. **Download Model**: Run the optimized lightweight model in your terminal:
   ```bash
   ollama pull llama3.2:1b
   ```
3. **Start Ollama Daemon**: Ensure Ollama is running. (On Windows/macOS, check for the Ollama tray icon. On Linux, run `systemctl start ollama`).

---

## 💾 Database Setup (Optional)

If you configure Supabase variables in `.env.local`, run the following SQL script in your **Supabase SQL Editor** to create the necessary schema and setup Row Level Security (RLS):

```sql
create table public.analyses (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  link text not null,
  source varchar(50) not null,
  content text not null,
  summary text not null,
  perspectives jsonb not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable Row Level Security
alter table public.analyses enable row level security;

-- Setup Access Policies
create policy "Allow users to read their own analyses" on public.analyses 
  for select using (auth.uid() = user_id);

create policy "Allow users to insert their own analyses" on public.analyses 
  for insert with check (auth.uid() = user_id);
```

---

## 🚀 Running the Application

### 1. Install Dependencies
```bash
npm install
```

### 2. Run the Development Server
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser to view the application.

---

## 🧠 Stance Analysis API Performance Tuning
To ensure maximum responsiveness and generation speed, the API is configured with:
1. **Zero Pre-flight Checks**: No blocking health check calls before initiating requests.
2. **Enforced JSON Mode**: Employs `format: "json"` in the `/api/chat` body to force structured responses.
3. **Optimized KV Cache**: Restricts context to `num_ctx: 2048` and prediction response to `num_predict: 1200` to prevent VRAM saturation and lag.
4. **SSE Typewriter Effect**: Streams incoming tokens directly to the client browser using Server-Sent Events, removing buffering spinners.
