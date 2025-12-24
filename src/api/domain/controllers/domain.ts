/**
 * api/domain/controllers/domain.ts
 */
import { factories } from '@strapi/strapi';
import { errors } from '@strapi/utils';

export default factories.createCoreController('api::domain.domain', ({ strapi }) => ({
    async find(ctx) {
        const user = ctx.state.user;
        const filters = ctx.query.filters as any || {};

        if (filters.type === 'public') {
            return super.find(ctx);
        }

        if (!user) {
            return ctx.unauthorized('You must be logged in to view these domains');
        }

        ctx.query.filters = {
            $and: [
                { type: 'custom' },
                { users_permissions_user: { id: user.id } }
            ]
        };

        if (!filters.type) {
            ctx.query.filters = {
                $or: [
                    { type: 'public' },
                    {
                        $and: [
                            { type: 'custom' },
                            { users_permissions_user: { id: user.id } }
                        ]
                    }
                ]
            };
        }

        const { data, meta } = await super.find(ctx);
        return { data, meta };
    },

    async create(ctx) {
        const user = ctx.state.user;
        if (!user) return ctx.unauthorized('Bạn cần đăng nhập để tạo domain.');
        const existingDomain = await strapi.db.query('api::domain.domain').findOne({
            where: {
                users_permissions_user: user.id,
                type: 'custom'
            }
        });

        if (existingDomain) {
            return ctx.badRequest('Mỗi tài khoản chỉ được tạo 1 Custom Domain.');
        }
        if (!ctx.request.body.data) {
            ctx.request.body = { data: { ...ctx.request.body } };
        }

        ctx.request.body.data.users_permissions_user = user.id;
        ctx.request.body.data.type = 'custom';

        const domainName = ctx.request.body.data.domain_name;
        if (!domainName || domainName.includes('http') || domainName.includes('/')) {
            return ctx.badRequest('Domain không hợp lệ. Chỉ nhập định dạng: sub.example.com');
        }

        try {
            const response = await super.create(ctx);
            return response;
        } catch (err: any) {
            if (err.message.includes('unique')) {
                return ctx.badRequest('Domain này đã tồn tại trên hệ thống.');
            }
            return ctx.badRequest(err.message);
        }
    }
}));