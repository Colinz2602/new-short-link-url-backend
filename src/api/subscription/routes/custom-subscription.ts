export default {
    routes: [
        {
            method: 'POST',
            path: '/subscriptions/checkout',
            handler: 'subscription.createCheckoutSession',
            config: { policies: ['global::is-authenticated'] },
        },
        {
            method: 'POST',
            path: '/subscriptions/webhook',
            handler: 'subscription.webhook',
            config: { auth: false },
        },
        {
            method: 'GET',
            path: '/subscriptions/me',
            handler: 'subscription.getMySubscription',
            config: { policies: ['global::is-authenticated'] },
        }
    ]
}