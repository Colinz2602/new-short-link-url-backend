import { factories } from '@strapi/strapi';

export default factories.createCoreController('api::tool.tool', ({ strapi }) => ({
    async find(ctx) {
        const user = ctx.state.user;
        const { data, meta } = await super.find(ctx);

        if (!user) {
            console.log("👉 [Backend] Returning GUEST data (is_active_for_user = false)");
            const processedData = data.map(tool => ({
                ...tool,
                is_active_for_user: tool.price === 0
            }));
            return { data: processedData, meta };
        }

        const sub = await strapi.db.query('api::subscription.subscription').findOne({
            where: { users_permissions_user: user.id },
            populate: ['tools']
        });

        // Kiểm tra quyền (Logic: Bundle/Annual/Quarterly -> ALL active; Single -> Check ID)
        const isVip = sub && ['bundle', 'annual', 'quarterly'].includes(sub.plan_type) && new Date(sub.active_until) > new Date();

        const purchasedToolIds = sub?.tools?.map(t => t.id) || [];

        const processedData = data.map(tool => {
            const isPurchased = purchasedToolIds.includes(tool.id);
            const isFree = tool.price === 0;
            const finalActive = isVip || isPurchased || isFree;

            return {
                ...tool,
                is_active_for_user: isVip || isPurchased || isFree
            };
        });

        return { data: processedData, meta };
    },
    async scrapeFacebook(ctx) {
        try {
            const { url } = ctx.request.body;

            if (!url) {
                return ctx.badRequest('URL is required');
            }

            const data = await strapi.service('api::tool.tool').scrapeFacebook(url);

            return { data };
        } catch (err: any) {
            return ctx.badRequest('Scrape failed', { error: err.message });
        }
    }
}));