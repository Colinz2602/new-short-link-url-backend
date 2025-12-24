export default {
    routes: [
        {
            method: 'POST',
            path: '/ai/script',
            handler: 'ai.script',
            config: {
                policies: [],
                middlewares: [],
            },
        },
        {
            method: 'POST',
            path: '/ai/insights',
            handler: 'ai.insights',
            config: {
                policies: [],
                middlewares: [],
            },
        },
    ],
};