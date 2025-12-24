import { errors } from '@strapi/utils';
import { DateTime } from 'luxon';
import { redis } from '../../../../config/redis';

const REDIS_CLICK_QUEUE = 'queue:clicks';

export default ({ strapi }) => ({
    // Hàm logClick cho POST /api/analytics/click
    async logClick(data: { slug: string, ip: string, device: string, country: string, referrer: string }) {
        const { slug, ip, country, device, referrer } = data;

        const link = await strapi.db.query('api::link.link').findOne({
            where: { short_code: slug },
            select: ['id', 'state', 'expire_at']
        });

        if (!link) return null;

        const now = new Date();
        if (link.state !== 'active') {
            return { queued: false, reason: 'Link not active' };
        }
        if (link.expire_at && new Date(link.expire_at) < now) {
            return { queued: false, reason: 'Link expired' };
        }

        const payload = JSON.stringify({
            linkId: link.id,
            slug,
            ip,
            country,
            device,
            referrer,
            timestamp: new Date().toISOString()
        });

        await redis.lpush(REDIS_CLICK_QUEUE, payload);

        return { queued: true };
    },

    // Hàm getAnalytics cho GET /api/analytics/:linkId
    async getAnalytics(linkId: number | string, userId: number | string) {
        const link = await strapi.db.query('api::link.link').findOne({
            where: { id: linkId, users_permissions_user: userId },
            populate: ['domain', 'qr_image']
        });

        if (!link) {
            throw new errors.NotFoundError('Link not found or unauthorized.');
        }
        const clicks = await strapi.db.query('api::click.click').findMany({
            where: { link: linkId },
            select: ['timestamp', 'country', 'device', 'referrer']
        });
        const stats = {
            total: clicks.length,
            byDate: {} as Record<string, number>,
            byCountry: {} as Record<string, number>,
            byDevice: {} as Record<string, number>,
            byReferrer: {} as Record<string, number>
        };

        clicks.forEach(c => {
            const date = DateTime.fromISO(c.timestamp).toISODate(); // YYYY-MM-DD
            stats.byDate[date] = (stats.byDate[date] || 0) + 1;

            const country = c.country || 'Unknown';
            stats.byCountry[country] = (stats.byCountry[country] || 0) + 1;

            const device = c.device || 'Other';
            stats.byDevice[device] = (stats.byDevice[device] || 0) + 1;

            const ref = c.referrer || 'Direct';
            stats.byReferrer[ref] = (stats.byReferrer[ref] || 0) + 1;
        });
        const result = {
            link: {
                id: link.id,
                full_short_url: link.full_short_url,
                original_url: link.original_url,
                created_at: link.createdAt,
                qr_image: link.qr_image,
                ai_insights: link.ai_insights
            },
            analytics: {
                total_clicks: stats.total,
                clicksOverTime: Object.entries(stats.byDate)
                    .map(([date, count]) => ({ date, count }))
                    .sort((a, b) => a.date.localeCompare(b.date)),

                topCountries: Object.entries(stats.byCountry)
                    .map(([name, value]) => ({ name, value }))
                    .sort((a, b) => b.value - a.value)
                    .slice(0, 10),

                topDevices: Object.entries(stats.byDevice)
                    .map(([name, value]) => ({ name, value })),

                topReferrers: Object.entries(stats.byReferrer)
                    .map(([name, value]) => ({ name, value }))
                    .sort((a, b) => b.value - a.value)
                    .slice(0, 10)
            }
        };
        return result;
    }
});