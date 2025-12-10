export default ({ strapi }) => ({
  async googleLogin(ctx) {
    try {
      const { idToken } = ctx.request.body;
      if (!idToken) return ctx.badRequest('Missing idToken');

      const result = await strapi
        .service('api::firebase-auth.firebase-auth')
        .googleLogin(idToken);
      return { data: result };

    } catch (err: any) {
      ctx.badRequest('Authentication failed', { error: err.message });
    }
  },
});