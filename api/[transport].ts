/**
 * api/[transport].ts
 * ------------------
 * The Aligned MCP server, as a Vercel Function. Serves the MCP endpoint at
 *   https://getitaligned.com/api/mcp   (that's your connector URL)
 *
 * Auth is enforced by withMcpAuth + verifyToken (Supabase OAuth tokens). Every
 * tool runs as the calling user via userClient(), so RLS scopes the data.
 *
 * Schema is mapped to Aligned's real tables (verified live):
 *   recordings(id,title,date,source,status,analysis jsonb{transcript,summary,
 *              actionPoints,meetingType,detectedLanguages})
 *   action_items(id,user_id,recording_id,text,status,assignee,due_date,created_at)
 *
 * NOTE: this uses Vercel's Web-handler function exports (export const GET/POST).
 * `[transport]` is a Vercel dynamic route segment, so this file answers /api/mcp.
 */

import { createMcpHandler, withMcpAuth } from 'mcp-handler';
import { z } from 'zod';
import { verifyToken, userClient } from '../_lib/mcpAuth';

const RECORDINGS = 'recordings';
const ACTION_ITEMS = 'action_items';
const ARCHIVED = 'archived';
const DEFAULT_STATUS = 'not_started';

// Pull the verified token / user id that withMcpAuth attached to the request.
const tokenFrom = (extra: any): string => extra?.authInfo?.token as string;
const userIdFrom = (extra: any): string | undefined =>
  extra?.authInfo?.extra?.userId as string | undefined;

const ok = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data ?? null) }],
});

