/**
 * api/mcp-diag.ts — TEMPORARY diagnostic. Delete once the MCP 500 is fixed.
 *
 * Uses the proven @vercel/node default-handler style (same as the razorpay
 * functions) and dynamically imports the suspect modules INSIDE a try/catch so
 * an import-time / construction-time crash surfaces as JSON instead of a generic
 * FUNCTION_INVOCATION_FAILED. Reports the furthest step it reached.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const steps: string[] = [];
  const env = {
    SUPABASE_URL: !!process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: !!process.env.SUPABASE_ANON_KEY,
  };
  try {
    steps.push('start');

    const mcp = await import('mcp-handler');
    steps.push(`imported mcp-handler: ${Object.keys(mcp).join(',')}`);

    const auth = await import('./_lib/mcpAuth.js');
    steps.push(`imported mcpAuth: ${Object.keys(auth).join(',')}`);

    const { z } = await import('zod');
    steps.push('imported zod');

    const base = mcp.createMcpHandler(
      (server: any) => {
        server.registerTool(
          'ping',
          { title: 'ping', description: 'ping', inputSchema: { x: z.string() } },
          async () => ({ content: [{ type: 'text', text: 'pong' }] })
        );
      },
      {},
      { basePath: '/api', maxDuration: 60 }
    );
    steps.push('createMcpHandler ok');

    const wrapped = mcp.withMcpAuth(base, (auth as any).verifyToken, {
      required: true,
    });
    steps.push(`withMcpAuth ok: ${typeof wrapped}`);

    return res.status(200).json({ ok: true, marker: 'mcpdiag-1', env, steps });
  } catch (e: any) {
    return res.status(500).json({
      ok: false,
      marker: 'mcpdiag-1',
      env,
      steps,
      error: String(e?.message ?? e),
      name: e?.name,
      stack: String(e?.stack ?? '').split('\n').slice(0, 14),
    });
  }
}
