// Standard Supabase Edge Function CORS headers.
//
// The three Gemini functions are called directly from the React app running
// in the user's browser (see services/geminiService.ts → invokeEdgeFunction).
// Browsers will reject any cross-origin response that does not carry these
// headers, and they will issue a preflight OPTIONS request before the real
// POST whenever the request includes a custom header (Authorization, apikey,
// Content-Type: application/json all trigger this). Every function therefore
// has to (a) answer OPTIONS with these headers and a 2xx status, and
// (b) include these headers on the actual POST response.
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
