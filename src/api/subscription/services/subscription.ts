import { factories } from '@strapi/strapi';
import Stripe from 'stripe';

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
const stripe = new Stripe(STRIPE_KEY || '', {
    apiVersion: '2025-11-17.clover',
    typescript: true,
});

export default factories.createCoreService('api::subscription.subscription', ({ strapi }) => ({
    // Tạo Stripe checkout session cho POST /api/payment/checkout
    async createStripeCheckoutSession(userId: number, userEmail: string, priceId: string, planType: string, toolId?: number) {

        if (!process.env.STRIPE_SECRET_KEY) {
            throw new Error('Stripe Key missing on Server');
        }

        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

        try {
            const sessionConfig: Stripe.Checkout.SessionCreateParams = {
                payment_method_types: ['card'],
                mode: planType === 'tool' ? 'payment' : 'subscription',
                customer_email: userEmail,
                line_items: [{ price: priceId, quantity: 1 }],
                success_url: `${frontendUrl}/?payment=success`,
                cancel_url: `${frontendUrl}/pricing?payment=cancelled`,
                metadata: { userId: userId.toString(), planType, toolId: toolId ? toolId.toString() : '' },
            };

            if (planType === 'tool') {
                sessionConfig.customer_creation = 'always';
            }

            const session = await stripe.checkout.sessions.create(sessionConfig);
            return session.url;
        } catch (e: any) {
            throw e;
        }
    },

    // Stripe webhook cho POST /api/payment/webhook
    async handleStripeWebhook(event: any) {
        switch (event.type) {
            case 'checkout.session.completed':
                await this.updateUserSubscription(event.data.object);
                break;
            case 'customer.subscription.deleted':
                await this.downgradeToFree(event.data.object);
                break;
        }
        return { received: true };
    },

    async updateUserSubscription(session: any) {
        const { userId, planType, toolId } = session.metadata;
        if (!userId) {
            return;
        }
        const stripeCustomerId = session.customer;
        const stripeSubscriptionId = session.subscription;

        const now = new Date();
        const expirationDate = new Date(now);
        switch (planType) {
            case 'annual':
                expirationDate.setFullYear(now.getFullYear() + 1);
                break;
            case 'quarterly':
                expirationDate.setMonth(now.getMonth() + 3);
                break;
            case 'bundle':
            case 'tool':
            default:
                expirationDate.setDate(now.getDate() + 30);
                break;
        }

        const existingSub = await strapi.db.query('api::subscription.subscription').findOne({
            where: { users_permissions_user: userId },
            populate: ['tools']
        });

        const data: any = {
            users_permissions_user: userId,
            stripe_customer_id: stripeCustomerId,
        };

        if (stripeSubscriptionId) {
            data.stripe_subscription_id = stripeSubscriptionId;
            data.plan_type = planType;
            data.active_until = expirationDate;
        } else if (!existingSub) {
            data.plan_type = planType;
            data.active_until = expirationDate;
        }

        if (planType === 'tool' && toolId) {
            const currentToolIds = existingSub?.tools?.map((t: any) => t.id) || [];
            data.tools = [...new Set([...currentToolIds, parseInt(toolId)])];
        }

        if (existingSub) {
            await strapi.entityService.update('api::subscription.subscription', existingSub.id, { data });
        } else {
            await strapi.entityService.create('api::subscription.subscription', { data });
        }
    },

    async downgradeToFree(subscription: any) {
        const sub = await strapi.db.query('api::subscription.subscription').findOne({
            where: { stripe_subscription_id: subscription.id }
        });
        if (sub) {
            await strapi.entityService.update('api::subscription.subscription', sub.id, {
                data: { plan_type: 'free', active_until: null, stripe_subscription_id: null }
            });
        }
    }
}));