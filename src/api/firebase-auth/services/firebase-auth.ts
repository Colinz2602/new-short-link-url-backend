import path from 'path';

const admin = require(path.join(process.cwd(), 'config', 'firebase-admin.js'));

export default ({ strapi }) => ({
    async googleLogin(idToken: string) {
        // Verify Token
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        const { email } = decodedToken;

        // Tìm hoặc tạo User
        let user = await strapi.db.query('plugin::users-permissions.user').findOne({
            where: { email },
        });

        if (!user) {
            const role = await strapi.db.query('plugin::users-permissions.role').findOne({
                where: { type: 'authenticated' },
            });
            const username = email.split('@')[0] + '_' + Date.now().toString().slice(-4);

            user = await strapi.plugin('users-permissions').service('user').add({
                username,
                email,
                provider: 'firebase',
                confirmed: true,
                blocked: false,
                role: role.id,
            });
        }

        const jwt = strapi.plugin('users-permissions').service('jwt').issue({
            id: user.id,
        });

        return {
            jwt,
            user: {
                id: user.id,
                email: user.email,
                username: user.username,
            },
        };
    },
});