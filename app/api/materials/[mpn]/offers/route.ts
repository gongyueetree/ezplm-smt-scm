import { NextResponse } from "next/server";
import { ProviderType, type Prisma } from "@prisma/client";
import { buildOfferCacheKey, CACHE_TTL_SECONDS } from "@/lib/providers/common/cache";
import { ProviderError } from "@/lib/providers/common/errors";
import { manufacturerMatches } from "@/lib/providers/common/mpn";
import type { NormalizedOffer } from "@/lib/providers/common/normalized-offer";
import { digiKeyMode, getDigiKeyProvider } from "@/lib/providers/digikey";
import { getMouserProvider, mouserMode } from "@/lib/providers/mouser";
import { badRequest, requireSession } from "@/lib/server/api";
import { prisma } from "@/lib/server/db";
import { tenantData, tenantWhere } from "@/lib/server/tenant-scope";

export const runtime = "nodejs";

interface CachedOffers {
  offers: NormalizedOffer[];
  degraded: { provider: string; kind: string; message: string }[];
}

/**
 * 物料详情页的分销商价格与库存(DigiKey + Mouser)。
 *
 * 纪律:
 * - 走 ExternalPartSnapshot 缓存,TTL 取 SPEC §15 的价格/库存档(15 分钟);
 *   页面上显示的是**数据更新时间**,不得暗示实时;
 * - provider 失败只降级不阻断,degraded 如实返回;
 * - **不做汇率换算**,各源币种原样返回,由 UI 标注;
 * - 同号异厂料单独标注,不与本厂料混在一起看价格。
 */
export async function GET(req: Request, { params }: { params: Promise<{ mpn: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  const { mpn: raw } = await params;
  const mpn = decodeURIComponent(raw).trim();
  if (!mpn) return badRequest("缺少 MPN");
  const expectedManufacturer = new URL(req.url).searchParams.get("manufacturer");

  const cacheKey = buildOfferCacheKey({
    provider: "DIGIKEY",
    site: "DETAIL",
    currency: "-",
    mpn,
    manufacturer: null,
    quantity: null,
  });

  const cached = await prisma.externalPartSnapshot.findFirst({
    where: tenantWhere(auth.session.tenantId, { source: ProviderType.DIGIKEY, cacheKey }),
  });

  let payload: CachedOffers;
  let fetchedAt: Date;
  let fromCache = false;

  if (cached && cached.expiresAt > new Date()) {
    payload = cached.payload as unknown as CachedOffers;
    fetchedAt = cached.fetchedAt;
    fromCache = true;
  } else {
    const offers: NormalizedOffer[] = [];
    const degraded: CachedOffers["degraded"] = [];
    for (const provider of [getDigiKeyProvider(), getMouserProvider()]) {
      try {
        offers.push(...(await provider.getOffersByMpn({ mpn })));
      } catch (e) {
        degraded.push(
          e instanceof ProviderError
            ? { provider: e.provider, kind: e.kind, message: e.message }
            : { provider: provider.name, kind: "unknown", message: String(e) },
        );
      }
    }
    payload = { offers, degraded };
    fetchedAt = new Date();
    const ttl = CACHE_TTL_SECONDS.PRICE_STOCK;
    await prisma.externalPartSnapshot.upsert({
      where: {
        tenantId_source_cacheKey: {
          tenantId: auth.session.tenantId,
          source: ProviderType.DIGIKEY,
          cacheKey,
        },
      },
      update: {
        payload: payload as unknown as Prisma.InputJsonValue,
        fetchedAt,
        ttlSeconds: ttl,
        expiresAt: new Date(fetchedAt.getTime() + ttl * 1000),
      },
      create: tenantData(auth.session.tenantId, {
        source: ProviderType.DIGIKEY,
        cacheKey,
        payload: payload as unknown as Prisma.InputJsonValue,
        fetchedAt,
        ttlSeconds: ttl,
        expiresAt: new Date(fetchedAt.getTime() + ttl * 1000),
      }),
    });
  }

  // 同号异厂料单独标注 —— 不是同一颗料,价格不可直接比
  const rows = payload.offers.map((o) => ({
    ...o,
    manufacturerMismatch: expectedManufacturer
      ? !manufacturerMatches(expectedManufacturer, o.manufacturer)
      : false,
  }));

  return NextResponse.json({
    offers: rows,
    degraded: payload.degraded,
    fetchedAt: fetchedAt.toISOString(),
    fromCache,
    ttlSeconds: CACHE_TTL_SECONDS.PRICE_STOCK,
    modes: { digikey: digiKeyMode(), mouser: mouserMode() },
  });
}
