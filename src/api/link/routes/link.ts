import { factories } from '@strapi/strapi';

export default factories.createCoreRouter('api::link.link', {
    config: {
        create: {
            policies: [],
        },
        find: {
            policies: ['global::is-authenticated'],
        },
        findOne: {
            policies: [],
        },
        update: {
            policies: ['global::is-authenticated'],
        },
        delete: {
            policies: ['global::is-authenticated'],
        },
    },
});
