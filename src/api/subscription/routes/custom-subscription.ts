export default {
    routes: [
        {
            method: 'POST',
            path: '/payment/checkout',
            handler: 'subscription.createCheckoutSession',
            config: { policies: ['global::is-authenticated'] },
        },
        {
            method: 'POST',
            path: '/payment/webhook',
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