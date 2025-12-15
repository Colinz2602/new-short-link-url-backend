/**
 * domain router
 */

import { factories } from '@strapi/strapi';

export default factories.createCoreRouter('api::domain.domain', {
    config: {
        find: {
            auth: false,
            policies: [],
            middlewares: [],
        },
    },
})
