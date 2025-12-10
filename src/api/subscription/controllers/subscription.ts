import { factories } from '@strapi/strapi';

export default factories.createCoreController('api::subscription.subscription', ({ strapi }) => ({
    // POST /api/payment/checkout
    async createCheckoutSession(ctx) {
        const { priceId, planType } = (ctx.request as any).body;
        const user = ctx.state.user;

        if (!user) return ctx.unauthorized('User not authenticated');

        try {
            const url = await strapi
                .service('api::subscription.subscription')
                .createStripeCheckoutSession(user.id, user.email, priceId, planType);
            return { data: { url } };

        } catch (error: any) {
            return ctx.badRequest(error.message);
        }
    },

    // POST /api/payment/webhook
    async webhook(ctx) {
        try {
            await strapi.service('api::subscription.subscription').handleStripeWebhook(ctx.request.body);
            return { received: true };
        } catch (err: any) {
            return ctx.badRequest(err.message);
        }
    },

    // GET /api/subscriptions/me
    async getMySubscription(ctx) {
        const userId = ctx.state.user?.id;
        if (!userId) return ctx.unauthorized();

        try {
            const sub = await strapi.db.query('api::subscription.subscription').findOne({
                where: { users_permissions_user: userId },
                select: ['plan_type', 'active_until']
            });

            let result = sub;
            if (!sub) {
                result = { plan_type: 'free', active_until: null };
            } else {
                const now = new Date();
                if (sub.active_until && new Date(sub.active_until) < now) {
                    result = { ...sub, plan_type: 'expired' };
                }
            }

            return { data: result };

        } catch (error: any) {
            return ctx.internalServerError(error.message);
        }
    },

}));