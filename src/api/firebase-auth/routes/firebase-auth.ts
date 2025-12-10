export default {
  routes: [
    {
      method: 'POST',
      path: '/auth/google',
      handler: 'firebase-auth.googleLogin',
      config: {
        auth: false,
      },
    }
  ],
};
