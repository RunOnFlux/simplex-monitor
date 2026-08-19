import type { NextRequest } from 'next/server';
import { err, ok } from '@/lib/api';
import { appConfig, getServer } from '@/lib/config';
import { chartsForKind, getChart, getServerVersion, queryRange } from '@/lib/prometheus';

export const dynamic = 'force-dynamic';

const RANGES: Record<string, { ms: number; stepSec: number }> = {
  '6h': { ms: 6 * 60 * 60 * 1000, stepSec: 120 },
  '24h': { ms: 24 * 60 * 60 * 1000, stepSec: 300 },
  '7d': { ms: 7 * 24 * 60 * 60 * 1000, stepSec: 3600 },
  '30d': { ms: 30 * 24 * 60 * 60 * 1000, stepSec: 4 * 3600 },
};

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const server = getServer(id);
  if (!server) return err(404, 'NotFound', `Unknown server ${id}`);
  if (!appConfig.prometheusUrl) {
    return ok({ enabled: false, charts: [], version: null });
  }
  const params = request.nextUrl.searchParams;
  const range = RANGES[params.get('range') ?? '24h'];
  if (!range) return err(400, 'BadRequest', 'range must be one of 6h, 24h, 7d, 30d');

  const chartId = params.get('chart');
  try {
    if (!chartId) {
      // chart catalog + server version
      return ok({
        enabled: true,
        charts: chartsForKind(server.kind).map(({ id: cid, title, unit, series }) => ({
          id: cid,
          title,
          unit,
          seriesLabels: series.map((s) => s.label),
        })),
        version: await getServerVersion(server.kind, server.id),
      });
    }
    const chart = getChart(server.kind, chartId);
    if (!chart) return err(404, 'NotFound', `Unknown chart ${chartId}`);
    const endSec = Math.floor(Date.now() / 1000);
    const startSec = endSec - Math.floor(range.ms / 1000);
    const series = await Promise.all(
      chart.series.map(async (s) => ({
        label: s.label,
        points: await queryRange(
          s.query.replaceAll('SERVER', server.id),
          startSec,
          endSec,
          range.stepSec,
        ),
      })),
    );
    return ok({
      enabled: true,
      chart: { id: chart.id, title: chart.title, unit: chart.unit },
      series,
    });
  } catch (e) {
    return err(502, 'PrometheusError', (e as Error).message);
  }
}
