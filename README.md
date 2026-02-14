<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Aligned - Professional Workspace Intelligence

Professional workspace intelligence that synchronizes discussions into actionable directives and structured notes.

View your app in AI Studio: https://ai.studio/apps/drive/1Yvx5k1AYWawztNLXERQEGIF5NGDUb3ZO

## Features

- 🎙️ Audio recording with AI-powered transcription
- 📝 Automatic meeting notes generation
- ✅ Action item extraction
- 💬 Live dictation mode with HUD overlay
- 🔒 Secure authentication with Supabase
- 🌐 Multi-language support (English, Hindi, Marathi)

## Prerequisites

- Node.js (v16 or higher)
- A Gemini API key ([Get one here](https://aistudio.google.com/app/apikey))
- A Supabase account ([Create one here](https://supabase.com))

## Setup Instructions

### 1. Install dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Create a `.env.local` file in the project root by copying from the example:

```bash
cp .env.example .env.local
```

Then edit `.env.local` and add your credentials:

```env
VITE_GEMINI_API_KEY=your_gemini_api_key_here
VITE_SUPABASE_URL=your_supabase_url_here
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key_here
```

**Important**: Never commit `.env.local` to version control. It's already in `.gitignore`.

### 3. Set up Supabase Database

Create a table named `recordings` in your Supabase project with the following schema:

```sql
create table recordings (
  id uuid primary key,
  user_id uuid references auth.users not null,
  title text not null,
  date bigint not null,
  duration numeric not null,
  status text not null,
  source text not null,
  analysis jsonb,
  error_message text,
  created_at timestamp with time zone default now()
);

-- Enable Row Level Security
alter table recordings enable row level security;

-- Create policy to allow users to view only their own recordings
create policy "Users can view own recordings"
  on recordings for select
  using (auth.uid() = user_id);

-- Create policy to allow users to insert their own recordings
create policy "Users can insert own recordings"
  on recordings for insert
  with check (auth.uid() = user_id);

-- Create policy to allow users to update their own recordings
create policy "Users can update own recordings"
  on recordings for update
  using (auth.uid() = user_id);

-- Create policy to allow users to delete their own recordings
create policy "Users can delete own recordings"
  on recordings for delete
  using (auth.uid() = user_id);
```

### 4. Run the Application

#### Web Development Mode
```bash
npm run dev
```

#### Electron Desktop App
```bash
npm run electron:dev
```

#### Build for Production
```bash
npm run build
npm run electron:build
```

## Usage

### Recording Meetings
1. Log in with your credentials
2. Click "New Recording" to start audio capture
3. Click "Stop" when finished
4. AI will automatically generate notes, action items, and summary

### Live Dictation Mode
1. Use the global shortcut `Option+Space` (macOS) or `Command+Shift+0`
2. Speak your text
3. Press the shortcut again to paste the dictated text

## Security Notes

This project implements the following security measures:
- ✅ Electron context isolation enabled
- ✅ Node integration disabled in renderer
- ✅ Web security enabled
- ✅ Secure IPC communication via contextBridge
- ✅ Environment variables properly protected

See [FIXES_APPLIED.md](FIXES_APPLIED.md) for detailed security improvements.

## Troubleshooting

### Microphone Access Issues
- Ensure your browser/OS has granted microphone permissions
- Check that a microphone is connected and working
- Restart the application if permissions were recently changed

### API Errors
- Verify your Gemini API key is valid and has sufficient quota
- Check that your Supabase credentials are correct
- Ensure you're using the correct model name (`gemini-2.0-flash-exp`)

### Electron Issues
- Clear the app cache and restart
- Check console for specific error messages
- Ensure all dependencies are properly installed

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - see LICENSE file for details
