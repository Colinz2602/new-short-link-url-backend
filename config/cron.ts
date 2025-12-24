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

    // Cron 3: AI Weekly Insights (Phase 3)
    // Chạy vào 00:00 sáng Thứ Hai hàng tuần
    generateAIInsights: {
        task: async ({ strapi }) => {
            console.log('[AI-Cron] Bắt đầu phân tích Insights tuần...');
            try {
                // Lấy Link có traffic cao (> 50 clicks)
                const highTrafficLinks = await strapi.db.query('api::link.link').findMany({
                    where: {
                        click_count: { $gt: 50 },
                        state: 'active',
                        users_permissions_user: { $notNull: true }
                    },
                    populate: ['users_permissions_user'],
                    limit: 20,
                });

                for (const link of highTrafficLinks) {
                    try {
                        const insights = await strapi.service('api::ai.ai').analyzeLinkInsights(link.id, link.owner.id);
                        console.log(`[AI-Cron] Generated insights for link ${link.short_code}`);
                        await strapi.entityService.update('api::link.link', link.id, {
                            data: { ai_insights: insights }
                        })
                    } catch (err) {
                        console.error(`[AI-Cron] Lỗi phân tích link ${link.id}:`, err.message);
                    }
                }
            } catch (err) {
                console.error('[AI-Cron] Lỗi hệ thống:', err);
            }
        },
        options: {
            rule: '0 0 * * 1',
        },
    },

    // Cron 4: Quét gói cước hết hạn (Subscription)
    // Chạy mỗi ngày lúc 01:00 sáng

    checkExpiredSubscriptions: {
        task: async ({ strapi }) => {
            try {
                const now = new Date();
                console.log(`[Subscription-Cron] Bắt đầu kiểm tra gói cước: ${now.toISOString()}`);

                // Tìm các subscription không phải Free và đã quá hạn active_until
                const expiredSubs = await strapi.db.query('api::subscription.subscription').findMany({
                    where: {
                        plan_type: {
                            $ne: 'free',
                        },
                        active_until: {
                            $notNull: true,
                            $lt: now,
                        },
                    },
                    select: ['id']
                });

                if (expiredSubs.length === 0) {
                    console.log('[Subscription-Cron] Tất cả gói cước đều hợp lệ.');
                    return;
                }

                console.log(`[Subscription-Cron] Tìm thấy ${expiredSubs.length} gói cước hết hạn. Tiến hành hạ cấp...`);

                const updatePromises = expiredSubs.map(async (sub) => {
                    // Update về Free và xóa ngày hết hạn
                    return strapi.entityService.update('api::subscription.subscription', sub.id, {
                        data: {
                            plan_type: 'free',
                            active_until: null,
                            stripe_subscription_id: null
                        }
                    });
                });

                await Promise.all(updatePromises);
                console.log(`[Subscription-Cron] Đã hạ cấp thành công ${expiredSubs.length} tài khoản về gói Free.`);

            } catch (err) {
                console.error('[Subscription-Cron] Lỗi hệ thống:', err);
            }
        },
        options: {
            rule: '0 1 * * *',
        }
    }
};