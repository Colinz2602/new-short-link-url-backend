export default {
    routes: [
        {
            method: 'POST',
            path: '/links/verify',
            handler: 'link.verify',
        },
        {
            method: 'GET',
            path: '/links/:slug',
            handler: 'link.redirect',
            config: {
                auth: false,
                middlewares: ['api::link.geo-detect'],
            },
        },
        {
            method: 'POST',
            path: '/links/bulk',
            handler: 'link.bulkImport',
            config: {
                policies: ['global::is-authenticated'],
                payload: {
                    parse: true,
                    allow: 'multipart/form-data',
                    maxSize: 10 * 1024 * 1024,
                },
            },
        },
        {
            method: 'POST',
            path: '/links/:id/qr',
            handler: 'link.generateQr',
            config: {
                policies: ['global::is-authenticated'],
            },
        },
    ],
};