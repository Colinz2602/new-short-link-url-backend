import { redis } from './redis';

const REDIS_CLICK_QUEUE = 'queue:clicks';
const BATCH_SIZE = 100;

export default {
    // Cron 1: Xử lý Analytics Queue
    // Chạy mỗi 1 phút
    processAnalyticsQueue: {
        task: async ({ strapi }) => {
            const pipeline = redis.pipeline();
            for (let i = 0; i < BATCH_SIZE; i++) {
                pipeline.rpop(REDIS_CLICK_QUEUE);
            }

            const results = await pipeline.exec();

            // Parse dữ liệu từ Redis
            const rawClicks: any[] = [];
            results?.forEach(([err, result]) => {
                if (!err && result) {
                    try {
                        rawClicks.push(JSON.parse(result as string));
                    } catch (e) {
                        console.error('Error parsing JSON from Redis:', result);
                    }
                }
            });

            if (rawClicks.length === 0) {
                return;
            }

            console.log(`Processing ${rawClicks.length} clicks from Redis...`);

            try {
                // Lọc các Link ID còn tồn tại
                const uniqueLinkIds = [...new Set(rawClicks.map(c => c.linkId))];

                const existingLinks = await strapi.db.query('api::link.link').findMany({
                    where: {
                        id: { $in: uniqueLinkIds }
                    },
                    select: ['id']
                });

                const existingLinkIdsSet = new Set(existingLinks.map(l => l.id));

                const validClicks = rawClicks.filter(click => {
                    if (existingLinkIdsSet.has(click.linkId)) return true;
                    console.warn(`[Analytics Cron] Bỏ qua click cho Link ID ${click.linkId} vì link không tồn tại.`);
                    return false;
                });

                if (validClicks.length === 0) {
                    console.log('Không có click hợp lệ để xử lý.');
                    return;
                }

                const linkClickCounts: Record<number, number> = {};

                // Transaction xử lý batch click
                await strapi.db.transaction(async ({ trx }) => {
                    const createPromises = validClicks.map(async (clickData) => {
                        // Đếm số click mỗi link
                        if (!linkClickCounts[clickData.linkId]) {
                            linkClickCounts[clickData.linkId] = 0;
                        }
                        linkClickCounts[clickData.linkId]++;

                        return strapi.db.query('api::click.click').create({
                            data: {
                                link: clickData.linkId,
                                ip: clickData.ip,
                                country: clickData.country,
                                device: clickData.device,
                                referrer: clickData.referrer,
                                timestamp: clickData.timestamp
                            },
                        });
                    });

                    await Promise.all(createPromises);

                    // Update click_count của Link
                    const updatePromises = Object.keys(linkClickCounts).map(async (linkId) => {
                        const countToAdd = linkClickCounts[Number(linkId)];

                        const link = await strapi.db.query('api::link.link').findOne({
                            where: { id: linkId },
                            select: ['click_count']
                        });

                        if (link) {
                            await strapi.db.query('api::link.link').update({
                                where: { id: linkId },
                                data: {
                                    click_count: (link.click_count || 0) + countToAdd
                                }
                            });
                        }
                    });

                    await Promise.all(updatePromises);
                });

                console.log(`Successfully processed ${validClicks.length} clicks.`);
            } catch (error) {
                console.error('Error processing click batch:', error);
            }
        },

        options: {
            rule: '*/1 * * * *', // chạy mỗi phút
        },
    },

    // Cron 2: Quét Link hết hạn
    // Chạy mỗi 1 ngày
    expireLinks: {
        task: async ({ strapi }) => {
            try {
                const now = new Date();
                console.log(`[Expiration-Cron] Bắt đầu quét link hết hạn: ${now.toISOString()}`);

                const result = await strapi.db.query('api::link.link').updateMany({
                    where: {
                        state: 'active',
                        expire_at: {
                            $notNull: true,
                            $lt: now,
                        },
                    },
                    data: {
                        state: 'expired',
                    },
                });

                if (result.count > 0) {
                    console.log(`[Expiration-Cron] Đã khóa ${result.count} link hết hạn.`);
                } else {
                    console.log(`[Expiration-Cron] Không có link nào hết hạn.`);
                }
            } catch (err) {
                console.error('[Expiration-Cron] Lỗi hệ thống:', err);
            }
        },

        options: {
            rule: '0 0 * * *', // Chạy mỗi ngày lúc 00:00
        },
    },
};