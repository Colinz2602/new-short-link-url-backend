import { UAParser } from 'ua-parser-js';

export default ({ strapi }) => ({
  // POST /api/analytics/click
  async logClick(ctx) {
    try {
      const { slug } = ctx.request.body;
      const ip = ctx.request.ip || 'unknown';

      const userAgent = ctx.request.header['user-agent'] || '';
      const parser = new UAParser(userAgent);
      const deviceType = parser.getResult().device.type || 'desktop';

      await strapi.service('api::analytics.analytics').logClick({
        slug,
        ip,
        device: deviceType,
        country: ctx.state.userCountry || 'unknown',
        referrer: ctx.request.header['referer'] || 'direct'
      });
      return { data: { success: true, message: 'Click queued' } };

    } catch (err: any) {
      return ctx.badRequest(err.message);
    }
  },

  // GET /api/analytics/:linkId
  async getAnalytics(ctx) {
    try {
      const { linkId } = ctx.params;
      const userId = ctx.state.user?.id;

      if (!userId) return ctx.unauthorized();

      const stats = await strapi.service('api::analytics.analytics').getAnalytics(linkId, userId);

      return { data: stats };

    } catch (err: any) {
      if (err.name === 'NotFoundError') return ctx.notFound(err.message);
      if (err.name === 'UnauthorizedError') return ctx.forbidden(err.message);
      return ctx.badRequest(err.message);
    }
  }
});