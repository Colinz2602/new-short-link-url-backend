export default {
  routes: [
    {
      method: 'POST',
      path: '/analytics/click',
      handler: 'analytics.logClick',
      config: {
        auth: false,
        middlewares: ['api::link.geo-detect'],
        policies: [],
      },
    },
    {
      method: 'GET',
      path: '/analytics/:linkId',
      handler: 'analytics.getAnalytics',
      config: {
        policies: ['global::is-authenticated']
      },
    }
  ],
};
