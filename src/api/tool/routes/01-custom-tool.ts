export default {
    routes: [
        {
            method: 'POST',
            path: '/scraper/facebook',
            handler: 'tool.scrapeFacebook',
            config: {
                policies: [],
                middlewares: [],
            },
        },
    ],
};