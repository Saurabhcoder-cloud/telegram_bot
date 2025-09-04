module.exports = {
  apps: [
    {
      name: "telegram-demo-bot",
      script: "dist/index.js",
      env: {
        NODE_ENV: "production"
      },
      watch: false,
      max_memory_restart: "250M"
    }
  ]
};