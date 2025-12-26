import { factories } from '@strapi/strapi';
import { errors } from '@strapi/utils';

export default factories.createCoreController('api::link.link', ({ strapi }) => ({
    // POST /api/link/verify
    async verify(ctx) {
        const { originalUrl } = ctx.request.body;
        if (!originalUrl) return ctx.badRequest('Missing originalUrl');

        try {
            const result = await strapi.service('api::link.link').verifyLink(originalUrl);
            return { data: result };
        } catch (err: any) {
            return ctx.badRequest(err.message);
        }
    },

    // POST /api/link/create
    async create(ctx) {
        try {
            const user = ctx.state.user;
            let ip = ctx.request.header['x-forwarded-for'] || ctx.request.ip;
            if (typeof ip === 'string' && ip.includes(',')) {
                ip = ip.split(',')[0].trim();
            }
            // Chuẩn hóa IP local
            if (ip === '::1' || ip === '127.0.0.1') ip = '127.0.0.1';

            if (!ctx.request.body.data) {
                ctx.request.body = { data: { ...ctx.request.body } };
            }

            if (ctx.request.body.data.domain) {
                ctx.request.body.data.domain = Number(ctx.request.body.data.domain);
            }

            const now = new Date();
            const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            if (!user) {
                const count = await strapi.db.query('api::link.link').count({
                    where: {
                        creator_ip: ip,
                        createdAt: { $gte: thirtyDaysAgo.toISOString() },
                        users_permissions_user: null
                    }
                });

                if (count >= 50) {
                    return ctx.badRequest('Bạn đã đạt giới hạn 50 links miễn phí');
                }

                ctx.request.body.data.creator_ip = ip;
                ctx.request.body.data.users_permissions_user = null;

            } else {
                const sub = await strapi.db.query('api::subscription.subscription').findOne({
                    where: { users_permissions_user: user.id }
                });
                const isFreeUser = !sub ||
                    sub.plan_type === 'free' ||
                    (sub.active_until && new Date(sub.active_until) < now);
                if (isFreeUser) {
                    const count = await strapi.db.query('api::link.link').count({
                        where: {
                            users_permissions_user: user.id,
                            createdAt: { $gte: thirtyDaysAgo.toISOString() }
                        }
                    });

                    if (count >= 200) {
                        return ctx.badRequest('Tài khoản Free giới hạn tạo 200 links/tháng. Vui lòng nâng cấp gói để tạo không giới hạn.');
                    }
                }

                ctx.request.body.data.users_permissions_user = user.id;
                ctx.request.body.data.creator_ip = ip;
            }

            const result = await strapi.service('api::link.link').create({
                data: ctx.request.body.data
            });

            const sanitizedEntity = await this.sanitizeOutput(result, ctx);
            return this.transformResponse(sanitizedEntity);
        } catch (err: any) {
            return ctx.badRequest(err.message, { details: err.details });
        }
    },

    // GET /links/:slug
    async redirect(ctx) {
        const { slug } = ctx.params;
        const hostname = ctx.query.host || ctx.request.header.host;
        const country = ctx.state.userCountry || 'Unknown';
        try {
            const targetUrl = await strapi.service('api::link.link').getRedirectTarget(slug, hostname, country);
            return { data: { targetUrl } };
        } catch (err: any) {
            if (err instanceof errors.NotFoundError) return ctx.notFound(err.message);
            if (err instanceof errors.ForbiddenError) return ctx.forbidden(err.message);
            return ctx.badRequest(err.message);
        }
    },

    // POST /links/bulk
    async bulkImport(ctx) {
        const user = ctx.state.user;
        if (!user) return ctx.unauthorized();

        const { files } = ctx.request as any;
        const file = files?.file || files?.files;

        if (!file) return ctx.badRequest('File CSV is required');

        try {
            const result = await strapi.service('api::link.link').processBulkImport(file, user.id);
            return { data: result };
        } catch (err: any) {
            return ctx.badRequest(err.message);
        }
    },

    // GET /api/links/find cho dashboard
    async find(ctx) {
        try {
            const user = ctx.state.user;
            if (!user) return ctx.unauthorized('Bạn cần đăng nhập.');

            const { page, pageSize } = ctx.query;
            if (page || pageSize) {
                ctx.query.pagination = {
                    ...(ctx.query.pagination as Record<string, any>),
                    page,
                    pageSize,
                };
                delete ctx.query.page;
                delete ctx.query.pageSize;
            }

            const secureFilter = { users_permissions_user: { id: user.id } };

            if (ctx.query.filters) {
                ctx.query.filters = { $and: [ctx.query.filters, secureFilter] };
            } else {
                ctx.query.filters = secureFilter;
            }

            if (!ctx.query.sort) ctx.query.sort = 'createdAt:desc';
            if (!ctx.query.populate) ctx.query.populate = { domain: { fields: ['domain_name'] } };

            const result = await super.find(ctx);
            return result;

        } catch (err: any) {
            console.error('Find Error:', err);
            return ctx.badRequest(err.message, { details: err.details });
        }
    },

    // POST /links/:id/qr cho tạo QR code
    async generateQr(ctx) {
        const { id } = ctx.params;
        const user = ctx.state.user;
        if (!user) return ctx.unauthorized();

        try {
            const link = await strapi.db.query('api::link.link').findOne({
                where: {
                    $or: [{ id: id }, { documentId: id }],
                    users_permissions_user: user.id
                },
                populate: ['qr_image']
            });

            const linkById = !link ? await strapi.db.query('api::link.link').findOne({
                where: { id: id, users_permissions_user: user.id }, populate: ['qr_image']
            }) : null;


            const finalLink = link || linkById;
            if (!finalLink) return ctx.notFound('Link not found or unauthorized');

            if (finalLink.qr_image) {
                return { data: { url: finalLink.qr_image.url, isNew: false } };
            }
            const qrFile = await strapi.service('api::link.link').generateQrCode(finalLink.id, finalLink.full_short_url);
            return { data: { url: qrFile.url, isNew: true } };

        } catch (err: any) {
            return ctx.badRequest(err.message);
        }
    },
}));