const makeBase = () => createMcpHandler(
  (server) => {
    // ---- meetings (read) -------------------------------------------------
    server.registerTool(
      'search_meetings',
      {
        title: 'Search meetings',
        description:
          "Search the user's meetings by title. Returns id, title, source, date (epoch ms) — not transcripts.",
        inputSchema: {
          query: z.string(),
          limit: z.number().int().min(1).max(50).default(10),
        },
      },
      async ({ query, limit }, extra) => {
        const sb = userClient(tokenFrom(extra));
        const { data, error } = await sb
          .from(RECORDINGS)
          .select('id,title,source,date')
          .ilike('title', `%${query}%`)
          .order('date', { ascending: false })
          .limit(limit);
        if (error) throw new Error(error.message);
        return ok(data);
      }
    );

    server.registerTool(
      'get_meeting',
      {
        title: 'Get meeting',
        description:
          'Fetch a meeting: metadata + summary + action points, WITHOUT the raw transcript. Use get_transcript for full text.',
        inputSchema: { meeting_id: z.string() },
      },
      async ({ meeting_id }, extra) => {
        const sb = userClient(tokenFrom(extra));
        const { data, error } = await sb
          .from(RECORDINGS)
          .select('id,title,date,source,status,analysis')
          .eq('id', meeting_id)
          .single();
        if (error) throw new Error(error.message);
        const a = (data?.analysis ?? {}) as Record<string, unknown>;
        return ok({
          id: data?.id,
          title: data?.title,
          date: data?.date,
          source: data?.source,
          status: data?.status,
          summary: a.summary,
          actionPoints: a.actionPoints,
          meetingType: a.meetingType,
          detectedLanguages: a.detectedLanguages,
        });
      }
    );

    server.registerTool(
      'get_summary',
      {
        title: 'Get summary',
        description: 'Fetch just the AI-generated summary for a meeting.',
        inputSchema: { meeting_id: z.string() },
      },
      async ({ meeting_id }, extra) => {
        const sb = userClient(tokenFrom(extra));
        const { data, error } = await sb
          .from(RECORDINGS)
          .select('id,title,analysis')
          .eq('id', meeting_id)
          .single();
        if (error) throw new Error(error.message);
        const a = (data?.analysis ?? {}) as Record<string, unknown>;
        return ok({ id: data?.id, title: data?.title, summary: a.summary });
      }
    );

    server.registerTool(
      'get_transcript',
      {
        title: 'Get transcript',
        description: 'Fetch the full transcript text for a meeting (can be long).',
        inputSchema: { meeting_id: z.string() },
      },
      async ({ meeting_id }, extra) => {
        const sb = userClient(tokenFrom(extra));
        const { data, error } = await sb
          .from(RECORDINGS)
          .select('id,title,analysis')
          .eq('id', meeting_id)
          .single();
        if (error) throw new Error(error.message);
        const a = (data?.analysis ?? {}) as Record<string, unknown>;
        return ok({ id: data?.id, title: data?.title, transcript: a.transcript });
      }
    );

    // ---- action items (read + write) ------------------------------------
    server.registerTool(
      'list_action_items',
      {
        title: 'List action items',
        description:
          "List the user's action items. Archived items are hidden unless status='archived'.",
        inputSchema: {
          status: z.string().optional(),
          assignee: z.string().optional(),
          limit: z.number().int().min(1).max(100).default(50),
        },
      },
      async ({ status, assignee, limit }, extra) => {
        const sb = userClient(tokenFrom(extra));
        let q = sb.from(ACTION_ITEMS).select('*');
        if (status) q = q.eq('status', status);
        else q = q.neq('status', ARCHIVED);
        if (assignee) q = q.eq('assignee', assignee);
        const { data, error } = await q
          .order('created_at', { ascending: false })
          .limit(limit);
        if (error) throw new Error(error.message);
        return ok(data);
      }
    );

    server.registerTool(
      'create_action_item',
      {
        title: 'Create action item',
        description:
          'Create an action item. text = content; due_date = YYYY-MM-DD; recording_id optionally links a meeting.',
        inputSchema: {
          text: z.string(),
          recording_id: z.string().optional(),
          assignee: z.string().optional(),
          due_date: z.string().optional(),
          status: z.string().default(DEFAULT_STATUS),
        },
      },
      async ({ text, recording_id, assignee, due_date, status }, extra) => {
        const sb = userClient(tokenFrom(extra));
        const row: Record<string, unknown> = { text, status };
        const uid = userIdFrom(extra); // user_id has no DB default; set from token for RLS
        if (uid) row.user_id = uid;
        if (recording_id) row.recording_id = recording_id;
        if (assignee) row.assignee = assignee;
        if (due_date) row.due_date = due_date;
        const { data, error } = await sb
          .from(ACTION_ITEMS)
          .insert(row)
          .select()
          .single();
        if (error) throw new Error(error.message);
        return ok(data);
      }
    );

    server.registerTool(
      'update_action_item',
      {
        title: 'Update action item',
        description: 'Update fields on an action item. Only provided fields change.',
        inputSchema: {
          action_item_id: z.string(),
          text: z.string().optional(),
          status: z.string().optional(),
          assignee: z.string().optional(),
          due_date: z.string().optional(),
        },
      },
      async ({ action_item_id, text, status, assignee, due_date }, extra) => {
        const sb = userClient(tokenFrom(extra));
        const patch: Record<string, unknown> = {};
        if (text !== undefined) patch.text = text;
        if (status !== undefined) patch.status = status;
        if (assignee !== undefined) patch.assignee = assignee;
        if (due_date !== undefined) patch.due_date = due_date;
        if (Object.keys(patch).length === 0)
          return ok({ error: 'No fields provided to update.' });
        const { data, error } = await sb
          .from(ACTION_ITEMS)
          .update(patch)
          .eq('id', action_item_id)
          .select()
          .single();
        if (error) throw new Error(error.message);
        return ok(data);
      }
    );

    server.registerTool(
      'archive_action_item',
      {
        title: 'Archive action item',
        description:
          "Soft delete: sets status='archived' so it drops out of normal lists but stays recoverable.",
        inputSchema: { action_item_id: z.string() },
      },
      async ({ action_item_id }, extra) => {
        const sb = userClient(tokenFrom(extra));
        const { data, error } = await sb
          .from(ACTION_ITEMS)
          .update({ status: ARCHIVED })
          .eq('id', action_item_id)
          .select()
          .single();
        if (error) throw new Error(error.message);
        return ok(data);
      }
    );
  },
  {},
  {
    // basePath must match where this [transport] file lives, so the route is /api/mcp
    basePath: '/api',
    // If you later enable the SSE transport or want resumable streams, set an
    // Upstash Redis URL here: redisUrl: process.env.REDIS_URL
    verboseLogs: true,
    maxDuration: 60,
  }
);

// TEMP DIAGNOSTIC (marker diag-v3): build the handler lazily INSIDE try/catch so
// a construction/module-load error is surfaced in the response too, not just a
// generic platform 500. `?diag=1` returns a marker (no auth) to confirm which
// deploy is live. Remove this whole block once the root cause is fixed.
const json = (obj: unknown, status: number) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  });

let _handler: ((req: Request) => Promise<Response>) | null = null;

const debugHandler = async (req: Request): Promise<Response> => {
  let phase = 'construct';
  try {
    if (!_handler) {
      _handler = withMcpAuth(makeBase(), verifyToken, { required: true });
    }
    if (new URL(req.url).searchParams.get('diag') === '1') {
      return json(
        {
          ok: true,
          marker: 'diag-v3',
          hasSupabaseUrl: !!process.env.SUPABASE_URL,
          hasSupabaseAnonKey: !!process.env.SUPABASE_ANON_KEY,
        },
        200
      );
    }
    phase = 'request';
    return await _handler(req);
  } catch (e: any) {
    return json(
      {
        marker: 'diag-v3',
        phase,
        debug_error: String(e?.message ?? e),
        name: e?.name,
        stack: String(e?.stack ?? '').split('\n').slice(0, 10),
      },
      500
    );
  }
};

export { debugHandler as GET, debugHandler as POST, debugHandler as DELETE };
