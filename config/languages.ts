// ─── Languages shown to users ───────────────────────────────────────────────
// Transcription runs on Sarvam Saaras v3 with automatic language detection
// (api/sarvam/transcribe.ts sends language_code 'unknown'), so the app has no
// hard-coded language switch. This is the list we advertise — the landing page
// tiles and the FAQ both read it.

export const LANGUAGES: { lang: string; script: string }[] = [
  { lang: 'Hindi',     script: 'हिन्दी'   },
  { lang: 'Marathi',   script: 'मराठी'    },
  { lang: 'Tamil',     script: 'தமிழ்'    },
  { lang: 'Telugu',    script: 'తెలుగు'   },
  { lang: 'Gujarati',  script: 'ગુજરાતી'  },
  { lang: 'Kannada',   script: 'ಕನ್ನಡ'    },
  { lang: 'Bengali',   script: 'বাংলা'    },
  { lang: 'Malayalam', script: 'മലയാളം'   },
  { lang: 'Punjabi',   script: 'ਪੰਜਾਬੀ'   },
  { lang: 'English',   script: 'English'  },
];
