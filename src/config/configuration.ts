export default () => ({
  app: {
    name: process.env.APP_NAME,
    port: Number(process.env.APP_PORT) || 3000,
    env: process.env.NODE_ENV,
  },
});
