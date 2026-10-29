import { checkOperatorScheduleSources } from '../../../../lib/operator-schedule-sources';
let cached: {
  checked: number;
  data: Awaited<ReturnType<typeof checkOperatorScheduleSources>>;
} | null = null;
let pending: ReturnType<typeof checkOperatorScheduleSources> | null = null;
export async function GET() {
  if (!cached || Date.now() - cached.checked > 15 * 60_000) {
    pending ??= checkOperatorScheduleSources();
    try {
      cached = { checked: Date.now(), data: await pending };
    } finally {
      pending = null;
    }
  }
  return Response.json(
    { data: cached.data },
    { headers: { 'cache-control': 'no-store' } },
  );
}
