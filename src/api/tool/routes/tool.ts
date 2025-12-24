/**
 * tool router
 */

import { factories } from '@strapi/strapi';

export default factories.createCoreRouter('api::tool.tool', {
    config: {
        find: {
            policies: [],
            middlewares: [],
        },
        findOne: {
            policies: [],
            middlewares: [],
        },
    },
});
