/** Fixed official destinations only: no user location, credentials or arbitrary URL. */
export const OPERATOR_SCHEDULE_SOURCES = [
  {
    operator: 'LRT Jabodebek',
    url: 'https://lrtjabodebek.kai.id/jadwal-keberangkatan',
  },
  { operator: 'MRT Jakarta', url: 'https://jakartamrt.co.id/id' },
  {
    operator: 'KRL',
    url: 'https://www.commuterline.id/layanan/info-pelanggan',
  },
] as const;
export async function checkOperatorScheduleSources(
  fetcher: typeof fetch = fetch,
) {
  return Promise.all(
    OPERATOR_SCHEDULE_SOURCES.map(async (source) => {
      let reachable = false;
      try {
        const response = await fetcher(source.url, {
          method: 'HEAD',
          redirect: 'error',
          signal: AbortSignal.timeout(6000),
          cache: 'no-store',
        });
        reachable = response.ok;
      } catch {
        /* No retry, bypass or inferred arrival on source failure. */
      }
      return {
        ...source,
        checked_at: new Date().toISOString(),
        website_reachable: reachable,
        arrival_status: 'NOT_CONNECTED' as const,
        arrivals: [],
        limitation: 'Belum ada integrasi jadwal kedatangan tervalidasi.',
      };
    }),
  );
}
