export default ({ strapi }) => ({
  // POST /api/ai/script
  async script(ctx) {
    const { url, platform, tone } = ctx.request.body;
    if (!url || !platform) {
      return ctx.badRequest('URL and Platform are required fields.');
    }

    try {
      const result = await strapi.service('api::ai.ai').generateScript({
        url,
        platform,
        tone
      });
      ctx.body = { data: result };
    } catch (err: any) {
      console.error("LỖI AI CONTROLLER:", err);
      return ctx.badRequest('AI Error', {
        message: err.message,
        details: err.response?.data || err
      });
    }
  },

  async insights(ctx) {
    const { linkId } = ctx.request.body;
    if (!linkId) {
      return ctx.badRequest('Missing linkId');
    }

    try {
      const result = await strapi.service('api::ai.ai').generateAdInsights(linkId);
      ctx.body = result;
    } catch (err) {
      ctx.badRequest('AI Analysis Failed', { moreDetails: err });
    }
  }
});